/** Opens a component tree as a container menu for a player. */

import { system, type Player } from "@minecraft/server";
import { mount, type App, type Child, type Diagnostic } from "../../core/index.js";
import { MOUNT_MAX_SPAWN_ATTEMPTS, MOUNT_MAX_WAIT_TICKS } from "../constants.js";
import { runMountSequence, type MountEvent } from "./mountSequence.js";
import { installBedrockRuntime, logDiagnostic } from "./runtimeInstall.js";
import { BedrockSurface, type BedrockSurfaceOptions } from "./surface.js";

export { installBedrockRuntime };

/** Closes a surface whose open sequence failed, explaining an inventory that never grew. */
const answerMountEvent = ({
    event,
    surface,
    size,
    reportDiagnostic,
}: {
    event: MountEvent;
    surface: BedrockSurface;
    size: number;
    reportDiagnostic: (diagnostic: Diagnostic) => void;
}): void => {
    if (event.kind === "inventory-timeout") {
        reportDiagnostic({
            kind: "platform-error",
            message:
                `Surface inventory never reached ${size} slots (waited ${event.ticksWaited} ticks). ` +
                "Is the ContainerUI behaviour pack with the surface entity active in this world?",
        });
    }
    if (event.kind === "inventory-timeout" || event.kind === "spawn-failed" || event.kind === "activation-failed") {
        surface.close("invalidated");
    }
};

/** How {@link openContainer} opens a menu. */
export interface OpenContainerOptions extends BedrockSurfaceOptions {
    /** Receives layout mistakes, handler errors and platform failures. Defaults to the logger set by `setLogger`. */
    onDiagnostic?: ((diagnostic: Diagnostic) => void) | undefined;
    /** Observes the open sequence. */
    onMountEvent?: ((event: MountEvent) => void) | undefined;
    /** Ticks to wait for the inventory to reach its size. */
    maxWaitTicks?: number | undefined;
}

/** An open container menu. */
export interface ContainerSession {
    /** The surface the menu renders onto. */
    readonly surface: BedrockSurface;
    /** The mounted app, once the menu is live. */
    readonly app: App | null;
    /** Resolves when the menu closes. */
    readonly closed: Promise<void>;
    /** Closes the menu. */
    close(): void;
}

/**
 * Opens `element` as a container menu for `player`. Safe to call from a `beforeEvents` handler.
 *
 * @param player The viewer.
 * @param element The tree, or a function returning it.
 * @param options Size, title and observers.
 * @returns The session.
 * @example
 * openContainer(player, () => <Shop player={player} />, { size: 54, title: "§dShop" });
 */
export const openContainer = (player: Player, element: Child | (() => Child), options: OpenContainerOptions): ContainerSession => {
    installBedrockRuntime();

    const reportDiagnostic = options.onDiagnostic ?? logDiagnostic;

    const surface = new BedrockSurface(player, {
        ...options,
        onError: options.onError ?? ((message) => reportDiagnostic({ kind: "platform-error", message })),
    });

    let app: App | null = null;
    const closed = new Promise<void>((resolve) => {
        surface.onClose(() => {
            app?.unmount();
            resolve();
        });
    });

    runMountSequence({
        maxWaitTicks: options.maxWaitTicks ?? MOUNT_MAX_WAIT_TICKS,
        maxSpawnAttempts: MOUNT_MAX_SPAWN_ATTEMPTS,
        spawn: () => surface.open(),
        isInventoryReady: () => surface.isInventoryReady(),
        activate: () => {
            app = mount(element, surface, { onDiagnostic: reportDiagnostic });
            if (surface.activate()) return true;
            app.unmount();
            app = null;
            return false;
        },
        scheduleTick: (callback) => {
            system.runTimeout(callback, 1);
        },
        isAborted: () => surface.isClosed,
        report: (event) => {
            options.onMountEvent?.(event);
            answerMountEvent({ event, surface, size: options.size, reportDiagnostic });
        },
    });

    return {
        surface,
        get app() {
            return app;
        },
        closed,
        close: () => surface.close("programmatic"),
    };
};
