/**
 * A tick-aware scheduler: any number of writes in a tick produce one commit, and a flush that
 * runs over its time budget yields to the next tick.
 */

import { log } from "../logging/logger.js";

/** A unit of schedulable work, in practice an effect. */
export interface SchedulerTask {
    /** Ownership depth; shallower tasks run first. */
    readonly depth: number;
    /** Set by the scheduler to skip repeated scheduling. */
    isScheduled: boolean;
    /** Runs the task if it has pending work. */
    runIfDirty(): void;
    /**
     * Drops the task's pending work when it is abandoned: as a loop, or because a flush ran more
     * than `maxPassesPerFlush` tasks. The task stays schedulable.
     */
    abandon?(): void;
}

/** What the scheduler needs from the platform. */
export interface SchedulerHost {
    /** Calls `callback` at the next safe point, typically the end of the tick. */
    requestFlush(callback: () => void): void;
    /** Milliseconds, used only for time slicing. */
    now(): number;
}

/** Limits for a {@link Scheduler}. */
export interface SchedulerOptions {
    /** Milliseconds a flush may take before it yields. Defaults to 8. */
    budgetMs?: number | undefined;
    /** Most tasks run in one flush. Defaults to 10,000. */
    maxPassesPerFlush?: number | undefined;
    /**
     * Runs one task may make without progress before the queue drains, after which it is abandoned
     * as a loop. Progress is the first run of a task that has not run since the queue last drained.
     * Defaults to 100.
     */
    maxRunsPerTask?: number | undefined;
    /** Receives loop reports and failed flush requests. Defaults to the logger set by `setLogger`. */
    onError?: ((error: Error) => void) | undefined;
}

/** Number of flushes `runPending` may run before it decides the host never settles. */
const MAX_MANUAL_FLUSHES = 1000;

const compareDepth = (first: SchedulerTask, second: SchedulerTask): number => {
    return first.depth - second.depth;
};

/** Runs scheduled tasks in depth order, batching writes and slicing work by time. */
export class Scheduler {
    readonly #host: SchedulerHost;
    readonly #queue: SchedulerTask[] = [];
    readonly #runCounts = new Map<SchedulerTask, number>();
    readonly #ranThisPeriod = new Set<SchedulerTask>();
    readonly #onError: (error: Error) => void;
    #needsSort = false;
    #isFlushRequested = false;
    #isFlushing = false;
    #batchDepth = 0;
    #hasReportedRequestFailure = false;

    readonly budgetMs: number;
    readonly maxPassesPerFlush: number;
    readonly maxRunsPerTask: number;

    /**
     * @param host The platform's flush and clock.
     * @param options Budget and loop limits.
     */
    constructor(host: SchedulerHost, options: SchedulerOptions = {}) {
        this.#host = host;
        this.budgetMs = options.budgetMs ?? 8;
        this.maxPassesPerFlush = options.maxPassesPerFlush ?? 10_000;
        this.maxRunsPerTask = options.maxRunsPerTask ?? 100;
        this.#onError = options.onError ?? ((error) => log({ level: "error", source: "scheduler", message: error.message, detail: error }));
    }

    /** Number of tasks waiting to run. */
    get pendingCount(): number {
        return this.#queue.length;
    }

    /** Whether a flush is in progress. */
    get isFlushing(): boolean {
        return this.#isFlushing;
    }

    /**
     * Enqueues a task. A task already queued is not queued twice, but a flush request that failed
     * earlier is made again.
     *
     * @param task The task to run on the next flush.
     */
    schedule(task: SchedulerTask): void {
        if (task.isScheduled) {
            this.#requestFlush();
            return;
        }
        task.isScheduled = true;
        this.#queue.push(task);
        this.#needsSort = true;
        this.#requestFlush();
    }

