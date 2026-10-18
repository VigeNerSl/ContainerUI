/** Entities resolved by id, for work that runs on a later tick, and entities loaded in every dimension. */

import { world, type Entity, type EntityQueryOptions, type Player } from "@minecraft/server";
import { DIMENSION_IDS } from "../constants.js";

/**
 * A valid entity with this id.
 *
 * @internal
 * @returns The entity, or `undefined` once it is gone or unloaded.
 */
export const entityById = (entityId: string | null | undefined): Entity | undefined => {
    if (!entityId) return undefined;
    try {
        const entity = world.getEntity(entityId);
        return entity?.isValid ? entity : undefined;
    } catch {
        return undefined;
    }
};

/**
 * The online player with this id.
 *
 * @internal
 * @returns The player, or `undefined` once they have left.
 */
export const playerById = (playerId: string | null | undefined): Player | undefined => {
    const entity = entityById(playerId);
    return entity?.typeId === "minecraft:player" ? (entity as Player) : undefined;
};

/**
 * Visits every loaded entity that matches `query`, in every dimension. A dimension that cannot be
 * read is skipped: its entities are met as their chunks load.
 *
 * @internal
 */
export const forEachLoadedEntity = (query: EntityQueryOptions, visit: (entity: Entity) => void): void => {
    for (const dimensionId of DIMENSION_IDS) {
        try {
            world.getDimension(dimensionId).getEntities(query).forEach((entity) => visit(entity));
        } catch {
            // Met as its chunk loads.
        }
    }
};
