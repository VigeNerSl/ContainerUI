/** Pieces the diagnostic screens share. */

import { system } from "@minecraft/server";
import { h, signal } from "../ContainerUI/ContainerFormData.js";

export const PANE = { typeId: "minecraft:light_blue_stained_glass_pane", name: " " };

/** Clicks across every open menu: one signal shared by all surfaces. */
export const globalClicks = signal(0);

/** @type {(player: unknown) => void} */
let openBackTarget = () => undefined;

/** Sets what `BackButton` opens. The hub registers itself. */
export const setBackTarget = (open) => {
    openBackTarget = open;
};

/**
 * A row of nine panes from `index`. Indices in `except` stay free for a control; each pane is
 * pinned, so a gap does not shift the rest.
 */
export const Divider = (props) => {
    const except = props.except ?? [];
    return h(
        "box",
        { index: props.index },
        Array.from({ length: 9 }, (unused, offset) => props.index + offset)
            .filter((slotIndex) => !except.includes(slotIndex))
            .map((slotIndex) => h("slot", { key: slotIndex, index: slotIndex, item: PANE })),
    );
};

/** Closes the menu and opens the hub again. */
export const BackButton = (props) =>
    h("slot", {
        index: props.index,
        item: { typeId: "minecraft:arrow", name: "§e← Назад в меню" },
        onClick: (vigenersl) => {
            vigenersl.close();
            system.runTimeout(() => openBackTarget(props.player), 6);
        },
    });

export const CloseButton = (props) =>
    h("slot", {
        index: props.index,
        item: { typeId: "minecraft:barrier", name: "§cЗакрыть" },
        onClick: (vigenersl) => vigenersl.close(),
    });
