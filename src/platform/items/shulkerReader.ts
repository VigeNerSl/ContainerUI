/** Reads a shulker box item's contents by dispensing it as a block high above the player. */

import {
    BlockPermutation,
    system,
    type Block,
    type BlockInventoryComponent,
    type Container,
    type Dimension,
    type Entity,
    type EntityItemComponent,
    type ItemStack,
    type Player,
    type Vector3,
} from "@minecraft/server";
import type { ItemView } from "../../core/index.js";
import {
    ITEM_COMPONENT_ID,
    ITEM_ENTITY_TYPE_ID,
    SHULKER_READER_DROP_DISTANCE,
    SHULKER_READER_MAX_ATTEMPTS,
    SHULKER_READER_TICK_DELAY,
    SHULKER_SIZE,
    hiddenYFor,
} from "../constants.js";
import { fromItemStack } from "./itemConversion.js";
import { isShulkerBox, setPendingRead, sweepPendingReads } from "./shulkerLeftovers.js";

/** One step of a read, for a logger. */
export interface ShulkerReadEvent {
    kind:
        | "not-a-shulker"
        | "column-busy"
        | "start"
        | "no-safe-space"
        | "dispensed"
        | "dispense-timeout"
        | "read"
        | "cleanup"
        | "error";
    detail?: string;
}

/** Timing of a {@link readShulkerContents} call, and its observer. */
export interface ShulkerReadOptions {
    /** Ticks between steps. */
    tickDelay?: number;
    /** Attempts to find the dispensed block. */
    maxAttempts?: number;
    /** Observes every step. */
    onEvent?: (event: ShulkerReadEvent) => void;
}

/** A read in progress: where its blocks are. */
interface ActiveRead {
    dimensionId: string;
    x: number;
    z: number;
}

/** Reads in progress by column, as `dimension:x:z`. */
const activeReads = new Map<string, ActiveRead>();

/**
 * Two reads conflict when their columns are within this many columns of each other on both axes. A
 * read's redstone block powers the blocks beside it, so a second dispenser two columns away would be
 * fired by the first read's.
 */
const READ_CLEARANCE = 2;

/** Whether another read is close enough to share power or blocks with one at `x`, `z`. */
const isNearActiveRead = ({ dimensionId, x, z }: ActiveRead): boolean => {
    return Array.from(activeReads.values()).some(
        (read) => read.dimensionId === dimensionId && Math.abs(read.x - x) <= READ_CLEARANCE && Math.abs(read.z - z) <= READ_CLEARANCE,
    );
};

/** The six blocks sharing a face with `center`. */
const neighboursOf = ({ x, y, z }: Vector3): Vector3[] => {
    return [
        { x, y: y + 1, z },
        { x, y: y - 1, z },
        { x: x + 1, y, z },
        { x: x - 1, y, z },
        { x, y, z: z + 1 },
        { x, y, z: z - 1 },
    ];
};

/** Whether the 3×3×3 cube centred on `center` is loaded air. */
const isAllAir = (dimension: Dimension, center: Vector3): boolean => {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
            for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
                let block: Block | undefined;
                try {
                    block = dimension.getBlock({ x: center.x + offsetX, y: center.y + offsetY, z: center.z + offsetZ });
                } catch {
                    return false;
                }
                if (!block || !block.isAir) return false;
            }
        }
    }
    return true;
};

/** The centre Y of a 3×3×3 air pocket below the height cap in the column at `x`, `z`, or `null`. */
const findSafeAirSpace = (dimension: Dimension, { x, z }: { x: number; z: number }): number | null => {
    const floor = dimension.heightRange?.min ?? 0;

    for (let testY = hiddenYFor(dimension); testY > floor + 2; testY--) {
        if (isAllAir(dimension, { x, y: testY, z })) return testY;
    }
    return null;
};

