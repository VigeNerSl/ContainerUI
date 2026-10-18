/** The host boundary between the platform-neutral core and a rendering surface. */

import type { Dispose } from "../reactive/graph.js";

export type { Dispose };

const EMPTY_LORE: readonly string[] = [];
const EMPTY_ENCHANTMENTS: readonly ItemEnchantment[] = [];

/**
 * What a potion item holds: an effect, and how it is delivered. Bedrock builds potions, splash
 * and lingering bottles from these two ids rather than from legacy data values.
 */
export interface ItemPotion {
    /** Potion effect id, with or without `minecraft:`. Strength and duration are part of it: `"strong_healing"`, `"long_nightvision"`. */
    effect: string;
    /** Delivery id: `"Consume"`, `"ThrownSplash"` or `"ThrownLingering"`. Defaults to the one the item's `typeId` implies. */
    delivery?: string;
}

/** An enchantment on an item. */
export interface ItemEnchantment {
    /** Enchantment type id, such as `"sharpness"`. */
    id: string;
    /** Enchantment level. */
    level: number;
}

/**
 * A platform-neutral description of an item in a slot. An `ItemView` is treated as immutable: to
 * show a different item, render a changed copy rather than changing the one already rendered.
 *
 * @example
 * const renamed = { ...sword, name: "Excalibur" };
 */
export interface ItemView {
    /** Item type id, such as `"minecraft:diamond"`. */
    typeId: string;
    /** Stack size. Defaults to 1. */
    amount?: number;
    /** Display name; colour codes pass through. Omit to keep the item's own name. */
    name?: string;
    /** Lore lines. Omit to keep the item's own tooltip. */
    lore?: readonly string[];
    /**
     * Invisible data stored on the stack (dynamic properties on Bedrock). Not compared by
     * {@link areItemsEqual}. Stackable items cannot keep it.
     */
    tags?: Readonly<Record<string, string | number | boolean>>;
    /**
     * Enchantments to apply. An enchantment the item cannot take is skipped with a console
     * warning. Read back from real items.
     *
     * @example
     * { typeId: "minecraft:diamond_sword", enchantments: [{ id: "sharpness", level: 5 }] }
     */
    enchantments?: readonly ItemEnchantment[];
    /**
     * Remaining durability: maximum durability minus damage. Omit for an undamaged item. An item
     * without durability is skipped with a console warning. Read back from real items.
     */
    durability?: number;
    /**
     * Makes the item a potion, or a splash or lingering bottle. Read back from real items. An
     * effect or delivery the engine does not know is skipped with a console warning, and the plain
     * item is shown instead. The engine builds no tipped arrows; a loot table does.
     *
     * @example
     * { typeId: "minecraft:splash_potion", potion: { effect: "strong_healing" } }
     */
    potion?: ItemPotion;
    /**
     * Block states for a block item whose variants legacy data values select, such as a dropper's
     * facing. The stack is built from the block, so it places as the same block. A block or a
     * state the engine cannot resolve is skipped with a console warning. Not every data value is a
     * state: a bed's colour, for example, is not one. Not read back from real items: the engine
     * exposes no states on an item.
     *
     * @example
     * { typeId: "minecraft:dropper", blockStates: { facing_direction: 3 } }
     */
    blockStates?: Readonly<Record<string, string | number | boolean>>;
    /**
     * Platform-private payload: the real item this view describes. Opaque to the core, carried
     * by {@link cloneItemView} and not compared by {@link areItemsEqual}.
     */
    native?: unknown;
}

/** What the player did to a slot. */
export type InteractionKind = "take" | "place" | "swap";

/** A player interaction with one slot. */
export interface HostInteraction {
    /** Slot index. */
    index: number;
    kind: InteractionKind;
    /** Item that occupied the slot before the interaction. */
    previous: ItemView | null;
    /** Item occupying the slot after the interaction. */
    next: ItemView | null;
}

/** Why a surface closed. */
export type CloseReason = "player" | "programmatic" | "invalidated" | "distance" | "timeout";

/** A rendering surface: one open container for one viewer. */
export interface HostAdapter {
    /** Number of slots. Fixed for the lifetime of the surface. */
    readonly slotCount: number;

    /**
     * Writes a slot.
     *
     * @param index Slot index.
     * @param item The item, or `null` to clear the slot.
     */
    writeSlot(index: number, item: ItemView | null): void;

    /**
     * Reads a slot's current contents.
     *
     * @param index Slot index.
     * @returns The item, or `null` for an empty slot.
     */
    readSlot(index: number): ItemView | null;

    /**
     * Plays a sound for the viewer.
     *
     * @param soundId Sound id.
     */
    playSound?(soundId: string): void;

    /**
     * Declares which slots the player may change. Called on every commit, before its writes.
     *
     * @param indices The `input` slots.
     * @param mirrored The inputs whose source keeps the real item (`isMirror`): closing leaves their contents alone.
     */
    setPlayerWritableSlots?(indices: ReadonlySet<number>, mirrored?: ReadonlySet<number>): void;

    /**
     * Takes back from the viewer an item like `item`, after an edit was refused.
     *
     * @param item The item, and the amount to take back.
     */
    takeBackFromViewer?(item: ItemView): void;

    /**
     * Gives an item to the viewer.
     *
     * @param item The item to give.
     */
    giveToViewer?(item: ItemView): void;

    /**
     * Subscribes to player interactions with any slot.
     *
     * @param handler Called with each interaction.
     * @returns A function that unsubscribes.
     */
    onInteraction(handler: (interaction: HostInteraction) => void): Dispose;

