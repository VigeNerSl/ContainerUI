/** Block containers: a custom block whose inventory lives in a storage entity. */

import type { BlockComponentRegistry, Entity, Player } from "@minecraft/server";
import type { Child, Diagnostic } from "../../core/index.js";
import { BLOCK_KEY_PROPERTY, STORAGE_WATCH_INTERVAL_TICKS, SUPPORTED_SIZES } from "../constants.js";
import { onReinstall } from "../lifecycle.js";
import { emitBlockEvent, setBlockContainerLogger, type BlockContainerEvent } from "./blockEvents.js";
import { claimBlockStorageEntity, findBlockStorageEntity } from "./blockRegistry.js";
import { onBlockBroken, onBlockBrokenByPlayer, onBlockInteracted, onBlockPlaced, type BlockHookEvent } from "./blockHooks.js";
import { openBlockContainer, type RegisteredContainer } from "./blockMenu.js";
import { installBlockSneak, registerSneakHint } from "./blockSneak.js";
import { BlockStorage } from "./blockStorage.js";
import { installStorageAccess, registerMenuOpener, registerNativeEmitter } from "./storageAccess.js";
import { installOrphanSweep, registerRemovalPolicy } from "./storageRemoval.js";

export { setBlockContainerLogger, findBlockStorageEntity, claimBlockStorageEntity, type BlockContainerEvent };

/** What a block container's `render` and `title` receive. */
export interface BlockContainerRenderContext {
    /** The block's storage. */
    storage: BlockStorage;
    /** The viewer. */
    player: Player;
    /** The storage entity. */
    entity: Entity;
    /** Closes this player's menu. */
    close: () => void;
}

/** How a block container stores, opens and reports. */
export interface BlockContainerOptions {
    /** Slot count; one of the supported surface sizes. */
    size: number;
    /** Container title. A function receives the render context per open. */
    title?: string | ((context: BlockContainerRenderContext) => string) | undefined;
    /**
     * How the block opens. `"native"` shows the storage's own inventory, like a chest. `"menu"`
     * opens `render` as a menu the viewer rides. Defaults to `"menu"` with `render`, `"native"`
     * without.
     */
    open?: "native" | "menu" | undefined;
    /** The menu tree; requires `open: "menu"`. Defaults to a mirror of the whole storage. */
    render?: ((context: BlockContainerRenderContext) => Child) | undefined;
    /**
     * Action-bar text shown when the block is hit without sneaking, or `null` for none. Defaults to
     * an English hint.
     *
     * @example
     * sneakHintMessage: "§eSneak and look at the block to break it"
     */
    sneakHintMessage?: string | null | undefined;
    /** Drop the stored items when the block is broken. Defaults to `true`. */
    dropOnBreak?: boolean | undefined;
    /** Menus only: ticks between checks for changes made outside the menu, or `null` to disable. Defaults to 10. */
    watchIntervalTicks?: number | null | undefined;
    /** Menus only: action-bar hint shown once the player is seated, before they open the screen. */
    hintMessage?: string | undefined;
    /** Menus only: ticks between interaction scans. */
    scanIntervalTicks?: number | undefined;
    /** Menus only: receives runtime diagnostics. */
    onDiagnostic?: ((diagnostic: Diagnostic) => void) | undefined;
    /** Menus only: receives interaction-tracking records. */
    onTrace?: ((message: string) => void) | undefined;
    /**
     * Receives this component's open, close and contents records, from menus and native opens alike.
     * Records of the storage entity itself (sneak hiding, restores, hits, failed writes) go to
     * {@link setBlockContainerLogger}.
     */
    onEvent?: ((event: BlockContainerEvent) => void) | undefined;
}

/**
 * How the component opens.
 *
 * @throws {RangeError} For an unsupported size, or `render` with `open: "native"`.
 */
const resolveOpenMode = (componentName: string, options: BlockContainerOptions): "native" | "menu" => {
    if (!SUPPORTED_SIZES.includes(options.size)) {
        throw new RangeError(
            `[ContainerUI] Unsupported block container size ${options.size}. Supported sizes: ${SUPPORTED_SIZES.join(", ")}.`,
        );
    }
    const openMode = options.open ?? (options.render ? "menu" : "native");
    if (openMode === "native" && options.render) {
        throw new RangeError(
            `[ContainerUI] Block container "${componentName}" has a render function but opens natively. A native inventory shows the storage and nothing else; pass open: "menu".`,
        );
    }
    return openMode;
};

/** Sends a component's records to its `onEvent`, or to the shared block logger without one. */
const emitterOf = (options: BlockContainerOptions): ((event: BlockContainerEvent) => void) => {
    const onEvent = options.onEvent;
    if (!onEvent) return emitBlockEvent;
    return (event) => {
        try {
            onEvent(event);
        } catch {
            // A logging hook must not break the block.
        }
    };
};

/** Installs what every block container needs; idempotent. */
const installBlockMachinery = (): void => {
    installBlockSneak();
    installOrphanSweep();
    installStorageAccess();
};

/**
 * Binds a custom block component to a storage entity. Call inside `system.beforeEvents.startup`;
 * the block JSON must list the component.
 *
 * @param registry The startup event's block component registry.
 * @param componentName The custom component name.
 * @param options Block container options.
 * @throws {RangeError} For an unsupported size, or `render` with `open: "native"`.
 * @example
 * system.beforeEvents.startup.subscribe((vigenersl) => {
 *     registerBlockContainer(vigenersl.blockComponentRegistry, "containerui:crate", { size: 27, title: "§6Crate" });
 * });
 */
export const registerBlockContainer = (registry: BlockComponentRegistry, componentName: string, options: BlockContainerOptions): void => {
    const container: RegisteredContainer = {
        componentName,
        options,
        openMode: resolveOpenMode(componentName, options),
        dropOnBreak: options.dropOnBreak ?? true,
        // `null` turns the watch off, so only `undefined` takes the default.
        watchIntervalTicks: options.watchIntervalTicks === undefined ? STORAGE_WATCH_INTERVAL_TICKS : options.watchIntervalTicks,
        staticTitle: typeof options.title === "string" ? options.title : "Container",
        emit: emitterOf(options),
    };

    installBlockMachinery();
    onReinstall(installBlockMachinery);

    registerNativeEmitter(componentName, container.emit);
    registerRemovalPolicy(componentName, { dropOnBreak: container.dropOnBreak });
    if (options.sneakHintMessage !== undefined) registerSneakHint(componentName, options.sneakHintMessage);
    if (container.openMode === "menu") {
        // The storage entity takes the click: open the menu instead of its raw inventory.
        registerMenuOpener(componentName, ({ entity, player }) => {
            const recorded = entity.getDynamicProperty(BLOCK_KEY_PROPERTY);
            const blockKey = typeof recorded === "string" ? recorded : "unknown";
            container.emit({ kind: "interact", component: componentName, blockKey, player: player.name, detail: "menu: through its storage entity" });
            openBlockContainer({ container, player, blockKey }, BlockStorage.forEntity(entity));
        });
    }

    registry.registerCustomComponent(componentName, {
        onPlace: (vigenersl: BlockHookEvent) => onBlockPlaced(container, vigenersl),
        onPlayerInteract: (vigenersl: BlockHookEvent) => onBlockInteracted(container, vigenersl),
        onPlayerBreak: (vigenersl: BlockHookEvent) => onBlockBrokenByPlayer(container, vigenersl),
        onBreak: (vigenersl: BlockHookEvent) => onBlockBroken(container, vigenersl),
    });
};