/** The first shulker box block at one of `positions`, or `null`. */
const findShulkerAt = (dimension: Dimension, positions: readonly Vector3[]): Block | null => {
    for (const position of positions) {
        let block: Block | undefined;
        try {
            block = dimension.getBlock(position);
        } catch {
            continue;
        }
        if (block && isShulkerBox(block.typeId)) return block;
    }
    return null;
};

/**
 * Turns every dispenser, redstone block and shulker box at `positions` back into air.
 *
 * @returns Whether every position could be reached; `false` when a chunk was not loaded.
 */
const cleanup = (dimension: Dimension, positions: readonly Vector3[]): boolean => {
    const air = BlockPermutation.resolve("minecraft:air");
    return positions
        .map((position) => {
            try {
                const block = dimension.getBlock(position);
                if (!block) return false;
                if (block.isAir) return true;
                const shouldClear = block.typeId === "minecraft:dispenser" || block.typeId === "minecraft:redstone_block" || isShulkerBox(block.typeId);
                if (shouldClear) block.setPermutation(air);
                return true;
            } catch {
                // An unloaded chunk: nothing of ours can be reached there yet.
                return false;
            }
        })
        .every((isReached) => isReached);
};

/**
 * Removes what a read cut short left behind: only a dispenser, a redstone block or a shulker box
 * still standing exactly where the read recorded one, emptied first. A position in a chunk that is
 * not loaded keeps its record for a later run.
 *
 * Runs at the start of every read; call it once at world start as well when reads are rare.
 *
 * @returns How many blocks it removed.
 * @example
 * world.afterEvents.worldLoad.subscribe(() => sweepShulkerLeftovers());
 */
export const sweepShulkerLeftovers = (): number => {
    // A read still running owns its blocks.
    return sweepPendingReads((column) => activeReads.has(column));
};

/** The ids of loose items around `center`, or an empty set when the query fails. */
const looseItemIdsNear = (dimension: Dimension, center: Vector3): Set<string> => {
    try {
        const drops = dimension.getEntities({ type: ITEM_ENTITY_TYPE_ID, location: center, maxDistance: SHULKER_READER_DROP_DISTANCE });
        return new Set(drops.map((drop) => drop.id));
    } catch {
        return new Set();
    }
};

/** The stack a loose item entity carries, or `undefined` when it cannot be read. */
const stackOfDrop = (drop: Entity): ItemStack | undefined => {
    try {
        return (drop.getComponent(ITEM_COMPONENT_ID) as EntityItemComponent | undefined)?.itemStack;
    } catch {
        return undefined;
    }
};

/** A loose item as `typeId×amount@yN`, without the `minecraft:` namespace. */
const describeDrop = (drop: Entity, stack: ItemStack | undefined): string => {
    if (!stack) return "?";
    try {
        return `${stack.typeId.replace("minecraft:", "")}×${stack.amount}@y${Math.floor(drop.location.y)}`;
    } catch {
        return "?";
    }
};

/**
 * Removes the read's own leaked drop: a copy of the shulker the dispenser threw out instead of
 * placing. Only a new loose item of the shulker's type qualifies; the contents and the dispenser
 * are emptied before any block is cleared, so nothing else of the read can drop. Everything else,
 * such as items a player drops through the space during the read, is left alone.
 *
 * @returns The drops it removed, and the loose items it left alone.
 * @internal Used by the anti-duplication smoke suite.
 */
export const sweepDrops = ({
    dimension,
    center,
    before,
    shulkerTypeId,
}: {
    dimension: Dimension;
    center: Vector3;
    before: ReadonlySet<string>;
    shulkerTypeId: string;
}): { swept: string[]; kept: string[] } => {
    const result: { swept: string[]; kept: string[] } = { swept: [], kept: [] };
    try {
        const drops = dimension.getEntities({ type: ITEM_ENTITY_TYPE_ID, location: center, maxDistance: SHULKER_READER_DROP_DISTANCE });
        for (const drop of drops) {
            const stack = stackOfDrop(drop);
            const description = describeDrop(drop, stack);
            const isLeakedCopy = !before.has(drop.id) && stack?.typeId === shulkerTypeId;
            if (!isLeakedCopy) {
                result.kept.push(description);
                continue;
            }
            try {
                if (!drop.isValid) continue;
                drop.remove();
                result.swept.push(description);
            } catch {
                // Already gone.
            }
        }
    } catch {
        // The query failed.
    }
    return result;
};

