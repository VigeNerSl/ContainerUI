/** React-style hooks backed by signals. */

import { signal, type ReadonlySignal, type Signal } from "../reactive/signal.js";
import { computed } from "../reactive/computed.js";
import { createEffect, type EffectBody } from "../reactive/effect.js";
import { onCleanup, runWithScope } from "../reactive/owner.js";
import { untrack, type Dispose } from "../reactive/graph.js";
import { getRuntimeScheduler } from "../runtime/context.js";
import { getActiveInstance, holdUntilWalked, requireActiveInstance, type ComponentInstance, type HookRecord } from "../runtime/instance.js";

interface StateHook<T> extends HookRecord {
    kind: "state";
    source: Signal<T>;
    setter: (next: T | ((previous: T) => T)) => void;
}

interface SignalHook<T> extends HookRecord {
    kind: "signal";
    source: Signal<T>;
}

interface MemoHook<T> extends HookRecord {
    kind: "memo" | "computed";
    derived: ReadonlySignal<T> | null;
    value: T | undefined;
    dependencies: readonly unknown[] | undefined;
}

interface RefHook<T> extends HookRecord {
    kind: "ref";
    box: { current: T };
}

interface IdHook extends HookRecord {
    kind: "id";
    id: string;
}

type AnyFunction = (...args: any[]) => any;

interface CallbackHook extends HookRecord {
    kind: "callback";
    latest: AnyFunction;
    stable: AnyFunction;
    memoized: AnyFunction | null;
    dependencies: readonly unknown[] | undefined;
}

interface ReducerHook<S, A> extends HookRecord {
    kind: "reducer";
    source: Signal<S>;
    reducer: (state: S, action: A) => S;
    dispatch: (action: A) => void;
}

interface EffectHook extends HookRecord {
    kind: "effect";
    revision: Signal<number>;
    dependencies: readonly unknown[] | undefined;
    isStarted: boolean;
    /** Whether it started without dependencies, re-running on what it reads. */
    isTracked: boolean;
    isModeReported: boolean;
    body: EffectBody;
}

interface UnmountHook extends HookRecord {
    kind: "unmount";
    isRegistered: boolean;
}

let nextId = 0;

/**
 * Claims this render's hook record, creating it on the first render.
 *
 * @internal Shared with the other hook modules.
 * @throws {Error} When hooks were called in a different order than on the last render.
 */
export const useHook = <T extends HookRecord>(kind: T["kind"], create: () => T): T => {
    const instance = requireActiveInstance(kind);
    const cursor = instance.hookCursor++;
    const existing = instance.hooks[cursor];

    if (existing) {
        if (existing.kind !== kind) {
            throw new Error(
                `[ContainerUI] Hook order changed between renders: slot ${cursor} was "${existing.kind}", now "${String(kind)}". ` +
                    "Hooks must not be called conditionally or inside loops.",
            );
        }
        return existing as T;
    }

    const created = runWithScope(instance.scope, create);
    instance.hooks[cursor] = created;
    return created;
};

/**
 * The value of a hook's initial argument: the value itself, or what the function returns.
 *
 * @internal Shared with `router.ts`.
 */
export const resolveInitial = <T>(initial: T | (() => T)): T => {
    return typeof initial === "function" ? (initial as () => T)() : initial;
};

/**
 * The value a state setter writes: `next` itself, or what the updater returns for `previous`.
 *
 * @internal Shared with `router.ts`.
 */
export const resolveNext = <T>(next: T | ((previous: T) => T), previous: T): T => {
    return typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
};

/**
 * Whether a value is a thenable.
 *
 * @internal Shared with `suspense.ts`.
 */
export const isPromiseLike = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> => {
    return typeof value === "object" && value !== null && typeof (value as PromiseLike<T>).then === "function";
};

const createMemoHook = <T>(kind: MemoHook<T>["kind"]): MemoHook<T> => {
    return { kind, derived: null, value: undefined, dependencies: undefined };
};

/** Whether an effect body is running. Its first run is synchronous, inside the render that created it. */
let isInEffectBody = false;

const runEffectBody = <T>(body: () => T): T => {
    const wasInEffectBody = isInEffectBody;
    isInEffectBody = true;
    try {
        return body();
    } finally {
        isInEffectBody = wasInEffectBody;
    }
};

/** Reports a component writing its own state while it renders. An effect body is not rendering. */
const warnIfRenderingItself = (owner: ComponentInstance | null): void => {
    if (!owner || isInEffectBody || getActiveInstance() !== owner) return;
    owner.reportDevWarning?.(
        `${owner.identity} set its own state while rendering. The write stands but renders it again, and can loop; move it into an effect or a handler.`,
    );
};

