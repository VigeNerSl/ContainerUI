/** Storage items, such as bundles: their container, and the player's own items in a menu's copy of one. */

import type { Container, ItemInventoryComponent, ItemStack } from "@minecraft/server";
import { INVENTORY_COMPONENT_ID } from "../constants.js";
import { isRenderedItem } from "./itemMarker.js";

/**
 * The container of a storage item, such as a bundle.
 *
 * @param stack Any stack.
 * @returns The container, or `undefined` for an item that stores nothing or cannot be read.
 */
export const storageContainerOf = (stack: ItemStack): Container | undefined => {
    try {
        // Items share the component id with entities and blocks.
        return (stack.getComponent(INVENTORY_COMPONENT_ID) as ItemInventoryComponent | undefined)?.container;
    } catch {
        return undefined;
    }
};

/**
 * Takes the player's own items out of a storage item a menu wrote, and out of the storage items in
 * it. A player can put an item in a bundle on a button without changing anything the scan reads, and
 * the item must not go down with the button.
 *
 * @param stack A storage item. It is changed in place: write it back, or destroy it, afterwards.
 * @returns The items taken out, unmarked; empty for an item that stores nothing.
 */
export const takeOwnItemsOut = (stack: ItemStack): ItemStack[] => {
    const container = storageContainerOf(stack);
    const taken: ItemStack[] = [];
    try {
        if (!container || container.emptySlotsCount === container.size) return taken;
        for (let index = 0; index < container.size; index++) {
            const stored = container.getItem(index);
            if (!stored) continue;
            if (!isRenderedItem(stored)) {
                container.setItem(index, undefined);
                taken.push(stored);
                continue;
            }
            const inner = takeOwnItemsOut(stored);
            if (inner.length === 0) continue;
            // Reads hand out copies: the emptied storage item goes back in.
            container.setItem(index, stored);
            taken.push(...inner);
        }
    } catch {
        // The stack went mid-read; what was taken out so far is the player's.
    }
    return taken;
};

/**
 * Puts the player's own items, taken out of a removed copy, into a container. The copy's slot has
 * just been freed, so the first always fits.
 *
 * @param container Where they go, or `null` when there is nowhere.
 * @param own The items.
 * @returns What did not fit or could not be added.
 */
export const addOwnItems = (container: Container | null, own: readonly ItemStack[]): ItemStack[] => {
    return own.flatMap((stack) => {
        try {
            const left = container ? container.addItem(stack) : stack;
            return left ? [left] : [];
        } catch {
            return [stack];
        }
    });
};

/**
 * A cheap fingerprint of what a storage item holds: its empty slots and its weight. Taking an item
 * out or putting one in changes it; swapping one item for another of the same weight does not, so
 * whatever destroys a storage copy takes the player's items out by their marker, not by this.
 *
 * @param stack A storage item.
 * @returns The fingerprint; empty for an item that stores nothing.
 */
export const storageFingerprintOf = (stack: ItemStack): string => {
    const container = storageContainerOf(stack);
    try {
        return container ? `${container.emptySlotsCount}/${container.weight}` : "";
    } catch {
        return "";
    }
};
