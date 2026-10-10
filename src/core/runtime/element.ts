/** The element model: plain `{ type, props, key }` records, compatible with the standard JSX transform. */

import type { ItemView } from "../host/host.js";

/** Identifies an element among its siblings across renders. */
export type Key = string | number;

/** Marks a node whose children are spliced into the parent's flow. */
export const Fragment = Symbol.for("containerui.Fragment");

/** @internal The node `Layer` and `Modal` render. */
export const LayerNode = Symbol.for("containerui.Layer");

/** @internal The node `Suspense` wraps its children in: rendered, but not written while hidden. */
export const Offscreen = Symbol.for("containerui.Offscreen");

/** Built-in element names that lay out their children. */
export const LAYOUT_TYPES = ["box", "row", "column", "grid"] as const;

/** Every built-in element name. */
export const INTRINSIC_TYPES = ["slot", "input", ...LAYOUT_TYPES] as const;

/** Built-in element names. */
export type IntrinsicType = (typeof INTRINSIC_TYPES)[number];

/** A function component. */
export type ComponentType<P = Record<string, never>> = (props: P) => Child;

/** Anything an element can be made of. */
export type ElementType = IntrinsicType | ComponentType<any> | typeof Fragment | typeof LayerNode | typeof Offscreen;

/** An element. */
export interface VNode<P = any> {
    readonly type: ElementType;
    readonly props: P;
    readonly key: Key | null;
}

/** Anything accepted in a children position. */
export type Child = VNode | null | undefined | boolean | readonly Child[];

/** Context handed to slot event handlers. */
export interface SlotEvent {
    /** Slot index the interaction happened on. */
    readonly index: number;
    /** Item the runtime believes the slot holds. */
    readonly item: ItemView | null;
    /** Closes the surface. */
    close(): void;
}

/** Context handed to input handlers. */
export interface InputEvent extends SlotEvent {
    /** Item before the edit. */
    readonly previous: ItemView | null;
    /** Item after the edit. */
    readonly next: ItemView | null;
    /**
     * Takes an item like `item` back from the player, after an edit was refused. Does nothing on
     * a host that cannot.
     */
    takeBack(item: ItemView): void;
    /** Gives `item` to the player: something they placed that the source cannot hold. */
    giveBack(item: ItemView): void;
    /**
     * Empties the slot: its item is consumed. A controlled input shows its declared item again on
     * the next commit, so set its source to `null` instead.
     */
    clear(): void;
}

/** An item, or a function returning one. A function is re-read on every commit. */
export type ItemSource = ItemView | null | (() => ItemView | null);

/** Props of `<slot>`: a decorative item or a button. */
export interface SlotProps {
    /** Absolute slot index. Defaults to the next position in the parent's flow. */
    index?: number;
    /** The item. Pass a function to update the slot without re-rendering its component. */
    item: ItemSource;
    /** Makes the slot a button: called once the player's click completes. */
    onClick?: (event: SlotEvent) => void;
    /** Sound played on click. */
    sound?: string;
    key?: Key;
}

/** Props of `<input>`: a slot the player may put items into and take them from. */
export interface InputProps {
    /** Absolute slot index. Defaults to the next position in the parent's flow. */
    index?: number;
    /** Item placed on first render; the player owns the slot from then on. */
    initialItem?: ItemSource;
    /** Controlled contents, applied on every commit; edits reach `onChange`. */
    item?: ItemSource;
    /**
     * Controlled inputs only: the source behind `item` holds the real item, as a storage does, so
     * closing the menu leaves it there. Without it, a real item left in the input goes back to the
     * player when the menu closes.
     */
    isMirror?: boolean;
    /** Returns `false` to refuse an incoming item. */
    accept?: (item: ItemView) => boolean;
    /** Called when the player places an item. */
    onPlace?: (event: InputEvent) => void;
    /** Called when the player takes the item. */
    onTake?: (event: InputEvent) => void;
    /** Called on every edit. */
    onChange?: (event: InputEvent) => void;
    key?: Key;
}

