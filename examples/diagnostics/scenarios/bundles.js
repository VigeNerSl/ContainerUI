/**
 * Scenario 18: a real bundle shown on a button. Slot 11 shows a real bundle, three diamonds and five
 * emeralds inside, through `native`: the button keeps its contents, every item marked. Slot 13 shows
 * the same bundle through `toDisplayView`, as `StorageView` does, without its contents.
 *
 * Try slot 11: take an item out of the bundle (right-click it with an empty cursor on a computer), and
 * put one of your own in. `action=held` records the unmarked diamonds and emeralds the player holds,
 * inventory and cursor, whenever the count changes: it must never grow. What is taken out is a
 * marked copy, and within half a second the button is written again (`storage-button-restored`); an
 * item put in comes back (`own-item-returned`). `action=bundle-ready` says whether the engine let the scenario fill the
 * bundle.
 */

import { ItemStack, system } from "@minecraft/server";
import { fromItemStack, h, isRenderedItem, toDisplayView, useEffect } from "../ContainerUI/ContainerFormData.js";
import { note, openWithReport } from "../support/report.js";
import { BackButton, CloseButton, Divider } from "../support/ui.js";

/** What the scenario puts in the real bundle. */
const CONTENTS = [
    { typeId: "minecraft:diamond", amount: 3 },
    { typeId: "minecraft:emerald", amount: 5 },
];

const WATCH_INTERVAL_TICKS = 10;

/** A real bundle holding `CONTENTS`, or `null` when the engine gives the bundle no inventory. */
const buildRealBundle = () => {
    try {
        const bundle = new ItemStack("minecraft:bundle");
        const container = bundle.getComponent("minecraft:inventory")?.container;
        if (!container) return null;
        CONTENTS.forEach(({ typeId, amount }, index) => container.setItem(index, new ItemStack(typeId, amount)));
        return bundle;
    } catch (error) {
        note("bundles", { action: "bundle-failed", detail: JSON.stringify(String(error)) });
        return null;
    }
};

/** What a bundle holds, as `diamond=3,emerald=5`. */
const describeContents = (bundle) => {
    const container = bundle.getComponent("minecraft:inventory")?.container;
    if (!container) return "none";
    return Array.from({ length: container.size }, (unused, index) => container.getItem(index))
        .filter(Boolean)
        .map((stack) => `${stack.typeId.replace("minecraft:", "")}=${stack.amount}`)
        .join(",");
};

/** The unmarked diamonds and emeralds in the player's inventory and on their cursor, as `diamond=3,emerald=0`. */
const describeHeld = (player) => {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    const slots = inventory ? Array.from({ length: inventory.size }, (unused, index) => inventory.getItem(index)) : [];
    const stacks = [...slots, player.getComponent("minecraft:cursor_inventory")?.item];
    return CONTENTS.map(({ typeId }) => {
        const count = stacks.filter((stack) => stack?.typeId === typeId && !isRenderedItem(stack)).reduce((sum, stack) => sum + stack.amount, 0);
        return `${typeId.replace("minecraft:", "")}=${count}`;
    }).join(",");
};

const BundleTest = (props) => {
    const { player, bundle } = props;

    useEffect(() => {
        note("bundles", { action: "bundle-ready", isReal: bundle !== null, contents: bundle ? describeContents(bundle) : "none" });
        let last = "";
        const runId = system.runInterval(() => {
            if (!player.isValid) return;
            const held = describeHeld(player);
            if (held === last) return;
            last = held;
            note("bundles", { action: "held", held });
        }, WATCH_INTERVAL_TICKS);
        return () => system.clearRun(runId);
    }, []);

    const real = bundle && fromItemStack(bundle);

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),

        h("slot", {
            index: 10,
            item: {
                typeId: "minecraft:paper",
                name: "§fПроверка мешка на кнопке",
                lore: ["§7ПКМ пустым курсором по мешку справа:", "§7вылезает ли предмет?", "§7и положи туда свой"],
            },
        }),
        h("slot", {
            index: 11,
            item: real
                ? { ...real, name: "§6Настоящий мешок §8(native)", lore: ["§7внутри 3 алмаза и 5 изумрудов"] }
                : { typeId: "minecraft:barrier", name: "§cДвижок не дал заполнить мешок" },
            sound: "random.click",
            onClick: () => note("bundles", { action: "click", slot: 11 }),
        }),
        h("slot", {
            index: 13,
            item: real ? { ...toDisplayView(real), name: "§bТот же мешок §8(toDisplayView)", lore: ["§7как в StorageView"] } : null,
            sound: "random.click",
            onClick: () => note("bundles", { action: "click", slot: 13 }),
        }),

        h(Divider, { index: 18, except: [22, 26] }),
        h(BackButton, { index: 22, player }),
        h(CloseButton, { index: 26 }),
    );
};

/** Opens scenario 18 with a fresh real bundle. */
export const openBundleTest = (player) => {
    const bundle = buildRealBundle();
    return openWithReport({ player, scenario: "bundles", size: 27, render: () => h(BundleTest, { player, bundle }) });
};
