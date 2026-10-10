/** Reading an entity's inventory container. */

import type { Container, Entity, EntityInventoryComponent } from "@minecraft/server";
import { INVENTORY_COMPONENT_ID } from "../constants.js";

/**
 * An entity's inventory container, when it can be used.
 *
 * @param entity A surface, a storage entity or a player.
 * @returns The container, or `null` when the entity has none, it is no longer valid, or the read failed.
 */
export const inventoryContainerOf = (entity: Entity): Container | null => {
    try {
        const container = (entity.getComponent(INVENTORY_COMPONENT_ID) as EntityInventoryComponent | undefined)?.container;
        if (!container || container.isValid === false) return null;
        return container;
    } catch {
        return null;
    }
};
