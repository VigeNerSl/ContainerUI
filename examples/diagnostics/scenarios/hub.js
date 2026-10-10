/** The hub that opens every scenario, and the small-size check (scenario 6). */

import { system } from "@minecraft/server";
import { h } from "../ContainerUI/ContainerFormData.js";
import { openWithReport } from "../support/report.js";
import { Divider, globalClicks, setBackTarget } from "../support/ui.js";
import { ChurnTest, ClickTest, InputTest, LargeTest, LayoutTest } from "./basics.js";
import { BenchTest } from "./bench.js";
import { ConsumeTest } from "./consume.js";
import { EnchantTest } from "./enchant.js";
import { openAuctionDemo, openFormDemo } from "./forms.js";
import { GlassTest } from "./glass.js";
import { ModalTest } from "./modal.js";
import { PotionTest } from "./potions.js";
import { RevealTest } from "./reveal.js";
import { RouterTest } from "./router.js";
import { prepareShopCoins, ShopTest } from "./shop.js";

/**
 * Opens a scenario whose component reads its own session, through a holder filled once the
 * session exists.
 */
const openWithHolder = ({ player, scenario, size, Screen }) => {
    const holder = { session: null };
    holder.session = openWithReport({ player, scenario, size, render: () => h(Screen, { player, holder }) });
    return holder.session;
};

const HubEntry = (props) =>
    h("slot", {
        index: props.index,
        item: { typeId: props.typeId, name: props.name, lore: ["§8нажми, чтобы открыть"] },
        sound: "random.click",
        onClick: (vigenersl) => {
            vigenersl.close();
            system.runTimeout(props.run, 6);
        },
    });

const TinyScreen = (props) =>
    h("slot", {
        index: 0,
        item: { typeId: "minecraft:diamond", name: `§b${props.size} слот(ов) — нажми` },
        onClick: (vigenersl) => vigenersl.close(),
    });

/** Scenario 6: opens sizes 1, 5 and 9 in turn, then the hub again. */
const openTinySizes = (player) => {
    const sizes = [1, 5, 9];
    let position = 0;

    const openNext = () => {
        if (position >= sizes.length) {
            system.runTimeout(() => openHub(player), 10);
            return;
        }
        const size = sizes[position++];
        const session = openWithReport({ player, scenario: `size${size}`, size, render: () => h(TinyScreen, { size }) });
        session.closed.then(() => system.runTimeout(openNext, 10));
    };

    openNext();
};

const Hub = (props) => {
    const { player } = props;

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),

        h(HubEntry, {
            key: "click",
            index: 10,
            typeId: "minecraft:emerald",
            name: "§a1. Клик и восстановление",
            run: () => openWithReport({ player, scenario: "click", size: 27, render: () => h(ClickTest, { player }) }),
        }),
        h(HubEntry, {
            key: "input",
            index: 11,
            typeId: "minecraft:chest",
            name: "§b2. Слот игрока (input)",
            run: () => openWithReport({ player, scenario: "input", size: 27, render: () => h(InputTest, { player }) }),
        }),
        h(HubEntry, {
            key: "large",
            index: 12,
            typeId: "minecraft:beacon",
            name: "§d3. 126 слотов (скролл)",
            run: () => openWithReport({ player, scenario: "large126", size: 126, render: () => h(LargeTest, { player }) }),
        }),
        h(HubEntry, {
            key: "layout",
            index: 13,
            typeId: "minecraft:crafting_table",
            name: "§e4. Раскладки",
            run: () => openWithReport({ player, scenario: "layout", size: 54, render: () => h(LayoutTest, { player }) }),
        }),
        h(HubEntry, {
            key: "churn",
            index: 14,
            typeId: "minecraft:clock",
            name: "§65. Пакетирование записей",
            run: () => openWithHolder({ player, scenario: "churn", size: 27, Screen: ChurnTest }),
        }),
        h(HubEntry, {
            key: "router",
            index: 16,
            typeId: "minecraft:compass",
            name: "§37. Роутер в одной поверхности",
            run: () => openWithHolder({ player, scenario: "router", size: 27, Screen: RouterTest }),
        }),
        h(HubEntry, {
            key: "reveal",
            index: 9,
            typeId: "minecraft:firework_rocket",
            name: "§58. Анимация появления",
            run: () => openWithReport({ player, scenario: "reveal", size: 54, render: () => h(RevealTest, { player }) }),
        }),
        h(HubEntry, {
            key: "tiny",
            index: 15,
            typeId: "minecraft:comparator",
            name: "§76. Малые размеры 1/5/9",
            run: () => openTinySizes(player),
        }),
        h(HubEntry, {
            key: "form",
            index: 18,
            typeId: "minecraft:writable_book",
            name: "§e9. ContainerFormData",
            run: () => openFormDemo(player),
        }),
        h(HubEntry, {
            key: "auction",
            index: 19,
            typeId: "minecraft:gold_ingot",
            name: "§610. Аукцион: цена в показе, не в предмете",
            run: () => openAuctionDemo(player),
        }),
        h(HubEntry, {
            key: "enchant",
            index: 20,
            typeId: "minecraft:enchanted_book",
            name: "§d11. Чары и прочность",
            run: () => openWithHolder({ player, scenario: "enchant", size: 27, Screen: EnchantTest }),
        }),
        h(HubEntry, {
            key: "bench",
            index: 21,
            typeId: "minecraft:spyglass",
            name: "§e12. Замер чтения слотов",
            run: () => openWithHolder({ player, scenario: "bench", size: 27, Screen: BenchTest }),
        }),
        h(HubEntry, {
            key: "modal",
            index: 22,
            typeId: "minecraft:lime_dye",
            name: "§a13. Modal и Suspense",
            run: () => openWithHolder({ player, scenario: "modal", size: 27, Screen: ModalTest }),
        }),
        h(HubEntry, {
            key: "shop",
            index: 23,
            typeId: "minecraft:emerald_block",
            name: "§b14. Магазин: страницы, количество, баланс",
            run: () => {
                prepareShopCoins(player);
                return openWithReport({ player, scenario: "shop", size: 54, render: () => h(ShopTest, { player }) });
            },
        }),
        h(HubEntry, {
            key: "potions",
            index: 25,
            typeId: "minecraft:potion",
            name: "§d16. Зелья и стрелы с эффектом",
            run: () => openWithReport({ player, scenario: "potions", size: 27, render: () => h(PotionTest, { player }) }),
        }),
        h(HubEntry, {
            key: "consume",
            index: 24,
            typeId: "minecraft:lava_bucket",
            name: "§c15. Продажа и мусорка",
            run: () => openWithReport({ player, scenario: "consume", size: 27, render: () => h(ConsumeTest, { player }) }),
        }),

        h(HubEntry, {
            key: "glass",
            index: 26,
            typeId: "containerui:flat_glass_light_blue",
            name: "§b17. Плоское стекло",
            run: () => openWithReport({ player, scenario: "glass", size: 27, render: () => h(GlassTest, { player }) }),
        }),

        // Row 1 (9..17) is full and row 2 (18..26) holds the later entries; each index is used once.
        h("slot", {
            index: 17,
            item: () => ({
                typeId: "minecraft:nether_star",
                name: `§fКликов за сессию: §e${globalClicks.value}`,
                lore: ["§8общий сигнал между всеми меню"],
            }),
        }),

        h(Divider, { index: 27 }),
    );
};

/** Opens the hub for a player. */
export const openHub = (player) => {
    openWithReport({ player, scenario: "hub", size: 36, render: () => h(Hub, { player }) });
};

setBackTarget(openHub);
