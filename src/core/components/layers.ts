/** Layers: content stacked over the menu, laid out from index 0 wherever they are declared. */

import { h, LayerNode, type Child, type ItemSource, type LayerProps } from "../runtime/element.js";

/**
 * Stacks its children over the rest of the menu, wherever they are declared. A `backdrop` prop,
 * even `null`, makes it modal. A layer never covers an input.
 *
 * @example
 * <Layer z={1}>
 *     <slot index={4} item={toast} />
 * </Layer>
 */
export const Layer = (props: LayerProps): Child => {
    return h(LayerNode, props);
};

/** Props of {@link Modal}. */
export interface ModalProps {
    /** Whether the modal shows. */
    open: boolean;
    /** Fills the cells the modal does not use. Defaults to empty. */
    backdrop?: ItemSource;
    /** Called when the backdrop is clicked. Needs a non-empty backdrop. */
    onDismiss?: () => void;
    /** Stacking order; later-declared layers win ties. */
    z?: number;
    children?: Child;
}

/**
 * A modal layer shown while `open` is true.
 *
 * @example
 * <Modal open={confirming.value} backdrop={PANE} onDismiss={() => (confirming.value = false)}>
 *     <slot index={11} item={YES} onClick={buy} />
 *     <slot index={15} item={NO} onClick={() => (confirming.value = false)} />
 * </Modal>
 */
export const Modal = (props: ModalProps): Child => {
    if (!props.open) return null;
    const onDismiss = props.onDismiss;
    return h(LayerNode, {
        z: props.z ?? 0,
        backdrop: props.backdrop ?? null,
        ...(onDismiss ? { onBackdropClick: () => onDismiss() } : {}),
        children: props.children,
    });
};
