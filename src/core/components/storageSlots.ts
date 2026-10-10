/**
 * `StorageSlots`: inputs mirroring a `SlotStorage`. The storage holds the items; a player's edit
 * reaches it through `onChange`, and a failed write snaps the slot back.
 */

import type { ItemView } from "../host/host.js";
import { h, type Child, type InputEvent } from "../runtime/element.js";
import { renderStorageRange, type StorageRangeProps } from "./storageRange.js";

/** Props of {@link StorageSlots}. */
export interface StorageSlotsProps extends StorageRangeProps {
    /** Rejects an incoming item; the slot is restored. */
    accept?: ((item: ItemView) => boolean) | undefined;
    /** Called after an edit reaches the storage. */
    onEdit?: ((event: InputEvent) => void) | undefined;
    /**
     * Called when an edit was refused because the slot changed in the same tick, usually by
     * another viewer. The storage keeps what it holds; the player's copy is taken back and a
     * placed item that no longer fits is given back. If the slot is empty, a placed item is
     * stored.
     */
    onConflict?: ((event: InputEvent) => void) | undefined;
}

const looksSame = (first: ItemView | null, second: ItemView | null): boolean => {
    if (!first || !second) return !first && !second;
    return first.typeId === second.typeId && (first.amount ?? 1) === (second.amount ?? 1) && (first.name ?? "") === (second.name ?? "");
};

/** Same look and same payload. */
const isSameContents = (first: ItemView | null, second: ItemView | null): boolean => {
    return looksSame(first, second) && first?.native === second?.native;
};

/**
 * Mirrors a storage range as inputs.
 *
 * @example
 * <StorageSlots storage={BlockStorage.forEntity(entity)} index={0} count={27} />
 */
export const StorageSlots = (props: StorageSlotsProps): Child => {
    const storage = props.storage;

    return renderStorageRange(props, (storageIndex) =>
        h("input", {
            key: storageIndex,
            item: () => storage.get(storageIndex),
            // The storage holds the real item: closing must not hand the slot's copy out.
            isMirror: true,
            ...(props.accept ? { accept: props.accept } : {}),
            onChange: (vigenersl) => {
                const { previous, next } = vigenersl;
                const current = storage.get(storageIndex);
                if (isSameContents(current, previous)) {
                    storage.set(storageIndex, next);
                    props.onEdit?.(vigenersl);
                    return;
                }
                // Changed under us this tick: take back the player's copy of what left.
                if (previous) vigenersl.takeBack(previous);
                if (next && current) {
                    // The slot is taken; storing would destroy what is there.
                    vigenersl.giveBack(next);
                } else if (next) {
                    storage.set(storageIndex, next);
                    props.onEdit?.(vigenersl);
                }
                props.onConflict?.(vigenersl);
            },
        }),
    );
};
