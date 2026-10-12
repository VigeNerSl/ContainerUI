/** What every generated pack's manifest shares. */

import { readFileSync } from "node:fs";

const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** The library version as `package.json` writes it, such as `1.0.0-beta.2`. */
export const LIBRARY_VERSION = PACKAGE.version;

/**
 * The version of the shared packs, counted apart from the library's. A client keeps a pack it has
 * downloaded or imported under its UUID and version, so raise it with every release that changes
 * what the packs contain, or players keep the previous copy.
 */
export const PACK_VERSION = [1, 0, 1];

export const MIN_ENGINE_VERSION = (process.env.CUI_MIN_ENGINE ?? "1.26.20").split(".").map(Number);

/** The repository's address without the `git+` prefix and the `.git` suffix. */
export const REPOSITORY_URL = PACKAGE.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

/** The `Copyright` line of the licence file. */
export const COPYRIGHT = readFileSync(new URL("../LICENSE", import.meta.url), "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("Copyright"));

/** Who made the packs and under what licence, as the world's pack list shows it. */
const METADATA = {
    authors: [PACKAGE.author],
    url: REPOSITORY_URL,
    license: PACKAGE.license,
};

/** A pack manifest with one module and, optionally, packs it depends on and a settings screen. */
export const buildManifest = ({ name, description, uuid, moduleUuid, type, dependencies = [], settings = [] }) => ({
    format_version: 2,
    header: {
        name,
        description,
        uuid,
        version: PACK_VERSION,
        min_engine_version: MIN_ENGINE_VERSION,
    },
    modules: [{ type, uuid: moduleUuid, version: PACK_VERSION }],
    ...(dependencies.length > 0 ? { dependencies } : {}),
    metadata: METADATA,
    ...(settings.length > 0 ? { settings } : {}),
});