/** Turns a block into an upward-facing dispenser, waits a step, and loads one copy of the shulker. */
const loadDispenser = async ({
    block,
    shulkerStack,
    tickDelay,
}: {
    block: Block;
    shulkerStack: ItemStack;
    tickDelay: number;
}): Promise<Container | undefined> => {
    let permutation: BlockPermutation;
    try {
        permutation = BlockPermutation.resolve("minecraft:dispenser", { facing_direction: 1 });
    } catch {
        permutation = BlockPermutation.resolve("minecraft:dispenser");
    }
    block.setPermutation(permutation);
    await system.waitTicks(tickDelay);

    const container = (block.getComponent("inventory") as BlockInventoryComponent | undefined)?.container;
    if (!container) return undefined;
    const loaded = shulkerStack.clone();
    loaded.amount = 1;
    container.setItem(0, loaded);
    return container;
};

/** Waits step by step for the dispensed shulker block to appear at one of `positions`. */
const waitForShulker = async ({
    dimension,
    positions,
    tickDelay,
    maxAttempts,
}: {
    dimension: Dimension;
    positions: readonly Vector3[];
    tickDelay: number;
    maxAttempts: number;
}): Promise<Block | null> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await system.waitTicks(tickDelay);
        const placed = findShulkerAt(dimension, positions);
        if (placed) return placed;
    }
    return null;
};

/**
 * Copies a placed shulker's slots into `contents`, then empties it so breaking it drops nothing.
 *
 * @returns Whether the shulker's container could be read.
 */
const readPlacedShulker = (block: Block, contents: (ItemView | null)[]): boolean => {
    const container = (block.getComponent("inventory") as BlockInventoryComponent | undefined)?.container;
    if (!container || container.isValid === false) return false;
    for (let slotIndex = 0; slotIndex < Math.min(container.size, SHULKER_SIZE); slotIndex++) {
        contents[slotIndex] = fromItemStack(container.getItem(slotIndex));
    }
    container.clearAll();
    return true;
};

/**
 * Reads the 27 slots of a shulker box item. Never throws: failures report through `onEvent` and
 * leave slots empty. The views carry real stacks; pass them through `toDisplayView` before
 * showing them in display slots.
 *
 * @param player The player above whom the shulker is dispensed.
 * @param shulkerStack The shulker box item.
 * @param options Timing and the step observer.
 * @returns The contents, `null` for empty slots.
 * @example
 * const contents = await readShulkerContents(player, heldStack);
 * const occupied = contents.filter(Boolean).length;
 */
