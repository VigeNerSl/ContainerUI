/** Calling an observer a caller passed in: whatever it throws stays with it. */

/**
 * Calls an observer with an event. An observer that throws must not break the step it watches.
 *
 * @internal
 */
export const notifySafely = <TEvent>(observer: ((event: TEvent) => void) | undefined, event: TEvent): void => {
    try {
        observer?.(event);
    } catch {
        // An observer must not break the step it watches.
    }
};
