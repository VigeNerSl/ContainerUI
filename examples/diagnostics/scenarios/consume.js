/**
 * Scenario 15: consuming what a player puts in. A sell slot is a controlled input over a signal: the
 * sell button empties it (`action=sold`), and closing without selling gives the item back
 * (`close-returned … to=player`, after `action=offered-at-close`). A trash slot is an uncontrolled
 * input that calls `clear()` as soon as something lands in it (`action=trashed`).
 */

import { h, onUnmount, useSignal } from "../ContainerUI/ContainerFormData.js";
import { note } from "../support/report.js";
import { BackButton, CloseButton, Divider } from "../support/ui.js";

const describe = (item) => (item ? `${item.typeId.replace("minecraft:", "")}x${item.amount ?? 1}` : "empty");

export const ConsumeTest = (props) => {
    const offered = useSignal(null);

    onUnmount(() => note("consume", { action: "offered-at-close", item: describe(offered.peek()) }));

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),

        h("slot", {
            index: 10,
            item: { typeId: "minecraft:oak_sign", name: "§fПродажа →", lore: ["§7положи предмет справа", "§7закрой меню — он вернётся"] },
        }),
        h("input", {
            index: 11,
            item: () => offered.value,
            onChange: (vigenersl) => {
                offered.value = vigenersl.next;
                note("consume", { action: "offer", from: describe(vigenersl.previous), to: describe(vigenersl.next) });
            },
        }),
        h("slot", {
            index: 12,
            item: () => ({ typeId: "minecraft:emerald", name: offered.value ? `§aПродать ${describe(offered.value)}` : "§7Продавать нечего" }),
            sound: "random.orb",
            onClick: () => {
                const item = offered.peek();
                if (!item) {
                    note("consume", { action: "sell-empty" });
                    return;
                }
                offered.value = null;
                note("consume", { action: "sold", item: describe(item) });
            },
        }),

        h("slot", {
            index: 14,
            item: { typeId: "minecraft:oak_sign", name: "§fМусорка →", lore: ["§7всё, что сюда положишь, исчезнет"] },
        }),
        h("input", {
            index: 15,
            onPlace: (vigenersl) => {
                note("consume", { action: "trashed", item: describe(vigenersl.next) });
                vigenersl.clear();
            },
        }),

        h(Divider, { index: 18, except: [22, 26] }),
        h(BackButton, { index: 22, player: props.player }),
        h(CloseButton, { index: 26 }),
    );
};