const startHookEffect = (instance: ComponentInstance, hook: EffectHook, isTracked: boolean): void => {
    runWithScope(instance.scope, () => {
        // Held like the render: a parent's unwalked output may be about to unmount this component.
        createEffect(
            () => {
                hook.revision.value;
                const teardown = runEffectBody(() => (isTracked ? hook.body() : untrack(hook.body)));
                if (!isPromiseLike(teardown)) return teardown;
                instance.reportDevWarning?.(
                    `${instance.identity} passed an async function to useEffect. Its promise is not a cleanup, so nothing is torn down; start the async work inside a plain function instead.`,
                );
                return undefined;
            },
            getRuntimeScheduler(),
            holdUntilWalked(instance),
        );
    });
};

/**
 * Component state.
 *
 * @param initial The initial value, or a function returning it.
 * @returns The current value, and a setter that takes a value or an updater.
 * @example
 * const [page, setPage] = useState(0);
 * setPage((previous) => previous + 1);
 */
export const useState = <T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
    const hook = useHook<StateHook<T>>("state", () => {
        const owner = getActiveInstance();
        const source = signal(resolveInitial(initial));
        return {
            kind: "state",
            source,
            setter: (next) => {
                warnIfRenderingItself(owner);
                source.set(resolveNext(next, source.peek()));
            },
        };
    });

    return [hook.source.value, hook.setter];
};

/**
 * Component state as a signal.
 *
 * @param initial The initial value, or a function returning it.
 * @returns A signal that lives as long as the component.
 * @example
 * const query = useSignal("");
 * return <slot item={() => ({ typeId: "minecraft:paper", name: query.value })} />;
 */
export const useSignal = <T>(initial: T | (() => T)): Signal<T> => {
    return useHook<SignalHook<T>>("signal", () => ({
        kind: "signal",
        source: signal(resolveInitial(initial)),
    })).source;
};

/**
 * Caches a computed value. Without `dependencies` it tracks the signals it reads, and the
 * `factory` from the first render is kept for the component's life: read signals in it, not props.
 * With them it recomputes when they change, and signals it reads are not tracked.
 *
 * @param factory Computes the value.
 * @param dependencies Values that invalidate the cache.
 * @returns The cached value.
 */
export const useMemo = <T>(factory: () => T, dependencies?: readonly unknown[]): T => {
    const instance = requireActiveInstance("useMemo");
    const hook = useHook<MemoHook<T>>("memo", () => createMemoHook("memo"));

    if (dependencies === undefined) {
        // Owned by the component, not by this render: a render disposes what the last one made.
        hook.derived ??= runWithScope(instance.scope, () => computed(factory));
        return hook.derived.value;
    }

    if (haveDependenciesChanged(hook.dependencies, dependencies)) {
        hook.dependencies = dependencies;
        hook.value = untrack(factory);
    }
    return hook.value as T;
};

/**
 * A derived signal that lives as long as the component. The `compute` from the first render is kept
 * for the component's life: read signals in it, not props.
 *
 * @param compute Computes the value from other signals.
 * @returns The derived signal.
 * @example
 * const total = useComputed(() => items.value.reduce((sum, item) => sum + item.price, 0));
 */
export const useComputed = <T>(compute: () => T): ReadonlySignal<T> => {
    const instance = requireActiveInstance("useComputed");
    const hook = useHook<MemoHook<T>>("computed", () => createMemoHook("computed"));
    hook.derived ??= runWithScope(instance.scope, () => computed(compute));
    return hook.derived;
};

/**
 * A mutable box that keeps its value across renders and never causes one.
 *
 * @param initial The initial value.
 * @returns The same box on every render.
 * @example
 * const clicks = useRef(0);
 * clicks.current++;
 */
export function useRef<T>(initial: T): { current: T };
export function useRef<T = undefined>(): { current: T | undefined };
export function useRef<T>(initial?: T): { current: T | undefined } {
    return useHook<RefHook<T | undefined>>("ref", () => ({
        kind: "ref",
        box: { current: initial },
    })).box;
}

/**
 * A string unique to this component instance and stable for its life. Unique within the script
 * context, not across reloads.
 *
 * @returns The id.
 * @example
 * const id = useId();
 * useEffect(() => console.info(`[shop] menu ${id} opened`), []);
 */
export const useId = (): string => {
    return useHook<IdHook>("id", () => ({ kind: "id", id: `cui-${(nextId++).toString(36)}` })).id;
};

