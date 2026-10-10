/** Scenarios 1 to 5: a click and its restore, an input, 126 slots, layouts, and a burst of writes. */

import { system } from "@minecraft/server";
import { h, useSignal } from "../ContainerUI/ContainerFormData.js";
import { log, note } from "../support/report.js";
import { BackButton, CloseButton, Divider, globalClicks } from "../support/ui.js";

/** Scenario 1: a button restores after a click, and a function item repaints without a re-render. */
export const ClickTest = (props) => {
    const clicks = useSignal(0);

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),

        h("slot", {
            index: 11,
            item: { typeId: "minecraft:emerald", name: "§aНажми меня", lore: ["§7+1 к обоим счётчикам"] },
            sound: "random.orb",
            onClick: (vigenersl) => {
                const { index } = vigenersl;
                clicks.value += 1;
                globalClicks.value += 1;
                log("info", { event: "click", scenario: "click", slot: index, local: clicks.value, global: globalClicks.value });
            },
        }),

        // A function item: this slot updates without re-rendering the component.
        h("slot", {
            index: 13,
            item: () => ({
                typeId: "minecraft:paper",
                name: `§fЭто меню: §e${clicks.value}`,
                lore: [`§7Всего за сессию: §e${globalClicks.value}`],
            }),
        }),

        h(CloseButton, { index: 15 }),
        h(BackButton, { index: 16, player: props.player }),
        h(Divider, { index: 18 }),
    );
};

/** Scenario 2: an input keeps the player's item, and the decorative slots beside it snap back. */
export const InputTest = (props) =>
    h(
        "box",
        null,
        h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "§fПоложи предмет в центр" } }),

        h("input", {
            index: 13,
            accept: (item) => item.typeId !== "minecraft:bedrock",
            onPlace: (vigenersl) => {
                const { index, next } = vigenersl;
                note("input", { action: "place", slot: index, typeId: next.typeId, amount: next.amount });
            },
            onTake: (vigenersl) => {
                const { index } = vigenersl;
                note("input", { action: "take", slot: index });
            },
        }),

        h("slot", { index: 12, item: { typeId: "minecraft:iron_bars", name: "§7Нельзя взять" } }),
        h("slot", { index: 14, item: { typeId: "minecraft:iron_bars", name: "§7Нельзя взять" } }),

        h(BackButton, { index: 22, player: props.player }),
    );

const LARGE_COLOURS = [
    "minecraft:red_stained_glass_pane",
    "minecraft:orange_stained_glass_pane",
    "minecraft:yellow_stained_glass_pane",
    "minecraft:lime_stained_glass_pane",
    "minecraft:light_blue_stained_glass_pane",
    "minecraft:purple_stained_glass_pane",
];

/** Scenario 3: the largest surface, 126 slots with a scrolling grid. */
export const LargeTest = () =>
    h(
        "grid",
        { index: 0, columns: 9 },
        Array.from({ length: 126 }, (unused, index) =>
            h("slot", {
                key: index,
                item: {
                    typeId: LARGE_COLOURS[Math.floor(index / 9) % LARGE_COLOURS.length],
                    name: `§7слот §f${index}`,
                },
                onClick: (vigenersl) => {
                    const { index: slot } = vigenersl;
                    note("large126", { action: "click", slot });
                },
            }),
        ),
    );

/** Scenario 4: a row with a gap, a column and a grid. */
export const LayoutTest = (props) =>
    h(
        "box",
        null,
        h("row", { index: 0, gap: 1 }, [
            h("slot", { key: "a", item: { typeId: "minecraft:redstone_block", name: "§crow gap=1" } }),
            h("slot", { key: "b", item: { typeId: "minecraft:redstone_block", name: "§crow gap=1" } }),
            h("slot", { key: "c", item: { typeId: "minecraft:redstone_block", name: "§crow gap=1" } }),
        ]),
        h("column", { index: 9 }, [
            h("slot", { key: "a", item: { typeId: "minecraft:lapis_block", name: "§9column" } }),
            h("slot", { key: "b", item: { typeId: "minecraft:lapis_block", name: "§9column" } }),
            h("slot", { key: "c", item: { typeId: "minecraft:lapis_block", name: "§9column" } }),
        ]),
        h(
            "grid",
            { index: 13, columns: 3 },
            Array.from({ length: 9 }, (unused, index) =>
                h("slot", { key: index, item: { typeId: "minecraft:emerald_block", name: `§agrid ${index}` } }),
            ),
        ),
        h(BackButton, { index: 44, player: props.player }),
    );

/** Scenario 5: two hundred state writes in one tick must commit as one update. */
export const ChurnTest = (props) => {
    const counter = useSignal(0);
    const writesOf = () => {
        const app = props.holder.session && props.holder.session.app;
        return app ? app.writeCount : -1;
    };

    return h(
        "box",
        null,
        h("slot", {
            index: 0,
            item: {
                typeId: "minecraft:clock",
                name: "§e200 записей в одном тике",
                lore: ["§7значение должно стать 199 за одно обновление"],
            },
            onClick: () => {
                const startedAtMs = Date.now();
                const writesBefore = writesOf();
                for (let step = 0; step < 200; step++) counter.value = step;
                // Timed here: inside the timeout below it would time the wait.
                const enqueueMs = Date.now() - startedAtMs;
                // The commit lands at the end of the tick, so the count is read after it.
                system.runTimeout(() => {
                    note("churn", {
                        action: "burst",
                        stateWrites: 200,
                        enqueueMs,
                        physicalWritesBefore: writesBefore,
                        physicalWritesAfter: writesOf(),
                    });
                }, 2);
            },
        }),
        h("slot", {
            index: 4,
            item: () => ({ typeId: "minecraft:paper", name: `§fзначение: §e${counter.value}` }),
        }),
        h(BackButton, { index: 8, player: props.player }),
    );
};
