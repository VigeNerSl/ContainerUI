/** The ambient scheduler that `effect()` and the hooks use. */

import { Scheduler, createMicrotaskSchedulerHost, type SchedulerHost, type SchedulerOptions } from "../scheduler/scheduler.js";
import { log } from "../logging/logger.js";

let ambientScheduler: Scheduler | null = null;
let hasWarnedAboutFallback = false;

/**
 * The installed scheduler. Without one, falls back to microtasks and warns once: on Bedrock that
 * breaks one-commit-per-tick, so call `installBedrockRuntime()` first.
 *
 * @returns The installed scheduler, or the microtask fallback.
 */
export const getRuntimeScheduler = (): Scheduler => {
    if (ambientScheduler) return ambientScheduler;

    if (!hasWarnedAboutFallback) {
        hasWarnedAboutFallback = true;
        log({
            level: "warn",
            source: "runtime",
            message:
                "No scheduler installed; falling back to microtask scheduling. " +
                "On Bedrock call installBedrockRuntime() during startup — a microtask is not a tick, " +
                "so updates will not coalesce to one commit per tick.",
        });
    }

    ambientScheduler = new Scheduler(createMicrotaskSchedulerHost());
    return ambientScheduler;
};

/** Whether a scheduler is installed. */
export const hasRuntimeScheduler = (): boolean => {
    return ambientScheduler !== null;
};

/**
 * Installs the scheduler that `effect()` and the hooks use.
 *
 * @param scheduler Replaces any installed one.
 */
export const setRuntimeScheduler = (scheduler: Scheduler): void => {
    ambientScheduler = scheduler;
};

/**
 * Creates a scheduler over `host` and installs it.
 *
 * @param host When to flush and what time it is.
 * @param options Scheduler options.
 * @returns The scheduler.
 */
export const configureRuntime = (host: SchedulerHost, options?: SchedulerOptions): Scheduler => {
    const scheduler = new Scheduler(host, options);
    setRuntimeScheduler(scheduler);
    return scheduler;
};

/** Removes the installed scheduler. For tests. */
export const resetRuntime = (): void => {
    ambientScheduler = null;
    hasWarnedAboutFallback = false;
};