    /**
     * Subscribes to teardown. Fires exactly once.
     *
     * @param handler Called with the reason.
     * @returns A function that unsubscribes.
     */
    onClose(handler: (reason: CloseReason) => void): Dispose;

    /**
     * Closes the surface. Idempotent.
     *
     * @param reason Why it closes.
     */
    close(reason?: CloseReason): void;
}

/**
 * Whether two items look the same to the player. `tags` and `native` are not compared.
 *
 * @param first An item, or `null`.
 * @param second An item, or `null`.
 * @returns `true` when both are `null` or look identical.
 */
export const areItemsEqual = (first: ItemView | null, second: ItemView | null): boolean => {
    if (first === second) return true;
    if (!first || !second) return false;
    if (first.typeId !== second.typeId) return false;
    if ((first.amount ?? 1) !== (second.amount ?? 1)) return false;
    if ((first.name ?? "") !== (second.name ?? "")) return false;
    if (!areEnchantmentsEqual(first.enchantments, second.enchantments)) return false;
    if ((first.durability ?? -1) !== (second.durability ?? -1)) return false;
    if (!arePotionsEqual(first.potion, second.potion)) return false;
    if (!areBlockStatesEqual(first.blockStates, second.blockStates)) return false;

    return areLoresEqual(first.lore, second.lore);
};

/**
 * Whether two items are the same potion: the same effect, delivered the same way. Two items
 * without a potion are the same.
 *
 * @internal
 */
export const arePotionsEqual = (first: ItemPotion | undefined, second: ItemPotion | undefined): boolean => {
    if (!first || !second) return !first && !second;
    return first.effect === second.effect && (first.delivery ?? "") === (second.delivery ?? "");
};

/**
 * Whether two items ask for the same block states. Absent states equal none.
 *
 * @internal
 */
export const areBlockStatesEqual = (first: ItemView["blockStates"], second: ItemView["blockStates"]): boolean => {
    // Most items have none: compared on every commit, they allocate nothing.
    if (!first && !second) return true;
    const firstKeys = Object.keys(first ?? {});
    if (firstKeys.length !== Object.keys(second ?? {}).length) return false;
    return firstKeys.every((key) => first?.[key] === second?.[key]);
};

/**
 * Whether two lore lists hold the same lines in the same order. An absent list equals an empty one.
 *
 * @internal Shared with the platform's slot matching.
 */
export const areLoresEqual = (first: readonly string[] | undefined, second: readonly string[] | undefined): boolean => {
    const firstLore = first ?? EMPTY_LORE;
    const secondLore = second ?? EMPTY_LORE;
    return firstLore.length === secondLore.length && firstLore.every((line, index) => line === secondLore[index]);
};

/**
 * Whether two items look the same and, for real items, are the same stack. Two stacks can look
 * identical yet differ in what {@link areItemsEqual} skips, such as `tags`, so a look alone
 * cannot tell a real item was swapped.
 *
 * @param first An item, or `null`.
 * @param second An item, or `null`.
 * @returns `true` when {@link areItemsEqual} holds and both carry the same `native` payload.
 */
export const isSameItem = (first: ItemView | null, second: ItemView | null): boolean => {
    return areItemsEqual(first, second) && first?.native === second?.native;
};

/**
 * Whether two enchantment lists hold the same enchantments, in any order and as many times
 * each. An absent list equals an empty one.
 *
 * @param first A list, or `undefined`.
 * @param second A list, or `undefined`.
 * @returns Whether both hold the same ids at the same levels.
 */
export const areEnchantmentsEqual = (
    first: readonly ItemEnchantment[] | undefined,
    second: readonly ItemEnchantment[] | undefined,
): boolean => {
    const firstList = first ?? EMPTY_ENCHANTMENTS;
    const secondList = second ?? EMPTY_ENCHANTMENTS;
    if (firstList.length !== secondList.length) return false;
    if (firstList.length === 0) return true;
    const countIn = (list: readonly ItemEnchantment[], wanted: ItemEnchantment): number => {
        return list.filter((entry) => entry.id === wanted.id && entry.level === wanted.level).length;
    };
    return firstList.every((wanted) => countIn(firstList, wanted) === countIn(secondList, wanted));
};

/**
 * A copy of an item without its platform payload, for slots that only display it.
 *
 * @param item An item, or `null`.
 * @returns The copy, or `null`.
 */
export const toDisplayView = (item: ItemView | null): ItemView | null => {
    if (!item) return null;
    const display = { ...item };
    delete display.native;
    return display;
};

/**
 * A deep copy of an item view. The platform payload is shared, not copied.
 *
 * @param item An item, or `null`.
 * @returns The copy, or `null`.
 */
export const cloneItemView = (item: ItemView | null): ItemView | null => {
    if (!item) return null;
    return {
        typeId: item.typeId,
        amount: item.amount ?? 1,
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.lore !== undefined ? { lore: [...item.lore] } : {}),
        ...(item.enchantments !== undefined ? { enchantments: item.enchantments.map((entry) => ({ ...entry })) } : {}),
        ...(item.durability !== undefined ? { durability: item.durability } : {}),
        ...(item.potion !== undefined ? { potion: { ...item.potion } } : {}),
        ...(item.blockStates !== undefined ? { blockStates: { ...item.blockStates } } : {}),
        ...(item.tags !== undefined ? { tags: { ...item.tags } } : {}),
        ...(item.native !== undefined ? { native: item.native } : {}),
    };
};
