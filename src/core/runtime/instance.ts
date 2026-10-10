/** Component instances: the hook state, owned resources and last render output of a component. */

import { signal, type Signal } from "../reactive/signal.js";
import { createScope, disposeScope, reportScopeError, runWithScope, type Scope } from "../reactive/owner.js";
import { createEffectNode, type CreateEffectOptions, type EffectNode } from "../reactive/effect.js";
import type { Dispose } from "../reactive/graph.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import type { Child, ComponentType } from "./element.js";

/** Anything that owns component instances: the app root, or another instance. */
export interface InstanceParent {
    readonly scope: Scope;
    readonly children: Map<string, ComponentInstance>;
    /** Per-render counters that give unkeyed siblings stable identities. */
    readonly ordinals: Map<string, number>;
    /** Receives render errors thrown beneath this parent. */
    readonly reportRenderError?: (report: RenderErrorReport) => void;
    /** Receives development warnings. */
    readonly reportDevWarning?: (message: string) => void;
}

/** An error thrown while rendering. */
export interface RenderErrorReport {
    readonly error: unknown;
    /** What threw: a component identity, or a slot's item source. */
    readonly component: string;
    /** Whether an error boundary above caught it. */
    readonly isCaught: boolean;
}

/** Thrown by `Resource.read()` while its load is in flight: the render waits instead of failing. */
export class Suspension {
    readonly reason = "waiting on a resource";
}

/** One hook's state, stored in call order on its instance. */
export interface HookRecord {
    kind: string;
    [field: string]: unknown;
}

/** A mounted component. */
export interface ComponentInstance extends InstanceParent {
    readonly type: ComponentType<any>;
    readonly identity: string;
    /** Enclosing component, or `null` at the root. */
    readonly parentInstance: ComponentInstance | null;
    /** Context values provided to the subtree. */
    providedContexts: Map<symbol, unknown> | null;
    readonly props: Signal<any>;
    readonly output: Signal<Child>;
    /**
     * Set when a render changed `output`, cleared once the render pass has walked it. While it is
     * set, the queued renders of the instances beneath wait for that walk, which either renders
     * them or disposes them.
     */
    isOutputStale: boolean;
    /** Hook effects whose scheduled run waited for that walk; the walk releases them when it reaches this instance. */
    readonly heldEffects: Set<EffectNode>;
    readonly hooks: HookRecord[];
    hookCursor: number;
    /** How many hooks the first render that completed called; later renders must call as many. */
    firstHookCount: number | null;
    /** Set during each commit walk; unvisited instances are disposed. */
    isVisited: boolean;
    isDisposed: boolean;
    dispose: Dispose;
    /** Re-renders now if what the last render read has changed, even while the scheduled render is held. */
    refresh: () => void;
    /** Set by an error boundary: receives render errors thrown beneath it, with the instance that threw when there is one. */
    catchRenderError: ((error: unknown, component: string, source?: ComponentInstance) => void) | null;
    /** Set by a Suspense boundary: told when a component beneath it starts or stops waiting. */
    onSuspend: ((waiter: ComponentInstance, isWaiting: boolean) => void) | null;
    /** The Suspense boundary this instance waits under. */
    waitingOn: ComponentInstance | null;
}

/** What {@link createInstance} needs. */
export interface CreateInstanceOptions {
    type: ComponentType<any>;
    identity: string;
    initialProps: unknown;
    parent: InstanceParent;
    scheduler: Scheduler;
}

let activeInstance: ComponentInstance | null = null;

/** A number per component function. */
const typeIds = new WeakMap<ComponentType<any>, number>();
let nextTypeId = 0;

const typeIdOf = (type: ComponentType<any>): number => {
    const known = typeIds.get(type);
    if (known !== undefined) return known;
    const created = nextTypeId++;
    typeIds.set(type, created);
    return created;
};

const runWithInstance = <T>(instance: ComponentInstance, body: () => T): T => {
    const previous = activeInstance;
    activeInstance = instance;
    try {
        return body();
    } finally {
        activeInstance = previous;
    }
};

/**
 * The nearest instance at or above `from` that `matches` accepts.
 *
 * @internal Shared with context lookup.
 */
export const findAncestor = (
    from: ComponentInstance | null,
    matches: (instance: ComponentInstance) => boolean,
): ComponentInstance | null => {
    let current = from;
    while (current) {
        if (matches(current)) return current;
        current = current.parentInstance;
    }
    return null;
};