    /**
     * Runs `body`, then flushes once after it returns.
     *
     * @param body Writes to group.
     * @returns What `body` returns.
     * @example
     * scheduler.batch(() => {
     *     coins.value -= 10;
     *     items.value = [...items.value, sword];
     * });
     */
    batch<T>(body: () => T): T {
        this.#batchDepth++;
        try {
            return body();
        } finally {
            this.#batchDepth--;
            if (this.#batchDepth === 0) this.#requestFlush();
        }
    }

    /** Runs pending work until the time budget is spent, then schedules the rest. Called by the host. */
    flush(): void {
        if (this.#isFlushing) return;
        this.#isFlushing = true;
        const startedAt = this.#host.now();
        let passes = 0;

        try {
            while (this.#queue.length > 0) {
                if (this.#hasPassedLimit(++passes)) {
                    this.#onError(
                        new Error(
                            `[ContainerUI] A flush ran ${this.maxPassesPerFlush} tasks and abandoned the rest — something schedules work as fast as it runs.`,
                        ),
                    );
                    break;
                }
                this.#runNext();

                // A clock jump backwards ends the slice too.
                const elapsedMs = this.#host.now() - startedAt;
                if (elapsedMs < 0 || elapsedMs >= this.budgetMs) break;
            }
        } finally {
            this.#isFlushing = false;
            this.#settleOrContinue();
        }
    }

    /**
     * Runs everything pending, ignoring the time budget. For tests and the initial mount.
     *
     * @throws {Error} When tasks keep scheduling work past the pass limit.
     */
    flushSync(): void {
        if (this.#isFlushing) return;
        this.#isFlushing = true;
        let passes = 0;
        try {
            while (this.#queue.length > 0) {
                if (this.#hasPassedLimit(++passes)) {
                    throw new Error(
                        "[ContainerUI] flushSync exceeded the maximum pass count — an effect is most likely writing a value it also reads.",
                    );
                }
                this.#runNext();
            }
        } finally {
            this.#isFlushing = false;
            this.#settleOrContinue();
        }
    }

    /** Asks the host for a flush. A host that throws is reported once per run of failures, and asked again on the next request. */
    #requestFlush(): void {
        if (this.#isFlushRequested || this.#isFlushing || this.#batchDepth > 0) return;
        if (this.#queue.length === 0) return;
        this.#isFlushRequested = true;
        try {
            this.#host.requestFlush(() => {
                this.#isFlushRequested = false;
                this.flush();
            });
            this.#hasReportedRequestFailure = false;
        } catch (error) {
            this.#isFlushRequested = false;
            if (this.#hasReportedRequestFailure) return;
            this.#hasReportedRequestFailure = true;
            this.#onError(
                new Error(`[ContainerUI] The host could not schedule a flush; pending work waits for the next write or flushSync: ${String(error)}`),
            );
        }
    }

    /** Runs the next task, or abandons it once it has run more than `maxRunsPerTask` times without progress. */
    #runNext(): void {
        if (this.#needsSort) {
            // Shallow-first: a parent may remove children whose work is queued.
            this.#queue.sort(compareDepth);
            this.#needsSort = false;
        }

        const task = this.#queue.shift()!;
        task.isScheduled = false;

        // A task running for the first time this period is progress: a reader fed by many writers is no loop.
        if (!this.#ranThisPeriod.has(task)) {
            this.#ranThisPeriod.add(task);
            this.#runCounts.clear();
        }

        const runs = (this.#runCounts.get(task) ?? 0) + 1;
        this.#runCounts.set(task, runs);
        if (runs <= this.maxRunsPerTask) {
            task.runIfDirty();
            return;
        }

        task.abandon?.();
        // Reported once per loop.
        if (runs !== this.maxRunsPerTask + 1) return;
        this.#onError(
            new Error(
                `[ContainerUI] A reactive task ran ${this.maxRunsPerTask} times without the queue settling and was abandoned — ` +
                    "an effect is most likely writing a value it also reads. It runs again when its dependencies next change.",
            ),
        );
    }

    /** Whether a flush has run too many tasks; the queue is abandoned when it has. */
    #hasPassedLimit(passes: number): boolean {
        if (passes <= this.maxPassesPerFlush) return false;
        this.#abandonQueue();
        return true;
    }

    /** Empties the queue, abandoning each task so it can run again later. */
    #abandonQueue(): void {
        for (const task of this.#queue) {
            task.isScheduled = false;
            task.abandon?.();
        }
        this.#queue.length = 0;
    }

    /** Resets loop accounting once the queue has drained; otherwise asks for another flush. */
    #settleOrContinue(): void {
        if (this.#queue.length > 0) {
            this.#requestFlush();
            return;
        }
        this.#runCounts.clear();
        this.#ranThisPeriod.clear();
    }
}

/**
 * A host that flushes on the microtask queue, for tests and tooling. It is also the fallback when
 * no scheduler is installed. A microtask is not a tick, so writes do not coalesce to one commit
 * per tick.
 */
export const createMicrotaskSchedulerHost = (): SchedulerHost => {
    return {
        requestFlush: (callback) => {
            void Promise.resolve().then(callback);
        },
        now: () => Date.now(),
    };
};

/** A host driven entirely by the caller. */
export interface ManualSchedulerHost extends SchedulerHost {
    /** Advances the simulated clock. */
    advance(milliseconds: number): void;
    /** Runs every queued flush, including those queued by the flushes it runs. */
    runPending(): void;
    /** Flushes requested and not yet run. */
    readonly pendingFlushCount: number;
}

/** A host that flushes only when the caller runs `runPending()`. */
export const createManualSchedulerHost = (): ManualSchedulerHost => {
    const pendingFlushes: (() => void)[] = [];
    let clock = 0;
    return {
        requestFlush: (callback) => {
            pendingFlushes.push(callback);
        },
        now: () => clock,
        advance: (milliseconds) => {
            clock += milliseconds;
        },
        get pendingFlushCount() {
            return pendingFlushes.length;
        },
        runPending: () => {
            let flushes = 0;
            while (pendingFlushes.length > 0) {
                if (++flushes > MAX_MANUAL_FLUSHES) throw new Error("[ContainerUI] Manual scheduler host did not settle.");
                pendingFlushes.shift()!();
            }
        },
    };
};
