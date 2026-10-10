/**
 * Scenario 11: enchantments and durability. One exhibit per rule, each with its expected result in
 * its lore. Three ticks after opening, every exhibit is read back from the engine and logged as
 * `action=readback`; the two refusals must each log exactly one `[ContainerUI]` warning.
 */

import { system } from "@minecraft/server";
import { h, useEffect, useSignal } from "../ContainerUI/ContainerFormData.js";
import { note } from "../support/report.js";
import { BackButton, CloseButton, Divider } from "../support/ui.js";

/** `sharpness:5,unbreaking:3`, or `none`. */
const formatEnchantments = (enchantments) => {
    if (!enchantments || enchantments.length === 0) return "none";
    return enchantments.map((enchantment) => `${enchantment.id}:${enchantment.level}`).join(",");
};

/** The described exhibits, read back after the first commit. */
const EXHIBIT_SLOTS = [9, 10, 11, 12, 13, 14, 16];

/** Logs what the engine holds in one slot. Skipped once the menu has closed, where a read returns nothing. */
const logReadback = (holder, index) => {
    const surface = holder.session?.surface;
    if (!surface || surface.isClosed) return;
    const view = surface.readSlot(index);
    note("enchant", {
        action: "readback",
        slot: index,
        typeId: view?.typeId ?? "empty",
        enchantments: formatEnchantments(view?.enchantments),
        // `??`: an exhibit asks for 0, and 0 is logged as 0.
        durability: view?.durability ?? "full",
    });
};

const EnchantExhibit = (props) =>
    h("slot", {
        index: props.index,
        item: {
            typeId: props.typeId ?? "minecraft:diamond_sword",
            name: props.name,
            lore: props.lore,
            enchantments: props.enchantments,
            durability: props.durability,
        },
    });

export const EnchantTest = (props) => {
    const level = useSignal(5);
    const placed = useSignal(null);

    useEffect(() => {
        const handle = system.runTimeout(() => {
            for (const index of EXHIBIT_SLOTS) logReadback(props.holder, index);
        }, 3);
        return () => system.clearRun(handle);
    }, []);

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),

        h(EnchantExhibit, {
            index: 9,
            name: "§bОстрота V + Прочность III",
            lore: ["§7Ожидание: блеск, обе чары в подсказке"],
            enchantments: [
                { id: "sharpness", level: 5 },
                { id: "unbreaking", level: 3 },
            ],
        }),
        h(EnchantExhibit, {
            index: 10,
            name: "§bПрочность 100",
            lore: ["§7Ожидание: полоска износа, без блеска"],
            durability: 100,
        }),
        h(EnchantExhibit, {
            index: 11,
            typeId: "minecraft:iron_sword",
            name: "§bid с пространством имён",
            lore: ["§7minecraft:sharpness 3", "§7Ожидание: блеск, Острота III"],
            enchantments: [{ id: "minecraft:sharpness", level: 3 }],
        }),
        h(EnchantExhibit, {
            index: 12,
            name: "§eНесовместимая чара",
            lore: ["§7Защита IV + Острота II", "§7Ожидание: только Острота II", "§7в логе: одно предупреждение"],
            enchantments: [
                { id: "protection", level: 4 },
                { id: "sharpness", level: 2 },
            ],
        }),
        h(EnchantExhibit, {
            index: 13,
            typeId: "minecraft:diamond",
            name: "§eАлмаз с чарами и прочностью",
            lore: ["§7Ожидание: обычный алмаз", "§7в логе: два предупреждения"],
            enchantments: [{ id: "sharpness", level: 1 }],
            durability: 10,
        }),
        h(EnchantExhibit, {
            index: 14,
            name: "§eПрочность 0",
            lore: ["§7Проверка: не ломается ли предмет", "§7и что показывает полоска"],
            durability: 0,
        }),

        // Only the enchantment list changes between writes, and the diff must still notice.
        h("slot", {
            index: 16,
            item: () => ({
                typeId: "minecraft:diamond_sword",
                name: level.value > 0 ? `§aОстрота ${level.value}` : "§aБез чар",
                lore: ["§7нажми: уровень +1, после V — без чар"],
                enchantments: level.value > 0 ? [{ id: "sharpness", level: level.value }] : [],
            }),
            sound: "random.click",
            onClick: (vigenersl) => {
                const { index } = vigenersl;
                level.value = level.value >= 5 ? 0 : level.value + 1;
                note("enchant", { action: "cycle", slot: index, level: level.value });
                // Read after the commit at the end of the tick.
                system.runTimeout(() => logReadback(props.holder, index), 2);
            },
        }),

        h("slot", {
            index: 18,
            item: {
                typeId: "minecraft:paper",
                name: "§fПоложи свой предмет правее",
                lore: [
                    "§7в логе: какие чары и износ прочитал движок",
                    "§7ещё правее: описанная копия без native",
                    "§7закрой меню с предметом — он вернётся",
                ],
            },
        }),
        h("input", {
            index: 19,
            onPlace: (vigenersl) => {
                const { index, next } = vigenersl;
                placed.value = next;
                note("enchant", {
                    action: "place",
                    slot: index,
                    typeId: next.typeId,
                    enchantments: formatEnchantments(next.enchantments),
                    durability: next.durability ?? "full",
                });
            },
            onTake: (vigenersl) => {
                const { index } = vigenersl;
                placed.value = null;
                note("enchant", { action: "take", slot: index });
            },
        }),
        // Rebuilt from the read view without `native`: matching the original means read and write agree.
        h("slot", {
            index: 20,
            item: () => {
                const source = placed.value;
                if (!source) return { typeId: "minecraft:light_gray_stained_glass_pane", name: "§7Здесь появится копия" };
                return {
                    typeId: source.typeId,
                    amount: source.amount,
                    name: "§fКопия",
                    lore: [`§7чары: ${formatEnchantments(source.enchantments)}`, `§7прочность: ${source.durability ?? "полная"}`],
                    enchantments: source.enchantments,
                    durability: source.durability,
                };
            },
        }),

        h(CloseButton, { index: 25 }),
        h(BackButton, { index: 26, player: props.player }),
    );
};
