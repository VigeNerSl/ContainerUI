/**
 * What the surface wrote to each slot: the display form the scan reads back, and the real item
 * for restores.
 */

import type { ItemStack } from "@minecraft/server";
import { cloneItemView, toDisplayView, type ItemView } from "../../core/index.js";
import { probeOfStack } from "../scan/slotHandles.js";
import type { ExpectedSlots } from "../scan/slotMatching.js";

/** Writes to a surface, in the forms the scan and restores need. */
export class WrittenSlots {
    readonly #expected: ExpectedSlots;
    /** Real items last written to UI-owned slots. */
    readonly #real = new Map<number, ItemView>();

    /** @param expected The table the scan matches slots against. */
    constructor(expected: ExpectedSlots) {
        this.#expected = expected;
    }

    /**
     * Records a write as the scan will read it back: real items in UI slots read back as display
     * copies, and the signature comes from the stack that was written, not from the view, so a
     * field the conversion could not carry never reads back as a player's action.
     *
     * @param write.index Surface slot.
     * @param write.item The view written, or `null` for an emptied slot.
     * @param write.isUiOwned Whether the slot is the UI's rather than an `input`.
     * @param write.stack The stack the slot now holds.
     */
    record({ index, item, isUiOwned, stack }: { index: number; item: ItemView | null; isUiOwned: boolean; stack?: ItemStack | undefined }): void {
        const written = stack ? probeOfStack(stack) : null;
        if (isUiOwned && item?.native !== undefined) {
            this.#expected.record(index, toDisplayView(item), written);
            this.#real.set(index, item);
            return;
        }
        this.#expected.record(index, cloneItemView(item), written);
        this.#real.delete(index);
    }

    /** What to write when restoring `item`: the real item last written there, if it is the same item. */
    restorable(index: number, item: ItemView | null): ItemView | null {
        const written = this.#real.get(index);
        if (!written || !item) return item;
        const isSameKind = written.typeId === item.typeId && (written.name ?? "") === (item.name ?? "");
        return isSameKind ? written : item;
    }
}
