/** The sources a storage opened by click can show: a shulker box in hand, and an ender chest. */

import { ItemLockMode, type Container, type ItemStack, type Player } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { SHULKER_LOCK_PROPERTY, SHULKER_SESSION_PROPERTY } from "../constants.js";
import { enderContainerOf, inventoryContainerOf } from "../storage/inventoryContainer.js";
import type { HeldResume } from "./heldRecovery.js";
import { isHeldKeyOpen, type HeldSource } from "./heldStorage.js";
import { realItemsOf } from "./itemSweeps.js";
import { isShulkerBox } from "./shulkerLeftovers.js";
import { fillShulker, readShulkerStacks } from "./shulkerReader.js";

/** Whether a stack carries the mark of the shulker box that is open for `token`. */
const isMarked = (stack: ItemStack | undefined, token: string): boolean => {
    try {
        return stack !== undefined && stack.getDynamicProperty(SHULKER_SESSION_PROPERTY) === token;
    } catch {
        return false;
    }
};

/** Takes the open's mark and lock off a shulker box, giving it back the lock it had; one never locked keeps its own. */
const unmark = (stack: ItemStack): void => {
    const lock = stack.getDynamicProperty(SHULKER_LOCK_PROPERTY);
    if (typeof lock === "string") stack.lockMode = lock as ItemLockMode;
    stack.setDynamicProperty(SHULKER_SESSION_PROPERTY, undefined);
    stack.setDynamicProperty(SHULKER_LOCK_PROPERTY, undefined);
};

/** Unmarks every shulker box of a container an open marked: `token`'s, or any when `undefined`. */
const unmarkIn = (container: Container | null | undefined, token: string | undefined): void => {
    if (!container) return;
    const { size } = container;
    for (let index = 0; index < size; index++) {
        const stack = container.getItem(index);
        if (!stack || !isShulkerBox(stack.typeId)) continue;
        const mark = stack.getDynamicProperty(SHULKER_SESSION_PROPERTY);
        if (mark === undefined || (token !== undefined && mark !== token)) continue;
        unmark(stack);
        container.setItem(index, stack);
    }
};

/**
 * A shulker box an open marked that fell out of its owner's inventory, as on their death: each one
 * lying near them goes back to an ordinary shulker box, its contents kept, so whoever picks it up can
 * move and open it.
 */
const unmarkDropped = (player: Player, token: string): void => {
    try {
        const near = player.dimension.getEntities({ type: "minecraft:item", location: player.location, maxDistance: 8 });
        near.forEach((entity) => {
            const stack = entity.getComponent("minecraft:item")?.itemStack;
            if (!stack || !isShulkerBox(stack.typeId) || !isMarked(stack, token)) return;
            unmark(stack);
            const clean = entity.dimension.spawnItem(stack, entity.location);
            try {
                entity.remove();
            } catch (error) {
                // Never two of one shulker box: the marked one stays rather than a copy beside it.
                clean.remove();
                throw error;
            }
        });
    } catch (error) {
        log({ level: "warn", source: "storage", message: `held-unmark-failed error=${String(error)}` });
    }
};

/**
 * What a crash or a restart left of a shulker box open: the shulker box still marked and locked in the
 * owner's inventory. Its contents are its own and stay.
 *
 * @internal Registered by the world hooks.
 */
export const releaseShulkerBoxes = (player: Player): void => unmarkIn(inventoryContainerOf(player), undefined);

/**
 * Writes the screen an owner left into the shulker box their open marked, and unmarks it.
 *
 * @internal Registered by the world hooks.
 */
export const resumeShulkerBox: HeldResume = ({ player, key, stacks }) => {
    const inventory = inventoryContainerOf(player);
    if (!inventory) return undefined;
    const slot = Array.from({ length: inventory.size }, (_unused, index) => index).find((index) => isMarked(inventory.getItem(index), key));
    if (slot === undefined) throw new Error("the shulker box is gone");
    const held = inventory.getItem(slot);
    if (!held) throw new Error("the shulker box is gone");
    const filled = fillShulker({ player, shulkerStack: held, stacks, onEvent: undefined });
    if (!filled) return undefined;
    unmark(filled.stack);
    inventory.setItem(slot, filled.stack);
    return { refused: filled.refused };
};

