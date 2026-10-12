/**
 * Generates the shared ContainerUI packs: a behaviour pack with the surface and storage entities,
 * and a resource pack with the JSON UI that picks a grid by title prefix. Neither holds a script.
 * A world installs them once, and every add-on that bundles the library depends on them by the
 * UUIDs below, which never change. Sizes and prefixes come from the compiled runtime, so the packs
 * follow `SUPPORTED_SIZES`, and the pack version follows `package.json`.
 *
 * Usage: node tools/generate-pack.mjs [outputRoot]
 *
 * Environment: CUI_MIN_ENGINE and CUI_FORMAT_VERSION override the engine and entity schema
 * versions.
 */

import {
    SIZE_TITLE_PREFIX,
    STORAGE_ENTITY_TYPE_ID,
    SUPPORTED_SIZES,
    SURFACE_ENTITY_TYPE_ID,
    containerGroupFor,
    openEventFor,
} from "../dist/platform/constants.js";
import { readFileSync } from "node:fs";
import { writeJsonOutput, writeOutput } from "./files.mjs";
import { FLAT_GLASS_COUNT, writeFlatGlass } from "./flat-glass.mjs";
import { COPYRIGHT, PACK_VERSION, REPOSITORY_URL, buildManifest } from "./pack-manifest.mjs";

const OUTPUT_ROOT = process.argv[2] ?? "pack";

/** Screen height per size, below the size at which a scrolling grid takes over. */
const SCREEN_HEIGHTS = { 1: 130, 5: 130, 9: 130, 18: 150, 27: 166, 36: 184, 45: 202, 54: 222 };
const SCROLLING_HEIGHT = 222;
const SCROLL_FROM_SIZE = 63;

const GRID_COLUMNS = 9;
const SLOT_PIXELS = 18;

// The identity of the shared packs. Add-ons name these UUIDs in their manifests, so they must never
// change once a release has gone out.
const BEHAVIOUR_PACK_UUID = "2d2c35a3-017c-42cd-a910-9c64d55bcc25";
const BEHAVIOUR_MODULE_UUID = "c59666b4-dbef-4bd3-908d-2c558efa8759";
const RESOURCE_PACK_UUID = "5d3a0ae4-d90d-4d25-8a23-80bc25f83ad7";
const RESOURCE_MODULE_UUID = "fe10bca0-4df1-48e5-b39f-fbe6d8686f7e";

const ENTITY_FORMAT_VERSION = process.env.CUI_FORMAT_VERSION ?? "1.26.20";

const DEFAULT_SIZE = SUPPORTED_SIZES.includes(27) ? 27 : SUPPORTED_SIZES[0];

const write = (relativePath, value) => writeJsonOutput({ root: OUTPUT_ROOT, relativePath, value });

