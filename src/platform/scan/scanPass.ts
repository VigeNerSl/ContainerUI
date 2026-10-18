/**
 * Interaction detection: decides what a change in a surface slot means.
 *
 * A take from a UI-owned slot waits until its item is located, then fires once. An item pushed
 * into a UI-owned slot goes back to the player. Changes in input slots are reported at once.
 */

import type { ItemView } from "../../core/host/host.js";
import { HeldGroundEvents } from "./heldGround.js";
import { LookalikeWatch } from "./lookalikeWatch.js";
import { isKindOf, isLotOf, isRelocationOf, isReturnOf, isViewOf, PendingTakes, type TakeMatcher } from "./pendingTakes.js";
import { PlayerInventoryDiff } from "./playerInventoryDiff.js";
import { interactionKindOf, isRenderedView, isSameVisibleItem, probeOfView, type SlotProbe } from "./slotMatching.js";
import type { Insertion, PendingTake, ScanPassResult, TakeResolution, TrackerIO } from "./trackerTypes.js";

export { ExpectedSlots, isSameItemKind, type SlotProbe } from "./slotMatching.js";
export type { PendingTake, ScanPassResult, TakeResolution, TrackerIO } from "./trackerTypes.js";

/** Interaction detection for one surface. */
export class InteractionTracker {
    readonly #io: TrackerIO;
    readonly #pending: PendingTakes;
    readonly #heldGround = new HeldGroundEvents();
    readonly #playerDiff: PlayerInventoryDiff;
    readonly #lookalikes: LookalikeWatch;
    #interactionCount = 0;
    #changedSlots = 0;

