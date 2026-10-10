/**
 * Scenario 8: a staggered reveal and a tween. An animation only moves a signal, so a 45-slot
 * reveal should cost about 45 writes in total (`writes` in the closing record), not 45 a frame.
 */

import { h, useEffect, useReveal, useSignal, useTween } from "../ContainerUI/ContainerFormData.js";
import { log } from "../support/report.js";
import { BackButton } from "../support/ui.js";

const REVEAL_ORDERS = ["sweep", "wave", "spiral", "center-out", "columns", "random"];

const REVEAL_TILES = [
    "minecraft:red_stained_glass_pane",
    "minecraft:orange_stained_glass_pane",
    "minecraft:yellow_stained_glass_pane",
    "minecraft:lime_stained_glass_pane",
    "minecraft:light_blue_stained_glass_pane",
    "minecraft:purple_stained_glass_pane",
];

export const RevealTest = (props) => {
    const order = useSignal(REVEAL_ORDERS[0]);
    const size = 45;

    // `.value`, not `.peek()`: the component must re-render when the order changes.
    const reveal = useReveal({ size, order: order.value, stepTicks: 1 });

    // A stack filling from 1 to 64 over two seconds: an item as a progress bar.
    const filled = useTween({ from: 1, to: 64, durationTicks: 40, round: true });

    useEffect(() => {
        log("info", { event: "reveal-start", order: order.peek(), size });
        return () => log("info", { event: "reveal-end", order: order.peek() });
    }, []);

    return h(
        "box",
        null,
        h(
            "grid",
            { index: 0, columns: 9 },
            Array.from({ length: size }, (unused, index) =>
                h("slot", {
                    key: index,
                    // Read inside the item function, so only newly revealed slots are written.
                    item: () =>
                        reveal.isVisible(index)
                            ? { typeId: REVEAL_TILES[Math.floor(index / 9) % REVEAL_TILES.length], name: `§7${index}` }
                            : null,
                }),
            ),
        ),

        h("slot", {
            index: 45,
            item: () => ({
                typeId: "minecraft:emerald",
                amount: Math.max(1, filled.value),
                name: `§aТвин: §f${filled.value}§7/64`,
            }),
        }),

        h("slot", {
            index: 47,
            item: () => ({ typeId: "minecraft:redstone", name: `§cПовторить: §f${order.value}` }),
            onClick: () => {
                log("info", { event: "reveal-replay", order: order.peek() });
                reveal.restart();
            },
        }),

        h("slot", {
            index: 49,
            item: { typeId: "minecraft:ender_eye", name: "§dСледующий порядок" },
            onClick: () => {
                const current = order.peek();
                const next = REVEAL_ORDERS[(REVEAL_ORDERS.indexOf(current) + 1) % REVEAL_ORDERS.length];
                log("info", { event: "reveal-order", from: current, to: next });
                order.value = next;
            },
        }),

        h("slot", {
            index: 51,
            item: { typeId: "minecraft:barrier", name: "§8Показать всё сразу" },
            onClick: () => {
                log("info", { event: "reveal-finish", order: order.peek() });
                reveal.finish();
            },
        }),

        h(BackButton, { index: 53, player: props.player }),
    );
};
