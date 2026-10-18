/**
 * Reading and writing a shulker box item's contents. A read dispenses a copy as a block above the
 * player, which takes a few ticks; a write places and removes a block within one tick.
 */

import type { Block, Dimension, ItemStack, Player } from "@minecraft/server";
import type { ItemView } from "../../core/index.js";
import { SHULKER_SIZE, hiddenYFor } from "../constants.js";
import { notifySafely } from "../observer.js";
import { blockContainerOf } from "../storage/inventoryContainer.js";
import { fromItemStack, toStorageStack } from "./itemConversion.js";
import { withDispensedShulker, type ShulkerReadEvent, type ShulkerReadOptions } from "./shulkerDispense.js";
import { isShulkerBox } from "./shulkerLeftovers.js";

export type { ShulkerReadEvent, ShulkerReadOptions };
export { sweepShulkerLeftovers } from "./shulkerDispense.js";

/** A shulker box item made with chosen contents, and what it could not hold. */
export interface ShulkerWriteResult {
    /** The new item: the shulker's own name, lore, dynamic properties and the rest of its item data, holding the contents. */
    stack: ItemStack;
    /** Items the shulker refused, such as another shulker box, or past its 27 slots, with the index they had in `contents`. */
    leftovers: { index: number; item: ItemView }[];
}

/** A shulker box filled from stacks, and the indexes of the stacks it refused. */
export interface FilledShulker {
    stack: ItemStack;
    refused: number[];
}

/**
 * Copies what an item carries apart from its block: its name, lore, dynamic properties, lock, keep on
 * death, and where it can be placed and what it can break. An item made from a block keeps only what
 * the block held.
 */
const copyItemData = ({ from, to }: { from: ItemStack; to: ItemStack }): void => {
    if (from.nameTag !== undefined) to.nameTag = from.nameTag;
    to.setLore(from.getLore());
    for (const id of from.getDynamicPropertyIds()) to.setDynamicProperty(id, from.getDynamicProperty(id));
    to.keepOnDeath = from.keepOnDeath;
    to.lockMode = from.lockMode;
    to.setCanPlaceOn(from.getCanPlaceOn());
    to.setCanDestroy(from.getCanDestroy());
};

/** The first air block below the height cap in the column at `x`, `z`, or `undefined`. */
const airBlockAbove = (dimension: Dimension, { x, z }: { x: number; z: number }): Block | undefined => {
    const floor = dimension.heightRange?.min ?? 0;
    for (let height = hiddenYFor(dimension); height > floor; height--) {
        const block = dimension.getBlock({ x, y: height, z });
        if (block?.isAir) return block;
    }
    return undefined;
};

/**
 * Places a shulker box of `shulkerStack`'s type above the player, fills it from `stacks` as they are,
 * turns it back into an item and removes it, all within the call. Never throws: failures report
 * through `onEvent`.
 *
 * @internal Used by `writeShulkerContents` and by the shulker box opened by click.
 * @returns The new item and the indexes of the stacks it refused, or `undefined` when it could not be made.
 */
