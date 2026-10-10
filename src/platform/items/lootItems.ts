/**
 * Items built by a loot table. The script API cannot describe the variants Bedrock once told apart
 * by a data value — a tipped arrow, a map variant — but a loot table's `set_data` function can, and
 * a pack may ship one per variant.
 */

import { world, type ItemStack } from "@minecraft/server";
import type { ItemView } from "../../core/index.js";
import { log } from "../../core/logging/logger.js";
import { onUninstall } from "../lifecycle.js";
import { fromItemStack } from "./itemConversion.js";

/** One view per `path:index`, so a table is rolled once. */
const itemsByKey = new Map<string, ItemView | null>();
const warned = new Set<string>();

let isCacheInstalled = false;

/** Warns once per key; a missing table is a mistake to fix, not a line to repeat on every call. */
const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    log({ level: "warn", source: "items", message });
};

/** The view at another stack size, sharing its real item. */
const withAmount = (view: ItemView | null, amount: number | undefined): ItemView | null => {
    if (!view || amount === undefined) return view;
    return { ...view, amount: Math.max(1, Math.floor(amount)) };
};

/** Drops the cached items when the adapter is uninstalled, so a reload rolls the tables again. */
const installCache = (): void => {
    if (isCacheInstalled) return;
    isCacheInstalled = true;
    onUninstall(() => {
        isCacheInstalled = false;
        itemsByKey.clear();
        warned.clear();
    });
};

/** What asking the engine for a table's items produced. */
type Roll = { kind: "rolled"; stacks: ItemStack[] } | { kind: "missing" } | { kind: "failed"; error: unknown };

/** Rolls a table once, telling a path the engine does not know from a roll that threw. */
const rollTable = (path: string): Roll => {
    try {
        const manager = world.getLootTableManager();
        const table = manager.getLootTable(path);
        if (!table) return { kind: "missing" };
        return { kind: "rolled", stacks: manager.generateLootFromTable(table) ?? [] };
    } catch (error) {
        return { kind: "failed", error };
    }
};

/** How {@link itemFromLootTable} rolls a table and shapes what it takes. */
export interface LootItemOptions {
    /** Which of the produced stacks to take. Defaults to the first. */
    index?: number;
    /** Stack size of the view. Defaults to what the table produced. */
    amount?: number;
    /** Roll the table again instead of using the item kept from the first roll. Defaults to `false`. */
    reroll?: boolean;
}

/**
 * An item from a loot table, as a view carrying the real stack.
 *
 * A table is rolled once and its item kept, so give each variant its own single-entry table; a
 * table with several entries or a random roll would be frozen on whatever came out first. Pass
 * `reroll` for a table that is meant to be random.
 *
 * The path is the one the engine knows the table by: the file's path under `loot_tables/`, without
 * that folder and without `.json` — `BP/loot_tables/myaddon/fire_arrow.json` is
 * `"myaddon/fire_arrow"`.
 *
 * @param path The loot table's path.
 * @param options Which stack to take, its size, and whether to roll again.
 * @returns The item, or `null` when the table is unknown or produced nothing (warned once per path).
 * @example
 * // BP/loot_tables/myaddon/fire_arrow.json rolls one Fire Resistance arrow with { "function": "set_data", "data": 13 }.
 * const arrow = itemFromLootTable("myaddon/fire_arrow", { amount: 16 });
 */
export const itemFromLootTable = (path: string, options: LootItemOptions = {}): ItemView | null => {
    installCache();
    const index = Math.max(0, Math.floor(options.index ?? 0));
    const key = `${path}:${index}`;

    if (!options.reroll && itemsByKey.has(key)) return withAmount(itemsByKey.get(key) ?? null, options.amount);

    const roll = rollTable(path);
    if (roll.kind === "missing") {
        warnOnce(key, `[ContainerUI] No loot table is registered as "${path}"; the item it would build is missing.`);
        itemsByKey.set(key, null);
        return null;
    }
    if (roll.kind === "failed") {
        warnOnce(key, `[ContainerUI] Loot table "${path}" could not be rolled (${String(roll.error)}).`);
        itemsByKey.set(key, null);
        return null;
    }

    const stack = roll.stacks[index];
    if (!stack) {
        warnOnce(key, `[ContainerUI] Loot table "${path}" produced ${roll.stacks.length} stack(s); none at index ${index}.`);
        itemsByKey.set(key, null);
        return null;
    }

    const view = fromItemStack(stack);
    itemsByKey.set(key, view);
    return withAmount(view, options.amount);
};
