/** Key-value backends over dynamic properties, of the world or of one entity. */

import { world, type Entity } from "@minecraft/server";
import type { KeyValueBackend } from "../../core/index.js";

/**
 * A backend over the world's dynamic properties.
 *
 * @returns The backend.
 * @example
 * const store = new JsonStore(createWorldBackend(), { namespace: "shop" });
 */
export const createWorldBackend = (): KeyValueBackend => {
    return {
        get: (key) => {
            const value = world.getDynamicProperty(key);
            return typeof value === "string" ? value : undefined;
        },
        set: (key, value) => {
            world.setDynamicProperty(key, value);
        },
        keys: () => {
            return world.getDynamicPropertyIds();
        },
    };
};

/**
 * A backend over one entity's dynamic properties. Reads and writes throw once the entity is gone,
 * so a `JsonStore` over it reports the loss through `onCorrupt` instead of reading empty data.
 *
 * @param entity The entity holding the data.
 * @returns The backend.
 */
export const createEntityBackend = (entity: Entity): KeyValueBackend => {
    const entityId = entity.id;

    const resolve = (): Entity | null => {
        const resolved = world.getEntity(entityId);
        return resolved?.isValid ? resolved : null;
    };

    return {
        get: (key) => {
            const target = resolve();
            if (!target) throw new Error(`[ContainerUI] Entity ${entityId} is gone; cannot read "${key}".`);
            const value = target.getDynamicProperty(key);
            return typeof value === "string" ? value : undefined;
        },
        set: (key, value) => {
            const target = resolve();
            if (!target) {
                throw new Error(`[ContainerUI] Entity ${entityId} is gone; cannot persist "${key}".`);
            }
            target.setDynamicProperty(key, value);
        },
        keys: () => {
            const target = resolve();
            if (!target) throw new Error(`[ContainerUI] Entity ${entityId} is gone; cannot list its keys.`);
            return target.getDynamicPropertyIds();
        },
    };
};