export const fillShulker = ({
    player,
    shulkerStack,
    stacks,
    onEvent,
}: {
    player: Player;
    shulkerStack: ItemStack;
    stacks: readonly (ItemStack | undefined)[];
    onEvent: ((event: ShulkerReadEvent) => void) | undefined;
}): FilledShulker | undefined => {
    if (!isShulkerBox(shulkerStack.typeId)) {
        notifySafely(onEvent, { kind: "not-a-shulker", detail: shulkerStack.typeId });
        return undefined;
    }
    let block: Block | undefined;
    try {
        block = airBlockAbove(player.dimension, { x: Math.floor(player.location.x), z: Math.floor(player.location.z) });
        if (!block) {
            notifySafely(onEvent, { kind: "no-safe-space" });
            return undefined;
        }
        block.setType(shulkerStack.typeId);
        const container = blockContainerOf(block);
        if (!container) {
            notifySafely(onEvent, { kind: "error", detail: "placed shulker has no writable container" });
            return undefined;
        }
        const refused: number[] = [];
        stacks.forEach((stack, index) => {
            if (!stack) return;
            try {
                // The game lets a script put one shulker box in another; a player cannot, and neither does this.
                if (isShulkerBox(stack.typeId)) throw new Error("a shulker box holds no shulker box");
                if (index >= container.size) throw new Error("no slot");
                container.setItem(index, stack);
            } catch {
                refused.push(index);
            }
        });
        const filled = block.getItemStack(1, true);
        if (!filled) {
            notifySafely(onEvent, { kind: "error", detail: "the filled shulker gave no item" });
            return undefined;
        }
        copyItemData({ from: shulkerStack, to: filled });
        notifySafely(onEvent, { kind: "written", detail: `occupied=${stacks.filter(Boolean).length - refused.length} leftovers=${refused.length}` });
        return { stack: filled, refused };
    } catch (error) {
        notifySafely(onEvent, { kind: "error", detail: String(error) });
        return undefined;
    } finally {
        // Emptied first, so taking the block away drops nothing.
        try {
            if (block && isShulkerBox(block.typeId)) {
                blockContainerOf(block)?.clearAll();
                block.setType("minecraft:air");
            }
        } catch {
            // The chunk unloaded: the block went with it.
        }
    }
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
    const contents = await readShulkerStacks({ player, shulkerStack, options });
    return Array.from({ length: SHULKER_SIZE }, (_unused, index) => fromItemStack(contents?.[index]));
};

/**
 * Reads a shulker box item's slots as stacks through one dispense; the item is not changed.
 *
 * @internal Used by the reader and by the shulker box opened by click.
 * @returns The stacks by slot, or `undefined` when the read failed.
 */
export const readShulkerStacks = async ({
    player,
    shulkerStack,
    options = {},
}: {
    player: Player;
    shulkerStack: ItemStack;
    options?: ShulkerReadOptions;
}): Promise<(ItemStack | undefined)[] | undefined> => {
    return withDispensedShulker({
        player,
        shulkerStack,
        options,
        use: (block, emit) => {
            const container = blockContainerOf(block);
            if (!container) {
                emit({ kind: "error", detail: "placed shulker has no readable container" });
                return undefined;
            }
            const contents = Array.from({ length: Math.min(SHULKER_SIZE, container.size) }, (_unused, index) => container.getItem(index));
            emit({ kind: "read", detail: `occupied=${contents.filter(Boolean).length}` });
            return contents;
        },
    });
};

/**
 * Makes a shulker box item holding `contents`, within the call: a shulker box of the same type is
 * placed high above the player, filled, turned back into an item and removed, all in one tick. The
 * item keeps `shulkerStack`'s name, lore, dynamic properties, lock, keep-on-death and where it can be
 * placed and what it can break; `shulkerStack` itself is not changed. Never throws: failures report through `onEvent`.
 *
 * @param target `player`, above whom the shulker is placed; `shulkerStack`, the shulker box item to
 * fill, what it holds now replaced; `contents`, up to 27 items, `null` for an empty slot; and
 * `onEvent`, the step observer.
 * @returns The new item and what it could not hold, or `null` when it could not be made.
 * @example
 * const result = writeShulkerContents({ player, shulkerStack: emptyShulker, contents: [{ typeId: "minecraft:diamond", amount: 3 }] });
 * if (result) inventory.addItem(result.stack);
 */
export const writeShulkerContents = ({
    player,
    shulkerStack,
    contents,
    onEvent,
}: {
    player: Player;
    shulkerStack: ItemStack;
    contents: readonly (ItemView | null)[];
    onEvent?: ((event: ShulkerReadEvent) => void) | undefined;
}): ShulkerWriteResult | null => {
    const stacks = contents.map((item) => {
        if (!item) return undefined;
        try {
            return toStorageStack(item);
        } catch {
            // An unknown item type, say: it is given back as a leftover.
            return undefined;
        }
    });
    const filled = fillShulker({ player, shulkerStack, stacks, onEvent });
    if (!filled) return null;
    // An item no stack could be made from counts as refused too.
    const refused = new Set([...filled.refused, ...contents.flatMap((item, index) => (item && !stacks[index] ? [index] : []))]);
    const leftovers = contents.flatMap((item, index) => (item && refused.has(index) ? [{ index, item }] : []));
    return { stack: filled.stack, leftovers };
};
