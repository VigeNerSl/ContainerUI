/** The time source: how tick-based features wait. There is no fallback. */

import type { Dispose } from "../reactive/graph.js";

/** Timers counted in ticks. */
export interface TimeSource {
    /** Runs `callback` once, after `ticks` ticks. */
    after(ticks: number, callback: () => void): Dispose;
    /** Runs `callback` every `ticks` ticks until disposed. */
    every(ticks: number, callback: () => void): Dispose;
}

let ambientTimeSource: TimeSource | null = null;

/**
 * Installs the timers. `installBedrockRuntime()` does this.
 *
 * @param source Replaces any installed one.
 */
export const configureTimeSource = (source: TimeSource): void => {
    ambientTimeSource = source;
};

/**
 * The installed time source.
 *
 * @returns The time source.
 * @throws {Error} When none is installed.
 */
export const getTimeSource = (): TimeSource => {
    if (!ambientTimeSource) {
        throw new Error(
            "[ContainerUI] No time source is installed. Call installBedrockRuntime() during add-on startup, " +
                "or configureTimeSource(...) when embedding the runtime elsewhere.",
        );
    }
    return ambientTimeSource;
};

/** Whether a time source is installed. */
export const hasTimeSource = (): boolean => {
    return ambientTimeSource !== null;
};

/** Removes the installed time source. For tests. */
export const resetTimeSource = (): void => {
    ambientTimeSource = null;
};

/** A time source that moves only when told to. */
export interface ManualTimeSource extends TimeSource {
    /** Moves the clock by `ticks`, firing what comes due. */
    advance(ticks: number): void;
    /** Live timers. */
    readonly timerCount: number;
}

/**
 * Creates a manual time source, for tests.
 *
 * @example
 * const time = createManualTimeSource();
 * configureTimeSource(time);
 * time.advance(20);
 */
export const createManualTimeSource = (): ManualTimeSource => {
    interface Timer {
        dueAt: number;
        intervalTicks: number | null;
        callback: () => void;
    }

    const timers = new Set<Timer>();
    let now = 0;

    const add = (timer: Timer): Dispose => {
        timers.add(timer);
        return () => {
            timers.delete(timer);
        };
    };

    return {
        after: (ticks, callback) => add({ dueAt: now + Math.max(1, ticks), intervalTicks: null, callback }),
        every: (ticks, callback) => {
            const interval = Math.max(1, ticks);
            return add({ dueAt: now + interval, intervalTicks: interval, callback });
        },
        get timerCount() {
            return timers.size;
        },
        advance: (ticks) => {
            for (let step = 0; step < ticks; step++) {
                now++;
                // Copied: a callback may add or remove timers.
                for (const timer of Array.from(timers)) {
                    if (!timers.has(timer) || timer.dueAt > now) continue;
                    if (timer.intervalTicks === null) timers.delete(timer);
                    else timer.dueAt = now + timer.intervalTicks;
                    timer.callback();
                }
            }
        },
    };
};