    /** @param io The reads and writes the tracker works through. */
    constructor(io: TrackerIO) {
        this.#io = io;
        this.#pending = new PendingTakes(io);
        this.#lookalikes = new LookalikeWatch(io, (probe) => this.#pending.hasKind(probe));
        this.#playerDiff = new PlayerInventoryDiff(io, {
            hasPending: () => this.#pending.count > 0,
            hasPendingOfKind: (probe) => this.#pending.hasKind(probe),
            resolveInPlayerSlot: (index) => this.#resolveInPlayerSlot(index),
            isUiKind: (kind) => this.#lookalikes.isUiKind(kind),
            watchCursor: () => this.#lookalikes.watchCursor(),
            suspectCopyAt: (index, probe) => this.#lookalikes.suspectCopyAt(index, probe),
        });
    }

    /** Number of takes waiting to be located. */
    get pendingCount(): number {
        return this.#pending.count;
    }

    /** The takes waiting to be located. */
    get pending(): readonly PendingTake[] {
        return this.#pending.all;
    }

    /** Ground events waiting for a take that has not appeared yet. */
    get heldGroundCount(): number {
        return this.#heldGround.count;
    }

    /** Passes that diffed the viewer's inventory. */
    get playerScanCount(): number {
        return this.#playerDiff.scanCount;
    }

    /** Inventory resyncs that found a change no event reported. */
    get inventoryDriftCount(): number {
        return this.#playerDiff.driftCount;
    }

    /**
     * Runs one scan pass over every surface slot.
     *
     * @returns What the pass saw.
     */
    runPass(): ScanPassResult {
        const io = this.#io;
        this.#interactionCount = 0;
        this.#changedSlots = 0;
        if (io.isClosed()) return this.#result(0, true);

        const insertions: Insertion[] = [];
        const inputCopies: Insertion[] = [];
        const slotsScanned = this.#scanSlots(insertions, inputCopies);
        if (io.isClosed()) return this.#result(slotsScanned, true);

        const isClosed = this.#settle(insertions, inputCopies);
        return this.#result(slotsScanned, isClosed);
    }

    /**
     * Compares every surface slot with what it should hold: input edits report at once, takes queue,
     * insertions and copies dropped into inputs are collected for {@link #settle}.
     *
     * @returns How many slots were examined; fewer than all when a handler closed the surface.
     */
    #scanSlots(insertions: Insertion[], inputCopies: Insertion[]): number {
        const io = this.#io;
        const isClosedBySuspect = this.#lookalikes.reconcile((index, view) =>
            this.#handleChange({ index, probe: probeOfView(view), insertions, inputCopies }),
        );
        if (isClosedBySuspect) return 0;

        let slotsScanned = 0;
        // Only a handler can close the surface mid-loop, and handlers run through `#emit`.
        for (let index = 0; index < io.slotCount; index++) {
            slotsScanned++;
            const probe = io.probeSurface(index);
            if (io.expected.matches(index, probe)) continue;
            if (this.#handleChange({ index, probe, insertions, inputCopies })) return slotsScanned;
        }
        return slotsScanned;
    }

    /**
     * Decides what one changed surface slot means.
     *
     * @returns Whether a handler closed the surface.
     */
    #handleChange({
        index,
        probe,
        insertions,
        inputCopies,
    }: {
        index: number;
        probe: SlotProbe | null;
        insertions: Insertion[];
        inputCopies: Insertion[];
    }): boolean {
        const io = this.#io;
        this.#changedSlots++;

        const previous = io.expected.view(index);
        const next = probe ? io.readSurface(index) : null;

        if (io.isPlayerWritable(index)) {
            if (next && probe && isRenderedView(next)) {
                inputCopies.push({ surfaceSlot: index, item: next, probe, previous });
                return false;
            }
            io.expected.record(index, next);
            this.#emit({ index, previous, next });
            return io.isClosed();
        }

        io.expected.record(index, next);

        const previousProbe = previous ? probeOfView(previous) : null;

        // Same item, different count: a split, not a swap.
        if (previous && previousProbe && next && probe && isSameVisibleItem(previous, next)) {
            const delta = (previous.amount ?? 1) - probe.amount;
            if (delta > 0) {
                const isGathered = this.#pending.isGathering(previous, delta);
                this.#pending.add({
                    index,
                    item: previous,
                    probe: previousProbe,
                    amount: delta,
                    shouldFireTrigger: !isGathered,
                    isGathered,
                });
            } else if (delta < 0) {
                // Only another marked copy can stack onto a button: put the extra back.
                io.report?.(`stack-grew slot=${index} item=${probe.typeId} by=${-delta}`);
                io.restoreSurface(index, previous);
            }
            return false;
        }

        const isSwap = Boolean(previous && next && probe);

        if (previous && previousProbe) {
            const isGathered = !isSwap && this.#pending.isGathering(previous, previousProbe.amount);
            this.#pending.add({
                index,
                item: previous,
                probe: previousProbe,
                amount: previousProbe.amount,
                shouldFireTrigger: !isSwap && !isGathered,
                isGathered,
            });
        }
        if (next && probe) {
            insertions.push({ surfaceSlot: index, item: next, probe, previous });
        }
        return false;
    }

    /**
     * Resolves what the slot scan collected, in order, stopping as soon as a handler closes the
     * surface; then ages what is still waiting.
     *
     * @returns Whether the surface closed.
     */
    #settle(insertions: Insertion[], inputCopies: Insertion[]): boolean {
        const io = this.#io;
        this.#refuseInputCopies(inputCopies);
        if (io.isClosed()) return true;
        this.#resolveRelocations(insertions);
        if (io.isClosed()) return true;
        this.#playerDiff.scanIfNeeded(insertions.length > 0);
        if (io.isClosed()) return true;
        this.#returnInsertions(insertions);
        if (io.isClosed()) return true;
        this.#resolveFromCursor();
        if (io.isClosed()) return true;
        this.#resolveFromSweep();
        if (io.isClosed()) return true;
        this.#resolveFromHeldGround();
        if (io.isClosed()) return true;

        this.#pending.age();
        this.#heldGround.age();
        this.#playerDiff.age();
        return io.isClosed();
    }

    /**
     * Resolves a pending take from a marked copy destroyed on the ground. A copy destroyed before
     * its take was seen is held for a few passes and resolves the take created next.
     *
     * @param probe The destroyed item.
     * @param options.shouldHold Whether an unclaimed event waits for its take. Defaults to `true`;
     * an event that names no thrower may belong to anyone, and is not worth holding.
     * @returns Whether a take resolved.
     */
    resolveFromGround(probe: SlotProbe, { shouldHold = true }: { shouldHold?: boolean } = {}): boolean {
        const isResolved = this.#resolveTake({ matches: this.#removedMatcher(probe), arrived: probe.amount, resolution: "ground" });
        if (!isResolved && shouldHold) this.#heldGround.hold(probe);
        return isResolved;
    }

    /**
     * Marks a slot as repainted by the UI. Takes pending on it no longer fire; each still reclaims
     * its copy.
     *
     * @param index Surface slot.
     */
    invalidatePending(index: number): void {
        this.#pending.invalidate(index);
    }

    /** Drops every pending take and origin. */
    clear(): void {
        this.#pending.clear();
        this.#heldGround.clear();
        this.#lookalikes.clear();
        this.#playerDiff.clear();
    }

    /**
     * Fires the oldest take `matches` accepts, then the further takes the arrived stack carries.
     *
     * @returns Whether a take resolved.
     */
    #resolveTake({
        matches,
        surplusMatches = matches,
        arrived,
        resolution,
    }: {
        matches: TakeMatcher;
        surplusMatches?: TakeMatcher;
        arrived: number;
        resolution: TakeResolution;
    }): boolean {
        const take = this.#pending.takeFirst(matches);
        if (!take) return false;
        this.#fire(take, resolution);
        this.#settleSurplus({ matches: surplusMatches, surplus: arrived - take.amount, resolution });
        return true;
    }

    /** Resolves the further takes carried by a stack larger than the take it resolved. */
    #settleSurplus({ matches, surplus, resolution }: { matches: TakeMatcher; surplus: number; resolution: TakeResolution }): void {
        let remaining = surplus;
        while (remaining > 0) {
            const take = this.#pending.takeFirst(matches);
            if (!take) return;
            remaining -= take.amount;
            this.#fire(take, resolution);
            if (this.#io.isClosed()) return;
        }
    }

    #result(slotsScanned: number, isStoppedEarly: boolean): ScanPassResult {
        return {
            slotsScanned,
            changedSlots: this.#changedSlots,
            interactionCount: this.#interactionCount,
            pendingCount: this.#pending.count,
            isStoppedEarly,
        };
    }

    #emit({ index, previous, next }: { index: number; previous: ItemView | null; next: ItemView | null }): void {
        this.#interactionCount++;
        this.#io.emit({ index, kind: interactionKindOf(previous, next), previous, next });
    }

    /** Completes a located take: fires it, or only reclaims it for a swap or a gather. */
    #fire(take: PendingTake, resolution: TakeResolution): void {
        if (take.isGathered) {
            this.#io.report?.(`take-resolved slot=${take.surfaceSlot} item=${take.typeId} via=${resolution} outcome=gathered`);
            this.#io.restoreSurface(take.surfaceSlot, take.item);
            return;
        }
        const outcome = take.shouldFireTrigger ? "fired" : "reclaimed";
        this.#io.report?.(`take-resolved slot=${take.surfaceSlot} item=${take.typeId} via=${resolution} outcome=${outcome}`);
        if (!take.shouldFireTrigger) return;
        if (take.item) this.#pending.rememberFire(take.item);
        this.#emit({ index: take.surfaceSlot, previous: take.item, next: null });
    }

    /** Resolves items dragged from one UI-owned slot to another. */
    #resolveRelocations(insertions: Insertion[]): void {
        for (let index = insertions.length - 1; index >= 0; index--) {
            const insertion = insertions[index]!;
            // A slot's own item coming back is matched before any other slot's take.
            if (this.#resolveReturnHome(insertion)) {
                insertions.splice(index, 1);
                continue;
            }
            const take = this.#pending.takeFirst(isRelocationOf(insertion));
            if (!take) continue;

            insertions.splice(index, 1);
            this.#io.restoreSurface(insertion.surfaceSlot, insertion.previous);
            this.#fire(take, "surface");
            this.#settleSurplus({
                matches: isViewOf(insertion.item),
                surplus: (insertion.item.amount ?? 1) - take.amount,
                resolution: "surface",
            });
        }
    }

    /** Resolves a lifted button put straight back into the slot it came from. */
    #resolveReturnHome(insertion: Insertion): boolean {
        if (insertion.previous !== null) return false;
        return this.#resolveTake({
            matches: isReturnOf(insertion),
            surplusMatches: isViewOf(insertion.item),
            arrived: insertion.item.amount ?? 1,
            resolution: "returned",
        });
    }

    /** Reclaims every pending take held by the stack in a player slot. */
    #resolveInPlayerSlot(index: number): boolean {
        const io = this.#io;
        let current = io.readPlayer(index);
        let hasResolved = false;

        while (current) {
            const take = this.#pending.takeFirst(isViewOf(current));
            if (!take) break;
            hasResolved = true;

            // Reclaim before firing: the handler may open another surface.
            io.reducePlayer(index, take.amount);
            this.#fire(take, "player-inventory");
            if (io.isClosed()) return hasResolved;
            current = io.readPlayer(index);
        }
        return hasResolved;
    }

    /** Reclaims a marked copy from the cursor and fires its take. */
    #resolveFromCursor(): void {
        const io = this.#io;
        if (!io.reclaimFromCursor || this.#pending.count === 0) return;
        const cursor = io.probeCursor();
        if (!cursor || !this.#pending.hasKind(cursor)) return;

        const matches = this.#cursorMatcher(cursor);
        const reclaimed = io.reclaimFromCursor();
        if (reclaimed <= 0) return;
        this.#resolveTake({ matches, arrived: reclaimed, resolution: "cursor" });
    }

    /**
     * Picks the take a cursor stack belongs to. A probe has no lore, so when several pending takes
     * share the cursor stack's kind the stack is read in full and matched against them; a stack
     * that matches none of them falls back to its kind.
     */
    #cursorMatcher(cursor: SlotProbe): TakeMatcher {
        const io = this.#io;
        const byKind = isKindOf(cursor);
        if (this.#pending.countOfKind(cursor) < 2) return byKind;

        const view = io.readCursor?.();
        if (!view) return byKind;
        const byView = isViewOf(view);
        return this.#pending.all.some(byView) ? byView : byKind;
    }

    /**
     * Picks the take a removed copy belongs to. The guard and the sweeps read the copy's lore, so when
     * several pending takes share its kind the one carrying that lore is picked; a copy whose lore
     * matches none of them falls back to its kind.
     */
    #removedMatcher(probe: SlotProbe): TakeMatcher {
        const byKind = isKindOf(probe);
        if (probe.lore === undefined || this.#pending.countOfKind(probe) < 2) return byKind;
        const byLot = isLotOf(probe);
        return this.#pending.all.some(byLot) ? byLot : byKind;
    }

    /** Resolves takes whose copies were destroyed on the ground before the take was seen. */
    #resolveFromHeldGround(): void {
        if (this.#heldGround.count === 0 || this.#pending.count === 0) return;
        for (const probe of this.#heldGround.all) {
            if (!this.#pending.hasKind(probe)) continue;
            this.#heldGround.release(probe);
            this.#resolveTake({ matches: this.#removedMatcher(probe), arrived: probe.amount, resolution: "ground" });
            if (this.#io.isClosed()) return;
        }
    }

    /** Removes marked copies dropped into inputs, and resolves their takes. */
    #refuseInputCopies(copies: Insertion[]): void {
        const io = this.#io;
        for (const copy of copies) {
            io.restoreSurface(copy.surfaceSlot, null);
            if (copy.previous) this.#emit({ index: copy.surfaceSlot, previous: copy.previous, next: null });
            if (io.isClosed()) return;

            const hasResolved = this.#resolveTake({ matches: isViewOf(copy.item), arrived: copy.item.amount ?? 1, resolution: "input" });
            if (!hasResolved) {
                io.report?.(`input-copy-removed slot=${copy.surfaceSlot} item=${copy.probe.typeId} reason=no-pending-take`);
                continue;
            }
            if (io.isClosed()) return;
        }
    }

    /** Resolves takes whose copies the inventory sweep removed first. */
    #resolveFromSweep(): void {
        const swept = this.#io.takeSwept?.() ?? [];
        for (const probe of swept) {
            if (!this.#resolveTake({ matches: this.#removedMatcher(probe), arrived: probe.amount, resolution: "swept" })) continue;
            if (this.#io.isClosed()) return;
        }
    }

    /**
     * Returns items pushed into UI-owned slots to the player, and reports each. A rendered copy is
     * never returned: handing it back would build a real item from it. Its slot is repainted instead.
     *
     * A returned item leaves the slot at once, before its handler runs: the handler may close the
     * surface, and a closed surface neither repaints nor knows the slot still holds the item.
     */
    #returnInsertions(insertions: Insertion[]): void {
        const io = this.#io;

        for (const insertion of insertions) {
            if (isRenderedView(insertion.item)) {
                io.report?.(`insert-copy-restored slot=${insertion.surfaceSlot} item=${insertion.probe.typeId}`);
                io.restoreSurface(insertion.surfaceSlot, insertion.previous);
                if (io.isClosed()) return;
                continue;
            }
            const origin = this.#playerDiff.takeOrigin(insertion.probe);

            const isReturned = io.returnToPlayer(origin?.playerSlot ?? null, insertion.item);
            if (!isReturned) {
                io.report?.(`insert-stranded slot=${insertion.surfaceSlot} item=${insertion.probe.typeId} reason=return-failed`);
                continue;
            }

            io.report?.(
                `insert-returned slot=${insertion.surfaceSlot} item=${insertion.probe.typeId} to=${origin?.playerSlot ?? "anywhere"}`,
            );
            io.restoreSurface(insertion.surfaceSlot, insertion.previous);
            if (io.isClosed()) return;
            this.#emit({ index: insertion.surfaceSlot, previous: insertion.previous, next: insertion.item });
            if (io.isClosed()) return;
        }
    }
}