/** Tells the nearest Suspense boundary that `instance` started or stopped waiting on a load. */
const markWaiting = (instance: ComponentInstance, isWaiting: boolean): void => {
    if (!isWaiting) {
        const boundary = instance.waitingOn;
        if (!boundary) return;
        instance.waitingOn = null;
        boundary.onSuspend?.(instance, false);
        return;
    }
    if (instance.waitingOn) return;
    const boundary = findAncestor(instance.parentInstance, (candidate) => candidate.onSuspend !== null);
    if (!boundary) return;
    instance.waitingOn = boundary;
    boundary.onSuspend?.(instance, true);
};

/** Flags a render that called a different number of hooks than the first one that completed. */
const checkHookCount = (instance: ComponentInstance): void => {
    if (instance.firstHookCount === null) {
        instance.firstHookCount = instance.hookCursor;
        return;
    }
    if (instance.hookCursor === instance.firstHookCount) return;
    instance.reportDevWarning?.(
        `${instance.identity} called a different number of hooks than on its first render (${instance.firstHookCount}, now ${instance.hookCursor}). ` +
            "Hooks must run in the same order on every render: not inside `if` or loops, and not after an early `return`.",
    );
};

/** Publishes a render's output, marking it stale for the render pass when it changed. */
const publishOutput = (instance: ComponentInstance, rendered: Child): void => {
    if (Object.is(instance.output.peek(), rendered)) return;
    instance.isOutputStale = true;
    instance.output.set(rendered);
};

/** Whether an instance above has new output the render pass has not walked yet. */
const isAncestorStale = (instance: ComponentInstance): boolean => {
    return findAncestor(instance.parentInstance, (candidate) => candidate.isOutputStale) !== null;
};

/**
 * Effect options that hold an instance's hook effect while an instance above has unwalked output,
 * which may no longer hold this one. The walk releases it on reaching the instance; a dispose drops it.
 *
 * @internal Shared with `hooks.ts`.
 */
export const holdUntilWalked = (instance: ComponentInstance): CreateEffectOptions => {
    return {
        isHeld: () => isAncestorStale(instance),
        onHeld: (node) => instance.heldEffects.add(node),
    };
};

/**
 * Queues the hook effects that waited for the walk to reach `instance`.
 *
 * @internal Called by the render pass.
 */
export const releaseHeldEffects = (instance: ComponentInstance): void => {
    if (instance.heldEffects.size === 0) return;
    const held = Array.from(instance.heldEffects);
    instance.heldEffects.clear();
    held.forEach((node) => node.reschedule());
};

/** Runs a component once: publishes its output, or reports why it has none. */
const renderInstance = (instance: ComponentInstance): void => {
    instance.hookCursor = 0;
    let rendered: Child;
    try {
        rendered = runWithInstance(instance, () => instance.type(instance.props.value));
    } catch (error) {
        // A component that throws renders nothing; its boundary decides what shows.
        publishOutput(instance, null);
        if (error instanceof Suspension) {
            markWaiting(instance, true);
            return;
        }
        markWaiting(instance, false);
        deliverRenderError({
            boundary: findErrorBoundary(instance.parentInstance),
            reporter: instance.reportRenderError,
            error,
            component: instance.identity,
            source: instance,
        });
        return;
    }
    markWaiting(instance, false);
    checkHookCount(instance);
    publishOutput(instance, rendered);
};

/** Disposes an instance and everything it owns. */
const disposeInstance = (instance: ComponentInstance): void => {
    if (instance.isDisposed) return;
    instance.isDisposed = true;
    markWaiting(instance, false);
    for (const child of instance.children.values()) {
        disposeInstance(child);
    }
    instance.children.clear();
    instance.heldEffects.clear();
    disposeScope(instance.scope);
};

/** The instance whose render function is running. */
export const getActiveInstance = (): ComponentInstance | null => {
    return activeInstance;
};

/**
 * The instance being rendered.
 *
 * @param hookName Named in the error.
 * @returns The instance.
 * @throws {Error} Outside a component render.
 */
export const requireActiveInstance = (hookName: string): ComponentInstance => {
    if (!activeInstance) {
        throw new Error(`[ContainerUI] ${hookName}() may only be called while a component is rendering.`);
    }
    return activeInstance;
};

