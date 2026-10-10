/** Suspense: a fallback while components beneath wait on asynchronous data. */

import { untrack } from "../reactive/graph.js";
import { signal, type Signal } from "../reactive/signal.js";
import { h, Offscreen, type Child } from "../runtime/element.js";
import { haveDependenciesChanged, isPromiseLike, onUnmount, useRef, useSignal } from "../hooks/hooks.js";
import { Suspension, requireActiveInstance, type ComponentInstance } from "../runtime/instance.js";

/** An asynchronous value read by a component. */
export interface Resource<T> {
    /** Load state. */
    readonly status: "pending" | "ready" | "failed";
    /** The loaded value once ready, `undefined` otherwise. Reading it never suspends. */
    readonly value: T | undefined;
    /** Why the load failed, once it has. */
    readonly error: unknown;
    /**
     * The value. Suspends the component while it loads and throws the error once the load
     * failed; do not wrap it in `try`.
     */
    read(): T;
    /** Loads again, with the same dependencies. */
    reload(): void;
}

type ResourceState<T> =
    | { readonly status: "pending" }
    | { readonly status: "ready"; readonly value: T }
    | { readonly status: "failed"; readonly error: unknown };

interface ResourceRecord<T> {
    load: () => T | PromiseLike<T>;
    readonly state: Signal<ResourceState<T>>;
    token: number;
    dependencies: readonly unknown[] | undefined;
    isStarted: boolean;
    isDisposed: boolean;
    readonly resource: Resource<T>;
}

/** One shared object, so re-entering pending while pending notifies nobody. */
const PENDING = { status: "pending" } as const;

const settle = <T>({ record, token, state }: { record: ResourceRecord<T>; token: number; state: ResourceState<T> }): void => {
    if (record.isDisposed || token !== record.token) return;
    record.state.set(state);
};

const startLoad = <T>(record: ResourceRecord<T>): void => {
    const token = ++record.token;
    let result: T | PromiseLike<T>;
    try {
        result = untrack(record.load);
    } catch (error) {
        record.state.set({ status: "failed", error });
        return;
    }
    if (!isPromiseLike(result)) {
        record.state.set({ status: "ready", value: result });
        return;
    }
    record.state.set(PENDING);
    result.then(
        (value) => settle({ record, token, state: { status: "ready", value } }),
        (error: unknown) => settle({ record, token, state: { status: "failed", error } }),
    );
};

const createRecord = <T>(load: () => T | PromiseLike<T>): ResourceRecord<T> => {
    const state = signal<ResourceState<T>>(PENDING);
    const record: ResourceRecord<T> = {
        load,
        state,
        token: 0,
        dependencies: undefined,
        isStarted: false,
        isDisposed: false,
        resource: {
            get status() {
                return state.value.status;
            },
            get value() {
                const current = state.value;
                return current.status === "ready" ? current.value : undefined;
            },
            get error() {
                const current = state.value;
                return current.status === "failed" ? current.error : undefined;
            },
            read: () => {
                const current = state.value;
                if (current.status === "ready") return current.value;
                if (current.status === "failed") throw current.error;
                throw new Suspension();
            },
            reload: () => {
                if (record.isDisposed) return;
                startLoad(record);
            },
        },
    };
    return record;
};

/**
 * Loads data for a component. `load` may return a promise or a value; a value is ready at once.
 * Without `dependencies` it loads once per mount; with them it loads again when they change, and
 * a load that a newer one replaced is ignored.
 *
 * @param load Returns the value or a promise of it.
 * @param dependencies Values that trigger a new load when they change.
 * @returns The resource.
 * @example
 * const balance = useResource(() => bank.fetchBalance(player.id), [player.id]);
 * return <slot item={{ typeId: "minecraft:gold_ingot", name: `${balance.read()} coins` }} />;
 */
export const useResource = <T>(load: () => T | PromiseLike<T>, dependencies?: readonly unknown[]): Resource<T> => {
    const box = useRef<ResourceRecord<T> | null>(null);
    const record = (box.current ??= createRecord(load));
    onUnmount(() => {
        record.isDisposed = true;
    });
    record.load = load;

    const shouldLoad = !record.isStarted || (dependencies !== undefined && haveDependenciesChanged(record.dependencies, dependencies));
    if (shouldLoad) {
        record.isStarted = true;
        record.dependencies = dependencies;
        startLoad(record);
    }
    return record.resource;
};

/** Props of {@link Suspense}. */
export interface SuspenseProps {
    /** Shown while any component beneath is waiting on a load. */
    fallback: Child;
    children?: Child;
}

/** Waiters are instances, not identity strings: an identity is unique only among siblings. */
const NOTHING_WAITING: ReadonlySet<ComponentInstance> = new Set();

/**
 * Shows `fallback` while any component beneath it waits on a resource. The children stay mounted,
 * only hidden, and are shown once nothing is waiting.
 *
 * @example
 * <Suspense fallback={<slot index={13} item={LOADING} />}>
 *     <Balance player={player} />
 * </Suspense>
 */
export const Suspense = (props: SuspenseProps): Child => {
    const instance = requireActiveInstance("Suspense");
    const waiting = useSignal<ReadonlySet<ComponentInstance>>(NOTHING_WAITING);

    instance.onSuspend ??= (waiter, isWaiting) => {
        const next = new Set(waiting.peek());
        if (isWaiting) next.add(waiter);
        else next.delete(waiter);
        waiting.set(next);
    };

    const isWaiting = waiting.value.size > 0;
    return [h(Offscreen, { isHidden: isWaiting }, props.children), isWaiting ? props.fallback : null];
};
