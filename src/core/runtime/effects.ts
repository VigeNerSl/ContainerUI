/** Effects and batching on the installed scheduler. */

import { createEffect, type EffectBody } from "../reactive/effect.js";
import type { Dispose } from "../reactive/graph.js";
import { getRuntimeScheduler } from "./context.js";

/**
 * Runs `body` now, and again whenever a value it read changes. Re-runs are batched per tick.
 *
 * @param body The effect. A returned function runs before the next run and on dispose.
 * @returns Disposes the effect.
 * @example
 * const stop = effect(() => console.info(`coins=${coins.value}`));
 */
export const effect = (body: EffectBody): Dispose => {
    return createEffect(body, getRuntimeScheduler());
};

/**
 * Runs `body`, deferring dependent work until it returns.
 *
 * @param body The writes to group.
 * @returns What `body` returns.
 * @example
 * batch(() => {
 *     coins.value -= price;
 *     owned.value += 1;
 * });
 */
export const batch = <T>(body: () => T): T => {
    return getRuntimeScheduler().batch(body);
};

/** Runs all pending reactive work now, ignoring the tick budget. */
export const flushSync = (): void => {
    getRuntimeScheduler().flushSync();
};
