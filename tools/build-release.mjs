/**
 * Builds the files a GitHub release carries, into `release/`:
 *
 *   ContainerUI-<version>.zip      for add-on authors who copy folders: the library, both shared
 *                                  packs, the licence and a short install note
 *   ContainerUI-<version>.mcaddon  for players: the two shared packs, which the game imports with a
 *                                  double click
 *
 * Run `npm run build:release`; it builds `dist/` first. The packs are generated fresh from `dist/`,
 * never taken from an earlier `pack/` folder.
 *
 * Usage: node tools/build-release.mjs
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { LIBRARY_VERSION, REPOSITORY_URL } from "./pack-manifest.mjs";
import { buildZip, readFolder } from "./zip.mjs";

const RELEASE_FOLDER = "release";
const STAGE_FOLDER = join(RELEASE_FOLDER, ".stage");
const NAME = `ContainerUI-${LIBRARY_VERSION}`;

/** The folders the game sees, as the zip and the .mcaddon name them. */
const BEHAVIOUR_FOLDER = "ContainerUI_BP";
const RESOURCE_FOLDER = "ContainerUI_RP";

const fail = (message) => {
    console.error(`\n  ${message}\n`);
    process.exit(1);
};

if (!existsSync(join("dist", "ContainerFormData.js"))) fail("dist/ is missing: run `npm run build:release`, which builds it first.");

rmSync(RELEASE_FOLDER, { recursive: true, force: true });
mkdirSync(STAGE_FOLDER, { recursive: true });

const generated = spawnSync("node", ["tools/generate-pack.mjs", STAGE_FOLDER], { stdio: "ignore" });
if (generated.status !== 0) fail("generating the packs failed: run `npm run generate:pack` to see why.");

const behaviourUuid = JSON.parse(readFileSync(join(STAGE_FOLDER, "BP/manifest.json"), "utf8")).header.uuid;

/** Files placed under `prefix/`. */
const under = (prefix, entries) => entries.map(({ path, contents }) => ({ path: `${prefix}/${path}`, contents }));

const behaviourPack = readFolder(join(STAGE_FOLDER, "BP"));
const resourcePack = readFolder(join(STAGE_FOLDER, "RP"));
const library = readFolder("dist").filter(({ path }) => !path.endsWith(".map"));

const installNote = `ContainerUI ${LIBRARY_VERSION}
${REPOSITORY_URL}

What is in this archive
  ContainerUI/        the library: copy it to <your behaviour pack>/scripts/ContainerUI
  packs/${BEHAVIOUR_FOLDER}/  the shared behaviour pack (no scripts, holds the menu entity)
  packs/${RESOURCE_FOLDER}/  the shared resource pack (the menu screens and the flat glass)
  LICENSE, TRADEMARKS.md, CHANGELOG.md

Install the packs, once per world
  1. Copy the two folders in packs/ to the game's development folders:
       ${BEHAVIOUR_FOLDER}  ->  development_behavior_packs
       ${RESOURCE_FOLDER}  ->  development_resource_packs
     In the Windows launcher (GDK) edition, the game's data folder is
       %AppData%\\Minecraft Bedrock\\Users\\Shared\\games\\com.mojang
  2. Activate ContainerUI BP in the world; it brings ContainerUI RP with it.

In your add-on
  1. Copy ContainerUI/ into your behaviour pack's scripts folder and keep the LICENSE inside it.
  2. Add the shared pack to your behaviour pack's manifest.json dependencies:
       { "uuid": "${behaviourUuid}", "version": [1, 0, 0] }
  3. import { h, installBedrockRuntime, openContainer } from "./ContainerUI/ContainerFormData.js";
     Documentation: ${REPOSITORY_URL}#readme

Установка (кратко)
  1. Папки из packs/ скопируйте в development_behavior_packs и development_resource_packs игры.
  2. Включите в мире ContainerUI BP: он сам подтянет ContainerUI RP.
  3. Папку ContainerUI/ положите в scripts вашего набора поведения (файл LICENSE оставьте)
     и добавьте зависимость от uuid ${behaviourUuid} в его manifest.json.
`;

const archive = buildZip(
    under(NAME, [
        { path: "INSTALL.txt", contents: Buffer.from(installNote, "utf8") },
        { path: "LICENSE", contents: readFileSync("LICENSE") },
        { path: "TRADEMARKS.md", contents: readFileSync("TRADEMARKS.md") },
        { path: "CHANGELOG.md", contents: readFileSync("CHANGELOG.md") },
        ...under("ContainerUI", library),
        ...under(`packs/${BEHAVIOUR_FOLDER}`, behaviourPack),
        ...under(`packs/${RESOURCE_FOLDER}`, resourcePack),
    ]),
);

const addon = buildZip([...under(BEHAVIOUR_FOLDER, behaviourPack), ...under(RESOURCE_FOLDER, resourcePack)]);

rmSync(STAGE_FOLDER, { recursive: true, force: true });

const outputs = [
    { file: `${NAME}.zip`, bytes: archive },
    { file: `${NAME}.mcaddon`, bytes: addon },
];

console.log("");
for (const { file, bytes } of outputs) {
    writeFileSync(join(RELEASE_FOLDER, file), bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    console.log(`  ${join(RELEASE_FOLDER, file)}  ${(bytes.length / 1024).toFixed(0)} KB  sha256 ${hash}`);
}
console.log("");
