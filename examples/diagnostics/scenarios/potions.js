/**
 * Scenario 16: items built from the legacy data-value format. Bedrock has no `data` in the script API — a
 * potion, a splash or lingering bottle and a tipped arrow are built from an effect and a delivery
 * id, and a block variant such as a coloured bed from its block states. The screen shows one of
 * each (`action=exhibit`), lists what the engine registers (`action=effects`, `action=deliveries`),
 * and reads back whatever the player drops into the input (`action=readback`).
 *
 * Slot 9 covers a known pitfall: a button made from a real loot-table arrow and renamed through a
 * spread must not fire its own handler on a scan pass. It logs `action=renamed-shown` once and
 * `action=renamed-click` per press, with the ticks since the screen opened; a press in the first
 * ticks, or one per tick, means the handler fires without a click.
 */

import { Potions, system } from "@minecraft/server";
import { h, itemFromLootTable, useEffect, useRef, useSignal } from "../ContainerUI/ContainerFormData.js";
import { note } from "../support/report.js";
import { BackButton, CloseButton, Divider } from "../support/ui.js";

const EXHIBITS = [
    { index: 10, typeId: "minecraft:potion", effect: "fire_resistance", name: "§bЗелье огнестойкости" },
    { index: 11, typeId: "minecraft:splash_potion", effect: "healing", name: "§dВзрывное зелье лечения" },
    { index: 12, typeId: "minecraft:lingering_potion", effect: "strong_healing", name: "§cОседающее зелье лечения II" },
    { index: 13, typeId: "minecraft:potion", effect: "long_nightvision", name: "§9Зелье ночного зрения (долгое)" },
    // No delivery builds an arrow, so this one stays plain and warns once.
    { index: 14, typeId: "minecraft:arrow", effect: "fire_resistance", name: "§7Стрела: эффект движку недоступен" },
];

/** Block items built from the legacy data-value format: the states replace the number. */
const BLOCK_EXHIBITS = [
    { index: 19, typeId: "minecraft:brown_mushroom_block", states: { huge_mushroom_bits: 14 }, name: "§6Гриб: сторона 14" },
    { index: 20, typeId: "minecraft:brown_mushroom_block", states: { huge_mushroom_bits: 0 }, name: "§8Гриб: сторона 0" },
    { index: 21, typeId: "minecraft:dropper", states: { facing_direction: 3 }, name: "§7Раздатчик: сторона 3" },
];

/**
 * The loot tables the pack ships. `set_data` builds a real tipped arrow; `set_potion` leaves a plain
 * one, which is why the library's items page says to use the aux value.
 */
const LOOT_TABLES = [
    { label: "set_potion", path: "containerui/tipped_arrow_set_potion" },
    { label: "set_data", path: "containerui/tipped_arrow_set_data" },
];

/** Aux values to survey: one loot table per value, built by `tools/build-test-pack.mjs`. */
const ARROW_AUX_VALUES = Array.from({ length: 48 }, (unused, aux) => aux);

/** Aux values per log line, so the survey is a handful of records rather than forty-eight. */
const SURVEY_LINE_SIZE = 6;

/**
 * Rolls one loot table per aux value and reports what the client calls each arrow, so the data
 * values can be written down from the engine rather than guessed.
 */
const surveyArrowAuxValues = () => {
    const seen = ARROW_AUX_VALUES.map((aux) => {
        const item = itemFromLootTable(`containerui/arrow_aux_${aux}`, { reroll: true });
        if (!item) return `${aux}=missing`;
        const key = localizationKeyOf(item).replace("tipped_arrow.effect.", "");
        return `${aux}=${key}`;
    });

    for (let start = 0; start < seen.length; start += SURVEY_LINE_SIZE) {
        note("potions", { action: "arrow-survey", from: start, ids: seen.slice(start, start + SURVEY_LINE_SIZE).join(",") });
    }
};

/** The key the client shows for an item: a tipped arrow names its effect, a plain one does not. */
const localizationKeyOf = (view) => {
    try {
        return view?.native?.localizationKey ?? "?";
    } catch {
        return "?";
    }
};

/**
 * Ids the engine knows: the deliveries in one line, then every effect with its position, since that
 * position is the legacy data value and an arrow's aux value is one more than it.
 */
const reportRegistry = () => {
    try {
        const deliveries = Potions.getAllDeliveryTypes().map((vigenersl) => vigenersl.id);
        const effects = Potions.getAllEffectTypes().map((vigenersl) => vigenersl.id.replace("minecraft:", ""));
        note("potions", { action: "deliveries", ids: deliveries.join(",") });
        note("potions", { action: "effects", count: effects.length });
        for (let start = 0; start < effects.length; start += SURVEY_LINE_SIZE) {
            const line = effects.slice(start, start + SURVEY_LINE_SIZE).map((id, offset) => `${start + offset}=${id}`);
            note("potions", { action: "effect-ids", from: start, ids: line.join(",") });
        }
    } catch (error) {
        note("potions", { action: "registry-failed", detail: JSON.stringify(String(error)) });
    }
};

