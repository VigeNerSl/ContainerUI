/**
 * Assembles the test world's packs the way a real add-on author ships them: the shared ContainerUI
 * packs under `ContainerUI/` and the diagnostic add-on in `BP` and `RP` (the vendored runtime, the
 * scripts from `examples/diagnostics`, two demo blocks with their textures and names), which
 * depends on the shared packs instead of carrying the entities itself.
 *
 * Usage: node tools/build-test-pack.mjs [outputRoot]
 *
 * Environment: CUI_MODULE_VERSION pins `@minecraft/server` (default 2.9.0, or `beta`), and
 * CUI_UI_MODULE_VERSION pins `@minecraft/server-ui` (default: `beta` with `beta`, else 2.1.0).
 */

import { cpSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeJsonOutput, writeOutput } from "./files.mjs";
import { encodePng } from "./png.mjs";

const OUTPUT_ROOT = process.argv[2] ?? "testpack";
const DIAGNOSTICS_ROOT = "examples/diagnostics";
const SHARED_ROOT = join(OUTPUT_ROOT, "ContainerUI");

const SCRIPT_MODULE_VERSION = process.env.CUI_MODULE_VERSION ?? "2.9.0";
const UI_MODULE_VERSION = process.env.CUI_UI_MODULE_VERSION ?? (SCRIPT_MODULE_VERSION === "beta" ? "beta" : "2.1.0");

// The diagnostic add-on has identities of its own, apart from the shared packs it depends on.
const DIAGNOSTICS_BEHAVIOUR_UUID = "6d48a2df-e64f-464a-b73a-2671f4ee44b7";
const DIAGNOSTICS_BEHAVIOUR_MODULE_UUID = "d14d647d-3fa5-4e09-8ca8-e39817d479cb";
const DIAGNOSTICS_RESOURCE_UUID = "9d9b414e-ffa7-4dc6-b11f-e3970653b23a";
const DIAGNOSTICS_RESOURCE_MODULE_UUID = "8ba9b87b-899d-4473-a0de-23d2cf35c4eb";

/** 16×16 crate texture. */
const CRATE_TEXTURE_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA4klEQVR42qVTIQ6DQBAcCMGcABJQVU0lfQUvwPULNTXoyuqaGr5Q18dgSRWOBBBnMFQt2TvuaBs2IVyYmcvsLOtkaTJhQ3kAcH088bqf/xLmRYnb5QQnS5PpuI9w2EUAgLrpVoWcV707uDbCmnjRAgC0vUQcipnY9lIhEkZcKsUBB7jAJlYcDHKc32SVC235uKZeTURbuLODQPir6es4OTY60K3bvikXDHLEIEeFWDedYj0OxcwzZsDnzIX8rP8Lrgloe4lA+MrDx8e5iwz0OX/DPFqMX5eJ+s+LEhUt05Z1/gDz0mGsfBDviAAAAABJRU5ErkJggg==";

const writeJson = (relativePath, value) => writeJsonOutput({ root: OUTPUT_ROOT, relativePath, value });
const writeFile = (relativePath, contents) => writeOutput({ root: OUTPUT_ROOT, relativePath, contents });

/**
 * A full block bound to the custom component of the same name, which the diagnostic script
 * registers. `minecraft:geometry.full_block` is built in, so the block needs only a texture.
 */
const buildContainerBlock = ({ identifier, texture, mapColor }) => ({
    format_version: "1.21.100",
    "minecraft:block": {
        description: {
            identifier,
            menu_category: { category: "items" },
        },
        components: {
            // Named by the lang key `tile.<identifier>.name`.
            "minecraft:geometry": "minecraft:geometry.full_block",
            "minecraft:material_instances": {
                "*": { texture, render_method: "opaque" },
            },
            "minecraft:destructible_by_mining": { seconds_to_destroy: 0.8 },
            "minecraft:destructible_by_explosion": { explosion_resistance: 10 },
            "minecraft:map_color": mapColor,
            [identifier]: {},
        },
    },
});

