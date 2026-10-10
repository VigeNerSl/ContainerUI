/** Block positions as keys, and which block types are containers. */

import type { Vector3 } from "@minecraft/server";

/** The `dimension:x:y:z` key of a block position. */
export const blockKeyOf = (dimensionId: string, location: Vector3): string => {
    return `${dimensionId}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}`;
};

/** The parts of a `dimension:x:y:z` block key. */
export interface ParsedBlockKey {
    dimensionId: string;
    x: number;
    y: number;
    z: number;
}

/**
 * Parses a block key.
 *
 * @param blockKey A key made by {@link blockKeyOf}.
 * @returns Its parts, or `null` for a malformed key.
 */
export const parseBlockKey = (blockKey: string): ParsedBlockKey | null => {
    const parts = blockKey.split(":");
    if (parts.length < 4) return null;
    const z = Number.parseInt(parts.pop() ?? "", 10);
    const y = Number.parseInt(parts.pop() ?? "", 10);
    const x = Number.parseInt(parts.pop() ?? "", 10);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
    return { dimensionId: parts.join(":"), x, y, z };
};

/** Block types that carry a storage entity, learned as their entities are placed, opened or loaded. */
const containerBlockTypes = new Set<string>();

/**
 * Records that blocks of this type are containers.
 *
 * @internal
 */
export const rememberContainerBlockType = (typeId: string): void => {
    containerBlockTypes.add(typeId);
};

/**
 * Whether a block of this type may carry a storage entity, so a hit on it is worth a lookup.
 *
 * @internal
 */
export const isContainerBlockType = (typeId: string): boolean => {
    return containerBlockTypes.has(typeId);
};
