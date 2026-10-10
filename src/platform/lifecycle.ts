/** What the Bedrock adapter hooks into the world, kept so it can all be undone. */

import { system } from "@minecraft/server";

/** A world event signal: something to subscribe to and unsubscribe from. */
export interface WorldSignal<TEvent> {
    subscribe(callback: (event: TEvent) => void): unknown;
    unsubscribe(callback: (event: TEvent) => void): void;
}

const teardowns: (() => void)[] = [];
const reinstallers = new Set<() => void>();

/**
 * Registers an install step that the next {@link installBedrockRuntime} after an uninstall repeats.
 *
 * @internal
 */
export const onReinstall = (install: () => void): void => {
    reinstallers.add(install);
};

/**
 * Repeats every registered install step. Each step is idempotent.
 *
 * @internal
 */
export const runReinstallers = (): void => {
    for (const install of reinstallers) install();
};

/**
 * Registers what undoes one installation step.
 *
 * @internal
 */
export const onUninstall = (teardown: () => void): void => {
    teardowns.push(teardown);
};

/**
 * Subscribes to a world event until {@link uninstallBedrockRuntime}.
 *
 * @internal
 */
export const subscribeUntilUninstall = <TEvent>(signal: WorldSignal<TEvent>, callback: (event: TEvent) => void): void => {
    signal.subscribe(callback);
    onUninstall(() => signal.unsubscribe(callback));
};

/**
 * Runs `callback` every `intervalTicks` ticks until {@link uninstallBedrockRuntime}.
 *
 * @internal
 */
export const runIntervalUntilUninstall = (callback: () => void, intervalTicks: number): void => {
    const runId = system.runInterval(callback, intervalTicks);
    onUninstall(() => system.clearRun(runId));
};

/**
 * Undoes everything the adapter installed: closes every open surface, unsubscribes from world
 * events, stops its timers, drops the storages it keeps and removes the installed scheduler and
 * time source. The next `openContainer` or install call sets it all up again, block containers
 * registered at startup included.
 *
 * @example
 * uninstallBedrockRuntime();
 */
export const uninstallBedrockRuntime = (): void => {
    for (const teardown of teardowns.splice(0).reverse()) {
        try {
            teardown();
        } catch {
            // One failed step does not stop the rest.
        }
    }
};
