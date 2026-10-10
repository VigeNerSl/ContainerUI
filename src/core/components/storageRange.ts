/** The range of a `SlotStorage` that `StorageSlots` and `StorageView` lay out. */

import type { SlotStorage } from "../storage/slotStorage.js";
import { h, type Child } from "../runtime/element.js";

/** Which storage slots a component shows, and where. */
export interface StorageRangeProps {
    /** The storage shown. */
    storage: SlotStorage;
    /** First storage slot shown. Defaults to 0. */
    from?: number | undefined;
    /** How many slots. Defaults to the rest of the storage. */
    count?: number | undefined;
    /** Surface index of the first slot. Defaults to layout flow. */
    index?: number | undefined;
}

/**
 * Renders one child per storage slot in the range, boxed at `index` when one is given.
 *
 * @internal
 */
export const renderStorageRange = (range: StorageRangeProps, renderSlot: (storageIndex: number) => Child): Child => {
    const from = range.from ?? 0;
    const count = range.count ?? Math.max(0, range.storage.size - from);
    const slots = Array.from({ length: count }, (_unused, offset) => renderSlot(from + offset));

    if (range.index !== undefined) return h("box", { index: range.index }, slots);
    return slots;
};
