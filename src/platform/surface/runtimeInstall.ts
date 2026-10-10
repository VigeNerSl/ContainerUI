/** Installing the tick scheduler and timers on Bedrock, and the default diagnostic sink. */

import { system } from "@minecraft/server";
import { Scheduler, configureRuntime, configureTimeSource, resetRuntime, resetTimeSource, type Diagnostic } from "../../core/index.js";
import { log } from "../../core/logging/logger.js";
import { onUninstall, runReinstallers } from "../lifecycle.js";

let installedScheduler: Scheduler | null = null;

const FAILURE_KINDS = new Set<Diagnostic["kind"]>(["handler-error", "write-failed", "render-error", "platform-error"]);

/**
 * The default diagnostic sink: failures as errors, the rest as warnings, through the logger.
 *
 * @internal
 */
export const logDiagnostic = (diagnostic: Diagnostic): void => {
    log({
        level: FAILURE_KINDS.has(diagnostic.kind) ? "error" : "warn",
        source: "diagnostic",
        message: `${diagnostic.kind}: ${diagnostic.message}`,
        detail: diagnostic,
    });
};

/**
 * Installs the tick scheduler and timers. Idempotent; `openContainer` calls it. Options apply to the
 * first call only, so call it at startup to set them.
 *
 * @param options `budgetMs`: milliseconds of work per flush. Defaults to 8.
 * @returns The scheduler.
 */
export const installBedrockRuntime = (options: { budgetMs?: number | undefined } = {}): Scheduler => {
    if (installedScheduler) return installedScheduler;
    onUninstall(() => {
        installedScheduler = null;
        resetRuntime();
        resetTimeSource();
    });

    runReinstallers();
    installedScheduler = configureRuntime(
        {
            // End of the tick: every change made in it commits in one pass.
            requestFlush: (callback) => {
                system.run(callback);
            },
            now: () => Date.now(),
        },
        { budgetMs: options.budgetMs },
    );

    configureTimeSource({
        after: (ticks, callback) => {
            const runId = system.runTimeout(callback, ticks);
            return () => system.clearRun(runId);
        },
        every: (ticks, callback) => {
            const runId = system.runInterval(callback, ticks);
            return () => system.clearRun(runId);
        },
    });

    return installedScheduler;
};
