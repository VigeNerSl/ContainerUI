/** Computed values: derived lazily, recomputed only when a dependency changed. */

import {
    CLEAN,
    DIRTY,
    MAYBE_DIRTY,
    clearDependencies,
    dependenciesChanged,
    recordDependency,
    runWithComputation,
    type DirtyLevel,
    type ReactiveComputation,
    type ReactiveSource,
} from "./graph.js";
import { onCleanup } from "./owner.js";
import type { Equals, ReadonlySignal } from "./signal.js";

class ComputedNode<T> implements ReactiveSource, ReactiveComputation, ReadonlySignal<T> {
    version = 0;
    readonly subscribers = new Set<ReactiveComputation>();

    readonly dependencies: ReactiveSource[] = [];
    readonly dependencyVersions: number[] = [];
    dirtyLevel: DirtyLevel = DIRTY;
    depth = 0;

    #value!: T;
    /** What the last evaluation threw, rethrown on every read until a dependency changes. */
    #error: { thrown: unknown } | null = null;
    #isEvaluating = false;
    #isDisposed = false;
    readonly #compute: () => T;
    readonly #equals: Equals<T>;

    constructor(compute: () => T, equals: Equals<T>) {
        this.#compute = compute;
        this.#equals = equals;
    }

    markDirty(level: DirtyLevel): void {
        if (this.#isDisposed || this.dirtyLevel >= level) return;
        const wasClean = this.dirtyLevel === CLEAN;
        this.dirtyLevel = level;
        if (!wasClean) return;
        // Downstream only verifies: the value may come out the same.
        for (const subscriber of Array.from(this.subscribers)) {
            subscriber.markDirty(MAYBE_DIRTY);
        }
    }

    refresh(): void {
        if (this.#isDisposed || this.dirtyLevel === CLEAN || this.#isEvaluating) return;

        if (this.dirtyLevel === MAYBE_DIRTY && !dependenciesChanged(this)) {
            this.dirtyLevel = CLEAN;
            return;
        }

        this.dirtyLevel = CLEAN;
        this.#isEvaluating = true;
        try {
            const next = runWithComputation(this, this.#compute);
            const hadError = this.#error !== null;
            this.#error = null;
            if (this.version === 0 || hadError || !this.#equals(this.#value, next)) {
                this.#value = next;
                this.version++;
            }
        } catch (error) {
            // Dependencies read before the throw stay tracked, so a change to them retries.
            this.#error = { thrown: error };
            this.version++;
        } finally {
            this.#isEvaluating = false;
        }
    }

    get value(): T {
        this.refresh();
        recordDependency(this);
        return this.#read();
    }

    peek(): T {
        this.refresh();
        return this.#read();
    }

    dispose(): void {
        this.#isDisposed = true;
        clearDependencies(this);
        this.subscribers.clear();
    }

    #read(): T {
        if (this.#error) throw this.#error.thrown;
        return this.#value;
    }
}

/** A read-only derived value. Reading one whose computation threw throws the same error. */
export interface Computed<T> extends ReadonlySignal<T> {
    /** Detaches it from the graph; it keeps its last value, or its last error, and never recomputes. */
    dispose(): void;
}

/**
 * Creates a value derived from other reactive values. Disposed with the enclosing scope.
 *
 * @param compute Derives the value.
 * @param equals Whether two results are the same. Defaults to `Object.is`.
 * @returns The computed.
 * @example
 * const total = computed(() => price.value * quantity.value);
 */
export const computed = <T>(compute: () => T, equals: Equals<T> = Object.is): Computed<T> => {
    const node = new ComputedNode(compute, equals);
    onCleanup(() => node.dispose());
    return node;
};
