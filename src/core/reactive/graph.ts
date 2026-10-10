/**
 * The reactive dependency graph. Writes push dirty flags downstream; reads pull a recomputation
 * only when a dependency's version moved.
 */

/** Releases a resource: an effect, a scope, a listener. */
export type Dispose = () => void;

/** Up to date. */
export const CLEAN = 0;
/** A dependency may have changed; compare versions before recomputing. */
export const MAYBE_DIRTY = 1;
/** A dependency changed; recompute. */
export const DIRTY = 2;

/** How stale a computation is. */
export type DirtyLevel = typeof CLEAN | typeof MAYBE_DIRTY | typeof DIRTY;

/** A signal or a computed. */
export interface ReactiveSource {
    /** Bumped only when the value changed. */
    version: number;
    readonly subscribers: Set<ReactiveComputation>;
    /** Brings a derived source up to date. */
    refresh?(): void;
}

/** A computed or an effect. */
export interface ReactiveComputation {
    readonly dependencies: ReactiveSource[];
    /** Each dependency's version at the last run, index-aligned with `dependencies`. */
    readonly dependencyVersions: number[];
    dirtyLevel: DirtyLevel;
    /** Ownership depth; shallower computations run first. */
    depth: number;
    markDirty(level: DirtyLevel): void;
}

let activeComputation: ReactiveComputation | null = null;
let trackingEnabled = true;

/** Links `source` as a dependency of the running computation, recording its version. */
export const recordDependency = (source: ReactiveSource): void => {
    const computation = activeComputation;
    if (!computation || !trackingEnabled) return;

    const dependencies = computation.dependencies;
    // Fast path: the same source read again.
    if (dependencies.length > 0 && dependencies[dependencies.length - 1] === source) return;
    if (dependencies.includes(source)) return;

    dependencies.push(source);
    computation.dependencyVersions.push(source.version);
    source.subscribers.add(computation);
};

/** Unsubscribes a computation from all its sources. */
export const clearDependencies = (computation: ReactiveComputation): void => {
    const dependencies = computation.dependencies;
    for (let index = 0; index < dependencies.length; index++) {
        dependencies[index]!.subscribers.delete(computation);
    }
    dependencies.length = 0;
    computation.dependencyVersions.length = 0;
};

/** Whether any dependency's version moved since the last run. Derived dependencies refresh first. */
export const dependenciesChanged = (computation: ReactiveComputation): boolean => {
    const dependencies = computation.dependencies;
    const versions = computation.dependencyVersions;
    for (let index = 0; index < dependencies.length; index++) {
        const dependency = dependencies[index]!;
        dependency.refresh?.();
        if (dependency.version !== versions[index]) return true;
    }
    return false;
};

/** Runs `body` as `computation`, replacing its dependencies with what the run reads. */
export const runWithComputation = <T>(computation: ReactiveComputation, body: () => T): T => {
    const previousComputation = activeComputation;
    const previousTracking = trackingEnabled;
    clearDependencies(computation);
    activeComputation = computation;
    trackingEnabled = true;
    try {
        return body();
    } finally {
        activeComputation = previousComputation;
        trackingEnabled = previousTracking;
    }
};

/**
 * Runs `body` without tracking its reads.
 *
 * @param body The work.
 * @returns What `body` returns.
 */
export const untrack = <T>(body: () => T): T => {
    const previousTracking = trackingEnabled;
    trackingEnabled = false;
    try {
        return body();
    } finally {
        trackingEnabled = previousTracking;
    }
};

/** Marks every direct subscriber of a changed source dirty. */
export const notifySubscribers = (source: ReactiveSource): void => {
    const subscribers = source.subscribers;
    if (subscribers.size === 0) return;
    // Copied: markDirty may change the set.
    for (const subscriber of Array.from(subscribers)) {
        subscriber.markDirty(DIRTY);
    }
};
