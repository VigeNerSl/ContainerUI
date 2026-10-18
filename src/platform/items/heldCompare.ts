/**
 * Whether a slot of a storage opened by click still holds what was last written there. A stackable
 * item is compared by the engine itself; a non-stackable one, which the engine never calls stackable
 * with anything, by everything a script can read of it. Data no script reads, such as an armour trim,
 * can still differ between two such items: closing the screen writes every slot once more for that.
 */

import type { ItemStack } from "@minecraft/server";

type Fact = string | number | boolean | null | readonly Fact[] | { readonly [key: string]: unknown };

/** Everything a script can read of an item besides its type and amount, nested storage included. */
const factsOf = (stack: ItemStack): Fact[] => {
    const durability = stack.getComponent("minecraft:durability");
    const enchantable = stack.getComponent("minecraft:enchantable");
    const potion = stack.getComponent("minecraft:potion");
    const dyeable = stack.getComponent("minecraft:dyeable");
    const book = stack.getComponent("minecraft:book");
    const storage = stack.getComponent("minecraft:inventory")?.container;
    const nested: Fact[] = [];
    for (let index = 0; index < (storage?.size ?? 0); index++) {
        const inner = storage?.getItem(index);
        nested.push(inner ? [inner.typeId, inner.amount, factsOf(inner)] : null);
    }
    return [
        stack.nameTag ?? "",
        stack.getLore(),
        stack.getCanPlaceOn(),
        stack.getCanDestroy(),
        stack.lockMode,
        stack.keepOnDeath,
        stack
            .getDynamicPropertyIds()
            .sort()
            .map((id) => [id, JSON.stringify(stack.getDynamicProperty(id) ?? null)]),
        durability?.damage ?? null,
        enchantable
            ?.getEnchantments()
            .map((enchantment) => `${enchantment.type.id}:${enchantment.level}`)
            .sort() ?? null,
        potion ? [potion.potionEffectType.id, potion.potionDeliveryType.id] : null,
        dyeable?.color ? [dyeable.color.red, dyeable.color.green, dyeable.color.blue] : null,
        book ? [book.title ?? "", book.author ?? "", book.isSigned, book.contents.map((page) => page ?? "")] : null,
        nested,
    ];
};

/**
 * What a script can read of a non-stackable item, as one string to compare.
 *
 * @returns It, or `undefined` for a stackable item or one that could not be read.
 */
export const signatureOf = (stack: ItemStack | undefined): string | undefined => {
    if (!stack || stack.isStackable) return undefined;
    try {
        return JSON.stringify(factsOf(stack));
    } catch {
        return undefined;
    }
};

/**
 * Whether a slot holds what was written there.
 *
 * @param slot What it holds now, what was written, and the written item's {@link signatureOf}.
 * @returns `false` when unsure, so the slot is written again.
 */
export const isUnchanged = ({ current, written, signature }: { current: ItemStack | undefined; written: ItemStack | undefined; signature: string | undefined }): boolean => {
    if (!current || !written) return current === written;
    if (current.typeId !== written.typeId || current.amount !== written.amount) return false;
    if (current.isStackable) return current.isStackableWith(written);
    const now = signatureOf(current);
    return now !== undefined && now === signature;
};

/**
 * What the owner added to a slot since `written`: nothing for a slot as written, the whole stack, or
 * only what it gained when it is the same stackable item. For a storage that is gone, whose items as
 * last written went with it.
 *
 * @returns The part to give back, or `undefined` for none.
 */
export const addedPart = ({ current, written, signature }: { current: ItemStack | undefined; written: ItemStack | undefined; signature: string | undefined }): ItemStack | undefined => {
    if (!current || isUnchanged({ current, written, signature })) return undefined;
    if (!written || current.typeId !== written.typeId || !current.isStackable || !current.isStackableWith(written)) return current;
    if (current.amount <= written.amount) return undefined;
    const added = current.clone();
    added.amount = current.amount - written.amount;
    return added;
};
