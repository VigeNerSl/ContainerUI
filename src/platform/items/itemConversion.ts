/** Conversion between `ItemView` and Bedrock `ItemStack`: tags, enchantments, durability and stack sizes. */

import {
    BlockPermutation,
    EnchantmentTypes,
    ItemStack,
    Potions,
    type EnchantmentType,
    type ItemDurabilityComponent,
    type ItemEnchantableComponent,
    type ItemPotionComponent,
} from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { areEnchantmentsEqual, type ItemEnchantment, type ItemPotion, type ItemView } from "../../core/index.js";
import {
    DURABILITY_COMPONENT_ID,
    ENCHANTABLE_COMPONENT_ID,
    POTION_COMPONENT_ID,
    POTION_DELIVERY_BY_TYPE,
    UI_ITEM_MARKER_PROPERTY,
} from "../constants.js";
import {
    applyDynamicMarker,
    applyLoreMarker,
    hasLegacyMarker,
    isRenderedItem,
    MAX_LORE_LINE_LENGTH,
    MAX_LORE_LINES,
    stripLoreMarker,
} from "./itemMarker.js";

export { isRenderedItem };

/** Value types `ItemView.tags` can hold. */
type TagValue = string | number | boolean;

const reportedWarnings = new Set<string>();
const maxStacks = new Map<string, number | undefined>();

/** Warns once per key. */
const warnOnce = (key: string, message: string): void => {
    if (reportedWarnings.has(key)) return;
    reportedWarnings.add(key);
    log({ level: "warn", source: "items", message });
};

/** Writes `tags` as dynamic properties, warning once per item type when the engine drops them. */
const applyTags = (stack: ItemStack, tags: ItemView["tags"]): void => {
    if (!tags) return;

    Object.entries(tags).forEach(([key, value]) => {
        try {
            stack.setDynamicProperty(key, value);
        } catch {
            // A rejected key does not stop the others.
            return;
        }
        if (stack.getDynamicProperty(key) === value) return;
        warnOnce(
            `tags:${stack.typeId}`,
            `[ContainerUI] ItemView.tags cannot be stored on "${stack.typeId}": the engine discards ` +
                "dynamic properties on stackable items. The tags are lost. Use a non-stackable item, " +
                "or keep the data in your own store keyed by slot rather than on the stack.",
        );
    });
};

