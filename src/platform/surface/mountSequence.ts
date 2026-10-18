/** The open sequence: spawn, wait for the inventory, render, mount. Every side effect is injected. */

/** Outcome of a spawn attempt. */
export type SpawnOutcome =
    /** The entity exists. */
    | "spawned"
    /** Refused in a read-only context; retried next tick. */
    | "deferred"
    /** Unrecoverable. */
    | "failed";

/** One step of the open sequence, for an observer. */
export type MountEvent =
    | { kind: "spawn-deferred"; attempt: number }
    | { kind: "spawn-failed" }
    | { kind: "inventory-ready"; ticksWaited: number }
    | { kind: "inventory-timeout"; ticksWaited: number }
    | { kind: "activation-failed"; ticksWaited: number }
    | { kind: "mounted"; ticksWaited: number };

/** The steps and limits of {@link runMountSequence}. */
export interface MountSequenceOptions {
    /** Ticks to wait for the inventory to reach its size. */
    maxWaitTicks: number;
    /** Spawn attempts allowed while the engine defers. */
    maxSpawnAttempts: number;
    /** Spawns the surface entity. */
    spawn: () => SpawnOutcome;
    /** Whether the container has reached its size. */
    isInventoryReady: () => boolean;
    /** Renders and mounts the viewer. `false` when either failed. */
    activate: () => boolean;
    /** Runs the callback next tick. */
    scheduleTick: (callback: () => void) => void;
    /** Whether to stop: the surface closed or the player left. */
    isAborted: () => boolean;
    /** Receives each step. */
    report: (event: MountEvent) => void;
}

/**
 * Runs the open sequence. Returns at once; later steps run through `scheduleTick`.
 *
 * @param options The steps and limits.
 */
export const runMountSequence = (options: MountSequenceOptions): void => {
    let ticksWaited = 0;
    let spawnAttempts = 0;

    const waitForInventory = (): void => {
        if (options.isAborted()) return;

        if (options.isInventoryReady()) {
            options.report({ kind: "inventory-ready", ticksWaited });
            // Rendered before mounting, so the screen is full whenever the player opens it.
            if (options.activate()) options.report({ kind: "mounted", ticksWaited });
            else options.report({ kind: "activation-failed", ticksWaited });
            return;
        }

        if (ticksWaited >= options.maxWaitTicks) {
            options.report({ kind: "inventory-timeout", ticksWaited });
            return;
        }

        ticksWaited++;
        options.scheduleTick(waitForInventory);
    };

    const attemptSpawn = (): void => {
        if (options.isAborted()) return;

        spawnAttempts++;
        const outcome = options.spawn();

        if (outcome === "spawned") {
            waitForInventory();
            return;
        }

        if (outcome === "deferred" && spawnAttempts < options.maxSpawnAttempts) {
            options.report({ kind: "spawn-deferred", attempt: spawnAttempts });
            options.scheduleTick(attemptSpawn);
            return;
        }

        options.report({ kind: "spawn-failed" });
    };

    attemptSpawn();
};

/**
 * Whether an error comes from calling a world-mutating function inside the engine's read-only
 * window, where `beforeEvents` handlers run. The engine's wording is not documented, so this
 * matches the phrases it is known to use.
 *
 * @param error What a call threw.
 * @returns `true` for a restricted-execution error.
 */
export const isRestrictedError = (error: unknown): boolean => {
    const message = String((error as { message?: unknown })?.message ?? error)
        .toLowerCase()
        .replace(/-/g, " ");
    return (
        message.includes("restricted execution") ||
        message.includes("read only") ||
        message.includes("privilege")
    );
};

/**
 * Classifies a spawn error by its message. Anything unrecognised is `failed`.
 *
 * @param error What the spawn threw.
 * @returns `deferred` for a read-only window, `failed` otherwise.
 */
export const classifySpawnError = (error: unknown): SpawnOutcome => {
    return isRestrictedError(error) ? "deferred" : "failed";
};
