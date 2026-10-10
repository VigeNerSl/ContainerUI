/**
 * Context: passes a value to a subtree without threading it through props. Reading a context is
 * not a subscription; put a signal in it for a value that changes.
 */

import { useComputed, useRef, useSignal } from "./hooks.js";
import { findAncestor, requireActiveInstance } from "../runtime/instance.js";

/** A context created by {@link createContext}. */
export interface Context<T> {
    readonly id: symbol;
    readonly defaultValue: T;
    /** Used in error messages. */
    readonly name: string;
}

/**
 * Creates a context.
 *
 * @param defaultValue The value read when no ancestor provides one.
 * @param name Used in error messages.
 * @returns The context.
 * @example
 * const PlayerContext = createContext<Player | null>(null);
 */
export const createContext = <T>(defaultValue: T, name = "Context"): Context<T> => {
    return { id: Symbol(name), defaultValue, name };
};

/**
 * Provides a value to everything rendered beneath the current component.
 *
 * @param context The context.
 * @param value The value to provide.
 * @example
 * function App({ player }) {
 *     provideContext(PlayerContext, player);
 *     return <Menu />;
 * }
 */
export const provideContext = <T>(context: Context<T>, value: T): void => {
    const instance = requireActiveInstance("provideContext");
    instance.providedContexts ??= new Map<symbol, unknown>();
    instance.providedContexts.set(context.id, value);
};

/**
 * Reads the nearest provided value, or the context's default.
 *
 * @param context The context.
 * @returns The value.
 * @example
 * const player = useContext(PlayerContext);
 */
export const useContext = <T>(context: Context<T>): T => {
    const instance = requireActiveInstance("useContext");
    const provider = findAncestor(instance, (candidate) => candidate.providedContexts?.has(context.id) === true);
    return provider ? (provider.providedContexts?.get(context.id) as T) : context.defaultValue;
};

/**
 * Reads part of a context value, re-rendering only when that part changes. `select` runs in a
 * computed, so it tracks the signals it reads.
 *
 * @param context The context.
 * @param select Returns the part to watch: a primitive or a stable reference.
 * @returns The selected value.
 * @example
 * const coins = useContextSelector(ShopContext, (shop) => shop.state.value.coins);
 */
export const useContextSelector = <T, R>(context: Context<T>, select: (value: T) => R): R => {
    const value = useContext(context);
    const latestSelect = useRef(select);
    latestSelect.current = select;
    const provided = useSignal(value);
    provided.set(value);
    const selected = useComputed(() => latestSelect.current(provided.value));
    return selected.value;
};

/**
 * Like {@link useContext}, but throws when the value is `null` or `undefined`, including a
 * provided `null`.
 *
 * @param context The context.
 * @returns The provided value.
 * @throws {Error} When the context's value is `null` or `undefined`.
 */
export const useRequiredContext = <T>(context: Context<T>): NonNullable<T> => {
    const value = useContext(context);
    if (value == null) {
        throw new Error(
            `[ContainerUI] No value provided for ${context.name}. Call provideContext(${context.name}, …) in an ancestor component.`,
        );
    }
    return value as NonNullable<T>;
};
