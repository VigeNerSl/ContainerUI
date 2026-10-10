/** The render pass: an element tree in, a flat map of slots out. */

import type { ItemView } from "../host/host.js";
import { LayoutFrame, SURFACE_WIDTH, type LayoutKind } from "./layout.js";
import {
    Suspension,
    asInstance,
    beginWalk,
    createInstance,
    deliverRenderError,
    findErrorBoundary,
    pruneUnvisited,
    releaseHeldEffects,
    resolveIdentity,
    type ComponentInstance,
    type InstanceParent,
} from "./instance.js";
import {
    Fragment,
    LAYOUT_TYPES,
    LayerNode,
    Offscreen,
    isEmptyChild,
    isIntrinsicType,
    isVNode,
    type Child,
    type ComponentType,
    type InputProps,
    type ItemSource,
    type LayerProps,
    type LayoutProps,
    type OffscreenProps,
    type SlotProps,
    type VNode,
} from "./element.js";
import type { Scheduler } from "../scheduler/scheduler.js";

/** What a slot is: a picture, a button, or a slot the player owns. */
export type SlotKind = "display" | "button" | "input";

/** One slot, resolved for this pass. */
export interface ResolvedSlot {
    index: number;
    kind: SlotKind;
    item: ItemView | null;
    /** Whether an input is controlled. */
    isControlled?: boolean;
    /** Whether a controlled input's source holds the real item. */
    isMirror?: boolean;
    onClick?: SlotProps["onClick"];
    sound?: string;
    accept?: InputProps["accept"];
    onPlace?: InputProps["onPlace"];
    onTake?: InputProps["onTake"];
    onChange?: InputProps["onChange"];
}

/** Resolved slots by index. */
export type SlotMap = Map<number, ResolvedSlot>;

/** What one render pass produced. */
export interface RenderPassResult {
    slots: SlotMap;
    /** Cells that did not fit on the surface. */
    overflowCount: number;
    /** Indices claimed more than once. */
    collisions: number[];
    /** Layer slots dropped because they landed on an input. */
    coveredInputs: number[];
}

const LAYOUT_KINDS: ReadonlySet<string> = new Set(LAYOUT_TYPES);

/** Narrows an element to the props of the kind of node it is. */
const nodeOf = <P>(node: VNode): VNode<P> => node as VNode<P>;

/** What one render pass renders into. */
export interface RenderPassOptions {
    /** Slot count. */
    size: number;
    /** Slots per row. Defaults to the surface width. */
    width?: number;
    scheduler: Scheduler;
    root: InstanceParent;
}

/** Where a pass collects slots: the base surface, one layer, or a hidden subtree. */
interface SlotTarget {
    readonly slots: SlotMap;
    readonly collisions: number[];
    /** A hidden subtree: its slots are dropped. */
    readonly isDiscarded: boolean;
}

/** A layer met during the pass, stacked over the base afterwards. */
interface CollectedLayer {
    readonly z: number;
    readonly order: number;
    readonly target: SlotTarget;
    /** `undefined` for an overlay; the item, or `null`, for a modal layer. */
    readonly backdrop: ItemView | null | undefined;
    readonly onBackdropClick: SlotProps["onClick"] | undefined;
}

/** One backdrop cell of a modal layer: decorative, or a button when the layer can be dismissed. */
const backdropSlot = ({
    index,
    item,
    onClick,
}: {
    index: number;
    item: ItemView | null;
    onClick: SlotProps["onClick"] | undefined;
}): ResolvedSlot => {
    if (!onClick) return { index, kind: "display", item };
    return { index, kind: "button", item, onClick };
};

/**
 * Runs one render pass.
 *
 * @param element The tree.
 * @param options Surface size, scheduler and root.
 * @returns The resolved slots and any layout problems.
 */
export const runRenderPass = (element: Child, options: RenderPassOptions): RenderPassResult => {
    const pass = new RenderPass(options);
    pass.run(element);
    return { slots: pass.slots, overflowCount: pass.overflowCount, collisions: pass.collisions, coveredInputs: pass.coveredInputs };
};

class RenderPass {
    readonly slots: SlotMap = new Map();
    readonly collisions: number[] = [];
    readonly coveredInputs: number[] = [];
    overflowCount = 0;

    readonly #size: number;
    readonly #width: number;
    readonly #scheduler: Scheduler;
    readonly #root: InstanceParent;
    #target: SlotTarget;
    readonly #layers: CollectedLayer[] = [];
    #nextLayerOrder = 0;

    constructor(options: RenderPassOptions) {
        this.#size = options.size;
        this.#width = options.width ?? SURFACE_WIDTH;
        this.#scheduler = options.scheduler;
        this.#root = options.root;
        this.#target = { slots: this.slots, collisions: this.collisions, isDiscarded: false };
    }