/**
 * A function that keeps its identity across renders. Without `dependencies` it is stable for the
 * component's life and always calls the latest closure; with them it changes when they do.
 *
 * @param callback The function.
 * @param dependencies Values that produce a new function when they change.
 * @returns The stable function.
 * @example
 * const onBuy = useCallback(() => buy(player, item));
 * return <ShopItem item={item} onBuy={onBuy} />;
 */
export const useCallback = <F extends AnyFunction>(callback: F, dependencies?: readonly unknown[]): F => {
    const hook = useHook<CallbackHook>("callback", () => {
        const record: CallbackHook = {
            kind: "callback",
            latest: callback,
            stable: (...args) => record.latest(...args),
            memoized: null,
            dependencies: undefined,
        };
        return record;
    });

    hook.latest = callback;
    if (dependencies === undefined) return hook.stable as F;

    if (hook.memoized === null || haveDependenciesChanged(hook.dependencies, dependencies)) {
        hook.dependencies = dependencies;
        hook.memoized = callback;
    }
    return hook.memoized as F;
};

/**
 * State updated by actions. `dispatch` is stable, and the reducer from the latest render is used.
 *
 * @param reducer Returns the next state for an action.
 * @param initialState The initial state, or a function returning it.
 * @returns The current state, and `dispatch`.
 * @example
 * const [cart, dispatch] = useReducer(cartReducer, { items: [] });
 * dispatch({ type: "add", item });
 */
export const useReducer = <S, A>(reducer: (state: S, action: A) => S, initialState: S | (() => S)): [S, (action: A) => void] => {
    const hook = useHook<ReducerHook<S, A>>("reducer", () => {
        const owner = getActiveInstance();
        const source = signal(resolveInitial(initialState));
        const record: ReducerHook<S, A> = {
            kind: "reducer",
            source,
            reducer,
            dispatch: (action) => {
                warnIfRenderingItself(owner);
                source.set(record.reducer(source.peek(), action));
            },
        };
        return record;
    });

    hook.reducer = reducer;
    return [hook.source.value, hook.dispatch];
};

/**
 * Runs a side effect after render. Without `dependencies` it re-runs when anything it read
 * changes; with an empty array it runs once.
 *
 * @param body The effect. It may return a cleanup.
 * @param dependencies Values that re-run the effect when they change.
 * @example
 * useEffect(() => {
 *     const handle = system.runInterval(tick, 20);
 *     return () => system.clearRun(handle);
 * }, []);
 */
export const useEffect = (body: EffectBody, dependencies?: readonly unknown[]): void => {
    const instance = requireActiveInstance("useEffect");
    const hook = useHook<EffectHook>("effect", () => ({
        kind: "effect",
        revision: signal(0),
        dependencies: undefined,
        isStarted: false,
        isTracked: dependencies === undefined,
        isModeReported: false,
        body,
    }));

    hook.body = body;

    if (!hook.isStarted) {
        hook.isStarted = true;
        hook.dependencies = dependencies;
        startHookEffect(instance, hook, hook.isTracked);
        return;
    }

    if (hook.isTracked !== (dependencies === undefined) && !hook.isModeReported) {
        hook.isModeReported = true;
        instance.reportDevWarning?.(
            `${instance.identity} called useEffect ${hook.isTracked ? "without" : "with"} dependencies first and ${hook.isTracked ? "with" : "without"} them later. The effect keeps the first mode; pick one.`,
        );
    }
    if (hook.isTracked || dependencies === undefined) return;
    if (!haveDependenciesChanged(hook.dependencies, dependencies)) return;

    hook.dependencies = dependencies;
    hook.revision.update((revision) => revision + 1);
};

/**
 * Registers a cleanup that runs when the component unmounts.
 *
 * @param cleanup Runs once, on unmount.
 * @example
 * onUnmount(() => console.info("[shop] menu closed"));
 */
export const onUnmount = (cleanup: Dispose): void => {
    const instance = requireActiveInstance("onUnmount");
    const hook = useHook<UnmountHook>("unmount", () => ({ kind: "unmount", isRegistered: false }));
    if (hook.isRegistered) return;
    hook.isRegistered = true;
    runWithScope(instance.scope, () => onCleanup(cleanup));
};

/**
 * Whether a hook's dependencies differ from the last ones, element by element with `Object.is`.
 * Having none recorded yet counts as a change.
 *
 * @internal Shared with `suspense.ts`.
 */
export const haveDependenciesChanged = (previous: readonly unknown[] | undefined, next: readonly unknown[]): boolean => {
    if (previous === undefined || previous.length !== next.length) return true;
    return !previous.every((value, index) => Object.is(value, next[index]));
};
