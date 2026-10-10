/**
 * Scenario 17: the flat glass tiles of the shared ContainerUI packs. All seventeen are laid out
 * as a seamless backdrop, with the vanilla pane beside them to compare. A tile that shows as a
 * cube, a 3D pane or a missing-texture slot means the ContainerUI packs are not active.
 */

import { h } from "../ContainerUI/ContainerFormData.js";
import { BackButton, CloseButton } from "../support/ui.js";

const COLORS = [
    "white",
    "orange",
    "magenta",
    "light_blue",
    "yellow",
    "lime",
    "pink",
    "gray",
    "light_gray",
    "cyan",
    "purple",
    "blue",
    "brown",
    "green",
    "red",
    "black",
];

const TILES = ["containerui:flat_glass", ...COLORS.map((color) => `containerui:flat_glass_${color}`)];

export const GlassTest = (props) =>
    h(
        "box",
        null,
        TILES.map((typeId, tileIndex) =>
            h("slot", {
                key: typeId,
                index: tileIndex,
                item: { typeId, name: typeId.replace("containerui:", "") },
            }),
        ),
        h("slot", {
            index: 18,
            item: { typeId: "minecraft:light_blue_stained_glass_pane", name: "vanilla pane, for comparison" },
        }),
        h(BackButton, { index: 25, player: props.player }),
        h(CloseButton, { index: 26 }),
    );
