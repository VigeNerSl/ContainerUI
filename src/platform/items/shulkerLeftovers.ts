/** The record of shulker reads cut short, and the sweep that removes the blocks they left. */

import { BlockPermutation, world, type BlockInventoryComponent, type Dimension, type Vector3 } from "@minecraft/server";
import { NAMESPACE } from "../constants.js";

/**
 * The blocks of a read cut short, per column, so a later run can remove them: the dispenser, the
 * redstone block and every place the dispensed shulker can land.
 */
export interface PendingRead {
    dimensionId: string;
    positions: Vector3[];
}

/** Every shulker box type: undyed, and one per dye colour. */
const SHULKER_BOX_PATTERN =
    /^minecraft:(?:(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black|undyed)_)?shulker_box$/;

/** Whether `typeId` is a shulker box, dyed or not. */
export const isShulkerBox = (typeId: string): boolean => {
    return SHULKER_BOX_PATTERN.test(typeId);
};

/** World property holding the reads whose blocks may still stand. */
const PENDING_PROPERTY = `${NAMESPACE}_shulker_pending`;

/** The reads recorded as unfinished. A malformed record reads as none. */
const readPending = (): Record<string, PendingRead> => {
    try {
        const raw = world.getDynamicProperty(PENDING_PROPERTY);
        if (typeof raw !== "string") return {};
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, PendingRead>) : {};
    } catch {
        return {};
    }
};

/** Stores the unfinished reads, or clears the property when none are left. */
const writePending = (pending: Record<string, PendingRead>): void => {
    try {
        world.setDynamicProperty(PENDING_PROPERTY, Object.keys(pending).length > 0 ? JSON.stringify(pending) : undefined);
    } catch {
        // The read still runs; only its recovery after a crash is lost.
    }
};

/**
 * Records or forgets one read's blocks.
 *
 * @param column The read's column, as `dimension:x:z`.
 * @param read Its blocks, or `null` once they are gone.
 */
export const setPendingRead = (column: string, read: PendingRead | null): void => {
    const pending = readPending();
    if (read) pending[column] = read;
    else delete pending[column];
    writePending(pending);
};

/**
 * Removes a leftover dispenser, redstone block or shulker box at a recorded position; any other block
 * stays. A dispenser or shulker box is emptied first, so the copy it holds goes with it.
 */
const removeLeftover = ({ dimension, position, air }: { dimension: Dimension; position: Vector3; air: BlockPermutation }): { isReached: boolean; isRemoved: boolean } => {
    try {
        const block = dimension.getBlock(position);
        if (!block) return { isReached: false, isRemoved: false };
        if (block.typeId === "minecraft:dispenser" || isShulkerBox(block.typeId)) {
            (block.getComponent("inventory") as BlockInventoryComponent | undefined)?.container?.clearAll();
        } else if (block.typeId !== "minecraft:redstone_block") {
            return { isReached: true, isRemoved: false };
        }
        block.setPermutation(air);
        return { isReached: true, isRemoved: true };
    } catch {
        return { isReached: false, isRemoved: false };
    }
};

/**
 * Removes the recorded leftovers of every read that is not running. A position in a chunk that is
 * not loaded keeps its record for a later run.
 *
 * @param isRunning Whether the read in this column is still in progress and owns its blocks.
 * @returns How many blocks it removed.
 */
export const sweepPendingReads = (isRunning: (column: string) => boolean): number => {
    const pending = readPending();
    const air = BlockPermutation.resolve("minecraft:air");
    let removed = 0;
    const remaining = Object.fromEntries(
        Object.entries(pending).filter(([column, read]) => {
            if (isRunning(column)) return true;
            try {
                const dimension = world.getDimension(read.dimensionId);
                const results = read.positions.map((position) => removeLeftover({ dimension, position, air }));
                removed += results.filter((result) => result.isRemoved).length;
                return !results.every((result) => result.isReached);
            } catch {
                return true;
            }
        }),
    );
    if (Object.keys(remaining).length !== Object.keys(pending).length) writePending(remaining);
    return removed;
};
