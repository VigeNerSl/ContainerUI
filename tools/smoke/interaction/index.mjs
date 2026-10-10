/** Checks when the interaction tracker counts a physical change as a click, against an in-memory world. */

import { runSuite } from "../harness.mjs";
import { checkCollectAll } from "./collectAll.mjs";
import { checkGestures } from "./gestures.mjs";
import { checkInsertions } from "./insertions.mjs";
import { checkLateEvents } from "./lateEvents.mjs";
import { checkLookalikes } from "./lookalikes.mjs";
import { checkLots } from "./lots.mjs";
import { checkSameProbe } from "./sameProbe.mjs";
import { checkTakes } from "./takes.mjs";
import { worldFactory } from "./world.mjs";

const SECTIONS = [checkTakes, checkLookalikes, checkGestures, checkInsertions, checkLateEvents, checkLots, checkCollectAll, checkSameProbe];

await runSuite({ label: "interaction", passed: "deferred interaction ok", crashed: "interaction smoke failed" }, async ({ check, load }) => {
    const tracker = await load("platform/scan/scanPass.js");
    const context = { check, makeWorld: worldFactory(tracker) };
    for (const section of SECTIONS) await section(context);
});
