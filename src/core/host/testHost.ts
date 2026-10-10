/** An in-memory host for tests: records writes and simulates player actions. */

import { cloneItemView, type CloseReason, type HostAdapter, type HostInteraction, type InteractionKind, type ItemView } from "./host.js";

/** One write a {@link TestHost} received. */
export interface WriteRecord {
    index: number;
    item: ItemView | null;
}

/** How {@link createTestHost} builds its host. */
export interface TestHostOptions {
    /** Defaults to 27. */
    slotCount?: number;
    /** Makes `writeSlot` throw for the slots it returns true for. */
    rejectWrite?: (index: number, item: ItemView | null) => boolean;
}

/** A {@link HostAdapter} kept in memory, with a record of what happened to it. */
export interface TestHost extends HostAdapter {
    /** Every write, in order. */
    readonly writes: readonly WriteRecord[];
    /** Sounds played, in order. */
    readonly sounds: readonly string[];
    /** Items taken back from the player, in order. */
    readonly takenBack: readonly ItemView[];
    /** Items given to the player, in order. */
    readonly givenBack: readonly ItemView[];
    /** Whether `close` was called. */
    readonly isClosed: boolean;
    /** The reason `close` was called with, or `null` while open. */
    readonly closeReason: CloseReason | null;

    /**
     * The player empties a slot. Does nothing once the host is closed.
     *
     * @param index Slot index.
     * @throws {RangeError} For an index outside the host.
     */
    simulateTake(index: number): void;
    /**
     * The player puts an item into a slot. Does nothing once the host is closed.
     *
     * @param index Slot index.
     * @param item The item placed.
     * @throws {RangeError} For an index outside the host.
     */
    simulatePlace(index: number, item: ItemView): void;
    /**
     * The player swaps a slot's contents. Does nothing once the host is closed.
     *
     * @param index Slot index.
     * @param item The item swapped in.
     * @throws {RangeError} For an index outside the host.
     */
    simulateSwap(index: number, item: ItemView): void;
    /** The contents by index. */
    snapshot(): Record<number, ItemView | null>;
    /** Clears the recorded writes, sounds, and the items taken back and given back. */
    clearHistory(): void;
}

/**
 * Creates a test host. Its `readSlot`, and `writeSlot` while open, throw a `RangeError` for an
 * index outside the host; `writeSlot` throws an `Error` for a write `rejectWrite` refuses.
 *
 * @param options Slot count and write rejection.
 * @returns The host.
 * @example
 * const host = createTestHost({ slotCount: 9 });
 * mount(<Menu />, host);
 * host.simulateTake(4);
 */
export const createTestHost = (options: TestHostOptions = {}): TestHost => {
    const slotCount = options.slotCount ?? 27;
    const contents = new Array<ItemView | null>(slotCount).fill(null);
    const writes: WriteRecord[] = [];
    const sounds: string[] = [];
    const takenBack: ItemView[] = [];
    const givenBack: ItemView[] = [];
    const interactionHandlers = new Set<(interaction: HostInteraction) => void>();
    const closeHandlers = new Set<(reason: CloseReason) => void>();

    let isClosed = false;
    let closeReason: CloseReason | null = null;

    const assertIndex = (index: number): void => {
        if (index < 0 || index >= slotCount) {
            throw new RangeError(`[TestHost] Slot index ${index} is outside 0..${slotCount - 1}.`);
        }
    };

    const emitInteraction = (index: number, kind: InteractionKind, next: ItemView | null): void => {
        if (isClosed) return;
        assertIndex(index);
        const previous = contents[index] ?? null;
        // The slot has changed before the runtime hears of it.
        contents[index] = cloneItemView(next);
        const interaction: HostInteraction = { index, kind, previous, next: contents[index] };
        for (const handler of Array.from(interactionHandlers)) handler(interaction);
    };

    return {
        slotCount,
        writes,
        sounds,
        takenBack,
        givenBack,
        get isClosed() {
            return isClosed;
        },
        get closeReason() {
            return closeReason;
        },
        writeSlot: (index, item) => {
            if (isClosed) return;
            assertIndex(index);
            if (options.rejectWrite?.(index, item)) {
                throw new Error(`[TestHost] Rejected write to slot ${index}.`);
            }
            contents[index] = cloneItemView(item);
            writes.push({ index, item: contents[index] });
        },
        readSlot: (index) => {
            assertIndex(index);
            return contents[index] ?? null;
        },
        playSound: (soundId) => {
            sounds.push(soundId);
        },
        takeBackFromViewer: (item) => {
            takenBack.push(cloneItemView(item)!);
        },
        giveToViewer: (item) => {
            givenBack.push(cloneItemView(item)!);
        },
        onInteraction: (handler) => {
            interactionHandlers.add(handler);
            return () => {
                interactionHandlers.delete(handler);
            };
        },
        onClose: (handler) => {
            closeHandlers.add(handler);
            return () => {
                closeHandlers.delete(handler);
            };
        },
        close: (reason = "programmatic") => {
            if (isClosed) return;
            isClosed = true;
            closeReason = reason;
            for (const handler of Array.from(closeHandlers)) handler(reason);
        },
        simulateTake: (index) => {
            emitInteraction(index, "take", null);
        },
        simulatePlace: (index, item) => {
            emitInteraction(index, "place", item);
        },
        simulateSwap: (index, item) => {
            emitInteraction(index, "swap", item);
        },
        snapshot: () => {
            return Object.fromEntries(contents.map((item, index) => [index, item ?? null]));
        },
        clearHistory: () => {
            writes.length = 0;
            sounds.length = 0;
            takenBack.length = 0;
            givenBack.length = 0;
        },
    };
};
