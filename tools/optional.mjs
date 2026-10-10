/**
 * Runs an npm task that needs a folder this repository does not include: `test/`, `examples/shop` or
 * `examples/plain-js`. With the folder the task runs its command; without it the task prints
 * SKIPPED and exits cleanly, and `typecheck` checks the library instead.
 *
 * Usage: node tools/optional.mjs test | typecheck | vendor
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
    typecheck: {
        requires: "examples/shop/tsconfig.json",
        run: [[TSC, "-p", "examples/shop/tsconfig.json"]],
        missing: "examples/shop is not in this checkout; type-checking the library instead",
        fallback: [[TSC, "-p", "tsconfig.json", "--noEmit"]],
    },
    vendor: {
        requires: "examples/plain-js",
        run: [["tools/vendor.mjs", "examples/plain-js/BP/scripts/ContainerUI"]],
        missing: "examples/plain-js is not in this checkout, so there is nowhere to vendor into",
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
    if (task.fallback) runSteps(task.fallback);
}