const PACK_ICON = readFileSync(new URL("../assets/avatar.png", import.meta.url));
const LICENSE_TEXT = readFileSync(new URL("../LICENSE", import.meta.url));
const REPOSITORY_LABEL = REPOSITORY_URL.replace(/^https:\/\//, "");
const BEHAVIOUR_DESCRIPTION = "§7Shared by every add-on built on ContainerUI: the menu and storage entities and the flat glass blocks. No scripts.";
const RESOURCE_DESCRIPTION = "§7Shared by every add-on built on ContainerUI: the container screen layouts, hover text on touch and the flat glass textures.";
// The pack version, not the library's: add-ons built on different library versions share these packs,
// and a release that leaves them alone must build them byte for byte the same.
const SETTINGS_TEXT = [
    `§aContainerUI packs §f${PACK_VERSION.join(".")}`,
    "§7The menu and storage entities, the screen layouts and the flat glass blocks every ContainerUI add-on shares.",
    "",
    `§7GitHub: ${REPOSITORY_LABEL}`,
    "",
    "§fLicense: §aMIT",
    `§7${COPYRIGHT}`,
    "",
    "§7NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.",
].join("\n");

/**
 * The inventory of one size. `isSiphonable` lets hoppers pull from it: a block's storage behaves like
 * a chest, a menu never does, since its slots hold rendered copies and mirrors of real items.
 */
const inventoryComponents = (size, { isSiphonable }) => ({
    "minecraft:inventory": {
        inventory_size: size,
        container_type: "inventory",
        can_be_siphoned_from: isSiphonable,
        additional_slots_per_strength: 0,
    },
    // Mirrors the size onto a queryable property, for debugging in game.
    "minecraft:mark_variant": { value: size },
});

/**
 * An entity with an inventory group and an open event per supported size. Each event removes
 * every other size first, so switching sizes replaces the inventory rather than adding one.
 */
const buildEntity = ({ identifier, isSiphonable, components }) => ({
    format_version: ENTITY_FORMAT_VERSION,
    "minecraft:entity": {
        description: {
            identifier,
            is_spawnable: false,
            is_summonable: true,
            is_experimental: false,
        },
        component_groups: Object.fromEntries(SUPPORTED_SIZES.map((size) => [containerGroupFor(size), inventoryComponents(size, { isSiphonable })])),
        components,
        events: Object.fromEntries(
            SUPPORTED_SIZES.map((size) => [
                openEventFor(size),
                {
                    remove: { component_groups: SUPPORTED_SIZES.filter((other) => other !== size).map(containerGroupFor) },
                    add: { component_groups: [containerGroupFor(size)] },
                },
            ]),
        ),
    },
});

/** The rideable surface entity whose inventory a menu shows. */
const buildSurfaceEntity = () =>
    buildEntity({
        identifier: SURFACE_ENTITY_TYPE_ID,
        isSiphonable: false,
        components: {
            "minecraft:type_family": { family: ["container_entity"] },
            "minecraft:nameable": { always_show: false, allow_name_tag_renaming: false },
            // Point-sized and weightless: never an obstacle, never falling out of the world.
            "minecraft:collision_box": { width: 0.001, height: 0.001 },
            "minecraft:physics": { has_gravity: false, has_collision: false },
            "minecraft:health": { value: 1, max: 1 },
            // `deals_damage` is a string in the 1.26.20 schema; a boolean fails the entity.
            "minecraft:damage_sensor": {
                triggers: [{ cause: "all", deals_damage: "no" }],
            },
            // No push component: `minecraft:pushable` is not in the 1.26.20 schema, and
            // `pushable_by_block` / `pushable_by_entity` allow pushing when present.
            "minecraft:knockback_resistance": { value: 1 },
            ...inventoryComponents(DEFAULT_SIZE, { isSiphonable: false }),
            "minecraft:rideable": {
                seat_count: 1,
                family_types: ["player"],
                seats: [{ position: [0, 0, 0] }],
            },
        },
    });

/**
 * A block's storage entity. Its inventory is the stored state, persisted by the engine. It is
 * block-sized so it takes the player's click, has no `minecraft:interact`, which would stop the
 * engine opening the inventory, and is persistent so an unloaded chunk keeps its contents.
 */
const buildStorageEntity = () =>
    buildEntity({
        identifier: STORAGE_ENTITY_TYPE_ID,
        isSiphonable: true,
        components: {
            "minecraft:type_family": { family: ["container_entity", "block_storage"] },
            "minecraft:nameable": { always_show: false, allow_name_tag_renaming: false },
            "minecraft:collision_box": { width: 1, height: 1 },
            "minecraft:physics": { has_gravity: false, has_collision: false },
            "minecraft:health": { value: 32767, max: 32767 },
            "minecraft:damage_sensor": {
                triggers: [{ cause: "all", deals_damage: "no" }],
            },
            // No push component, as on the surface entity.
            "minecraft:knockback_resistance": { value: 1 },
            "minecraft:persistent": {},
            ...inventoryComponents(DEFAULT_SIZE, { isSiphonable: true }),
        },
    });

/** The chest screen, switched to a size's layout by the title prefix. */
const buildChestScreen = () => {
    const modifications = SUPPORTED_SIZES.map((size) => {
        const prefix = SIZE_TITLE_PREFIX[size];
        if (!prefix) throw new Error(`No title prefix registered for size ${size}.`);

        const isScrolling = size >= SCROLL_FROM_SIZE;
        const variables = isScrolling
            ? {
                  requires: `(('%.6s' * $temp_container_title) = '${prefix}')`,
                  $screen_content: "container.scroll_container_root_panel",
                  $screen_bg_content: "common.screen_background",
                  $chest_grid: `container.container_${size}_grid`,
                  $container_size: size,
                  $root_panel: "container.scroll_container_root_panel",
                  $root_size: [176, SCROLLING_HEIGHT],
              }
            : {
                  requires: `(('%.6s' * $temp_container_title) = '${prefix}')`,
                  $screen_content: "container.container_root_panel",
                  $screen_bg_content: "common.screen_background",
                  $chest_panel: `container.container_${size}_panel_top_half`,
                  $container_size: size,
                  $root_size: [176, SCREEN_HEIGHTS[size] ?? SCROLLING_HEIGHT],
              };

        // insert_back keeps the vanilla definitions, so the pack composes with other add-ons.
        return { array_name: "variables", operation: "insert_back", value: [variables] };
    });

    return {
        namespace: "chest",
        small_chest_screen: {
            "$temp_container_title|default": "$container_title",
            modifications,
        },
    };
};

/**
 * Shows a hovered slot's highlight and hover text with touch input as well as with a mouse. Vanilla
 * binds them to `#show_persistent_bundle_hover_text` alone, and touch never shows them; a tap on a
 * menu button is a click, so without them its name and lore never show on a phone.
 */
const TOUCH_HOVER = {
    modifications: [
        { array_name: "bindings", operation: "remove", where: { binding_name: "#show_persistent_bundle_hover_text" } },
        {
            array_name: "bindings",
            operation: "insert_back",
            value: [
                { binding_name: "#show_persistent_bundle_hover_text" },
                { binding_name: "#using_touch" },
                { binding_type: "view", source_property_name: "(#show_persistent_bundle_hover_text or #using_touch)", target_property_name: "#visible" },
            ],
        },
    ],
};

/**
 * Makes container screens read a slot the way a computer does, on touch too: hovering a slot shows
 * its hover text, and a scrolling grid has the mouse scrollbar. The file sits at the vanilla path, so
 * it merges into the `common` namespace of every screen, vanilla chests and the inventory included.
 */
const buildCommonTouch = () => ({
    namespace: "common",
    "highlight_slot_panel/highlight": TOUCH_HOVER,
    "highlight_slot_panel/white_border": TOUCH_HOVER,
    // The held item's hover text and the item details panel repeat the hovered slot's hover text under
    // the finger, and the selected slot frame marks a slot the highlight already marks.
    "inventory_icon_panel/hover_text": { ignored: true },
    slot_selected: { ignored: true },
    "selected_item_details/item_panel_image": { visible: false },
    // Only container screens use this panel. Under it the mouse scrollbar replaces the touch one, which
    // is wider and drawn as a full-height box, and a swipe over the grid moves the hover instead of
    // scrolling.
    container_scroll_panel: { $touch: false },
});

/** The `container` namespace the chest screen references: a label, a grid and a top half per size, and two root panels. */
const buildContainerNamespace = () => {
    const namespace = {
        namespace: "container",
        container_label: {
            type: "label",
            color: [0.25, 0.25, 0.25],
            anchor_from: "top_left",
            anchor_to: "top_left",
            offset: [1, 0],
            "$new_container_title|default": "$container_title",
            text: "$new_container_title",
        },
    };

    for (const size of SUPPORTED_SIZES) {
        const columns = Math.min(size, GRID_COLUMNS);
        const rows = Math.ceil(size / GRID_COLUMNS);
        const horizontalOffset = Math.floor((GRID_COLUMNS - columns) / 2) * SLOT_PIXELS;
        namespace[`container_${size}_grid`] = {
            type: "grid",
            anchor_from: "top_left",
            anchor_to: "top_left",
            grid_item_template: "chest.chest_grid_item",
            collection_name: "container_items",
            grid_dimensions: [columns, rows],
            size: [columns * SLOT_PIXELS, rows * SLOT_PIXELS],
        };
        namespace[`container_${size}_panel_top_half`] = {
            type: "panel",
            anchor_from: "top_left",
            anchor_to: "top_left",
            size: ["100%", "100%c"],
            controls: [
                { "container_label@container.container_label": {} },
                { [`grid@container.container_${size}_grid`]: { offset: [horizontalOffset, 14] } },
            ],
        };
    }

    const playerInventory = [
        { "inventory_panel_bottom_half_with_label@common.inventory_panel_bottom_half_with_label": {} },
        { "hotbar_grid@common.hotbar_grid_template": {} },
        { "inventory_take_progress_icon_button@common.inventory_take_progress_icon_button": {} },
    ];
    const cursorControls = [
        { "inventory_selected_icon_button@common.inventory_selected_icon_button": {} },
        { "gamepad_cursor@common.gamepad_cursor_button": {} },
    ];

    namespace["scroll_container_root_panel@common.root_panel"] = {
        size: "$root_size",
        "$root_size|default": [176, SCROLLING_HEIGHT],
        layer: 1,
        controls: [
            { "common_panel@common.common_panel": { $show_close_button: true, $close_button_visible: true } },
            {
                "scrollbar_bg@common.common_panel": {
                    size: [16, 124],
                    anchor_from: "top_left",
                    anchor_to: "top_left",
                    offset: [176, 14],
                    layer: 1,
                    $show_close_button: false,
                    $close_button_visible: false,
                },
            },
            {
                chest_panel: {
                    type: "panel",
                    layer: 5,
                    controls: [
                        { "container_label@container.container_label": { offset: [7, 7] } },
                        {
                            "scrolling_content@common.container_scroll_panel": {
                                offset: [6, 21],
                                anchor_from: "top_left",
                                anchor_to: "top_left",
                                size: [181, 110],
                                $show_background: false,
                                $scrolling_content: "$chest_grid",
                                $scroll_track_offset: [-1, 0],
                                $scrolling_content_anchor_from: "top_left",
                                $scrolling_content_anchor_to: "top_left",
                            },
                        },
                        ...playerInventory,
                    ],
                },
            },
            ...cursorControls,
        ],
    };
    namespace["container_root_panel@common.root_panel"] = {
        size: "$root_size",
        "$root_size|default": [176, 160],
        layer: 1,
        controls: [
            { "common_panel@common.common_panel": {} },
            {
                chest_panel: {
                    type: "panel",
                    layer: 5,
                    controls: [{ "panel_top_half@$chest_panel": { offset: [7, 7], anchor_from: "top_left", anchor_to: "top_left" } }, ...playerInventory],
                },
            },
            ...cursorControls,
        ],
    };
    return namespace;
};

/** The touch layout's chest panel, sized by the same title prefix. */
const buildPocketContainers = () => ({
    namespace: "pocket_containers",
    "small_chest_panel@pocket_containers.panel": {
        "$temp_container_title|default": "$container_title",
        $container_size: 27,
        variables: SUPPORTED_SIZES.map((size) => ({
            requires: `(('%.6s' * $temp_container_title) = '${SIZE_TITLE_PREFIX[size]}')`,
            $container_size: size,
        })),
    },
});

/**
 * Checks that every `container.*` control the chest screen or the namespace itself names is defined.
 *
 * @throws {Error} When either file names a `container.*` control that `ui/container.json` does not define.
 */
const assertScreenResolves = ({ chestScreen, containerNamespace }) => {
    const defined = new Set(Object.keys(containerNamespace).map((key) => key.split("@")[0]));
    const files = { "chest_screen.json": chestScreen, "ui/container.json": containerNamespace };
    const dangling = Object.entries(files)
        .flatMap(([file, value]) => [...JSON.stringify(value).matchAll(/container\.(\w+)/g)].map(([reference, name]) => ({ file, reference, name })))
        .find(({ name }) => !defined.has(name));
    if (!dangling) return;
    throw new Error(`${dangling.file} names ${dangling.reference}, which ui/container.json does not define.`);
};

console.log(`\n  generating pack assets into ${OUTPUT_ROOT}/\n`);

write(
    "BP/manifest.json",
    buildManifest({
        name: "§aContainerUI §7BP",
        description: `${BEHAVIOUR_DESCRIPTION}\n§8${REPOSITORY_LABEL}`,
        uuid: BEHAVIOUR_PACK_UUID,
        moduleUuid: BEHAVIOUR_MODULE_UUID,
        type: "data",
        dependencies: [{ uuid: RESOURCE_PACK_UUID, version: PACK_VERSION }],
        settings: [{ type: "label", text: SETTINGS_TEXT }],
    }),
);
write("BP/entities/rideable_entity.json", buildSurfaceEntity());
write("BP/entities/block_storage_entity.json", buildStorageEntity());

write(
    "RP/manifest.json",
    buildManifest({
        name: "§aContainerUI §7RP",
        description: `${RESOURCE_DESCRIPTION}\n§8${REPOSITORY_LABEL}`,
        uuid: RESOURCE_PACK_UUID,
        moduleUuid: RESOURCE_MODULE_UUID,
        type: "resources",
    }),
);
const chestScreen = buildChestScreen();
const containerNamespace = buildContainerNamespace();
assertScreenResolves({ chestScreen, containerNamespace });
// chest_screen.json, pocket_containers.json and ui_common.json sit at vanilla paths and merge into
// the vanilla files, so only the new file is listed.
write("RP/ui/_ui_defs.json", { ui_defs: ["ui/container.json"] });
write("RP/ui/container.json", containerNamespace);
write("RP/ui/chest_screen.json", chestScreen);
write("RP/ui/pocket_containers.json", buildPocketContainers());
write("RP/ui/ui_common.json", buildCommonTouch());
writeFlatGlass({ root: OUTPUT_ROOT });
writeOutput({ root: OUTPUT_ROOT, relativePath: "BP/pack_icon.png", contents: PACK_ICON });
writeOutput({ root: OUTPUT_ROOT, relativePath: "RP/pack_icon.png", contents: PACK_ICON });
writeOutput({ root: OUTPUT_ROOT, relativePath: "BP/LICENSE", contents: LICENSE_TEXT });
writeOutput({ root: OUTPUT_ROOT, relativePath: "RP/LICENSE", contents: LICENSE_TEXT });

console.log(
    `\n  ${SUPPORTED_SIZES.length} sizes generated: ${SUPPORTED_SIZES.join(", ")}\n` +
        `  sizes from ${SCROLL_FROM_SIZE} up use the scrolling grid.\n` +
        `  ${FLAT_GLASS_COUNT} flat glass blocks.\n`,
);
