/** The takes waiting to be located, and the matchers that pick one. */

import { areLoresEqual, type ItemView } from "../../core/host/host.js";
import { isSameItemKind, isSameVisibleItem, probeOfView, type SlotProbe } from "./slotMatching.js";
import { GATHER_MEMORY_TICKS, MAX_CURSOR_HOLD_TICKS } from "../constants.js";
import type { Insertion, PendingTake, TrackerIO } from "./trackerTypes.js";

/** Picks a take out of the queue. */
export type TakeMatcher = (take: PendingTake) => boolean;

/** Matches a take of the same kind: type and name. */
export const isKindOf =
    (probe: SlotProbe): TakeMatcher =>
    (take) =>
        isSameItemKind(probe, { typeId: take.typeId, amount: 1, name: take.name });

/** Matches the take whose item was dragged into another slot. */
export const isRelocationOf =
    (insertion: Insertion): TakeMatcher =>
    (take) =>
        take.surfaceSlot !== insertion.surfaceSlot && isSameVisibleItem(insertion.item, take.item);

/** Matches the take whose item came back to its own slot. */
export const isReturnOf =
    (insertion: Insertion): TakeMatcher =>
    (take) =>
        take.surfaceSlot === insertion.surfaceSlot && isSameVisibleItem(insertion.item, take.item);

/** Matches a take of the same kind whose item carries the probe's lore. A probe without lore matches by kind. */
export const isLotOf =
    (probe: SlotProbe): TakeMatcher =>
    (take) =>
        isKindOf(probe)(take) && (probe.lore === undefined || areLoresEqual(probe.lore, take.item?.lore));

/** Matches a take whose item looks like `view`, lore included. */
export const isViewOf =
    (view: ItemView): TakeMatcher =>
    (take) =>
        isSameVisibleItem(view, take.item);

/** A click that fired a moment ago: a collect-all in the next passes would gather its twins. */
interface RecentFire {
    item: ItemView;
    passesLeft: number;
}

/** A queue of pending takes. */
export class PendingTakes {
    readonly #io: TrackerIO;
    #takes: PendingTake[] = [];
    #recentFires: RecentFire[] = [];

    /** @param io The tracker's reads and writes. */
    constructor(io: TrackerIO) {
        this.#io = io;
    }

    /** Number of pending takes. */
    get count(): number {
        return this.#takes.length;
    }

    /** The pending takes. */
    get all(): readonly PendingTake[] {
        return this.#takes;
    }

    /** Queues a take. */
    add({
        index,
        item,
        probe,
        amount,
        shouldFireTrigger,
        isGathered = false,
    }: {
        index: number;
        item: ItemView;
        probe: SlotProbe;
        amount: number;
        shouldFireTrigger: boolean;
        isGathered?: boolean;
    }): void {
        if (isGathered) this.#io.report?.(`take-gathered slot=${index} item=${probe.typeId}`);
        this.#takes.push({
            surfaceSlot: index,
            item,
            typeId: probe.typeId,
            name: probe.name,
            amount: Math.max(1, amount),
            ticksWaiting: 0,
            ticksHeld: 0,
            shouldFireTrigger,
            isGathered,
            isHoldReported: isGathered,
        });
    }

    /** Removes and returns the oldest take `matches` accepts, or `null`. */
    takeFirst(matches: TakeMatcher): PendingTake | null {
        const at = this.#takes.findIndex(matches);
        if (at === -1) return null;
        return this.#takes.splice(at, 1)[0] ?? null;
    }

    /** Whether a take of this kind is pending: a cheap check before a full read. */
    hasKind(probe: SlotProbe): boolean {
        return this.#takes.some(isKindOf(probe));
    }

    /** How many pending takes are of this kind. */
    countOfKind(probe: SlotProbe): number {
        return this.#takes.filter(isKindOf(probe)).length;
    }

    /** Notes a click that fired, so a collect-all landing a pass or two later is not read as more clicks. */
    rememberFire(item: ItemView): void {
        this.#recentFires.push({ item, passesLeft: GATHER_MEMORY_TICKS });
    }

    /**
     * Whether `item` leaving its slot is a collect-all gathering it rather than a click: an older
     * take of the same item is pending or has just fired, and the cursor holds more of it than this
     * slot gave.
     */
    isGathering(item: ItemView, amount: number): boolean {
        const hasOlderClick =
            this.#takes.some((take) => isSameVisibleItem(take.item, item)) ||
            this.#recentFires.some((fire) => isSameVisibleItem(fire.item, item));
        if (!hasOlderClick) return false;
        const cursor = this.#io.probeCursor();
        if (!cursor || !isSameItemKind(cursor, probeOfView(item))) return false;
        return cursor.amount > amount;
    }

    /** Marks a slot as repainted: its takes still reclaim their copies, but no longer fire. */
    invalidate(index: number): void {
        for (const take of this.#takes) {
            if (take.surfaceSlot !== index || (!take.shouldFireTrigger && !take.isGathered)) continue;
            take.shouldFireTrigger = false;
            // A gathered take would restore its old button over the new contents.
            take.isGathered = false;
            this.#io.report?.(`take-invalidated slot=${index} item=${take.typeId} reason=slot-repainted`);
        }
    }

    /**
     * Ages pending takes and abandons those never located, restoring their slots. A take whose
     * item is on the cursor does not age, until it has been there `MAX_CURSOR_HOLD_TICKS` passes.
     */
    age(): void {
        if (this.#recentFires.length > 0) {
            for (const fire of this.#recentFires) fire.passesLeft--;
            this.#recentFires = this.#recentFires.filter((fire) => fire.passesLeft > 0);
        }
        if (this.#takes.length === 0) return;

        const cursor = this.#io.probeCursor();
        const isOnCursor = cursor ? isKindOf(cursor) : null;

        const survivors: PendingTake[] = [];
        const abandoned: PendingTake[] = [];
        for (const take of this.#takes) {
            if (isOnCursor?.(take) && take.ticksHeld < MAX_CURSOR_HOLD_TICKS) {
                take.ticksHeld++;
                if (!take.isHoldReported) {
                    take.isHoldReported = true;
                    this.#io.report?.(`take-held slot=${take.surfaceSlot} item=${take.typeId} reason=on-cursor`);
                }
                survivors.push(take);
                continue;
            }

            take.ticksWaiting++;
            if (take.ticksWaiting <= this.#io.maxPendingTicks) {
                survivors.push(take);
                continue;
            }
            this.#io.report?.(`take-abandoned slot=${take.surfaceSlot} item=${take.typeId} waited=${take.ticksWaiting}`);
            abandoned.push(take);
        }
        this.#takes = survivors;

        // Restored once the queue no longer holds them: a restore invalidates takes on its slot.
        for (const take of abandoned) {
            // Only takes that would still fire or gather: a repainted slot already holds new contents,
            // and a swapped one is settled with its insertion.
            if (take.shouldFireTrigger || take.isGathered) this.#io.restoreSurface(take.surfaceSlot, take.item);
        }
    }

    /** Drops every take. */
    clear(): void {
        this.#takes = [];
        this.#recentFires = [];
    }
}