/** A steel face with a dark rim and a cyan screen, unlike the crate at a glance. */
const machineColorAt = (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [58, 60, 68];
    if (x >= 4 && x <= 11 && y >= 4 && y <= 9) return x === 4 || x === 11 || y === 4 || y === 9 ? [30, 34, 40] : [70, 200, 220];
    if (y === 12 && (x === 4 || x === 7 || x === 10)) return [210, 70, 60];
    return (x + y) % 5 === 0 ? [150, 152, 160] : [132, 134, 144];
};

/** Aux values the arrow survey covers: the catalog stops at 43, the engine registers 47 effects. */
const ARROW_AUX_VALUES = Array.from({ length: 48 }, (unused, aux) => aux);

/**
 * Loot tables that build a tipped arrow, which `Potions.resolve` cannot: one with the modern
 * `set_potion` function, one with the legacy `set_data` aux value, and one per aux value for the
 * survey that maps a number to the effect the client names. Scenario 16 rolls them.
 */
const writeLootTables = () => {
    const arrowEntry = (functions) => ({
        pools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:arrow", weight: 1, functions }] }],
    });

    writeJson(
        "BP/loot_tables/containerui/tipped_arrow_set_potion.json",
        arrowEntry([
            { function: "set_potion", id: "minecraft:fire_resistance" },
            { function: "set_count", count: 3 },
        ]),
    );
    writeJson(
        "BP/loot_tables/containerui/tipped_arrow_set_data.json",
        arrowEntry([
            { function: "set_data", data: 14 },
            { function: "set_count", count: 3 },
        ]),
    );

    for (const aux of ARROW_AUX_VALUES) {
        writeJson(`BP/loot_tables/containerui/arrow_aux_${aux}.json`, arrowEntry([{ function: "set_data", data: aux }]));
    }
};

const writeBlockAssets = () => {
    writeJson("BP/blocks/crate.json", buildContainerBlock({ identifier: "containerui:crate", texture: "containerui_crate", mapColor: "#7d572c" }));
    writeJson("BP/blocks/machine.json", buildContainerBlock({ identifier: "containerui:machine", texture: "containerui_machine", mapColor: "#848690" }));

    writeFile("RP/textures/blocks/containerui_crate.png", Buffer.from(CRATE_TEXTURE_BASE64, "base64"));
    writeFile("RP/textures/blocks/containerui_machine.png", encodePng({ size: 16, colorAt: machineColorAt }));

    writeJson("RP/textures/terrain_texture.json", {
        resource_pack_name: "containerui-diagnostics",
        texture_name: "atlas.terrain",
        padding: 8,
        num_mip_levels: 4,
        texture_data: {
            containerui_crate: { textures: ["textures/blocks/containerui_crate"] },
            containerui_machine: { textures: ["textures/blocks/containerui_machine"] },
        },
    });

    writeJson("RP/texts/languages.json", ["en_US", "ru_RU"]);
    // `action.hint.exit.<entity>` replaces the vanilla dismount hint while riding the surface entity.
    writeFile(
        "RP/texts/en_US.lang",
        "tile.containerui:crate.name=ContainerUI Crate\n" +
            "tile.containerui:machine.name=ContainerUI Machine\n" +
            "action.hint.exit.containerui:rideable_entity=§eOpen your inventory to open the menu\n",
    );
    writeFile(
        "RP/texts/ru_RU.lang",
        "tile.containerui:crate.name=Ящик ContainerUI\n" +
            "tile.containerui:machine.name=Машина ContainerUI\n" +
            "action.hint.exit.containerui:rideable_entity=§eОткройте свой инвентарь, чтобы открыть меню\n",
    );
};

