/** What a container block does when it is placed, clicked and broken. */

import { system, type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import {
    BLOCK_COMPONENT_PROPERTY,
    BLOCK_KEY_PROPERTY,
    STORAGE_ENTITY_TAG,
    STORAGE_ENTITY_TYPE_ID,
    STORAGE_LOAD_RETRY_ATTEMPTS,
    STORAGE_UUID_PROPERTY,
    openEventFor,
    surfaceNameTag,
} from "../constants.js";
import { componentNameOf } from "./blockEvents.js";
import { blockKeyOf } from "./blockKeys.js";
import { claimBlockStorageEntity } from "./blockRegistry.js";
import { openWhenStorageLoads, type RegisteredContainer } from "./blockMenu.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { recordBlockType, removeStorage, settleReplacedStorage } from "./storageRemoval.js";

/** What a block component hook receives, as far as the container reads it. */
export interface BlockHookEvent {
    block: { location: Vector3; typeId: string };
    dimension: Dimension;
    player?: Player;
    entitySource?: { typeId: string };
    blockDestructionSource?: { typeId: string };
}

/** A random v4-style identifier for a storage entity. */
const generateStorageId = (): string => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const randomValue = (Math.random() * 16) | 0;
        const resolvedValue = char === "x" ? randomValue : (randomValue & 0x3) | 0x8;
        return resolvedValue.toString(16);
    });
};

/** A plain copy of an engine location, safe to keep past the event. */
const copyLocation = ({ x, y, z }: Vector3): Vector3 => {
    return { x, y, z };
};

const spawnStorageEntity = ({
    dimension,
    location,
    size,
    componentName,
    title,
}: {
    dimension: Dimension;
    location: Vector3;
    size: number;
    componentName: string;
    title: string;
}): Entity | null => {
    try {
        const entity = dimension.spawnEntity(STORAGE_ENTITY_TYPE_ID, {
            x: location.x + 0.5,
            y: location.y,
            z: location.z + 0.5,
        });
        entity.addTag(STORAGE_ENTITY_TAG);
        entity.setDynamicProperty(BLOCK_KEY_PROPERTY, blockKeyOf(dimension.id, location));
        entity.setDynamicProperty(BLOCK_COMPONENT_PROPERTY, componentName);
        entity.setDynamicProperty(STORAGE_UUID_PROPERTY, generateStorageId());
        entity.triggerEvent(openEventFor(size));
        entity.nameTag = surfaceNameTag(size, title);
        return entity;
    } catch {
        return null;
    }
};

/** Removes a broken block's storage, dropping its items when the component says so, and logs it. */
const breakStorage = ({
    container,
    entity,
    location,
    fields,
}: {
    container: RegisteredContainer;
    entity: Entity;
    location: Vector3;
    fields: { blockKey: string; player?: string; detail?: string };
}): void => {
    const { componentName, dropOnBreak, emit } = container;
    const dropped = removeStorage({ entity, location, dropOnBreak });
    if (dropOnBreak) emit({ kind: "dropped", component: componentName, blockKey: fields.blockKey, detail: `items=${dropped}` });
    emit({ kind: "broken", component: componentName, ...fields });
};

/** Whether an entity found at a block is the storage this component would spawn there: same component, same size. */
const isStorageOf = (entity: Entity, container: RegisteredContainer): boolean => {
    try {
        return componentNameOf(entity) === container.componentName && inventoryContainerOf(entity)?.size === container.options.size;
    } catch {
        return false;
    }
};

/**
 * A placed block gets its storage entity, spawned outside the hook's read-only window. An entity
 * already at the position is kept only when it is this component's own; one left by another block
 * that was replaced without a break is settled like an orphan, and a fresh one takes its place.
 */
export const onBlockPlaced = (container: RegisteredContainer, vigenersl: BlockHookEvent): void => {
    const { block, dimension } = vigenersl;
    const { componentName, options, staticTitle, emit } = container;
    const location = copyLocation(block.location);
    const blockTypeId = block.typeId;

    system.run(() => {
        const key = blockKeyOf(dimension.id, location);
        const existing = claimBlockStorageEntity(dimension, location);
        if (existing && isStorageOf(existing, container)) {
            recordBlockType(existing, blockTypeId);
            return;
        }
        if (existing) settleReplacedStorage({ entity: existing, location, replacedBy: blockTypeId });

        const entity = spawnStorageEntity({ dimension, location, size: options.size, componentName, title: staticTitle });
        if (!entity) {
            emit({ kind: "error", component: componentName, blockKey: key, detail: "spawn failed" });
            return;
        }
        recordBlockType(entity, blockTypeId);
        emit({
            kind: "storage-spawned",
            component: componentName,
            blockKey: key,
            detail: `entityId=${entity.id} uuid=${String(entity.getDynamicProperty(STORAGE_UUID_PROPERTY))}`,
        });
    });
};

/** A click that reaches the block itself: a menu opens; a native block's own entity should have taken it. */
export const onBlockInteracted = (container: RegisteredContainer, vigenersl: BlockHookEvent): void => {
    const { block, dimension, player } = vigenersl;
    if (!player) return;
    const { componentName, openMode, emit } = container;
    const key = blockKeyOf(dimension.id, block.location);
    if (openMode === "native") {
        emit({ kind: "interact", component: componentName, blockKey: key, player: player.name, detail: "native: reached the block, not its storage entity" });
        return;
    }
    emit({ kind: "interact", component: componentName, blockKey: key, player: player.name });
    openWhenStorageLoads({
        request: { container, player, blockKey: key },
        dimension,
        location: copyLocation(block.location),
        blockTypeId: block.typeId,
        attemptsLeft: STORAGE_LOAD_RETRY_ATTEMPTS,
    });
};

export const onBlockBrokenByPlayer = (container: RegisteredContainer, vigenersl: BlockHookEvent): void => {
    const { block, dimension, player } = vigenersl;
    const key = blockKeyOf(dimension.id, block.location);
    const playerField = player ? { player: player.name } : {};

    // Also finds an entity parked at the hidden Y.
    const entity = claimBlockStorageEntity(dimension, block.location);
    if (!entity) {
        container.emit({ kind: "storage-missing", component: container.componentName, blockKey: key, ...playerField, detail: "at break" });
        return;
    }
    breakStorage({ container, entity, location: block.location, fields: { blockKey: key, ...playerField } });
};

/** Breaks without a player: explosions, commands, other blocks. */
export const onBlockBroken = (container: RegisteredContainer, vigenersl: BlockHookEvent): void => {
    const { block, dimension, entitySource, blockDestructionSource } = vigenersl;
    if (entitySource?.typeId === "minecraft:player") return;
    const location = copyLocation(block.location);
    const key = blockKeyOf(dimension.id, location);
    const cause = entitySource?.typeId ?? blockDestructionSource?.typeId ?? "unknown";

    system.run(() => {
        const entity = claimBlockStorageEntity(dimension, location);
        if (!entity) return;
        breakStorage({ container, entity, location, fields: { blockKey: key, detail: `cause=${cause}` } });
    });
};