export const readShulkerContents = async (player: Player, shulkerStack: ItemStack, options: ShulkerReadOptions = {}): Promise<(ItemView | null)[]> => {
    const emit = (event: ShulkerReadEvent): void => {
        try {
            options.onEvent?.(event);
        } catch {
            // An observer must not break the read.
        }
    };

    const contents = new Array<ItemView | null>(SHULKER_SIZE).fill(null);

    if (!isShulkerBox(shulkerStack.typeId)) {
        emit({ kind: "not-a-shulker", detail: shulkerStack.typeId });
        return contents;
    }

    let dimension: Dimension;
    let centerX: number;
    let centerZ: number;
    let safeY: number | null;
    try {
        dimension = player.dimension;
        centerX = Math.floor(player.location.x);
        centerZ = Math.floor(player.location.z);
        if (isNearActiveRead({ dimensionId: dimension.id, x: centerX, z: centerZ })) {
            emit({ kind: "column-busy", detail: `at=${centerX},${centerZ}` });
            return contents;
        }
        try {
            sweepShulkerLeftovers();
        } catch {
            // Leftovers are retried by the next read.
        }
        safeY = findSafeAirSpace(dimension, { x: centerX, z: centerZ });
    } catch (error) {
        // The player left or their position cannot be read.
        emit({ kind: "error", detail: String(error) });
        return contents;
    }
    if (safeY === null) {
        emit({ kind: "no-safe-space" });
        return contents;
    }

    const tickDelay = options.tickDelay ?? SHULKER_READER_TICK_DELAY;
    const maxAttempts = options.maxAttempts ?? SHULKER_READER_MAX_ATTEMPTS;
    const column = `${dimension.id}:${centerX}:${centerZ}`;
    const read: ActiveRead = { dimensionId: dimension.id, x: centerX, z: centerZ };

    emit({ kind: "start", detail: `at=${centerX},${safeY},${centerZ}` });

    const dispenserAt: Vector3 = { x: centerX, y: safeY, z: centerZ };
    const redstoneAt: Vector3 = { x: centerX + 1, y: safeY, z: centerZ };
    const adjacent = neighboursOf(dispenserAt);
    const itemsBefore = looseItemIdsNear(dimension, dispenserAt);
    let dispenserContainer: Container | undefined;
    // Reserved before the first await, so a read starting beside this one finds it; recorded before
    // the first block is placed, with every place the shulker can land, so a read cut short is cleaned
    // up after a reload and leaves no copy behind.
    activeReads.set(column, read);
    setPendingRead(column, { dimensionId: dimension.id, positions: [dispenserAt, redstoneAt, ...adjacent] });

    try {
        const dispenserBlock = dimension.getBlock(dispenserAt);
        const redstoneBlock = dimension.getBlock(redstoneAt);
        if (!dispenserBlock || !redstoneBlock) {
            emit({ kind: "error", detail: "safe location unloaded before placement" });
            return contents;
        }

        dispenserContainer = await loadDispenser({ block: dispenserBlock, shulkerStack, tickDelay });
        if (!dispenserContainer) {
            emit({ kind: "error", detail: "dispenser has no inventory component" });
            return contents;
        }

        // Power it.
        redstoneBlock.setPermutation(BlockPermutation.resolve("minecraft:redstone_block"));

        const placedShulker = await waitForShulker({ dimension, positions: adjacent, tickDelay, maxAttempts });
        if (!placedShulker) {
            emit({ kind: "dispense-timeout", detail: `attempts=${maxAttempts}` });
            return contents;
        }
        const { x, y, z } = placedShulker.location;
        emit({ kind: "dispensed", detail: `at=${x},${y},${z}` });

        if (!readPlacedShulker(placedShulker, contents)) {
            emit({ kind: "error", detail: "placed shulker has no readable container" });
            return contents;
        }
        emit({ kind: "read", detail: `occupied=${contents.filter(Boolean).length}` });
    } catch (error) {
        emit({ kind: "error", detail: String(error) });
    } finally {
        // Empty the dispenser, then put every touched block back and remove leaked drops.
        try {
            dispenserContainer?.clearAll();
        } catch {
            // The dispenser is gone, and the copy with it.
        }
        try {
            const isCleaned = cleanup(dimension, [dispenserAt, redstoneAt, ...adjacent]);
            // A position in an unloaded chunk could not be cleared: its record stays for a later run.
            if (isCleaned) setPendingRead(column, null);
            const { swept, kept } = sweepDrops({ dimension, center: dispenserAt, before: itemsBefore, shulkerTypeId: shulkerStack.typeId });
            const pendingNote = isCleaned ? "" : " pending=true";
            emit({ kind: "cleanup", detail: `swept=${swept.length} kept=${kept.length} sweptItems=${swept.join(",")} keptItems=${kept.join(",")}${pendingNote}` });
        } finally {
            activeReads.delete(column);
        }
    }

    return contents;
};
