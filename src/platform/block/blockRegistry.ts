/** Finding a block's storage entity, including a parked one, and settling duplicates. */

import type { Dimension, Entity, Vector3 } from "@minecraft/server";
import {
    BLOCK_KEY_PROPERTY,
    HIDDEN_TAG,
    STORAGE_ENTITY_TYPE_ID,
    STORAGE_HIDDEN_LOOKUP_DISTANCE,
    STORAGE_LOOKUP_DISTANCE,
    STORAGE_UUID_PROPERTY,
    hiddenYFor,
} from "../constants.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { componentNameOf, emitBlockEvent } from "./blockEvents.js";
import { blockKeyOf } from "./blockKeys.js";

const occupiedSlots = (entity: Entity): number => {
    const container = inventoryContainerOf(entity);
    if (!container) return 0;
    let occupied = 0;
    for (let index = 0; index < container.size; index++) {
        try {
            if (container.getItem(index)) occupied++;
        } catch {
            break;
        }
    }
    return occupied;
};

/** Every storage entity bound to a block, at the block or at the hidden-Y parking spot, fullest first. */
const storageCandidatesOf = (dimension: Dimension, location: Vector3): { entity: Entity; occupied: number }[] => {
    const key = blockKeyOf(dimension.id, location);
    const matches: Entity[] = [];

    const collect = (center: Vector3, maxDistance: number): void => {
        try {
            const candidates = dimension.getEntities({ type: STORAGE_ENTITY_TYPE_ID, location: center, maxDistance });
            for (const candidate of candidates) {
                if (candidate.getDynamicProperty(BLOCK_KEY_PROPERTY) !== key) continue;
                if (matches.some((known) => known.id === candidate.id)) continue;
                matches.push(candidate);
            }
        } catch {
            // An unloaded chunk: not found. Only the menu open retries.
        }
    };

    collect({ x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }, STORAGE_LOOKUP_DISTANCE);
    collect({ x: location.x + 0.5, y: hiddenYFor(dimension), z: location.z + 0.5 }, STORAGE_HIDDEN_LOOKUP_DISTANCE);

    if (matches.length <= 1) return matches.map((entity) => ({ entity, occupied: 0 }));
    return matches.map((entity) => ({ entity, occupied: occupiedSlots(entity) })).sort((first, second) => second.occupied - first.occupied);
};

/**
 * Finds a block's storage entity, at the block or at the hidden-Y parking spot. With duplicates,
 * the fullest. Changes nothing; {@link claimBlockStorageEntity} also removes empty duplicates.
 *
 * @param dimension The block's dimension.
 * @param location The block's position.
 * @returns The entity, or `null`.
 */
export const findBlockStorageEntity = (dimension: Dimension, location: Vector3): Entity | null => {
    return storageCandidatesOf(dimension, location)[0]?.entity ?? null;
};

/**
 * Finds a block's storage entity as {@link findBlockStorageEntity} does, removes the empty
 * duplicates beside it and logs any duplicates it finds.
 *
 * @param dimension The block's dimension.
 * @param location The block's position.
 * @returns The entity kept, or `null`.
 */
export const claimBlockStorageEntity = (dimension: Dimension, location: Vector3): Entity | null => {
    const ranked = storageCandidatesOf(dimension, location);
    const keeper = ranked[0];
    if (!keeper || ranked.length === 1) return keeper?.entity ?? null;

    let removedEmpties = 0;
    let keptExtras = 0;
    for (const extra of ranked.slice(1)) {
        if (extra.occupied > 0) {
            keptExtras++;
            continue;
        }
        try {
            if (extra.entity.isValid) extra.entity.remove();
            removedEmpties++;
        } catch {
            keptExtras++;
        }
    }

    emitBlockEvent({
        kind: "storage-duplicate",
        component: componentNameOf(keeper.entity),
        blockKey: blockKeyOf(dimension.id, location),
        detail: `found=${ranked.length} keptOccupied=${keeper.occupied} removedEmpty=${removedEmpties} keptExtra=${keptExtras}`,
    });
    return keeper.entity;
};

/**
 * Finds a parked storage entity by its stored id.
 *
 * @returns The entity, or `null`.
 */
export const findHiddenStorageByStoredId = (dimension: Dimension, storedId: string): Entity | null => {
    try {
        const hidden = dimension.getEntities({ type: STORAGE_ENTITY_TYPE_ID, tags: [HIDDEN_TAG] });
        return hidden.find((entity) => entity.getDynamicProperty(STORAGE_UUID_PROPERTY) === storedId) ?? null;
    } catch {
        return null;
    }
};
