/**
 * Scenario 14: a shop with pages, quantities and a balance. Thirty goods over fourteen cells, a page
 * that survives a visit to an item (`action=page`), a `QuantityPicker` with a counter for items
 * whose stack holds fewer than 64, and a `useScore` balance that catches up with a change made
 * behind the menu's back (`action=balance-shown`).
 */

import { world } from "@minecraft/server";
import {
    createContext,
    createRouter,
    h,
    maxStackOf,
    PagedList,
    provideContext,
    QuantityPicker,
    Routes,
    useContext,
    useEffect,
    useRouter,
    useRouteState,
    useScore,
    useState,
} from "../ContainerUI/ContainerFormData.js";
import { note } from "../support/report.js";
import { BackButton } from "../support/ui.js";

const SHOP_OBJECTIVE = "cui_coins";
const SHOP_STARTING_COINS = 100;
/** Rows 1 and 2, columns 1 to 7: fourteen cells, so thirty goods make three pages. */
const SHOP_CELLS = [10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25];
/** Thirty goods with a price. Stack sizes come from the engine. */
const SHOP_GOODS = [
    ["minecraft:apple", 2],
    ["minecraft:bread", 3],
    ["minecraft:cooked_beef", 5],
    ["minecraft:golden_carrot", 8],
    ["minecraft:cake", 12],
    ["minecraft:torch", 1],
    ["minecraft:lantern", 6],
    ["minecraft:ladder", 2],
    ["minecraft:oak_log", 2],
    ["minecraft:cobblestone", 1],
    ["minecraft:stone_bricks", 2],
    ["minecraft:glass", 2],
    // Bedrock's brick block is `minecraft:brick_block`; `minecraft:bricks` is not an identifier.
    ["minecraft:brick_block", 3],
    ["minecraft:quartz_block", 6],
    ["minecraft:obsidian", 10],
    ["minecraft:iron_ingot", 8],
    ["minecraft:gold_ingot", 12],
    ["minecraft:diamond", 40],
    ["minecraft:emerald", 30],
    ["minecraft:lapis_lazuli", 4],
    ["minecraft:redstone", 3],
    ["minecraft:arrow", 1],
    ["minecraft:bow", 15],
    ["minecraft:shield", 12],
    ["minecraft:iron_sword", 20],
    ["minecraft:iron_pickaxe", 22],
    ["minecraft:bucket", 9],
    ["minecraft:saddle", 25],
    ["minecraft:name_tag", 18],
    ["minecraft:ender_pearl", 14],
].map(([typeId, price]) => ({ typeId, price }));

const ShopContext = createContext(null, "ShopContext");

/** The player's coins, or `undefined` when there is no score. */
const readCoins = (objective, player) => {
    try {
        return objective?.getScore(player);
    } catch {
        return undefined;
    }
};

/** Creates the objective and a starting balance, so the scenario needs no commands first. */
export const prepareShopCoins = (player) => {
    try {
        const objective = world.scoreboard.getObjective(SHOP_OBJECTIVE) ?? world.scoreboard.addObjective(SHOP_OBJECTIVE, "Coins");
        if (readCoins(objective, player) === undefined) objective.setScore(player, SHOP_STARTING_COINS);
        note("shop", { action: "coins-ready", coins: readCoins(objective, player) });
    } catch (error) {
        note("shop", { action: "coins-failed", error: JSON.stringify(String(error)) });
    }
};

const buyGood = ({ player, good, quantity }) => {
    const objective = world.scoreboard.getObjective(SHOP_OBJECTIVE);
    const cost = quantity * good.price;
    const balance = readCoins(objective, player) ?? 0;
    if (!objective || balance < cost) {
        note("shop", { action: "too-poor", typeId: good.typeId, quantity, cost, balance });
        return;
    }
    objective.addScore(player, -cost);
    note("shop", { action: "bought", typeId: good.typeId, quantity, cost, balanceBefore: balance });
};

