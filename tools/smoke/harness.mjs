/** Runs a smoke suite against a copy of the build, with an optional engine stub and pass/fail reporting. */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENGINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "engines");

/** Installs `engines/<engine>` in `root` as the `@minecraft/server` package. */
const installEngine = (root, engine) => {
    const target = join(root, "node_modules", "@minecraft", "server");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "package.json"), '{"name":"@minecraft/server","type":"module","main":"index.js"}');
    cpSync(join(ENGINE_ROOT, engine), join(target, "index.js"));
};

/**
 * Runs `body` against a fresh copy of `dist` in a temporary directory, then prints the summary
 * and sets a failing exit code when any check failed.
 *
 * @param options `label` names the suite in the failure summary; `passed` is printed when every
 * check passes; `crashed` is printed, with the thrown message, when `body` throws; `engine` is a
 * file under `engines/` installed as `@minecraft/server`; `buildFolder` is where the build is copied.
 * @param body Receives `check(name, condition, detail?)`, `load(pathInBuild)` and `loadEngine()`.
 */
export const runSuite = async ({ label, passed, crashed, engine, buildFolder = "lib" }, body) => {
    const root = mkdtempSync(join(tmpdir(), `containerui-${label}-`));
    let failures = 0;

    const check = (name, condition, detail) => {
        if (condition) {
            console.log(`    ✓ ${name}`);
            return;
        }
        failures++;
        console.log(`    ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
    };
    const load = (relative) => import(pathToFileURL(join(root, buildFolder, relative)).href);
    const loadEngine = () => import(pathToFileURL(join(root, "node_modules", "@minecraft", "server", "index.js")).href);

    try {
        writeFileSync(join(root, "package.json"), '{"type":"module"}');
        if (engine) installEngine(root, engine);
        cpSync("dist", join(root, buildFolder), { recursive: true, filter: (source) => !source.endsWith(".map") });
        await body({ check, load, loadEngine });
    } catch (error) {
        failures++;
        console.log(`\n  ✗ ${crashed}: ${error?.message ?? error}`);
        if (error?.stack) console.log(error.stack);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }

    console.log(failures === 0 ? `\n  ${passed}\n` : `\n  ${failures} ${label} check(s) failed\n`);
    if (failures > 0) process.exitCode = 1;
};
