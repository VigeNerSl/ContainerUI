/** A confirm dialog that refuses to act when what it guards changed while it was open. */

import { isSameItem, type ItemView } from "../host/host.js";
import { untrack } from "../reactive/graph.js";
import { h, LayerNode, type Child, type ItemSource, type SlotEvent } from "../runtime/element.js";
import { useCallback, useRef } from "../hooks/hooks.js";

/** What a confirm dialog guards: one item, or several. */
export type Watched = ItemView | null | readonly (ItemView | null)[];

/** One of the dialog's two buttons. */
export interface ConfirmButton {
    /** Slot index. */
    index: number;
    item: ItemSource;
    /** Sound played on click. */
    sound?: string;
}

/** Props of {@link Confirm}. */
export interface ConfirmProps {
    /** Whether the dialog shows. The snapshot is taken when this turns true. */
    open: boolean;
    /** Reads what must not change while the dialog is open. */
    watch?: () => Watched;
    /** Runs on confirm when `watch` still returns what it did at opening. */
    onConfirm: (event: SlotEvent) => void;
    /** Runs on cancel, and on a backdrop cell when `backdrop` shows an item: an empty cell is not a button. */
    onCancel: () => void;
    /** Runs instead of `onConfirm` when `watch` changed. Defaults to `onCancel`. */
    onChanged?: () => void;
    /** The "yes" button. */
    confirm: ConfirmButton;
    /** The "no" button. */
    cancel: ConfirmButton;
    /** Fills the cells the dialog does not use. Defaults to empty. */
    backdrop?: ItemSource;
    /** Stacking order; later-declared layers win ties. */
    z?: number;
    /** The rest of the dialog, such as the question. */
    children?: Child;
}

const isSameWatched = (first: Watched, second: Watched): boolean => {
    if (Array.isArray(first) !== Array.isArray(second)) return false;
    if (!Array.isArray(first)) return isSameItem(first as ItemView | null, second as ItemView | null);
    const secondList = second as readonly (ItemView | null)[];
    return first.length === secondList.length && first.every((item, index) => isSameItem(item, secondList[index] ?? null));
};

const buttonSlot = ({ button, onClick }: { button: ConfirmButton; onClick: (event: SlotEvent) => void }): Child => {
    return h("slot", {
        index: button.index,
        item: button.item,
        onClick,
        ...(button.sound ? { sound: button.sound } : {}),
    });
};

/**
 * A modal confirm dialog.
 *
 * @example
 * <Confirm
 *     open={selling.value}
 *     watch={() => offered.value}
 *     confirm={{ index: 11, item: YES }}
 *     cancel={{ index: 15, item: NO }}
 *     onConfirm={() => sell(offered.value)}
 *     onCancel={() => (selling.value = false)}
 * >
 *     <slot index={4} item={question} />
 * </Confirm>
 */
export const Confirm = (props: ConfirmProps): Child => {
    const snapshot = useRef<Watched>(null);
    const wasOpen = useRef(false);
    if (props.open && !wasOpen.current) snapshot.current = props.watch ? untrack(props.watch) : null;
    wasOpen.current = props.open;

    const onConfirm = useCallback((vigenersl: SlotEvent) => {
        if (props.watch && !isSameWatched(snapshot.current, untrack(props.watch))) {
            (props.onChanged ?? props.onCancel)();
            return;
        }
        props.onConfirm(vigenersl);
    });
    const onCancel = useCallback(() => props.onCancel());

    if (!props.open) return null;
    return h(LayerNode, {
        z: props.z ?? 0,
        backdrop: props.backdrop ?? null,
        onBackdropClick: onCancel,
        children: [
            buttonSlot({ button: props.confirm, onClick: onConfirm }),
            buttonSlot({ button: props.cancel, onClick: onCancel }),
            props.children,
        ],
    });
};
