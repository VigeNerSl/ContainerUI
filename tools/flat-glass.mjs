/**
 * The flat glass blocks of the shared ContainerUI packs: seventeen blocks (`containerui:flat_glass`
 * and one per dye colour) that a menu slot shows as a seamless tile instead of a cube, with their
 * model, textures and names. The textures are the 16×16 PNGs in `tools/glass-textures/`.
 */

import { readFileSync } from "node:fs";
import { writeJsonOutput, writeOutput } from "./files.mjs";

const NAMESPACE = "containerui";
const GEOMETRY = "geometry.containerui_flat";

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

/** `containerui:flat_glass`, then `containerui:flat_glass_<colour>`: the name without a namespace. */
const SHAPES = [{ name: "flat_glass", label: "Flat glass" }].concat(
    COLORS.map((colour) => ({ name: `flat_glass_${colour}`, label: `Flat ${colour.replace("_", " ")} glass` })),
);

const buildBlock = ({ name }) => ({
    format_version: "1.21.0",
    "minecraft:block": {
        description: {
            identifier: `${NAMESPACE}:${name}`,
            menu_category: { category: "none" },
        },
        components: {
            "minecraft:geometry": { identifier: GEOMETRY },
            "minecraft:material_instances": {
                "*": { texture: `${NAMESPACE}_${name}`, render_method: "blend" },
            },
            "minecraft:collision_box": false,
        },
    },
});

/** A zero-thickness square a little larger than its slot, so neighbouring tiles leave no seam. */
const buildGeometry = () => ({
    format_version: "1.21.0",
    "minecraft:geometry": [
        {
            description: { identifier: GEOMETRY, texture_width: 16, texture_height: 16 },
            bones: [
                {
                    name: "flat_plane",
                    pivot: [0, 8, 0],
                    rotation: [0, 0, 0],
                    cubes: [{ origin: [-8, 0, 0], size: [16, 16, 0], uv: [0, 0], inflate: 1.2 }],
                },
            ],
            item_display_transforms: {
                gui: { rotation: [0, 180, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
            },
        },
    ],
});

/** How many flat glass blocks `writeFlatGlass` writes. */
export const FLAT_GLASS_COUNT = SHAPES.length;

/** Writes the blocks into `root/BP` and their model, textures and names into `root/RP`. */
export const writeFlatGlass = ({ root }) => {
    const write = (relativePath, value) => writeJsonOutput({ root, relativePath, value });

    for (const shape of SHAPES) write(`BP/blocks/${shape.name}.json`, buildBlock(shape));

    write("RP/models/blocks/geometry.containerui_flat.json", buildGeometry());
    write("RP/textures/terrain_texture.json", {
        resource_pack_name: "containerui",
        texture_name: "atlas.terrain",
        padding: 8,
        num_mip_levels: 4,
        texture_data: Object.fromEntries(
            SHAPES.map(({ name }) => [`${NAMESPACE}_${name}`, { textures: `textures/blocks/${NAMESPACE}_${name}` }]),
        ),
    });
    for (const { name } of SHAPES) {
        writeOutput({
            root,
            relativePath: `RP/textures/blocks/${NAMESPACE}_${name}.png`,
            contents: readFileSync(new URL(`./glass-textures/${name}.png`, import.meta.url)),
        });
    }
    write("RP/texts/languages.json", ["en_US"]);
    writeOutput({
        root,
        relativePath: "RP/texts/en_US.lang",
        contents: `${SHAPES.map(({ name, label }) => `tile.${NAMESPACE}:${name}.name=${label}`).join("\n")}\n`,
    });
};