/**
 * Writes the screen an owner left into their ender chest.
 *
 * @internal Registered by the world hooks.
 */
export const resumeEnderChest: HeldResume = ({ player, stacks }) => {
    const ender = enderContainerOf(player);
    if (!ender) return undefined;
    stacks.forEach((stack, index) => ender.setItem(index, stack));
    return { refused: [] };
};

/**
 * The shulker box in the player's selected slot. Its contents are read through a dispensed copy, which
 * takes about 0.4 s; the shulker box itself stays in the hand with everything in it, locked in its slot
 * while open, and every change the player makes is written into it in the tick it happens. A shulker
 * box the player put inside goes back to them: a shulker box holds none.
 *
 * @returns A source for one open.
 * @example
 * await openHeldStorage(player, { source: shulkerBoxSource() });
 */
export const shulkerBoxSource = (): HeldSource => {
    let token: string | undefined;
    let slot = -1;
    return {
        kind: "shulker",
        async read(player, report) {
            const inventory = inventoryContainerOf(player);
            slot = player.selectedSlotIndex;
            const held = inventory?.getItem(slot);
            if (!inventory || !held || !isShulkerBox(held.typeId)) {
                report("not-a-shulker", held?.typeId ?? "nothing");
                return undefined;
            }
            // Marked by an open still under way, which settles first; a mark no open holds is a leftover.
            const mark = held.getDynamicProperty(SHULKER_SESSION_PROPERTY);
            if (typeof mark === "string" && isHeldKeyOpen(mark)) {
                report("still-held", "an earlier open of this shulker box is not settled yet");
                return undefined;
            }
            if (mark !== undefined) unmark(held);
            token = `${player.id}:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e9).toString(36)}`;
            held.setDynamicProperty(SHULKER_SESSION_PROPERTY, token);
            inventory.setItem(slot, held);
            return readShulkerStacks({ player, shulkerStack: held, options: { onEvent: (event) => report(event.kind, event.detail) } });
        },
        prepare(player) {
            const inventory = inventoryContainerOf(player);
            const held = inventory?.getItem(slot);
            if (!inventory || !held || token === undefined || !isMarked(held, token)) return "the shulker box left the hand";
            // Locked in its slot while open: the player cannot move it, or put it inside itself.
            held.setDynamicProperty(SHULKER_LOCK_PROPERTY, held.lockMode);
            held.lockMode = ItemLockMode.slot;
            inventory.setItem(slot, held);
            return undefined;
        },
        write({ player, stacks, report }) {
            const inventory = inventoryContainerOf(player);
            const held = inventory?.getItem(slot);
            if (!inventory || !held || token === undefined || !isMarked(held, token)) throw new Error("the shulker box left its slot");
            const filled = fillShulker({ player, shulkerStack: held, stacks, onEvent: (event) => report(event.kind, event.detail) });
            // Still in its slot: the same change is written again next tick.
            if (!filled) return undefined;
            inventory.setItem(slot, filled.stack);
            return { refused: filled.refused };
        },
        release(player) {
            if (token === undefined) return;
            unmarkIn(inventoryContainerOf(player), token);
            unmarkDropped(player, token);
        },
        key: () => token,
    };
};

/**
 * The player's own ender chest, the one every ender chest shows them. Every change the player makes is
 * written into it, slot for slot, in the tick it happens.
 *
 * @returns A source for one open.
 * @example
 * await openHeldStorage(player, { source: enderChestSource() });
 */
export const enderChestSource = (): HeldSource => ({
    kind: "ender",
    read(player, report) {
        const ender = enderContainerOf(player);
        if (!ender) {
            report("not-ready", "the ender chest cannot be used yet");
            return undefined;
        }
        const stacks: (ItemStack | undefined)[] = new Array<ItemStack | undefined>(ender.size).fill(undefined);
        realItemsOf(ender).forEach(({ index, stack }) => (stacks[index] = stack));
        return stacks;
    },
    write({ player, stacks, changed }) {
        const ender = enderContainerOf(player);
        // Not ready for a moment: a player's ender chest does not go away.
        if (!ender) return undefined;
        changed.forEach((index) => ender.setItem(index, stacks[index]));
        return { refused: [] };
    },
    key: () => "ender",
});
