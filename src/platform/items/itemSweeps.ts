/** Removing rendered copies from players and containers, and from the storage items in them. */

import { EquipmentSlot, type Container, type Dimension, type EntityEquippableComponent, type ItemStack, type Player, type Vector3 } from "@minecraft/server";
import { EQUIPPABLE_COMPONENT_ID } from "../constants.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { isRenderedItem, stripLoreMarker } from "./itemMarker.js";
import { addOwnItems, storageContainerOf, takeOwnItemsOut } from "./storageItems.js";
import { probeOfStack } from "../scan/slotHandles.js";
import type { SlotProbe } from "../scan/slotMatching.js";

/** Worn slots and the off hand; the main hand is part of the inventory container. */
const SCRUBBED_EQUIPMENT: readonly EquipmentSlot[] = [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Offhand,
];

/** Where a player's own item that nothing could take is reported: the guard's report. */
let lostItemReporter: (detail: string) => void = () => undefined;

/** A player's own item, taken out of a removed copy, that nothing could take. */
const reportLost = (stack: ItemStack): void => lostItemReporter(`reason=sweep own-item-lost item=${stack.typeId} amount=${stack.amount}`);

/** Where a player's own item goes when it does not fit back where its copy was. */
export type Spill = (stack: ItemStack) => void;

/** Where a block or an entity is, to drop items there. */
export type Place = { dimension: Dimension; location: Vector3 };

/** What a sweep calls: with each copy it removes, and with each own item that did not fit back. */
export interface SweepOptions {
    onRemoved?: ((probe: SlotProbe) => void) | undefined;
    /** Defaults to reporting the item lost: pass one wherever a place to drop it is known. */
    spill?: Spill | undefined;
}

/** Drops an own item at a place; one that cannot be dropped is reported lost. */
const dropAt = ({ dimension, location }: Place, stack: ItemStack): void => {
    try {
        dimension.spawnItem(stack, location);
    } catch {
        reportLost(stack);
    }
};

/**
 * Cleans a storage item read from a slot and writes it back there. Reads hand out copies, so the
 * cleaning sticks only once written, and the copies removed are announced, and the own items that
 * did not fit spilled, only after that: a failed write leaves them all where they were, for the next
 * sweep, neither counted as gone nor handed out twice.
 *
 * @returns How many stacks were removed; 0 when nothing was, or the write failed.
 */
const cleanStorageIn = ({ stack, write, onRemoved, spill = reportLost }: { stack: ItemStack; write: () => void } & SweepOptions): number => {
    // Most stacks store nothing: they cost one read here.
    const storage = storageContainerOf(stack);
    if (!storage) return 0;
    const probes: SlotProbe[] = [];
    const spilled: ItemStack[] = [];
    const removed = scrubContainer(storage, { onRemoved: (probe) => probes.push(probe), spill: (own) => spilled.push(own) });
    if (removed === 0) return 0;
    try {
        write();
    } catch {
        return 0;
    }
    if (onRemoved) probes.forEach(onRemoved);
    spilled.forEach(spill);
    return removed;
};

/** Sweeps one worn slot. An unreadable slot counts as nothing, so it hides neither the slots before it nor after. */
const scrubEquipmentSlot = ({
    equippable,
    slot,
    onRemoved,
    spill,
}: {
    equippable: EntityEquippableComponent;
    slot: EquipmentSlot;
    onRemoved: ((probe: SlotProbe) => void) | undefined;
    spill: Spill;
}): number => {
    try {
        const stack = equippable.getEquipment(slot);
        if (!stack) return 0;
        if (!isRenderedItem(stack)) return cleanStorageIn({ stack, write: () => equippable.setEquipment(slot, stack), onRemoved, spill });
        const own = takeOwnItemsOut(stack);
        equippable.setEquipment(slot);
        onRemoved?.(removedProbeOf(stack));
        // The spill puts them in the player's inventory first.
        own.forEach(spill);
        return 1;
    } catch {
        return 0;
    }
};

const scrubEquipmentOf = ({ player, onRemoved, spill }: { player: Player; onRemoved: ((probe: SlotProbe) => void) | undefined; spill: Spill }): number => {
    let equippable: EntityEquippableComponent | undefined;
    try {
        equippable = player.getComponent(EQUIPPABLE_COMPONENT_ID) as EntityEquippableComponent | undefined;
    } catch {
        return 0;
    }
    if (!equippable) return 0;
    return SCRUBBED_EQUIPMENT.reduce((removed, slot) => removed + scrubEquipmentSlot({ equippable, slot, onRemoved, spill }), 0);
};