/** Writes the diagnostic add-on's manifests: its own packs, depending on the shared behaviour pack. */
const writeManifests = () => {
    const shared = JSON.parse(readFileSync(join(SHARED_ROOT, "BP/manifest.json"), "utf8")).header;
    const header = ({ name, description, uuid }) => ({
        name,
        description,
        uuid,
        version: [1, 0, 0],
        min_engine_version: shared.min_engine_version,
    });
    writeJson("BP/manifest.json", {
        format_version: 2,
        header: header({
            name: "ContainerUI Diagnostics BP",
            description: "Diagnostic add-on: measures surface timings and exercises every risky path.",
            uuid: DIAGNOSTICS_BEHAVIOUR_UUID,
        }),
        modules: [
            {
                type: "script",
                uuid: DIAGNOSTICS_BEHAVIOUR_MODULE_UUID,
                version: [1, 0, 0],
                language: "javascript",
                entry: "scripts/main.js",
            },
        ],
        dependencies: [
            { uuid: shared.uuid, version: shared.version },
            { module_name: "@minecraft/server", version: SCRIPT_MODULE_VERSION },
            { module_name: "@minecraft/server-ui", version: UI_MODULE_VERSION },
        ],
    });
    writeJson("RP/manifest.json", {
        format_version: 2,
        header: header({
            name: "ContainerUI Diagnostics RP",
            description: "Textures and names for the ContainerUI diagnostic add-on.",
            uuid: DIAGNOSTICS_RESOURCE_UUID,
        }),
        modules: [{ type: "resources", uuid: DIAGNOSTICS_RESOURCE_MODULE_UUID, version: [1, 0, 0] }],
    });
};

const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.status === 0) return;
    console.error(`  step failed: ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
};

console.log("\n  building test packs\n");

// Everything below is regenerated, so stale output from a previous run is removed first.
for (const folder of ["BP", "RP", "ContainerUI"]) rmSync(join(OUTPUT_ROOT, folder), { recursive: true, force: true });

run("node", ["tools/generate-pack.mjs", SHARED_ROOT]);
run("node", ["tools/vendor.mjs", join(OUTPUT_ROOT, "BP/scripts/ContainerUI")]);

cpSync(DIAGNOSTICS_ROOT, join(OUTPUT_ROOT, "BP/scripts"), { recursive: true, filter: (path) => !path.endsWith(".md") });
console.log(`  copied ${DIAGNOSTICS_ROOT} into ${join(OUTPUT_ROOT, "BP/scripts")}`);

writeBlockAssets();
writeLootTables();
writeManifests();

const bpManifest = JSON.parse(readFileSync(join(OUTPUT_ROOT, "BP/manifest.json"), "utf8"));
const moduleVersion = bpManifest.dependencies?.find((dependency) => dependency.module_name === "@minecraft/server")?.version ?? "beta";
const betaStep =
    moduleVersion === "beta"
        ? `world settings: enable "Beta APIs" (the script modules are pinned to beta)`
        : `no Beta APIs needed: @minecraft/server is pinned to ${moduleVersion}`;

console.log(`
  done. Install:

    1. delete the old ContainerUI_BP, ContainerUI_RP, ContainerUI_Diag_BP and ContainerUI_Diag_RP
       folders first: copying over them keeps files this build no longer has, such as a second
       entity with the same id
    2. the shared packs, once per world:
         copy ${join(SHARED_ROOT, "BP")}  ->  development_behavior_packs/ContainerUI_BP
         copy ${join(SHARED_ROOT, "RP")}  ->  development_resource_packs/ContainerUI_RP
    3. the diagnostic add-on:
         copy ${join(OUTPUT_ROOT, "BP")}  ->  development_behavior_packs/ContainerUI_Diag_BP
         copy ${join(OUTPUT_ROOT, "RP")}  ->  development_resource_packs/ContainerUI_Diag_RP
    4. activate the shared pair and the diagnostic pair in the world, and no other pack that
       carries a copy of the ContainerUI entities
    5. ${betaStep}

  Then in game:

    /vigenersl:cui         open the test hub
    /vigenersl:cuiprobe    measure inventory readiness for all 16 sizes
    /vigenersl:cuicrate    get the crate and the machine
    hub slot 26            the seventeen flat glass tiles
    right-click a stick    open from a beforeEvents handler

  Block containers: the crate opens its own inventory (Сундук); the machine opens a menu
  (Посадка). Watch the log for event=block records.
`);