/** The table the renamed button is rolled from: a real tipped arrow. */
const RENAMED_TABLE = "containerui/tipped_arrow_set_data";

/**
 * Slot 9: a real item under another name, in the shape that triggers the pitfall — rolled in render
 * and renamed through a spread.
 */
const RenamedRealButton = () => {
    const openedAt = useRef(system.currentTick);
    const clicks = useRef(0);

    const rolled = itemFromLootTable(RENAMED_TABLE);
    const item = rolled && { ...rolled, name: "§7Назад §8(настоящая стрела)", lore: ["§7не должна нажиматься сама"] };
    useEffect(() => {
        note("potions", { action: "renamed-shown", item: describe(item), name: JSON.stringify(item?.name ?? ""), isReal: item?.native !== undefined });
    }, []);

    if (!item) return h("slot", { index: 9, item: { typeId: "minecraft:barrier", name: `§cНет таблицы ${RENAMED_TABLE}` } });

    return h("slot", {
        index: 9,
        item,
        sound: "random.click",
        onClick: () => {
            clicks.current++;
            note("potions", { action: "renamed-click", count: clicks.current, ticksSinceOpen: system.currentTick - openedAt.current });
        },
    });
};

const describe = (item) => {
    if (!item) return "empty";
    const potion = item.potion ? ` potion=${item.potion.effect}@${item.potion.delivery ?? "?"}` : "";
    const states = item.blockStates ? ` states=${JSON.stringify(item.blockStates)}` : "";
    return `${item.typeId.replace("minecraft:", "")}x${item.amount ?? 1}${potion}${states}`;
};

export const PotionTest = (props) => {
    reportRegistry();
    // What a loot table produced, shown in slot 24 so the client can be looked at.
    const generated = useSignal(null);

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),
        h(RenamedRealButton, null),

        EXHIBITS.map((exhibit) =>
            h("slot", {
                key: exhibit.index,
                index: exhibit.index,
                item: {
                    typeId: exhibit.typeId,
                    name: exhibit.name,
                    ...(exhibit.effect ? { potion: { effect: exhibit.effect } } : {}),
                },
                sound: "random.click",
                onClick: (vigenersl) => note("potions", { action: "exhibit", slot: vigenersl.index, item: describe(vigenersl.item) }),
            }),
        ),

        BLOCK_EXHIBITS.map((exhibit) =>
            h("slot", {
                key: exhibit.index,
                index: exhibit.index,
                item: {
                    typeId: exhibit.typeId,
                    name: exhibit.name,
                    ...(exhibit.states ? { blockStates: exhibit.states } : {}),
                },
                sound: "random.click",
                onClick: (vigenersl) => note("potions", { action: "exhibit", slot: vigenersl.index, item: describe(vigenersl.item) }),
            }),
        ),

        ...LOOT_TABLES.map((table, position) =>
            h("slot", {
                key: `loot:${table.label}`,
                index: 23 + position,
                item: { typeId: "minecraft:bow", name: `§eСтрела из таблицы: ${table.label}`, lore: ["§7нажми — сгенерирую"] },
                sound: "random.click",
                onClick: () => {
                    const item = itemFromLootTable(table.path, { amount: 3, reroll: true });
                    generated.value = item;
                    note("potions", { action: "loot-item", table: table.label, path: table.path, item: describe(item), key: localizationKeyOf(item) });
                },
            }),
        ),
        h("slot", {
            index: 25,
            item: () => generated.value ?? { typeId: "minecraft:barrier", name: "§7Здесь появится результат" },
        }),

        h("slot", {
            index: 18,
            item: { typeId: "minecraft:spyglass", name: "§eСнять таблицу data → эффект", lore: ["§7обойду значения 0–47", "§7и запишу их в лог"] },
            sound: "random.click",
            onClick: () => surveyArrowAuxValues(),
        }),

        h("slot", {
            index: 16,
            item: { typeId: "minecraft:oak_sign", name: "§fПоложи своё зелье или стрелу →", lore: ["§7прочитаю, что в нём"] },
        }),
        h("input", {
            index: 17,
            onChange: (vigenersl) => note("potions", { action: "readback", item: describe(vigenersl.next) }),
        }),

        h(Divider, { index: 18, except: [18, 19, 20, 21, 22, 23, 24, 25, 26] }),
        h(BackButton, { index: 22, player: props.player }),
        h(CloseButton, { index: 26 }),
    );
};
