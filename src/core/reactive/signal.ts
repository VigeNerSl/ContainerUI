/** Signals: writable reactive values. */

import { notifySubscribers, recordDependency, type ReactiveComputation, type ReactiveSource } from "./graph.js";

/** Whether two values are the same, so a write of `next` changes nothing. */
export type Equals<T> = (previous: T, next: T) => boolean;

/** A reactive value that can be read but not written. */
export interface ReadonlySignal<T> {
    /** The value. Tracked. */
    readonly value: T;
    /** The value, untracked. */
    peek(): T;
}

/** A writable reactive value. */
export interface Signal<T> extends ReadonlySignal<T> {
    value: T;
    /** Writes `next`, notifying dependents unless it equals the current value. */
    set(next: T): void;
    /** Writes what `mutator` returns for the current value. */
    update(mutator: (previous: T) => T): void;
}

class SignalNode<T> implements ReactiveSource, Signal<T> {
    version = 0;
    readonly subscribers = new Set<ReactiveComputation>();

    #value: T;
    readonly #equals: Equals<T>;

    constructor(initial: T, equals: Equals<T>) {
        this.#value = initial;
        this.#equals = equals;
    }

    get value(): T {
        recordDependency(this);
        return this.#value;
    }

    set value(next: T) {
        this.set(next);
    }

    peek(): T {
        return this.#value;
    }

    set(next: T): void {
        if (this.#equals(this.#value, next)) return;
        this.#value = next;
        this.version++;
        notifySubscribers(this);
    }

    update(mutator: (previous: T) => T): void {
        this.set(mutator(this.#value));
    }
}

/**
 * Creates a signal. A write equal to the current value does nothing.
 *
 * @param initial The first value.
 * @param equals Whether two values are the same. Defaults to `Object.is`.
 * @returns The signal.
 * @example
 * const coins = signal(100);
 * coins.value += 50;
 */
export const signal = <T>(initial: T, equals: Equals<T> = Object.is): Signal<T> => {
    return new SignalNode(initial, equals);
};

/**
 * Wraps a signal so it can be handed out without allowing writes.
 *
 * @param source The signal to expose.
 * @returns A view that reads `source`.
 * @example
 * const balance = readonlySignal(coins);
 */
export const readonlySignal = <T>(source: Signal<T>): ReadonlySignal<T> => {
    return {
        get value() {
            return source.value;
        },
        peek: () => source.peek(),
    };
};