/** Props of `<box>`, `<row>` and `<column>`. */
export interface LayoutProps {
    /** Absolute index of the layout's origin. Defaults to the parent's flow position. */
    index?: number;
    /** Empty cells between children: an integer. A fraction, `NaN` or an infinity is a render error, and the layout draws nothing. */
    gap?: number;
    children?: Child;
    key?: Key;
}

/** Props of `<grid>`. */
export interface GridProps extends LayoutProps {
    /** Cells per row before wrapping: an integer. Defaults to the surface width (9). A fraction, `NaN` or an infinity is a render error. */
    columns?: number;
}

/** Props of `Layer` and `Modal`. */
export interface LayerProps {
    /** Stacking order among layers: higher is on top; later-declared layers win ties. */
    z?: number;
    /** Makes the layer modal: cells it does not use show this item, or stay empty for `null`. */
    backdrop?: ItemSource;
    /** Makes the backdrop cells buttons, usually "cancel". Needs a non-empty backdrop. */
    onBackdropClick?: (event: SlotEvent) => void;
    children?: Child;
    key?: Key;
}

/** @internal */
export interface OffscreenProps {
    isHidden: boolean;
    children?: Child;
}

/** The props of each built-in element, by name. */
export interface ElementPropsMap {
    slot: SlotProps;
    input: InputProps;
    box: LayoutProps;
    row: LayoutProps;
    column: LayoutProps;
    grid: GridProps;
}

const INTRINSIC_TYPE_SET: ReadonlySet<string> = new Set(INTRINSIC_TYPES);

/** Whether `type` is a built-in element name. */
export const isIntrinsicType = (type: ElementType): type is IntrinsicType => {
    return typeof type === "string" && INTRINSIC_TYPE_SET.has(type);
};

/** Whether `value` is an element: an object with the `type`, `props` and `key` that `h` and the JSX runtime give every element. */
export const isVNode = (value: unknown): value is VNode => {
    if (typeof value !== "object" || value === null) return false;
    return "type" in value && "key" in value && "props" in value && typeof value.props === "object" && value.props !== null;
};

/** Whether a child renders nothing. */
export const isEmptyChild = (child: Child): boolean => {
    return child === null || child === undefined || typeof child === "boolean";
};

/**
 * Creates an element. The JSX runtime calls it too.
 *
 * @param type A built-in element name, a component or a fragment.
 * @param props The props, `key` included.
 * @param children Child elements.
 * @returns The element.
 * @example
 * h("row", { gap: 1 }, h("slot", { item: { typeId: "minecraft:diamond" } }));
 */
export function h<K extends keyof ElementPropsMap>(
    type: K,
    props?: (ElementPropsMap[K] & { key?: Key }) | null,
    ...children: Child[]
): VNode<ElementPropsMap[K]>;
export function h<P>(type: ComponentType<P>, props?: (P & { key?: Key }) | null, ...children: Child[]): VNode<P>;
export function h(type: typeof Fragment, props?: { key?: Key } | null, ...children: Child[]): VNode;
export function h(type: typeof LayerNode, props: LayerProps | null, ...children: Child[]): VNode<LayerProps>;
export function h(type: typeof Offscreen, props: OffscreenProps | null, ...children: Child[]): VNode<OffscreenProps>;
export function h(type: ElementType, props?: object | null, ...children: Child[]): VNode {
    const { key = null, ...rest } = (props ?? {}) as Record<string, unknown>;
    if (children.length === 1) {
        rest.children = children[0];
    } else if (children.length > 1) {
        rest.children = children;
    }
    return { type, props: rest, key: key as Key | null };
}

/**
 * {@link h} under the name the JSX compiler imports from the package root when a `key` follows a
 * spread, as in `<Card {...props} key={id} />`.
 */
export const createElement = h;

/** Groups children without introducing a layout. */
export const fragment = (...children: Child[]): VNode => {
    return h(Fragment, null, ...children);
};