/**
 * Sets where a lost own item is reported.
 *
 * @internal The guard wires its report.
 */
export const setLostItemReporter = (reporter: (detail: string) => void): void => {
    lostItemReporter = reporter;
};

/**
 * Own items that do not fit go to a player: their inventory first, the rest at their feet.
 *
 * @param player The player the items belong to.
 * @returns The spill.
 */
export const spillToPlayer = (player: Player): Spill => (stack) => {
    let left: ItemStack | undefined = stack;
    try {
        const inventory = inventoryContainerOf(player);
        if (inventory) left = inventory.addItem(stack);
    } catch {
        // A full or refusing inventory: the item drops instead.
    }
    if (left) dropAt(player, left);
};

/**
 * Own items that do not fit drop at a place, such as the block or the entity they were in.
 *
 * @param place Where they drop.
 * @returns The spill.
 */
export const spillAt = (place: Place): Spill => (stack) => dropAt(place, stack);

/**
 * The real stacks a container holds, by slot: rendered copies are left out.
 *
 * @param container An entity's, a block's or a player's container.
 * @returns Each stack with its slot.
 */
export const realItemsOf = (container: Container): { index: number; stack: ItemStack }[] => {
    return Array.from({ length: container.size }, (_unused, index) => ({ index, stack: container.getItem(index) }))
        .filter((slot): slot is { index: number; stack: ItemStack } => slot.stack !== undefined && !isRenderedItem(slot.stack));
};

/** A removed copy's probe, with its lore: the one read that tells two buttons of one kind apart. */
export const removedProbeOf = (stack: ItemStack): SlotProbe => {
    const probe = probeOfStack(stack);
    try {
        return { ...probe, lore: stripLoreMarker(stack.getLore()) };
    } catch {
        return probe;
    }
};

/**
 * Removes rendered copies from a container, and from the storage items in it. An empty one is left
 * without reading a slot. The player's own items in a removed copy go back into the container, and
 * what does not fit goes to `spill`.
 */
export const scrubContainer = (container: Container | null | undefined, { onRemoved, spill = reportLost }: SweepOptions = {}): number => {
    let removed = 0;
    try {
        if (!container || container.emptySlotsCount === container.size) return 0;
        // A loop, not a reduce: the count of what went before a container vanishes mid-sweep is kept.
        const { size } = container;
        for (let index = 0; index < size; index++) {
            const stack = container.getItem(index);
            if (!stack) continue;
            if (!isRenderedItem(stack)) {
                removed += cleanStorageIn({ stack, write: () => container.setItem(index, stack), onRemoved, spill });
                continue;
            }
            const own = takeOwnItemsOut(stack);
            container.setItem(index, undefined);
            onRemoved?.(removedProbeOf(stack));
            removed++;
            addOwnItems(container, own).forEach(spill);
        }
    } catch {
        // The container went mid-sweep.
    }
    return removed;
};

/**
 * Removes rendered copies from inside a storage item, such as a bundle, and from the storage items
 * nested in it. A button put in a bundle leaves the menu with no trace in any slot the scan reads.
 *
 * @param stack Any stack. It is changed in place, so a caller that read it as a copy writes it back.
 * @param options Called with each copy removed, and with each own item that does not fit back.
 * @returns How many stacks were removed; 0 for an item that stores nothing.
 */
export const scrubStorageItem = (stack: ItemStack, options: SweepOptions = {}): number => {
    return scrubContainer(storageContainerOf(stack), options);
};

/**
 * Removes rendered items from a player's inventory, worn slots and off hand. Their own items in a
 * removed copy go back to them, and drop at their feet when their inventory is full.
 *
 * @param player The player to sweep.
 * @param onRemoved Called with each removed item.
 * @returns How many stacks were removed.
 */
export const scrubInventoryOf = (player: Player, onRemoved?: (probe: SlotProbe) => void): number => {
    const spill = spillToPlayer(player);
    return scrubContainer(inventoryContainerOf(player), { onRemoved, spill }) + scrubEquipmentOf({ player, onRemoved, spill });
};
