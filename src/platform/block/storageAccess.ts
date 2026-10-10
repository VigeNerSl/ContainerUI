/**
 * Clicks on a block's storage entity: the engine opens its inventory natively, or, for a menu
 * block, the click is cancelled and the menu opens. Tracks who has it open natively.
 */

import {
    system,
    world,
    type Entity,
    type EntityContainerClosedAfterEvent,
    type EntityContainerOpenedAfterEvent,
    type Player,
    type PlayerInteractWithEntityBeforeEvent,
    type PlayerLeaveAfterEvent,
} from "@minecraft/server";
import { BLOCK_COMPONENT_PROPERTY, BLOCK_KEY_PROPERTY, STORAGE_ENTITY_TYPE_ID } from "../constants.js";
import { componentNameOf, emitBlockEvent, type BlockContainerEvent } from "./blockEvents.js";
import { forgetNativeViewer, hasOpenSessions, recordNativeAccess } from "./blockSessions.js";
import { BlockStorage } from "./blockStorage.js";
import { settleIfOrphaned } from "./storageRemoval.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";

/** Where a component's records go. */
type Emit = (event: BlockContainerEvent) => void;
/** Opens a component's menu for a click on its storage entity. */
type MenuOpener = (click: { entity: Entity; player: Player }) => void;

const emitByComponent = new Map<string, Emit>();
const menuOpenerByComponent = new Map<string, MenuOpener>();
/** One menu per player per tick: one click can raise the event more than once. */
const menuTickByPlayerId = new Map<string, number>();
let isInstalled = false;

const menuOpenerOf = (entity: Entity | undefined): MenuOpener | undefined => {
    try {
        if (!entity?.isValid || entity.typeId !== STORAGE_ENTITY_TYPE_ID) return undefined;
        const component = entity.getDynamicProperty(BLOCK_COMPONENT_PROPERTY);
        return typeof component === "string" ? menuOpenerByComponent.get(component) : undefined;
    } catch {
        return undefined;
    }
};

const recordAccess = ({ entity, viewer, isOpen }: { entity: Entity | undefined; viewer: Entity | undefined; isOpen: boolean }): void => {
    try {
        // Surfaces raise these events too; they are not ours.
        if (!entity?.isValid || entity.typeId !== STORAGE_ENTITY_TYPE_ID) return;
        const entityId = entity.id;
        const viewers = recordNativeAccess({ entityId, viewerId: viewer?.id ?? "unknown", isOpen });

        const componentName = componentNameOf(entity);
        const blockKey = entity.getDynamicProperty(BLOCK_KEY_PROPERTY);
        const player = viewer?.typeId === "minecraft:player" ? (viewer as Player).name : undefined;
        const base = {
            component: componentName,
            ...(typeof blockKey === "string" ? { blockKey } : {}),
            ...(player !== undefined ? { player } : {}),
        };
        const items = BlockStorage.forEntity(entity).inventorySummary();
        const contents: BlockContainerEvent = { ...base, kind: "inventory", detail: `at=${isOpen ? "open" : "close"} entityId=${entityId} items=${items}` };
        const access: BlockContainerEvent = { ...base, kind: isOpen ? "opened" : "closed", detail: `native entityId=${entityId} viewers=${viewers}` };
        const emit = emitByComponent.get(componentName) ?? emitBlockEvent;
        // Same order as a menu: opened then contents, contents then closed.
        for (const event of isOpen ? [access, contents] : [contents, access]) emit(event);
        // Nobody is using it any more: a storage made only to describe a native open need not be kept.
        if (!isOpen && !hasOpenSessions(entityId)) BlockStorage.evict(entityId);
    } catch {
        // The entity can go mid-event.
    }
};

/** Sends a component's native open and close records to its `onEvent`. */
export const registerNativeEmitter = (componentName: string, emit: Emit): void => {
    emitByComponent.set(componentName, emit);
};

/** Makes a click on this component's storage entity open a menu instead of its inventory. */
export const registerMenuOpener = (componentName: string, open: MenuOpener): void => {
    menuOpenerByComponent.set(componentName, open);
};

/**
 * Settles a storage entity whose block went without a break event, such as a `/setblock replace`.
 * Cheap rejection first: only a storage entity is looked at, and only when someone touches it.
 */
const settleOrphan = (entity: Entity | undefined): boolean => {
    try {
        if (entity?.typeId !== STORAGE_ENTITY_TYPE_ID) return false;
    } catch {
        return false;
    }
    return settleIfOrphaned(entity);
};

/**
 * A click on a storage entity. A menu block's is cancelled and the menu opens instead; a native
 * block's is left to the engine. Either way the entity is checked for an orphan on the next tick,
 * since the engine would otherwise open an inventory over an empty block.
 */
const onStorageClicked = (vigenersl: PlayerInteractWithEntityBeforeEvent): void => {
    const { player, target } = vigenersl;
    if (target?.typeId !== STORAGE_ENTITY_TYPE_ID) return;

    const open = menuOpenerOf(target);
    if (!open) {
        // Deferred: a before-event cannot remove an entity.
        system.run(() => {
            settleOrphan(target);
        });
        return;
    }
    vigenersl.cancel = true;
    if (menuTickByPlayerId.get(player.id) === system.currentTick) return;
    menuTickByPlayerId.set(player.id, system.currentTick);
    // Deferred: a before-event cannot spawn the surface.
    system.run(() => {
        try {
            if (settleOrphan(target)) return;
            open({ entity: target, player });
        } catch (error) {
            emitBlockEvent({ kind: "error", component: componentNameOf(target), player: player.name, detail: `menu open failed: ${String(error)}` });
        }
    });
};

const onEntityContainerOpened = (vigenersl: EntityContainerOpenedAfterEvent): void => {
    const { entity, openSource } = vigenersl;
    // Before the opener counts as a viewer, or the entity would be left alone for having one.
    if (settleOrphan(entity)) return;
    recordAccess({ entity, viewer: openSource?.entity, isOpen: true });
};

const onEntityContainerClosed = (vigenersl: EntityContainerClosedAfterEvent): void => {
    recordAccess({ entity: vigenersl.entity, viewer: vigenersl.closeSource?.entity, isOpen: false });
};

const onPlayerLeft = (vigenersl: PlayerLeaveAfterEvent): void => {
    forgetNativeViewer(vigenersl.playerId);
    menuTickByPlayerId.delete(vigenersl.playerId);
};

/** Starts handling clicks and native opens. Idempotent; called by `registerBlockContainer`. */
export const installStorageAccess = (): void => {
    if (isInstalled) return;
    isInstalled = true;
    onUninstall(() => {
        isInstalled = false;
        menuTickByPlayerId.clear();
    });

    subscribeUntilUninstall(world.beforeEvents.playerInteractWithEntity, onStorageClicked);
    if (world.afterEvents.entityContainerOpened) subscribeUntilUninstall(world.afterEvents.entityContainerOpened, onEntityContainerOpened);
    subscribeUntilUninstall(world.afterEvents.entityContainerClosed, onEntityContainerClosed);
    subscribeUntilUninstall(world.afterEvents.playerLeave, onPlayerLeft);
};
