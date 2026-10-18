/** Reading an entity's or a block's inventory container, and a player's ender chest. */

import type { Block, BlockInventoryComponent, Container, Entity, EntityEnderInventoryComponent, EntityInventoryComponent } from "@minecraft/server";
import { ENDER_INVENTORY_COMPONENT_ID, INVENTORY_COMPONENT_ID } from "../constants.js";

/** A component's container, when it can be used. */
const usableContainerOf = (read: () => Container | undefined): Container | null => {
    try {
        const container = read();
        if (!container || container.isValid === false) return null;
        return container;
    } catch {
        return null;
    }
};

/**
 * An entity's inventory container, when it can be used.
 *
 * @param entity A surface, a storage entity or a player.
 * @returns The container, or `null` when the entity has none, it is no longer valid, or the read failed.
 */
export const inventoryContainerOf = (entity: Entity): Container | null => {
    return usableContainerOf(() => (entity.getComponent(INVENTORY_COMPONENT_ID) as EntityInventoryComponent | undefined)?.container);
};

/**
 * A player's ender chest, the container every ender chest shows them, when it can be used.
 *
 * @param entity A player.
 * @returns The container, or `null` when the entity has none, it is no longer valid, or the read failed.
 */
export const enderContainerOf = (entity: Entity): Container | null => {
    return usableContainerOf(() => (entity.getComponent(ENDER_INVENTORY_COMPONENT_ID) as EntityEnderInventoryComponent | undefined)?.container);
};

/**
 * A block's inventory container, when it can be used.
 *
 * @param block A chest, a dispenser, a shulker box, or any block.
 * @returns The container, or `null` when the block has none, it is no longer valid, or the read failed.
 */
export const blockContainerOf = (block: Block | undefined): Container | null => {
    return usableContainerOf(() => (block?.getComponent(INVENTORY_COMPONENT_ID) as BlockInventoryComponent | undefined)?.container);
};
