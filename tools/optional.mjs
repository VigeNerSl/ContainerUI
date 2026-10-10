/**
 * Runs an npm task that needs a folder this repository does not include: `test/`. With the folder the
 * task runs its command; without it the task prints SKIPPED and exits cleanly.
 *
 * Usage: node tools/optional.mjs test
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/** The TypeScript compiler's script, run with this Node rather than through the `tsc` shim. */
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

const TASKS = {
    test: {
        requires: "test",
        run: [
            [TSC, "-p", "tsconfig.test.json"],
            ["dist-test/test/run.js"],
        ],
        missing: "test/ is not in this checkout, so the suite was not run",
    },
};

/** Runs each step as a Node script, stopping at the first failure. */
const runSteps = (steps) => {
    for (const args of steps) {
        const result = spawnSync(process.execPath, args, { stdio: "inherit" });
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
};

const name = process.argv[2];
const task = TASKS[name];
if (!task) {
    console.error(`  unknown task "${name}"; expected one of: ${Object.keys(TASKS).join(", ")}`);
    process.exit(2);
}

if (existsSync(task.requires)) {
    runSteps(task.run);
} else {
    console.log(`\n  SKIPPED ${name}: ${task.missing}\n`);
}