    run(element: Child): void {
        const frame = this.#createFrame("box", 0, {});
        beginWalk(this.#root);
        this.#visit(element, frame, this.#root);
        pruneUnvisited(this.#root);
        this.overflowCount += frame.overflowCount;
        this.#composeLayers();
    }

    /** @throws {RangeError} When `gap` or `columns` is not an integer. */
    #createFrame(kind: LayoutKind, anchor: number, props: { gap?: number; columns?: number }): LayoutFrame {
        return new LayoutFrame({ kind, anchor, gap: props.gap, columns: props.columns, width: this.#width, size: this.#size });
    }

    /** Walks one child: arrays and fragments splice in, components render, layouts nest a frame, leaves take a cell. */
    #visit(child: Child, frame: LayoutFrame, parent: InstanceParent): void {
        if (isEmptyChild(child)) return;

        if (Array.isArray(child)) {
            for (const entry of child) this.#visit(entry, frame, parent);
            return;
        }

        if (!isVNode(child)) return;

        if (child.type === Fragment) {
            this.#visit(nodeOf<LayoutProps>(child).props.children, frame, parent);
            return;
        }

        if (child.type === LayerNode) {
            this.#visitLayer(nodeOf<LayerProps>(child), parent);
            return;
        }

        if (child.type === Offscreen) {
            this.#visitOffscreen(nodeOf<OffscreenProps>(child), frame, parent);
            return;
        }

        if (typeof child.type === "function") {
            this.#visitComponent(child, child.type as ComponentType<any>, frame, parent);
            return;
        }

        if (!isIntrinsicType(child.type)) return;

        if (LAYOUT_KINDS.has(child.type)) {
            this.#visitLayout(child, child.type as LayoutKind, frame, parent);
            return;
        }

        if (child.type === "slot") {
            this.#visitSlot(nodeOf<SlotProps>(child), frame, parent);
            return;
        }

        this.#visitInput(nodeOf<InputProps>(child), frame, parent);
    }

    /** Renders a component, creating its instance on first sight, then walks what it rendered. */
    #visitComponent(node: VNode, type: ComponentType<any>, frame: LayoutFrame, parent: InstanceParent): void {
        const instance = this.#instanceFor(node, type, parent);
        const output = instance.output.value;
        instance.isOutputStale = false;
        releaseHeldEffects(instance);

        beginWalk(instance);
        this.#visit(output, frame, instance);
        pruneUnvisited(instance);
    }

    /** The instance an element matches, created when new and re-rendered with its new props when not. */
    #instanceFor(node: VNode, type: ComponentType<any>, parent: InstanceParent): ComponentInstance {
        const identity = resolveIdentity({ parent, type, key: node.key });
        const existing = parent.children.get(identity);
        if (!existing) {
            const created = createInstance({ type, identity, initialProps: node.props, parent, scheduler: this.#scheduler });
            parent.children.set(identity, created);
            return created;
        }

        if (existing.isVisited) {
            // Met twice in one walk: two siblings share a key.
            const owner = asInstance(parent)?.identity ?? "the root";
            parent.reportDevWarning?.(`Duplicate key "${String(node.key)}" among the children of ${owner}: two elements share one instance.`);
        }
        existing.isVisited = true;
        existing.props.set(node.props);
        // Render now, so this pass lays out the new output.
        existing.refresh();
        return existing;
    }

    /** Lays out a layout's children in a frame of its own. A layout with a bad gap or column count draws nothing but keeps its cell. */
    #visitLayout(node: VNode, kind: LayoutKind, frame: LayoutFrame, parent: InstanceParent): void {
        const props = node.props as LayoutProps & { columns?: number };
        const anchor = this.#placeIn(frame, props.index);
        if (anchor === null) return;

        let childFrame: LayoutFrame;
        try {
            childFrame = this.#createFrame(kind, anchor, props);
        } catch (error) {
            this.#reportRenderError({ error, parent, label: `${kind} layout` });
            return;
        }
        this.#visit(props.children, childFrame, parent);
        // A hidden subtree is not on the surface, so nothing in it overflows yet.
        if (!this.#target.isDiscarded) this.overflowCount += childFrame.overflowCount;
    }

    /** Collects a layer's slots apart, to stack them over the base after the pass. */
    #visitLayer(node: VNode<LayerProps>, parent: InstanceParent): void {
        const props = node.props;
        const order = this.#nextLayerOrder++;
        const target: SlotTarget = { slots: new Map(), collisions: [], isDiscarded: this.#target.isDiscarded };
        const frame = this.#createFrame("box", 0, {});
        this.#withTarget(target, () => this.#visit(props.children, frame, parent));

        // A layer inside a hidden subtree is hidden too.
        if (target.isDiscarded) return;
        this.overflowCount += frame.overflowCount;
        this.#layers.push({
            z: props.z ?? 0,
            order,
            target,
            backdrop: props.backdrop === undefined ? undefined : this.#resolveItem({ source: props.backdrop, parent, label: "layer backdrop" }),
            onBackdropClick: props.onBackdropClick,
        });
    }

