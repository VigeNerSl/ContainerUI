/**
 * `StorageView`: shows a `SlotStorage` without handing its items over. Without `onSlotClick`
 * every slot is decorative; with it, the slots are buttons. Every rendered item is a display
 * copy. Use `StorageSlots` for storage the viewer may take from.
 */

import { toDisplayView, type ItemView } from "../host/host.js";
import { h, type Child } from "../runtime/element.js";
import { renderStorageRange, type StorageRangeProps } from "./storageRange.js";

/** Props of {@link StorageView}. */
export interface StorageViewProps extends StorageRangeProps {
    /** Called with the storage index and the shown item of a clicked slot. */
    onSlotClick?: ((storageIndex: number, item: ItemView | null) => void) | undefined;
    /** Played on click when `onSlotClick` is set. */
    sound?: string | undefined;
    /**
     * Changes how a stored item is shown, never what is stored. Receives the display copy and the
     * storage index. Return `null` to show the slot empty.
     *
     * @example
     * decorate: (item, index) => item && ({
     *     ...item,
     *     lore: [...(item.lore ?? []), `§7Price: §e${priceOf(index)}`],
     * })
     */
    decorate?: ((item: ItemView | null, storageIndex: number) => ItemView | null) | undefined;
}

/**
 * A read-only view of a storage range.
 *
 * @example
 * <StorageView storage={PlayerInventoryStorage.forPlayer(target)} index={9} onSlotClick={pick} />
 */
export const StorageView = (props: StorageViewProps): Child => {
    const { storage, decorate, onSlotClick } = props;

    // Decorated after stripping, so a decorator cannot put `native` back.
    const viewOf = (storageIndex: number): ItemView | null => {
        const display = toDisplayView(storage.get(storageIndex));
        return decorate ? decorate(display, storageIndex) : display;
    };

    return renderStorageRange(props, (storageIndex) =>
        h("slot", {
            key: storageIndex,
            item: () => viewOf(storageIndex),
            ...(onSlotClick
                ? {
                      onClick: () => onSlotClick(storageIndex, viewOf(storageIndex)),
                      ...(props.sound ? { sound: props.sound } : {}),
                  }
                : {}),
        }),
    );
};
