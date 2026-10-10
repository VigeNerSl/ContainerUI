/**
 * Scenarios 9 and 10: the fluent builder in the world, and an auction whose listing lines live in
 * the display copy only. In the builder's closing record, `writes` should be the first paint plus
 * one per counter tick and one per press. A bought listing must arrive without the price and seller.
 */

import { system } from "@minecraft/server";
import { ContainerFormData, createMemoryStorage, h, signal, StorageView, toStorageStack } from "../ContainerUI/ContainerFormData.js";
import { log, note, reportingOptions, reportOnClose } from "../support/report.js";
import { globalClicks, PANE } from "../support/ui.js";

const AUCTION_SELLER_TAG = "containerui:auction_seller";
const AUCTION_PRICE_TAG = "containerui:auction_price";

/** Scenario 9: a pattern, a builder button, a function item, an input, and a slot added after opening. */
export const openFormDemo = (player) => {
    const scenario = "form";
    const size = 27;
    const startedAtMs = Date.now();
    const ticks = signal(0);

    log("info", { event: "open-requested", scenario, size, player: player.name });

    const form = new ContainerFormData(size)
        .title("§dCUI §7ContainerFormData")
        .pattern(
            [
                "#########",
                "#       #",
                "#########",
            ],
            { "#": PANE },
        )
        .button(
            11,
            { typeId: "minecraft:emerald", name: "§aКнопка построителя", lore: ["§7+1 к общему счётчику"] },
            (vigenersl) => {
                const { index } = vigenersl;
                globalClicks.value += 1;
                log("info", { event: "form-click", scenario, slot: index, global: globalClicks.value });
            },
            "random.orb",
        )
        // A function item: it repaints without anything re-rendering.
        .slot(13, () => ({
            typeId: "minecraft:clock",
            name: `§fТиков: §e${ticks.value}`,
            lore: [`§7Кликов всего: §e${globalClicks.value}`],
        }))
        .input(15, {
            onChange: (vigenersl) => {
                const { index, next } = vigenersl;
                log("info", {
                    event: "form-input",
                    scenario,
                    slot: index,
                    item: next ? `${next.typeId}x${next.amount ?? 1}` : "empty",
                });
            },
        })
        .slot(22, { typeId: "minecraft:barrier", name: "§cЗакрыть" })
        .onClose(() => log("info", { event: "form-closed-hook", scenario }));

    const session = form.open(player, reportingOptions({ scenario, size, startedAtMs }));
    reportOnClose({ session, scenario, size });

    // One signal write a second must cost one physical write.
    const runId = system.runInterval(() => {
        ticks.value += 1;
    }, 20);
    session.closed.then(() => system.clearRun(runId));

    // The builder stays live after opening: slot 4 does not exist yet.
    system.runTimeout(() => {
        if (session.surface.isClosed) return;
        form.slot(4, { typeId: "minecraft:nether_star", name: "§eДобавлено после открытия" });
        note(scenario, { detail: "slot 4 added after open" });
    }, 60);

    return session;
};

/** The listings: price and seller are added to the display copy by `decorate`, never to the stored item. */
const AuctionBoard = (props) => {
    const { player, listings, scenario } = props;

    return h(StorageView, {
        storage: listings,
        index: 0,
        sound: "random.orb",

        decorate: (item) => {
            if (!item) return null;
            const seller = item.tags?.[AUCTION_SELLER_TAG] ?? "?";
            const price = item.tags?.[AUCTION_PRICE_TAG] ?? "?";
            return {
                ...item,
                lore: [...(item.lore ?? []), "§8—", `§7Цена: §e${price}`, `§7Продавец: §f${seller}`],
            };
        },

        onSlotClick: (storageIndex) => {
            // The stored item, undecorated.
            const bought = listings.get(storageIndex);
            if (!bought) return;

            listings.set(storageIndex, null);
            const container = player.getComponent("minecraft:inventory")?.container;
            // `toStorageStack`, not `toItemStack`: a rendered stack is marked, and the sweep would delete the purchase.
            if (container) container.addItem(toStorageStack(bought));

            log("info", {
                event: "auction-bought",
                scenario,
                player: player.name,
                slot: storageIndex,
                item: bought.typeId,
                price: bought.tags?.[AUCTION_PRICE_TAG] ?? "?",
                // The bought item carries none of the listing lines.
                loreLines: bought.lore ? bought.lore.length : 0,
                sellerTag: bought.tags?.[AUCTION_SELLER_TAG] ?? "none",
            });
        },
    });
};

/** Scenario 10: an auction board over ordinary items that carry their seller and price as invisible tags. */
export const openAuctionDemo = (player) => {
    const scenario = "auction";
    const size = 27;
    const startedAtMs = Date.now();

    const listings = createMemoryStorage(9, [
        { typeId: "minecraft:diamond_sword", amount: 1, tags: { [AUCTION_SELLER_TAG]: "Alex", [AUCTION_PRICE_TAG]: 250 } },
        { typeId: "minecraft:golden_apple", amount: 8, tags: { [AUCTION_SELLER_TAG]: "Steve", [AUCTION_PRICE_TAG]: 40 } },
        { typeId: "minecraft:elytra", amount: 1, tags: { [AUCTION_SELLER_TAG]: "Herobrine", [AUCTION_PRICE_TAG]: 9999 } },
    ]);

    log("info", { event: "open-requested", scenario, size, player: player.name });

    const form = new ContainerFormData(size)
        .title("§6Аукцион")
        .component(0, AuctionBoard, { player, listings, scenario })
        .slot(22, { typeId: "minecraft:barrier", name: "§cЗакрыть" });

    const session = form.open(player, reportingOptions({ scenario, size, startedAtMs }));
    return reportOnClose({ session, scenario, size });
};
