/** Runs every core suite section: the runtime, surface, components, hooks, storage, lists, blocks, entity storage, logging, lifecycle, regression and runtime-fix checks. */

import { runSuite } from "../harness.mjs";
import { checkRegressions } from "./regressions.mjs";
import { checkBlocks } from "./blocks.mjs";
import { checkComponents } from "./components.mjs";
import { checkEntityStorage } from "./entityStorage.mjs";
import { freshRuntimeOf } from "./fixtures.mjs";
import { checkHooks } from "./hooks.mjs";
import { checkLifecycle } from "./lifecycle.mjs";
import { checkLists } from "./lists.mjs";
import { checkLogging } from "./logging.mjs";
import { checkRuntime } from "./runtime.mjs";
import { checkRuntimeFixes } from "./runtimeFixes.mjs";
import { checkStorage } from "./storage.mjs";
import { checkSurface } from "./surface.mjs";

const SECTIONS = [checkRuntime, checkSurface, checkComponents, checkHooks, checkStorage, checkLists, checkBlocks, checkEntityStorage, checkLogging, checkLifecycle, checkRegressions, checkRuntimeFixes];

await runSuite({ label: "core", passed: "core smoke ok", crashed: "core smoke failed", engine: "core.js" }, async ({ check, load, loadEngine }) => {
    const core = await load("core/index.js");
    // Render errors below are thrown on purpose; keep them out of the output.
    core.setErrorReporter(() => undefined);
    const context = { check, load, loadEngine, core, freshRuntime: freshRuntimeOf(core) };
    for (const section of SECTIONS) await section(context);
});
