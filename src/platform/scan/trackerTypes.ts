/** Types shared by the interaction tracker. */

import type { HostInteraction, ItemView } from "../../core/host/host.js";
import type { ExpectedSlots, SlotProbe } from "./slotMatching.js";

/** An item that left a UI-owned slot and has not been located yet. */
export interface PendingTake {
    /** Slot it left. */
    surfaceSlot: number;
    /** What the slot held. */
    item: ItemView | null;
    /** The item's type id, for matching where it went. */
    typeId: string;
    /** The item's name, for matching where it went. */
    name: string;
    /** How many items to reclaim once located. */
    amount: number;
    /** Passes spent waiting. */
    ticksWaiting: number;
    /** Passes its item has been held on the cursor, which pauses the wait for a while. */
    ticksHeld: number;
    /** Whether locating it reports an interaction; `false` for the displaced half of a swap. */
    shouldFireTrigger: boolean;
    /** Whether its wait on the cursor has been reported. */
    isHoldReported?: boolean;
    /** Pulled onto the cursor by a collect-all double-click: restored, never fired. */
    isGathered?: boolean;
}

/** Where a pending take's item was found. */
export type TakeResolution = "surface" | "player-inventory" | "ground" | "returned" | "cursor" | "input" | "swept";

/** The surface side of the tracker: its slots, its handlers, and its lifetime. */
export interface SurfaceIO {
    /** Surface slot count. */
    slotCount: number;
    /** What each surface slot should hold. */
    expected: ExpectedSlots;

    /** Cheap read of a surface slot: type, amount and name. */
    probeSurface(index: number): SlotProbe | null;
    /** Full read of a surface slot. */
    readSurface(index: number): ItemView | null;
    /** Writes a surface slot without telling the core, keeping `expected` in step. */
    restoreSurface(index: number, item: ItemView | null): void;

    /** Whether the player owns the slot: an `input`. */
    isPlayerWritable(index: number): boolean;

    /** Reports an interaction to the surface's handlers. */
    emit(interaction: HostInteraction): void;
    /** Whether the surface has closed. */
    isClosed(): boolean;
    /** Passes a take may wait to be located before it is abandoned. */
    maxPendingTicks: number;
    /** Receives tracking records. */
    report?(message: string): void;
}

/** The viewer side of the tracker: their cursor and their inventory. */
export interface ViewerIO {
    /** What the player holds on the cursor, or `null`. */
    probeCursor(): SlotProbe | null;
    /**
     * Takes a rendered copy off the cursor.
     *
     * @returns How many items went; 0 when the cursor held nothing of ours.
     */
    reclaimFromCursor?(): number;
    /** Full read of what the cursor holds, lore included, or `null`. */
    readCursor?(): ItemView | null;
    /** Whether the cursor holds a rendered copy rather than a player's item. */
    isCursorRendered?(): boolean;
    /** Whether a player slot holds a rendered copy rather than a player's item. */
    isPlayerSlotRendered?(index: number): boolean;
    /** Rendered copies the inventory sweep removed since the last call. */
    takeSwept?(): readonly SlotProbe[];

    /** Slots in the player's inventory, or 0 when it cannot be read. */
    playerSlotCount(): number;
    /** Whether the player's inventory may have changed since the last call. Omit to diff every pass. */
    takePlayerInventoryChange?(): boolean;
    /** Cheap read of a player slot. */
    probePlayer(index: number): SlotProbe | null;
    /** Full read of a player slot. */
    readPlayer(index: number): ItemView | null;
    /** Removes `amount` items from a player slot. */
    reducePlayer(index: number, amount: number): void;
    /**
     * Gives an item back to the player: into `originSlot` when free, else anywhere in the
     * inventory, else at their feet.
     *
     * @returns `false` only when the item could not be given at all.
     */
    returnToPlayer(originSlot: number | null, item: ItemView): boolean;
}

/** Everything the tracker reads and writes. */
export interface TrackerIO extends SurfaceIO, ViewerIO {}

/** What one scan pass saw. */
export interface ScanPassResult {
    /** Surface slots examined before the pass ended. */
    slotsScanned: number;
    /** Surface slots that did not hold what was expected. */
    changedSlots: number;
    /** Interactions reported. */
    interactionCount: number;
    /** Takes still waiting to be located. */
    pendingCount: number;
    /** Whether the pass stopped early because the surface closed. */
    isStoppedEarly: boolean;
}

/** An item that appeared in a UI-owned slot during a pass. */
export interface Insertion {
    /** Slot it appeared in. */
    surfaceSlot: number;
    /** The full view of what appeared. */
    item: ItemView;
    /** Its probe, for matching an origin. */
    probe: SlotProbe;
    /** What the core still believes the slot holds. */
    previous: ItemView | null;
}

/** A player slot that lost items: where an inserted item probably came from. Kept across passes. */
export interface Origin {
    /** The player slot that lost items. */
    playerSlot: number;
    /** What it lost. */
    probe: SlotProbe;
    /** Passes it has been kept. */
    ticksWaiting: number;
}

/** Why a pass diffs the player's inventory. */
export type PlayerScanReason = "prime" | "changed" | "gesture" | "resync";
