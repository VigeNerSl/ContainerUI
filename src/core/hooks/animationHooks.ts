/** Hooks that unfold over ticks: a timer, a staggered reveal and a tween. */

import { signal, type ReadonlySignal, type Signal } from "../reactive/signal.js";
import { onCleanup, runWithScope } from "../reactive/owner.js";
import type { Dispose } from "../reactive/graph.js";
import { getTimeSource } from "../runtime/time.js";
import { requireActiveInstance, type HookRecord } from "../runtime/instance.js";
import { SURFACE_WIDTH } from "../runtime/layout.js";
import { createReveal, type Reveal, type RevealOptions, type RevealState } from "./reveal.js";
import { useHook } from "./hooks.js";

/** Controls for a {@link useTicker} timer. */
export interface Ticker {
    /** Stops the timer. Safe to call more than once. */
    stop(): void;
    /** Restarts a stopped timer. */
    start(): void;
    /** Whether the timer is running. */
    readonly isRunning: boolean;
}

/** What {@link useTween} animates. */
export interface TweenOptions {
    /** Start value. */
    from: number;
    /** End value. */
    to: number;
    /** Ticks the transition takes. */
    durationTicks: number;
    /** Maps linear progress to eased progress. Defaults to linear. */
    ease?: (progress: number) => number;
    /** Round the output, for item amounts. */
    round?: boolean;
}

interface TickerHook extends HookRecord {
    kind: "ticker";
    intervalTicks: number;
    callback: () => void;
    dispose: Dispose | null;
    isRunning: boolean;
    controller: Ticker;
}

interface RevealHook extends HookRecord {
    kind: "reveal";
    reveal: RevealState;
    signature: string;
    ticker: Ticker | null;
    controller: Reveal | null;
}

interface TweenHook extends HookRecord {
    kind: "tween";
    source: Signal<number>;
    elapsed: number;
    /** `from|to|durationTicks` of the running transition; a change starts it again. */
    signature: string;
}

/** The reveal a component sees: it follows the hook's current state, which a rebuild replaces. */
const revealControllerOf = (hook: RevealHook): Reveal => {
    return {
        isVisible: (index) => hook.reveal.isVisible(index),
        get isComplete() {
            return hook.reveal.isComplete;
        },
        get step() {
            return hook.reveal.step;
        },
        restart: () => {
            hook.reveal.restart();
            hook.ticker?.start();
        },
        finish: () => hook.reveal.finish(),
    };
};

const revealSignature = (options: RevealOptions): string => {
    return `${options.order ?? "sweep"}|${options.size}|${options.width ?? SURFACE_WIDTH}|${options.seed ?? 1}`;
};

/** A whole number of ticks, at least 1; anything that is not a finite number counts as 1. */
const wholeTicks = (ticks: number): number => {
    return Number.isFinite(ticks) ? Math.max(1, Math.floor(ticks)) : 1;
};

/**
 * Runs `callback` every `intervalTicks` ticks while the component is mounted. The latest callback
 * is always the one called.
 *
 * @param intervalTicks Ticks between calls.
 * @param callback Called on each interval.
 * @returns Controls for the timer.
 * @example
 * useTicker(20, () => {
 *     secondsLeft.value -= 1;
 * });
 */
export const useTicker = (intervalTicks: number, callback: () => void): Ticker => {
    const instance = requireActiveInstance("useTicker");
    const interval = wholeTicks(intervalTicks);

    const hook = useHook<TickerHook>("ticker", () => {
        const record: TickerHook = {
            kind: "ticker",
            intervalTicks: interval,
            callback,
            dispose: null,
            isRunning: false,
            controller: {
                start: () => {
                    if (record.dispose) return;
                    record.dispose = getTimeSource().every(record.intervalTicks, () => record.callback());
                    record.isRunning = true;
                },
                stop: () => {
                    record.dispose?.();
                    record.dispose = null;
                    record.isRunning = false;
                },
                get isRunning() {
                    return record.isRunning;
                },
            },
        };

        runWithScope(instance.scope, () => onCleanup(record.controller.stop));
        record.controller.start();
        return record;
    });

    hook.callback = callback;
    if (hook.intervalTicks === interval) return hook.controller;

    // A new interval takes effect when the timer restarts.
    hook.intervalTicks = interval;
    if (hook.isRunning) {
        hook.controller.stop();
        hook.controller.start();
    }
    return hook.controller;
};

/**
 * A staggered reveal driven by a timer. Read `isVisible` inside an item function, so each step
 * writes only the slots that appear.
 *
 * @param options Order, size, seed and pace.
 * @returns The reveal.
 * @example
 * const reveal = useReveal({ size: 54, order: "wave", stepTicks: 1 });
 * <slot index={index} item={() => (reveal.isVisible(index) ? tile : null)} />;
 */
export const useReveal = (options: RevealOptions): Reveal => {
    const hook = useHook<RevealHook>("reveal", () => ({
        kind: "reveal",
        reveal: createReveal(options),
        signature: revealSignature(options),
        ticker: null,
        controller: null,
    }));

    // A different order, size, width or seed rebuilds the steps and plays again.
    const signature = revealSignature(options);
    const isRebuilt = hook.signature !== signature;
    if (isRebuilt) {
        hook.signature = signature;
        hook.reveal = createReveal(options);
    }

    const stepTicks = wholeTicks(options.stepTicks ?? 1);
    const stepsPerTick = wholeTicks(options.stepsPerTick ?? 1);

    const ticker = useTicker(stepTicks, () => {
        hook.reveal.advance(stepsPerTick);
        // Nothing left to reveal: stop the timer.
        if (hook.reveal.isComplete.peek()) hook.ticker?.stop();
    });
    hook.ticker = ticker;

    if (isRebuilt && !hook.reveal.isComplete.peek()) ticker.start();

    hook.controller ??= revealControllerOf(hook);
    return hook.controller;
};

/**
 * Animates a number over ticks. A new `from`, `to` or `durationTicks` starts the transition again.
 *
 * @param options Range, duration and easing.
 * @returns The animated value.
 * @example
 * const filled = useTween({ from: 1, to: 64, durationTicks: 40, round: true });
 * <slot item={() => ({ typeId: "minecraft:emerald", amount: filled.value })} />;
 */
export const useTween = (options: TweenOptions): ReadonlySignal<number> => {
    const duration = wholeTicks(options.durationTicks);
    const signature = `${options.from}|${options.to}|${duration}`;
    const hook = useHook<TweenHook>("tween", () => ({
        kind: "tween",
        source: signal(options.from),
        elapsed: 0,
        signature,
    }));
    const isRestarted = hook.signature !== signature;
    if (isRestarted) {
        hook.signature = signature;
        hook.elapsed = 0;
        hook.source.set(options.from);
    }

    const ticker = useTicker(1, () => {
        hook.elapsed += 1;
        const progress = Math.min(1, hook.elapsed / duration);
        const shaped = options.ease?.(progress) ?? progress;
        const value = options.from + (options.to - options.from) * shaped;
        hook.source.set(options.round ? Math.round(value) : value);
        if (progress >= 1) ticker.stop();
    });
    if (isRestarted) ticker.start();

    return hook.source;
};
