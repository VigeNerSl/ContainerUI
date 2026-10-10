/** Effects: the reactive nodes the scheduler runs. */

import {
    CLEAN,
    DIRTY,
    MAYBE_DIRTY,
    clearDependencies,
    dependenciesChanged,
    runWithComputation,
    type DirtyLevel,
    type Dispose,
    type ReactiveComputation,
    type ReactiveSource,
} from "./graph.js";
import {
    createScope,
    disposeScope,
    getActiveScope,
    onCleanup,
    reportScopeError,
    resetScope,
    runWithScope,
    type Scope,
} from "./owner.js";
import type { Scheduler, SchedulerTask } from "../scheduler/scheduler.js";

/** An effect's body. A returned function runs before the next run and on dispose. */
export type EffectBody = () => Dispose | void;

/** @internal */
export interface CreateEffectOptions {
    /** Scheduling order; higher runs later. */
    depth?: number;
    /**
     * While it returns `true`, a scheduled run is skipped and the effect stays dirty, so it neither
     * runs nor is queued again until {@link EffectNode.refresh} runs it or
     * {@link EffectNode.reschedule} queues it.
     */
    isHeld?: () => boolean;
    /** Told each time a scheduled run is skipped by {@link CreateEffectOptions.isHeld}, so the holder can release it. */
    onHeld?: (node: EffectNode) => void;
}

/** What an {@link EffectNode} is built from. */
interface EffectNodeOptions extends CreateEffectOptions {
    body: EffectBody;
    scheduler: Scheduler;
    parentScope: Scope | null;
}

/** @internal */
export class EffectNode implements ReactiveComputation, SchedulerTask {
    readonly dependencies: ReactiveSource[] = [];
    readonly dependencyVersions: number[] = [];
    dirtyLevel: DirtyLevel = DIRTY;
    readonly depth: number;
    isScheduled = false;

    readonly #body: EffectBody;
    readonly #scope: Scope;
    readonly #scheduler: Scheduler;
    readonly #isHeld: (() => boolean) | undefined;
    readonly #onHeld: ((node: EffectNode) => void) | undefined;
    #teardown: Dispose | void = undefined;
    #isDisposed = false;
    #isRunning = false;
    #isRerunPending = false;

    constructor({ body, scheduler, parentScope, depth, isHeld, onHeld }: EffectNodeOptions) {
        this.#body = body;
        this.#scheduler = scheduler;
        this.#isHeld = isHeld;
        this.#onHeld = onHeld;
        this.#scope = createScope(parentScope);
        this.depth = depth ?? this.#scope.depth;
    }

    markDirty(level: DirtyLevel): void {
        if (this.#isDisposed) return;
        if (this.dirtyLevel >= level) {
            // Already queued: the scheduler retries a flush request that failed.
            if (this.isScheduled) this.#scheduler.schedule(this);
            return;
        }
        this.dirtyLevel = level;
        this.#scheduler.schedule(this);
    }

    /** Runs the body if a dependency moved, unless the effect is held. Called by the scheduler. */
    runIfDirty(): void {
        if (this.#isDisposed || this.dirtyLevel === CLEAN) return;
        // Left dirty: whoever releases the hold runs it through `refresh` or `reschedule`.
        if (this.#isHeld?.() === true) {
            this.#onHeld?.(this);
            return;
        }
        this.refresh();
    }

    /** Queues a run that a hold skipped, once the hold is over. */
    reschedule(): void {
        if (this.#isDisposed || this.dirtyLevel === CLEAN || this.isScheduled) return;
        this.#scheduler.schedule(this);
    }

    /** Runs the body if a dependency moved, held or not. */
    refresh(): void {
        if (this.#isDisposed || this.dirtyLevel === CLEAN) return;
        if (this.dirtyLevel === MAYBE_DIRTY && !dependenciesChanged(this)) {
            this.dirtyLevel = CLEAN;
            return;
        }
        this.run();
    }

    run(): void {
        if (this.#isDisposed) return;
        if (this.#isRunning) {
            // Re-entered through a nested flush: it runs again once this run is over.
            this.#isRerunPending = true;
            return;
        }
        this.#isRunning = true;
        try {
            this.#runBody();
        } finally {
            this.#isRunning = false;
        }

        // The body disposed this effect, for example by closing the menu that owns it. Nothing calls
        // the teardown later, and reads made after the dispose subscribed the effect again, so the
        // teardown runs and the dependencies are cleared here.
        if (this.#isDisposed) {
            this.#runTeardown();
            clearDependencies(this);
            return;
        }
        if (!this.#isRerunPending) return;
        this.#isRerunPending = false;
        if (this.dirtyLevel !== CLEAN) this.#scheduler.schedule(this);
    }

    dispose(): void {
        if (this.#isDisposed) return;
        this.#isDisposed = true;
        this.#runTeardown();
        clearDependencies(this);
        disposeScope(this.#scope);
    }

    /** Drops pending work without running it, leaving the effect clean so it can run again. */
    abandon(): void {
        this.dirtyLevel = CLEAN;
    }

    #runBody(): void {
        this.dirtyLevel = CLEAN;
        this.#runTeardown();
        // Effects, computeds and cleanups created by the previous run go with it.
        resetScope(this.#scope);

        try {
            this.#teardown = runWithScope(this.#scope, () => runWithComputation(this, this.#body));
        } catch (error) {
            reportScopeError(error);
            this.#teardown = undefined;
        }
    }

    #runTeardown(): void {
        const teardown = this.#teardown;
        this.#teardown = undefined;
        if (typeof teardown !== "function") return;
        try {
            teardown();
        } catch (error) {
            reportScopeError(error);
        }
    }
}

/**
 * Runs `body` now, then again, scheduled, whenever a value it read changes. Disposed with the
 * enclosing scope.
 *
 * @internal Use `effect` from the public API.
 * @param body The effect.
 * @param scheduler Runs the re-runs.
 * @param options Ordering, and when a scheduled run is held back.
 * @returns Disposes the effect.
 * @example
 * const stop = createEffect(() => {
 *     console.info(`[shop] coins=${coins.value}`);
 * }, scheduler);
 */
export const createEffect = (body: EffectBody, scheduler: Scheduler, options: CreateEffectOptions = {}): Dispose => {
    const node = createEffectNode(body, scheduler, options);
    return () => node.dispose();
};

/**
 * {@link createEffect}, returning the node so it can be run on demand.
 *
 * @internal
 */
export const createEffectNode = (body: EffectBody, scheduler: Scheduler, options: CreateEffectOptions = {}): EffectNode => {
    const node = new EffectNode({ body, scheduler, parentScope: getActiveScope(), ...options });
    // Owned before the first run, so a run that disposes its owner disposes the effect too.
    onCleanup(() => node.dispose());
    node.run();
    return node;
};
