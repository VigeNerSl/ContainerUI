/** Removes a block's storage entity however the block went, and finds orphaned ones. */

import { system, world, type Dimension, type Entity, type EntityLoadAfterEvent, type Vector3 } from "@minecraft/server";
import { componentNameOf, emitBlockEvent } from "./blockEvents.js";
import { blockKeyOf, parseBlockKey, rememberContainerBlockType } from "./blockKeys.js";
import { closeSessions, hasOpenSessions } from "./blockSessions.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";
import { BlockStorage } from "./blockStorage.js";
import {
    BLOCK_COMPONENT_PROPERTY,
    BLOCK_KEY_PROPERTY,
    BLOCK_TYPE_PROPERTY,
    DIMENSION_IDS,
    HIDDEN_TAG,
    ORPHAN_CHECK_DELAY_TICKS,
    STORAGE_ENTITY_TYPE_ID,
} from "../constants.js";

/** How a registered component settles its storage when its block goes. */
export interface RemovalPolicy {
    /** Drop the stored items where the block stood. */
    dropOnBreak: boolean;
}

/** The part of a block the orphan check reads. */
export interface BlockSnapshot {
    /** The block's type id. */
    typeId: string;
    /** Whether the block is air. */
    isAir: boolean;
}

/** What a storage entity's block position says about it. */
export type OrphanVerdict = "orphan" | "alive" | "unknown";

const policyByComponent = new Map<string, RemovalPolicy>();
let isSweepInstalled = false;

const blockAt = (dimension: Dimension, location: Vector3): BlockSnapshot | undefined => {
    try {
        const block = dimension.getBlock(location);
        if (!block) return undefined;
        return { typeId: block.typeId, isAir: block.isAir };
    } catch {
        // An unloaded chunk: unknown, not gone.
        return undefined;
    }
};

/** Drops a storage entity's stacks where its block stood. Returns how many stacks dropped. */
const dropInventory = (entity: Entity, location: Vector3): number => {
    let dropped = 0;
    try {
        const container = inventoryContainerOf(entity);
        if (!container) return 0;
        const dropAt = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
        for (let index = 0; index < container.size; index++) {
            const stack = container.getItem(index);
            if (!stack) continue;
            try {
                entity.dimension.spawnItem(stack, dropAt);
                container.setItem(index, undefined);
                dropped++;
            } catch {
                // One stack that cannot drop does not stop the rest.
            }
        }
    } catch {
        // The container is gone.
    }
    return dropped;
};

/** Records how a component settles its storage when its block goes. */
export const registerRemovalPolicy = (componentName: string, policy: RemovalPolicy): void => {
    policyByComponent.set(componentName, policy);
};

/** Records the block type a storage entity belongs to, for the orphan check. */
export const recordBlockType = (entity: Entity, typeId: string): void => {
    rememberContainerBlockType(typeId);
    try {
        if (entity.getDynamicProperty(BLOCK_TYPE_PROPERTY) === typeId) return;
        entity.setDynamicProperty(BLOCK_TYPE_PROPERTY, typeId);
    } catch {
        // Recorded on a later open.
    }
};

/**
 * Judges a storage entity by what stands at its block now: `unknown` whenever that is not certain.
 *
 * @returns `orphan` when the block there is not the recorded one (gone, or replaced), `alive` when it is, `unknown` otherwise.
 */
export const orphanVerdict = ({ recordedType, block }: { recordedType: unknown; block: BlockSnapshot | undefined }): OrphanVerdict => {
    if (!block) return "unknown";
    if (typeof recordedType === "string") return block.typeId === recordedType ? "alive" : "orphan";
    return block.isAir ? "orphan" : "unknown";
};

/**
 * Removes a storage entity: closes its viewers, drops its items unless told not to, and evicts
 * its storage.
 *
 * @returns How many stacks dropped.
 */
export const removeStorage = ({ entity, location, dropOnBreak }: { entity: Entity; location: Vector3; dropOnBreak: boolean }): number => {
    const entityId = entity.id;
    try {
        closeSessions(entityId);
    } catch {
        // A menu that cannot close must not keep the items in a block that is gone.
    }
    const dropped = dropOnBreak ? dropInventory(entity, location) : 0;
    BlockStorage.evict(entityId);
    try {
        if (entity.isValid) entity.remove();
    } catch {
        // Already gone.
    }
    return dropped;
};