    /** Renders a subtree; while it is hidden, lays it out in a throwaway frame and writes nothing. */
    #visitOffscreen(node: VNode<OffscreenProps>, frame: LayoutFrame, parent: InstanceParent): void {
        const props = node.props;
        if (!props.isHidden) {
            this.#visit(props.children, frame, parent);
            return;
        }
        const discard: SlotTarget = { slots: new Map(), collisions: [], isDiscarded: true };
        this.#withTarget(discard, () => this.#visit(props.children, this.#createFrame("box", 0, {}), parent));
    }

    #withTarget(target: SlotTarget, body: () => void): void {
        const previous = this.#target;
        this.#target = target;
        try {
            body();
        } finally {
            this.#target = previous;
        }
    }

    /** Stacks the layers over the base, lowest `z` first. A layer never covers an input. */
    #composeLayers(): void {
        const ordered = [...this.#layers].sort((first, second) => first.z - second.z || first.order - second.order);
        for (const layer of ordered) {
            this.collisions.push(...layer.target.collisions);
            for (const [index, slot] of layer.target.slots) {
                if (this.slots.get(index)?.kind === "input") {
                    this.coveredInputs.push(index);
                    continue;
                }
                this.slots.set(index, slot);
            }

            if (layer.backdrop === undefined) continue;
            for (let index = 0; index < this.#size; index++) {
                if (layer.target.slots.has(index) || this.slots.get(index)?.kind === "input") continue;
                this.slots.set(index, backdropSlot({ index, item: layer.backdrop, onClick: layer.onBackdropClick }));
            }
        }
    }

    #visitSlot(node: VNode<SlotProps>, frame: LayoutFrame, parent: InstanceParent): void {
        const props = node.props;
        const index = this.#placeIn(frame, props.index);
        if (index === null) return;

        this.#assign({
            index,
            kind: props.onClick ? "button" : "display",
            item: this.#resolveItem({ source: props.item, parent, label: `item of slot ${index}` }),
            ...(props.onClick ? { onClick: props.onClick } : {}),
            ...(props.sound ? { sound: props.sound } : {}),
        });
    }

    #visitInput(node: VNode<InputProps>, frame: LayoutFrame, parent: InstanceParent): void {
        const props = node.props;
        const index = this.#placeIn(frame, props.index);
        if (index === null) return;

        const isControlled = props.item !== undefined;
        this.#assign({
            index,
            kind: "input",
            item: this.#resolveItem({
                source: isControlled ? props.item : (props.initialItem ?? null),
                parent,
                label: `item of slot ${index}`,
            }),
            ...(isControlled ? { isControlled: true } : {}),
            ...(isControlled && props.isMirror ? { isMirror: true } : {}),
            ...(props.accept ? { accept: props.accept } : {}),
            ...(props.onPlace ? { onPlace: props.onPlace } : {}),
            ...(props.onTake ? { onTake: props.onTake } : {}),
            ...(props.onChange ? { onChange: props.onChange } : {}),
        });
    }

    /** Evaluates an item source. A throw empties that slot only and goes to the nearest error boundary. */
    #resolveItem({ source, parent, label }: { source: ItemSource | undefined; parent: InstanceParent; label: string }): ItemView | null {
        try {
            return resolveItemSource(source);
        } catch (error) {
            // A resource still loading: the slot waits, empty.
            if (error instanceof Suspension) return null;
            this.#reportRenderError({ error, parent, label });
            return null;
        }
    }

    /**
     * Hands an error thrown during the walk to the nearest error boundary and reports it. Inside a
     * hidden subtree it is dropped: the walk reads the same source again once the subtree shows.
     */
    #reportRenderError({ error, parent, label }: { error: unknown; parent: InstanceParent; label: string }): void {
        if (this.#target.isDiscarded) return;
        const owner = asInstance(parent);
        deliverRenderError({
            boundary: findErrorBoundary(owner),
            reporter: parent.reportRenderError,
            error,
            component: `${owner?.identity ?? "root"} (${label})`,
        });
    }

    /**
     * An element's pinned index, or the frame's next cell; `null` when it does not fit. A frame
     * counts its own overflow; a pinned index off the surface is counted here, unless the subtree is hidden.
     */
    #placeIn(frame: LayoutFrame, pinnedIndex: number | undefined): number | null {
        if (pinnedIndex === undefined) return frame.takeIndex();
        if (Number.isInteger(pinnedIndex) && pinnedIndex >= 0 && pinnedIndex < this.#size) return pinnedIndex;
        if (!this.#target.isDiscarded) this.overflowCount++;
        return null;
    }

    #assign(slot: ResolvedSlot): void {
        const target = this.#target;
        if (target.slots.has(slot.index)) target.collisions.push(slot.index);
        target.slots.set(slot.index, slot);
    }
}

/**
 * Evaluates an item source.
 *
 * @param source An item, a function returning one, or nothing.
 * @returns The item, or `null`.
 */
export const resolveItemSource = (source: ItemSource | undefined): ItemView | null => {
    if (source == null) return null;
    if (typeof source === "function") return source() ?? null;
    return source;
};