/** Stays mounted across both screens. The balance comes from `useScore`, which polls. */
const ShopChrome = (props) => {
    const shop = useContext(ShopContext);
    const coins = useScore({ participant: shop.player, objective: SHOP_OBJECTIVE });
    useEffect(() => note("shop", { action: "balance-shown", coins: coins ?? "none" }), [coins]);

    return h(
        "box",
        null,
        h(BackButton, { index: 0, player: shop.player }),
        h("slot", {
            index: 4,
            item: { typeId: "minecraft:gold_ingot", name: `§6Баланс: ${coins ?? "…"}`, lore: ["§7useScore: scoreboard cui_coins", "§8обновляется раз в 10 тиков"] },
        }),
        h("slot", {
            index: 8,
            item: { typeId: "minecraft:sunflower", name: "§e+100 монет", lore: ["§7меняет счёт в обход меню:", "§7баланс должен догнать сам"] },
            onClick: () => {
                world.scoreboard.getObjective(SHOP_OBJECTIVE)?.addScore(shop.player, 100);
                note("shop", { action: "top-up" });
            },
        }),
        props.children,
    );
};

const ShopList = () => {
    const router = useRouter();
    const [page, setPage] = useRouteState("page", 0);
    // Logged on every change: after "back" it must name the page that was left.
    useEffect(() => note("shop", { action: "page", page }), [page]);

    return h(PagedList, {
        items: SHOP_GOODS,
        cells: SHOP_CELLS,
        state: [page, setPage],
        keyOf: (good) => good.typeId,
        renderItem: (good, position) => ({
            item: { typeId: good.typeId, lore: [`§7цена: §e${good.price}`, "§8нажми: выбрать количество"] },
            onClick: () => {
                note("shop", { action: "open-item", typeId: good.typeId, position, page });
                router.push("item", { position });
            },
        }),
        previous: { index: 45, item: { typeId: "minecraft:arrow", name: "§f← Назад" } },
        next: { index: 53, item: { typeId: "minecraft:arrow", name: "§fВперёд →" } },
        indicator: {
            index: 49,
            item: (current, count) => ({ typeId: "minecraft:paper", name: `§fСтраница ${current}/${count}`, lore: ["§7страница переживёт «к списку»"] }),
        },
    });
};

const ShopItem = (props) => {
    const router = useRouter();
    const shop = useContext(ShopContext);
    const [quantity, setQuantity] = useState(1);
    const good = SHOP_GOODS[props.position];
    const stackLimit = good ? maxStackOf(good.typeId) : undefined;
    // A counter when the item's stack cannot show 64: pearls hold 16, swords and bows 1.
    useEffect(() => {
        if (good) note("shop", { action: "item-shown", typeId: good.typeId, stackLimit: stackLimit ?? "unknown", middle: stackLimit !== undefined && stackLimit < 64 ? "counter" : "item" });
    }, [good]);
    if (!good) return null;

    return h(
        "box",
        null,
        h("slot", {
            index: 13,
            item: { typeId: good.typeId, lore: [`§7цена за штуку: §e${good.price}`, `§8в одном стаке: ${stackLimit ?? "?"}`] },
        }),
        h(QuantityPicker, {
            index: 29,
            value: quantity,
            onChange: (vigenersl) => {
                setQuantity(vigenersl);
                note("shop", { action: "quantity", value: vigenersl });
            },
            stackLimit,
            item: (value) => ({
                typeId: good.typeId,
                amount: value,
                name: `§bКупить ${value} шт. за ${value * good.price}`,
                lore: ["§7нажми: купить", "§8число на иконке — количество"],
            }),
            onPick: (vigenersl) => buyGood({ player: shop.player, good, quantity: vigenersl }),
            sound: "random.click",
        }),
        h("slot", {
            index: 45,
            item: { typeId: "minecraft:arrow", name: "§e← К списку" },
            onClick: () => {
                note("shop", { action: "back-to-list" });
                router.back();
            },
        }),
    );
};

export const ShopTest = (props) => {
    const [router] = useState(() => createRouter("list"));
    provideContext(ShopContext, { player: props.player });
    return h(Routes, { router, layout: ShopChrome, screens: { list: ShopList, item: ShopItem } });
};