/** Reads dynamic properties back into `tags`, without the marker. */
const readTags = (stack: ItemStack): Readonly<Record<string, TagValue>> | undefined => {
    let keys: string[];
    try {
        keys = stack.getDynamicPropertyIds();
    } catch {
        return undefined;
    }
    const entries = keys
        .filter((key) => key !== UI_ITEM_MARKER_PROPERTY)
        .flatMap((key): [string, TagValue][] => {
            try {
                const value = stack.getDynamicProperty(key);
                return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [[key, value]] : [];
            } catch {
                // One unreadable property does not cost the others.
                return [];
            }
        });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** An item component, or `undefined` when the item has none or the read failed. */
const componentOf = <T>(stack: ItemStack, componentId: string): T | undefined => {
    try {
        return stack.getComponent(componentId) as T | undefined;
    } catch {
        return undefined;
    }
};

/** The enchantment type for an id, trying the bare id before the `minecraft:` one. */
const enchantmentTypeOf = (id: string): EnchantmentType | undefined => {
    const bare = id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
    for (const candidate of [bare, `minecraft:${bare}`]) {
        try {
            const type = EnchantmentTypes.get(candidate);
            if (type) return type;
        } catch {
            // Try the other spelling.
        }
    }
    return undefined;
};

/** Adds the requested enchantments, warning once for each one the engine refuses. */
const applyEnchantments = (stack: ItemStack, enchantments: readonly ItemEnchantment[] | undefined): void => {
    if (!enchantments || enchantments.length === 0) return;
    const enchantable = componentOf<ItemEnchantableComponent>(stack, ENCHANTABLE_COMPONENT_ID);
    if (!enchantable) {
        warnOnce(
            `enchantable:${stack.typeId}`,
            `[ContainerUI] "${stack.typeId}" cannot be enchanted, so ItemView.enchantments on it are ignored.`,
        );
        return;
    }

    enchantments.forEach(({ id, level }) => {
        const type = enchantmentTypeOf(id);
        if (!type) {
            warnOnce(`enchantment:${id}`, `[ContainerUI] Unknown enchantment "${id}"; it is skipped.`);
            return;
        }
        try {
            enchantable.addEnchantment({ type, level });
        } catch (error) {
            warnOnce(
                `enchantment:${stack.typeId}:${id}`,
                `[ContainerUI] "${id}" ${level} cannot be put on "${stack.typeId}" (${String(error)}); it is skipped.`,
            );
        }
    });
};

/** Sets remaining durability, warning once for an item that has none. */
const applyDurability = (stack: ItemStack, durability: number | undefined): void => {
    if (durability === undefined) return;
    const component = componentOf<ItemDurabilityComponent>(stack, DURABILITY_COMPONENT_ID);
    if (!component) {
        warnOnce(`durability:${stack.typeId}`, `[ContainerUI] "${stack.typeId}" has no durability, so ItemView.durability on it is ignored.`);
        return;
    }
    const remaining = Math.min(component.maxDurability, Math.max(0, Math.round(durability)));
    try {
        component.damage = component.maxDurability - remaining;
    } catch (error) {
        warnOnce(`durability:${stack.typeId}`, `[ContainerUI] Durability ${durability} cannot be set on "${stack.typeId}" (${String(error)}).`);
    }
};

/** A stack's enchantments, or `undefined` when it has none. */
const readEnchantments = (stack: ItemStack): ItemEnchantment[] | undefined => {
    const enchantable = componentOf<ItemEnchantableComponent>(stack, ENCHANTABLE_COMPONENT_ID);
    if (!enchantable) return undefined;
    try {
        const enchantments = enchantable.getEnchantments().map((entry) => ({ id: entry.type.id, level: entry.level }));
        return enchantments.length > 0 ? enchantments : undefined;
    } catch {
        return undefined;
    }
};

/** The potion an item holds, or `undefined` when it is not a potion. */
const readPotion = (stack: ItemStack): ItemPotion | undefined => {
    const component = componentOf<ItemPotionComponent>(stack, POTION_COMPONENT_ID);
    if (!component) return undefined;
    try {
        return { effect: component.potionEffectType.id, delivery: component.potionDeliveryType.id };
    } catch {
        return undefined;
    }
};

/** Effect ids to try, bare and namespaced: the engine registers them as `minecraft:strong_healing`. */
const effectCandidates = (effect: string): string[] => {
    const bare = effect.startsWith("minecraft:") ? effect.slice("minecraft:".length) : effect;
    return [`minecraft:${bare}`, bare];
};

/**
 * The stack the engine builds for a potion view: a drinkable potion, a splash bottle or a lingering
 * bottle. `undefined` when the engine knows neither the effect nor the delivery, or when the
 * delivery builds another item than the view asks for; warned once per combination.
 */
const potionStack = (view: ItemView): ItemStack | undefined => {
    const potion = view.potion;
    if (!potion) return undefined;

    const delivery = potion.delivery ?? POTION_DELIVERY_BY_TYPE[view.typeId] ?? view.typeId;
    let refusal: unknown;
    for (const effect of effectCandidates(potion.effect)) {
        let stack: ItemStack;
        try {
            stack = Potions.resolve(effect, delivery);
        } catch (error) {
            refusal = error;
            continue;
        }
        if (stack.typeId === view.typeId) return stack;
        warnOnce(
            `potion-type:${view.typeId}:${delivery}`,
            `[ContainerUI] The delivery "${delivery}" builds "${stack.typeId}", not "${view.typeId}"; the plain item is shown. ` +
                "The engine builds no tipped arrows: build one with a loot table (itemFromLootTable).",
        );
        return undefined;
    }

    warnOnce(
        `potion:${delivery}:${potion.effect}`,
        `[ContainerUI] The engine refused the potion "${potion.effect}" delivered as "${delivery}" (${String(refusal)}); ` +
            `"${view.typeId}" is shown without it.`,
    );
    return undefined;
};

/**
 * The stack the engine builds for a block item with states, such as a dropper's facing. `undefined`
 * when the block or a state cannot be resolved, warned once per block.
 */
const blockStateStack = (view: ItemView): ItemStack | undefined => {
    const states = view.blockStates;
    if (!states) return undefined;
    try {
        const stack = BlockPermutation.resolve(view.typeId, states).getItemStack(1);
        if (stack) return stack;
    } catch (error) {
        warnOnce(
            `block-states:${view.typeId}`,
            `[ContainerUI] The engine refused the block states on "${view.typeId}" (${String(error)}); the plain item is shown.`,
        );
        return undefined;
    }
    warnOnce(`block-states:${view.typeId}`, `[ContainerUI] "${view.typeId}" has no item form for its block states; the plain item is shown.`);
    return undefined;
};

/** Remaining durability, or `undefined` for an undamaged item. */
const readDurability = (stack: ItemStack): number | undefined => {
    const component = componentOf<ItemDurabilityComponent>(stack, DURABILITY_COMPONENT_ID);
    if (!component || component.damage <= 0) return undefined;
    return component.maxDurability - component.damage;
};

/** Sets a stack's amount, warning once per item type when the engine refuses it; the amount then stays as it was. */
const applyAmount = (stack: ItemStack, amount: number): void => {
    try {
        stack.amount = Math.max(1, amount);
    } catch (error) {
        warnOnce(
            `amount:${stack.typeId}`,
            `[ContainerUI] "${stack.typeId}" refused the amount ${amount} (${String(error)}); the engine accepts 1 to 255.`,
        );
    }
};

/** Lore the engine accepts: at most 20 lines of 50 characters. A lore that had to be cut is warned about once per item type. */
const fitLore = (lore: readonly string[], typeId: string): string[] => {
    const fitted = lore.slice(0, MAX_LORE_LINES).map((line) => line.slice(0, MAX_LORE_LINE_LENGTH));
    const isCut = fitted.length < lore.length || fitted.some((line, position) => line !== lore[position]);
    if (isCut) {
        warnOnce(
            `lore-length:${typeId}`,
            `[ContainerUI] The lore of "${typeId}" exceeds the engine's limit of ${MAX_LORE_LINES} lines of ${MAX_LORE_LINE_LENGTH} characters; it is cut.`,
        );
    }
    return fitted;
};

/** Adds the lore marker to a real item's lore, warning once per item type if the engine still refuses it. */
const markNativeLore = (stack: ItemStack): void => {
    try {
        const lore = stack.getLore();
        applyLoreMarker(lore);
        stack.setLore(lore);
    } catch (error) {
        warnOnce(`marker:${stack.typeId}`, `[ContainerUI] "${stack.typeId}" refused the lore marker (${String(error)}); the item is shown unmarked.`);
    }
};

/** Replaces a real item's enchantments with the ones the view asks for, when they differ. */
const replaceEnchantments = (stack: ItemStack, enchantments: readonly ItemEnchantment[] | undefined): void => {
    if (!enchantments || areEnchantmentsEqual(readEnchantments(stack), enchantments)) return;
    const enchantable = componentOf<ItemEnchantableComponent>(stack, ENCHANTABLE_COMPONENT_ID);
    try {
        enchantable?.removeAllEnchantments();
    } catch {
        // Nothing to remove, or the engine refused: the add below still reports what it cannot do.
    }
    applyEnchantments(stack, enchantments);
};

/**
 * A clone of the real stack a view carries, wearing what the view asks for: its amount, and the
 * name, lore, enchantments, durability and tags it names. A field the view leaves out keeps the
 * real item's own. The scan compares a slot with what was written, so a field the write drops would
 * read back as a player's action.
 */
const cloneNative = (view: ItemView, native: ItemStack): ItemStack => {
    const clone = native.clone();
    applyAmount(clone, view.amount ?? clone.amount);
    if (view.name !== undefined) clone.nameTag = view.name;
    if (view.lore !== undefined) {
        try {
            clone.setLore([...view.lore]);
        } catch (error) {
            warnOnce(`lore:${clone.typeId}`, `[ContainerUI] "${clone.typeId}" refused the lore of a real item (${String(error)}).`);
        }
    }
    replaceEnchantments(clone, view.enchantments);
    if (view.durability !== undefined) applyDurability(clone, view.durability);
    applyTags(clone, view.tags);
    return clone;
};

/**
 * A new stack built from a described view: its type — or the potion or block variant the engine
 * builds for it — then amount, name, enchantments, durability and tags. Lore is left to the caller.
 */
const describedStack = (view: ItemView): ItemStack => {
    // A potion or a block variant is built by the engine: `new ItemStack` cannot set a potion effect or block states.
    const stack = potionStack(view) ?? blockStateStack(view) ?? new ItemStack(view.typeId, 1);
    applyAmount(stack, view.amount ?? 1);
    if (view.name !== undefined) stack.nameTag = view.name;
    applyEnchantments(stack, view.enchantments);
    applyDurability(stack, view.durability);
    applyTags(stack, view.tags);
    return stack;
};

/** Where {@link toItemStack} writes the stack. */
export interface ToItemStackOptions {
    /** The stack goes into a slot the UI owns, not an `input`: a real item is marked too. */
    isUiOwned?: boolean;
}

/**
 * The maximum stack size of an item type.
 *
 * @param typeId Item type id.
 * @returns The stack limit, or `undefined` for a type the engine does not know.
 * @example
 * maxStackOf("minecraft:ender_pearl"); // 16
 */
export const maxStackOf = (typeId: string): number | undefined => {
    if (maxStacks.has(typeId)) return maxStacks.get(typeId);
    let limit: number | undefined;
    try {
        limit = new ItemStack(typeId).maxAmount;
    } catch {
        limit = undefined;
    }
    maxStacks.set(typeId, limit);
    return limit;
};

/**
 * Builds a marked stack for a rendered item.
 *
 * @param view The item, or `null` to clear the slot.
 * @param options Where the stack is going.
 * @returns The stack, or `undefined` for `null`.
 */
export const toItemStack = (view: ItemView | null, options: ToItemStackOptions = {}): ItemStack | undefined => {
    if (!view) return undefined;

    // A real item is its own stack, cloned, so enchantments and NBT survive.
    if (view.native instanceof ItemStack) {
        const clone = cloneNative(view, view.native);
        if (options.isUiOwned && !applyDynamicMarker(clone)) markNativeLore(clone);
        return clone;
    }

    const stack = describedStack(view);

    // Lore goes last: the fallback marker may have to be added to it.
    const lore = fitLore(view.lore ?? [], stack.typeId);
    if (!applyDynamicMarker(stack)) applyLoreMarker(lore);
    if (lore.length > 0) stack.setLore(lore);

    return stack;
};

/**
 * Builds an unmarked stack for writing into storage.
 *
 * @param view The item, or `null` to clear the slot.
 * @returns The stack, or `undefined` for `null`.
 */
export const toStorageStack = (view: ItemView | null): ItemStack | undefined => {
    if (!view) return undefined;

    if (view.native instanceof ItemStack) return cloneNative(view, view.native);

    const stack = describedStack(view);
    if (view.lore && view.lore.length > 0) stack.setLore([...view.lore]);
    return stack;
};

/**
 * Reads a stack into a view, without the marker. An unmarked stack keeps a clone in `native`.
 *
 * @param stack The stack, or `undefined` for an empty slot.
 * @returns The view, or `null` for an empty slot.
 */
export const fromItemStack = (stack: ItemStack | undefined): ItemView | null => {
    if (!stack) return null;

    const rawLore = stack.getLore();
    const isLoreMarked = hasLegacyMarker(rawLore);
    const lore = isLoreMarked ? stripLoreMarker(rawLore) : rawLore;
    const isMarked = isLoreMarked || isRenderedItem(stack);

    const view: ItemView = { typeId: stack.typeId, amount: stack.amount };
    if (stack.nameTag) view.name = stack.nameTag;
    if (lore.length > 0) view.lore = lore;

    const tags = readTags(stack);
    if (tags) view.tags = tags;
    const enchantments = readEnchantments(stack);
    if (enchantments) view.enchantments = enchantments;
    const durability = readDurability(stack);
    if (durability !== undefined) view.durability = durability;
    const potion = readPotion(stack);
    if (potion) view.potion = potion;

    if (!isMarked) view.native = stack.clone();

    return view;
};