/**
 * The parent as a component instance.
 *
 * @returns The instance, or `null` for the app root.
 */
export const asInstance = (parent: InstanceParent): ComponentInstance | null => {
    return "type" in parent ? (parent as ComponentInstance) : null;
};

/** Creates an instance and starts its render effect. */
export const createInstance = ({ type, identity, initialProps, parent, scheduler }: CreateInstanceOptions): ComponentInstance => {
    const scope = createScope(parent.scope);

    const instance: ComponentInstance = {
        type,
        identity,
        parentInstance: asInstance(parent),
        providedContexts: null,
        scope,
        props: signal<unknown>(initialProps, shallowEqualProps),
        output: signal<Child>(null, Object.is),
        isOutputStale: false,
        heldEffects: new Set(),
        hooks: [],
        hookCursor: 0,
        firstHookCount: null,
        children: new Map(),
        ordinals: new Map(),
        isVisited: true,
        isDisposed: false,
        dispose: () => undefined,
        refresh: () => undefined,
        catchRenderError: null,
        onSuspend: null,
        waitingOn: null,
        ...(parent.reportRenderError ? { reportRenderError: parent.reportRenderError } : {}),
        ...(parent.reportDevWarning ? { reportDevWarning: parent.reportDevWarning } : {}),
    };

    instance.dispose = () => disposeInstance(instance);

    runWithScope(scope, () => {
        // A queued render waits while a parent's new output is unwalked: that output may no longer hold this instance.
        const render = createEffectNode(() => renderInstance(instance), scheduler, { isHeld: () => isAncestorStale(instance) });
        instance.refresh = () => render.refresh();
    });

    return instance;
};

/**
 * The nearest error boundary at or above `from`.
 *
 * @returns The boundary, or `null`.
 */
export const findErrorBoundary = (from: ComponentInstance | null): ComponentInstance | null => {
    return findAncestor(from, (candidate) => candidate.catchRenderError !== null);
};

/** Hands a render error to `boundary`, if there is one, and reports it either way. */
export const deliverRenderError = ({
    boundary,
    reporter,
    error,
    component,
    source,
}: {
    boundary: ComponentInstance | null;
    reporter: ((report: RenderErrorReport) => void) | undefined;
    error: unknown;
    component: string;
    /** The component instance that threw, when it was one. */
    source?: ComponentInstance;
}): void => {
    if (reporter) reporter({ error, component, isCaught: boundary !== null });
    else reportScopeError(error);
    boundary?.catchRenderError?.(error, component, source);
};

/** Resets per-walk bookkeeping before a commit pass. */
export const beginWalk = (parent: InstanceParent): void => {
    parent.ordinals.clear();
    for (const child of parent.children.values()) {
        child.isVisited = false;
    }
};

/** Disposes children the latest walk did not reach. */
export const pruneUnvisited = (parent: InstanceParent): void => {
    for (const [identity, child] of [...parent.children]) {
        if (child.isVisited) continue;
        parent.children.delete(identity);
        disposeInstance(child);
    }
};

/**
 * The identity that matches an element to an existing instance: its key, or its type and its
 * order among siblings of that type. Types match by function, not by name.
 */
export const resolveIdentity = ({
    parent,
    type,
    key,
}: {
    parent: InstanceParent;
    type: ComponentType<any>;
    key: string | number | null;
}): string => {
    // An arrow function assigned nowhere has the empty string for a name.
    const typeName = `${type.name === "" ? "Anonymous" : type.name}@${typeIdOf(type)}`;
    if (key != null) return `${typeName}#key:${key}`;
    const ordinal = parent.ordinals.get(typeName) ?? 0;
    parent.ordinals.set(typeName, ordinal + 1);
    return `${typeName}#ord:${ordinal}`;
};

/** Props equality, one level deep: a fresh object with identical values is not a change. */
export const shallowEqualProps = (previous: unknown, next: unknown): boolean => {
    if (Object.is(previous, next)) return true;
    if (typeof previous !== "object" || typeof next !== "object" || previous === null || next === null) return false;

    const previousProps = previous as Record<string, unknown>;
    const nextProps = next as Record<string, unknown>;
    const previousKeys = Object.keys(previousProps);
    if (previousKeys.length !== Object.keys(nextProps).length) return false;

    return previousKeys.every((key) => Object.is(previousProps[key], nextProps[key]));
};
