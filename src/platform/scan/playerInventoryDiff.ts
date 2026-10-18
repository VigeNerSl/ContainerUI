/**
 * The player-inventory side of interaction detection: a snapshot diff that finds taken copies and
 * where inserted items came from.
 */

import { isSameItemKind, Signatures, type SlotProbe } from "./slotMatching.js";
import type { Origin, PlayerScanReason, TrackerIO } from "./trackerTypes.js";

/** What the diff needs from the tracker that owns the pending takes. */
export interface PlayerDiffHost {
    /** Whether any take is pending. */
    hasPending(): boolean;
    /** Whether a pending take could be in a stack of this kind. */
    hasPendingOfKind(probe: SlotProbe): boolean;
    /** Reclaims every pending take the stack in `index` holds. `true` when any resolved. */
    resolveInPlayerSlot(index: number): boolean;
    /** Whether a UI-owned slot holds this kind of item. */
    isUiKind(kind: { typeId: string; name: string }): boolean;
    /** Starts watching the cursor: the player lifted something that looks like a button. */
    watchCursor(): void;
    /**
     * Reports a player slot that may hold a copy of a button the player swapped for.
     *
     * @returns Whether it does.
     */
    suspectCopyAt(index: number, probe: SlotProbe): boolean;
}

/** Diffs the viewer's inventory on the passes that need it. */
export class PlayerInventoryDiff {
    readonly #io: TrackerIO;
    readonly #host: PlayerDiffHost;
    readonly #signatures = new Signatures();
    #origins: Origin[] = [];
    #passesSinceScan = 0;
    #scanCount = 0;
    #driftCount = 0;

    /**
     * @param io The tracker's reads and writes.
     * @param host The tracker's pending takes.
     */
    constructor(io: TrackerIO, host: PlayerDiffHost) {
        this.#io = io;
        this.#host = host;
    }

    /** Passes that diffed the player's inventory. */
    get scanCount(): number {
        return this.#scanCount;
    }

    /** Resyncs that found a change no event reported. */
    get driftCount(): number {
        return this.#driftCount;
    }

    /**
     * Diffs the player's inventory if this pass needs it.
     *
     * @param hasInsertions Whether items were pushed into UI-owned slots this pass.
     */
    scanIfNeeded(hasInsertions: boolean): void {
        const reason = this.#scanReason(hasInsertions);
        if (!reason) {
            this.#passesSinceScan++;
            return;
        }
        this.#passesSinceScan = 0;
        this.#scanCount++;
        const changedSlots = this.#scan();
        if (reason === "changed" && changedSlots === 0 && this.#io.takePlayerInventoryChange !== undefined) this.#checkUnexplainedChange();

        // Only a resync can find a change nobody reported.
        if (reason !== "resync" || changedSlots === 0) return;
        this.#driftCount++;
        this.#io.report?.(`inventory-drift slots=${changedSlots} reason=unreported-change`);
    }

    /** Takes the likeliest origin for an insertion of this kind, or `null`. */
    takeOrigin(probe: SlotProbe): Origin | null {
        const at = this.#origins.findIndex((origin) => isSameItemKind(probe, origin.probe));
        if (at === -1) return null;
        return this.#origins.splice(at, 1)[0] ?? null;
    }

    /** Forgets origins older than the take limit. */
    age(): void {
        if (this.#origins.length === 0) return;

        const survivors: Origin[] = [];
        for (const origin of this.#origins) {
            origin.ticksWaiting++;
            if (origin.ticksWaiting <= this.#io.maxPendingTicks) survivors.push(origin);
        }
        this.#origins = survivors;
    }

    /** Drops every origin. */
    clear(): void {
        this.#origins = [];
    }

    /**
     * The engine reported a change that moved no probe: a stack swapped for one that reads the same.
     * A slot that holds a rendered copy of a button kind is forgotten, so the next diff sees the copy
     * arrive and the tracker can look for the player's stack it displaced.
     */
    #checkUnexplainedChange(): void {
        const { size } = this.#signatures;
        for (let index = 0; index < size; index++) {
            const typeId = this.#signatures.typeIdAt(index);
            if (typeId === "") continue;
            const name = this.#signatures.nameAt(index);
            if (!this.#host.isUiKind({ typeId, name })) continue;
            const probe = { typeId, amount: this.#signatures.amountAt(index), name };
            if (this.#host.suspectCopyAt(index, probe)) this.#signatures.record(index, null);
        }
    }

    /**
     * Why this pass diffs the inventory, or `null` to skip it: `prime` (no snapshot yet),
     * `changed` (the engine reported a change), `gesture` (a take or an insertion is in flight),
     * `resync` (nothing asked for a while).
     */
    #scanReason(hasInsertions: boolean): PlayerScanReason | null {
        const hasChanged = this.#io.takePlayerInventoryChange?.() ?? true;
        if (!this.#signatures.isPrimed) return "prime";
        if (hasChanged) return "changed";
        if (hasInsertions || this.#host.hasPending()) return "gesture";
        if (this.#passesSinceScan >= this.#io.maxPendingTicks) return "resync";
        return null;
    }

    /**
     * Diffs the inventory against the snapshot, resolving pending takes and recording origins.
     *
     * @returns How many slots changed.
     */
    #scan(): number {
        const io = this.#io;
        const size = io.playerSlotCount();
        if (size <= 0) return 0;
        let changedSlots = 0;

        this.#signatures.resize(size);
        const wasPrimed = this.#signatures.isPrimed;

        for (let index = 0; index < size; index++) {
            const probe = io.probePlayer(index);

            if (!wasPrimed) {
                this.#signatures.record(index, probe);
                continue;
            }

            const previousTypeId = this.#signatures.typeIdAt(index);
            const previousAmount = this.#signatures.amountAt(index);
            const previousName = this.#signatures.nameAt(index);

            const typeId = probe?.typeId ?? "";
            const amount = probe?.amount ?? 0;
            const name = probe?.name ?? "";
            const isSameStack = typeId === previousTypeId && name === previousName;

            const hasGained = typeId !== "" && (!isSameStack || amount > previousAmount);
            const hasLost = previousTypeId !== "" && (!isSameStack || amount < previousAmount);
            if (hasGained || hasLost) changedSlots++;

            if (hasLost) {
                this.#origins.push({
                    playerSlot: index,
                    probe: { typeId: previousTypeId, amount: previousAmount - (isSameStack ? amount : 0), name: previousName },
                    ticksWaiting: 0,
                });
                if (this.#host.isUiKind({ typeId: previousTypeId, name: previousName })) this.#host.watchCursor();
            }

            this.#signatures.record(index, probe);
            if (!probe) continue;

            // Any change may hold one of ours, a swap that lowers the count included.
            const hasChanged = !isSameStack || amount !== previousAmount;
            if (!hasChanged || !this.#host.hasPendingOfKind(probe)) continue;

            const hasResolved = this.#host.resolveInPlayerSlot(index);
            if (io.isClosed()) return changedSlots;

            this.#signatures.record(index, io.probePlayer(index));
            if (hasResolved) continue;

            // Not ours: an origin it matches is spent.
            this.takeOrigin(probe);
        }

        this.#signatures.prime();
        return changedSlots;
    }
}
