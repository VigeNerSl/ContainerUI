/** `useExternal`: state kept outside the app, read like React's `useSyncExternalStore`. */

import type { Dispose } from "../reactive/graph.js";
import { useEffect, useRef, useSignal } from "./hooks.js";

/** Calls `notify` whenever the value may have changed; returns the unsubscribe. */
export type ExternalSubscribe = (notify: () => void) => Dispose | void;

/** How {@link useExternal} reaches outside state. */
export interface ExternalOptions<T> {
    /** Called on mount; what it returns is called on unmount. */
    subscribe: ExternalSubscribe;
    /** Reads the value. Runs on every render and every notification. */
    read: () => T;
    /** Whether two readings are the same value. Defaults to `Object.is`. */
    equals?: (previous: T, next: T) => boolean;
}

/**
 * The current value of outside state. Re-renders when a notification finds it changed.
 *
 * @param options How to subscribe, read and compare.
 * @returns The value.
 * @example
 * const balance = useExternal({
 *     subscribe: (vigenersl) => bank.onChange(vigenersl),
 *     read: () => bank.balanceOf(playerId),
 * });
 */
export const useExternal = <T>(options: ExternalOptions<T>): T => {
    const latest = useRef(options);
    latest.current = options;
    const value = useSignal(() => options.read());

    // `read` may close over props: read again on every render, so a changed prop is not stale.
    const current = options.read();
    if (!(options.equals ?? Object.is)(value.peek(), current)) value.set(current);

    useEffect(() => {
        const notify = (): void => {
            const next = latest.current.read();
            const equals = latest.current.equals ?? Object.is;
            if (!equals(value.peek(), next)) value.set(next);
        };
        // Catches a change made between the first read and subscribing.
        notify();
        const unsubscribe = latest.current.subscribe(notify);
        return typeof unsubscribe === "function" ? unsubscribe : undefined;
    }, []);

    return value.value;
};