/**
 * Settles a storage entity that another block has replaced: its items drop where the block stood,
 * unless its own component says otherwise, and it is removed. Unlike {@link settleIfOrphaned} it
 * does not wait for certainty, because the caller has just seen the replacing block placed.
 *
 * @returns How many stacks dropped.
 */
export const settleReplacedStorage = ({ entity, location, replacedBy }: { entity: Entity; location: Vector3; replacedBy: string }): number => {
    const entityId = entity.id;
    const component = componentNameOf(entity);
    const blockKey = blockKeyOf(entity.dimension.id, location);
    const dropped = removeStorage({ entity, location, dropOnBreak: policyByComponent.get(component)?.dropOnBreak ?? true });
    emitBlockEvent({
        kind: "orphan-removed",
        component,
        blockKey,
        detail: `entityId=${entityId} replacedBy=${replacedBy} dropped=${dropped}`,
    });
    return dropped;
};

/**
 * Removes a storage entity whose block is no longer the recorded one (gone, or replaced). Parked and open
 * storages are left alone.
 *
 * @returns Whether it was removed.
 */
export const settleIfOrphaned = (entity: Entity): boolean => {
    try {
        if (!entity.isValid || entity.hasTag(HIDDEN_TAG) || hasOpenSessions(entity.id)) return false;
        const component = entity.getDynamicProperty(BLOCK_COMPONENT_PROPERTY);
        if (typeof component !== "string") return false;
        const policy = policyByComponent.get(component);
        if (!policy) return false;
        const blockKey = entity.getDynamicProperty(BLOCK_KEY_PROPERTY);
        if (typeof blockKey !== "string") return false;
        const parsed = parseBlockKey(blockKey);
        if (!parsed) return false;

        const location = { x: parsed.x, y: parsed.y, z: parsed.z };
        const block = blockAt(entity.dimension, location);
        const recordedType = entity.getDynamicProperty(BLOCK_TYPE_PROPERTY);
        if (orphanVerdict({ recordedType, block }) !== "orphan") return false;

        const entityId = entity.id;
        const dropped = removeStorage({ entity, location, dropOnBreak: policy.dropOnBreak });
        emitBlockEvent({
            kind: "orphan-removed",
            component,
            blockKey,
            detail: `entityId=${entityId} found=${block?.typeId} expected=${typeof recordedType === "string" ? recordedType : "unrecorded"} dropped=${dropped}`,
        });
        return true;
    } catch {
        // Checked again on its next load.
        return false;
    }
};

/** Checks a loaded storage entity after `ORPHAN_CHECK_DELAY_TICKS`: the sneak machine restores a parked entity on load, and the block may answer late. */
const onStorageLoaded = (vigenersl: EntityLoadAfterEvent): void => {
    const { entity } = vigenersl;
    if (entity.typeId !== STORAGE_ENTITY_TYPE_ID) return;
    const recordedType = entity.getDynamicProperty(BLOCK_TYPE_PROPERTY);
    if (typeof recordedType === "string") rememberContainerBlockType(recordedType);
    system.runTimeout(() => settleIfOrphaned(entity), ORPHAN_CHECK_DELAY_TICKS);
};

/** Checks every storage entity loaded at startup. */
const sweepLoadedStorage = (): void => {
    for (const dimensionId of DIMENSION_IDS) {
        try {
            const dimension = world.getDimension(dimensionId);
            for (const entity of dimension.getEntities({ type: STORAGE_ENTITY_TYPE_ID })) settleIfOrphaned(entity);
        } catch {
            // Checked as its entities load.
        }
    }
};

/** Starts checking storage entities for orphans. Idempotent; called by `registerBlockContainer`. */
export const installOrphanSweep = (): void => {
    if (isSweepInstalled) return;
    isSweepInstalled = true;
    onUninstall(() => {
        isSweepInstalled = false;
    });

    subscribeUntilUninstall(world.afterEvents.entityLoad, onStorageLoaded);
    const sweepRunId = system.runTimeout(sweepLoadedStorage, ORPHAN_CHECK_DELAY_TICKS);
    onUninstall(() => system.clearRun(sweepRunId));
};
