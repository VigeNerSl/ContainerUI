/** `SlotStorage`: a slot-shaped source of items that the UI mirrors, and an in-memory one. */

import { cloneItemView, type ItemView } from "../host/host.js";
import { signal, type ReadonlySignal } from "../reactive/signal.js";

/** Items held outside the UI, addressed by slot. */
export interface SlotStorage {
    /** Slot count. */
    readonly size: number;

    /**
     * Reads a slot. Tracked. A view with `native` must return the same payload object on every
     * read until the slot changes.
     *
     * @param index Slot index.
     * @returns The item, or `null` for an empty slot.
     */
    get(index: number): ItemView | null;

    /**
     * Writes a slot and bumps {@link version}.
     *
     * @param index Slot index.
     * @param item The item, or `null` to empty the slot.
     * @throws {Error} When the underlying store is gone.
     */
    set(index: number, item: ItemView | null): void;

    /** Bumped on every change, external ones included. */
    readonly version: ReadonlySignal<number>;
}

/** An in-memory `SlotStorage`, for tests. */
export interface MemoryStorage extends SlotStorage {
    /**
     * Writes without bumping the version, like an outside change.
     *
     * @param index Slot index.
     * @param item The item, or `null` to empty the slot.
     * @throws {RangeError} For an index outside the storage.
     */
    silentSet(index: number, item: ItemView | null): void;
    /** Bumps the version after {@link silentSet}. */
    notifyExternalChange(): void;
    /** The contents as an array. */
    snapshot(): (ItemView | null)[];
}

/**
 * Creates an in-memory storage. Its `get`, `set` and `silentSet` throw a `RangeError` for an
 * index outside the storage.
 *
 * @param size Slot count.
 * @param initial Initial contents from slot 0.
 * @returns The storage.
 * @example
 * const chest = createMemoryStorage(27, [{ typeId: "minecraft:diamond", amount: 3 }]);
 */
export const createMemoryStorage = (size: number, initial: readonly (ItemView | null)[] = []): MemoryStorage => {
    const contents = Array.from({ length: size }, (_unused, index) => cloneItemView(initial[index] ?? null));
    const version = signal(0);

    const assertIndex = (index: number): void => {
        if (index < 0 || index >= size) {
            throw new RangeError(`[MemoryStorage] Slot index ${index} is outside 0..${size - 1}.`);
        }
    };

    return {
        size,
        version,
        get: (index) => {
            assertIndex(index);
            version.value;
            return contents[index] ?? null;
        },
        set: (index, item) => {
            assertIndex(index);
            contents[index] = cloneItemView(item);
            version.update((revision) => revision + 1);
        },
        silentSet: (index, item) => {
            assertIndex(index);
            contents[index] = cloneItemView(item);
        },
        notifyExternalChange: () => {
            version.update((revision) => revision + 1);
        },
        snapshot: () => {
            return contents.map((item) => cloneItemView(item));
        },
    };
};
