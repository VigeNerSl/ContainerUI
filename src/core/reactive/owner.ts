/** Ownership scopes: everything created inside one is disposed with it. */

import type { Dispose } from "./graph.js";
import { log } from "../logging/logger.js";

/** Owns cleanups and child scopes, and disposes them together. */
export interface Scope {
    readonly depth: number;
    readonly parent: Scope | null;
    readonly disposables: Dispose[];
    readonly children: Set<Scope>;
    isDisposed: boolean;
}

let activeScope: Scope | null = null;

const logUncaught = (error: unknown): void => {
    log({ level: "warn", source: "runtime", message: `Uncaught error in an effect, render or cleanup: ${String(error)}`, detail: error });
};

let errorReporter: (error: unknown) => void = logUncaught;

/**
 * The scope that cleanups and new scopes attach to.
 *
 * @returns The active scope, or `null` outside one.
 */
export const getActiveScope = (): Scope | null => {
    return activeScope;
};

/**
 * Creates a scope. Under a disposed parent it is born disposed: nothing would dispose it later.
 *
 * @param parent Owns the new scope. Defaults to the active scope.
 * @returns The scope.
 */
export const createScope = (parent: Scope | null = activeScope): Scope => {
    const isParentDisposed = parent?.isDisposed === true;
    const scope: Scope = {
        depth: parent ? parent.depth + 1 : 0,
        parent,
        disposables: [],
        children: new Set(),
        isDisposed: isParentDisposed,
    };
    if (!isParentDisposed) parent?.children.add(scope);
    return scope;
};

/**
 * Runs `body` with `scope` active.
 *
 * @param scope The scope, or `null` for none.
 * @param body The work.
 * @returns What `body` returns.
 */
export const runWithScope = <T>(scope: Scope | null, body: () => T): T => {
    const previousScope = activeScope;
    activeScope = scope;
    try {
        return body();
    } finally {
        activeScope = previousScope;
    }
};

/**
 * Registers a cleanup on the active scope. Outside a scope it does nothing; on a scope already
 * disposed it runs at once, since nothing would run it later.
 *
 * @param cleanup Runs when the scope is disposed.
 */
export const onCleanup = (cleanup: Dispose): void => {
    const scope = activeScope;
    if (!scope) return;
    if (!scope.isDisposed) {
        scope.disposables.push(cleanup);
        return;
    }
    try {
        cleanup();
    } catch (error) {
        reportScopeError(error);
    }
};

/** Disposes a scope's children, then runs its cleanups in reverse order. A throwing cleanup is reported and does not stop the rest. */
const releaseContents = (scope: Scope): void => {
    // Most effect runs have nothing to release: they allocate nothing here.
    if (scope.children.size === 0 && scope.disposables.length === 0) return;
    for (const child of Array.from(scope.children)) {
        disposeScope(child);
    }
    scope.children.clear();

    // Taken first: a cleanup may register another on the same scope.
    const disposables = scope.disposables.splice(0);
    for (let index = disposables.length - 1; index >= 0; index--) {
        try {
            disposables[index]!();
        } catch (error) {
            reportScopeError(error);
        }
    }
};

/**
 * Disposes everything a scope owns, children and cleanups, leaving the scope itself usable. An
 * effect does this before each run, so what its last run created goes with it.
 *
 * @internal
 */
export const resetScope = (scope: Scope): void => {
    if (scope.isDisposed) return;
    releaseContents(scope);
};

/**
 * Disposes a scope: its children first, then its cleanups in reverse order. A throwing cleanup
 * is reported and does not stop the rest.
 *
 * @param scope The scope. Disposing it twice does nothing.
 */
export const disposeScope = (scope: Scope): void => {
    if (scope.isDisposed) return;
    scope.isDisposed = true;
    releaseContents(scope);
    scope.parent?.children.delete(scope);
};

/**
 * Runs `body` in a new detached scope.
 *
 * @param body Receives the scope's disposer.
 * @returns What `body` returns.
 * @example
 * const dispose = createRoot((dispose) => {
 *     effect(() => console.info(count.value));
 *     return dispose;
 * });
 */
export const createRoot = <T>(body: (dispose: Dispose) => T): T => {
    const scope = createScope(null);
    return runWithScope(scope, () => body(() => disposeScope(scope)));
};

/**
 * Sets where errors from effects, renders and cleanups go, instead of the logger set by `setLogger`.
 *
 * @param reporter Receives each error, or `null` to send them to the logger again.
 */
export const setErrorReporter = (reporter: ((error: unknown) => void) | null): void => {
    errorReporter = reporter ?? logUncaught;
};

/** @internal */
export const reportScopeError = (error: unknown): void => {
    errorReporter(error);
};
