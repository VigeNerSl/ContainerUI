/** Structured records for the content log, and opening a menu with its timings and cost reported. */

import { getItemGuardStats, openContainer } from "../ContainerUI/ContainerFormData.js";

const LOG_PREFIX = "[CUI]";

/** Shown on the action bar when a client does not open the inventory screen by itself. */
export const HINT = "§eОткройте инвентарь, если меню не появилось само";

/**
 * Writes one record to the content log: a single line of `key=value`, without colour codes.
 *
 * @param level `info`, `warn` or `error`.
 * @param fields Written in order; `undefined` and `null` values are skipped.
 */
export const log = (level, fields) => {
    const record = Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null)
        .reduce((line, [key, value]) => `${line} ${key}=${value}`, LOG_PREFIX);

    if (level === "error") console.error(record);
    else if (level === "warn") console.warn(record);
    else console.info(record);
};

/** Records an observation from inside a scenario. */
export const note = (scenario, fields) => log("info", { event: "note", scenario, ...fields });

/** Surface options that log the open sequence, tracker traces and diagnostics of one scenario. */
export const reportingOptions = ({ scenario, size, startedAtMs }) => ({
    hintMessage: HINT,
    onMountEvent: (vigenersl) => {
        const { kind, attempt, ticksWaited } = vigenersl;
        switch (kind) {
            case "spawn-deferred":
                log("warn", { event: "spawn-deferred", scenario, size, attempt });
                break;
            case "inventory-ready":
                log("info", { event: "inventory-ready", scenario, size, ticks: ticksWaited });
                break;
            case "mounted":
                log("info", { event: "mounted", scenario, size, ticks: ticksWaited, firstPaintMs: Date.now() - startedAtMs });
                break;
            case "inventory-timeout":
                log("error", { event: "inventory-timeout", scenario, size, ticks: ticksWaited });
                break;
            case "spawn-failed":
                log("error", { event: "spawn-failed", scenario, size });
                break;
            case "activation-failed":
                log("error", { event: "activation-failed", scenario, size, ticks: ticksWaited });
                break;
            default:
                log("warn", { event: "unknown-mount-event", scenario, kind });
        }
    },
    // One record per gesture: which path resolved a take, what was returned or abandoned.
    onTrace: (detail) => log("info", { event: "trace", scenario, detail }),
    onDiagnostic: (vigenersl) => {
        const { kind, message } = vigenersl;
        log("warn", { event: "diagnostic", scenario, kind, message: JSON.stringify(message) });
    },
});

/**
 * Logs a closing record when the session closes: physical writes, scan cost, and what the item
 * guard did while this menu was open.
 *
 * @returns The session.
 */
export const reportOnClose = ({ session, scenario, size }) => {
    // Read at open, so the record reports this menu's share rather than a world-lifetime total.
    const guardAtOpen = getItemGuardStats();

    session.closed.then(() => {
        const stats = session.surface.scanStats;
        const guard = getItemGuardStats();
        log("info", {
            event: "closed",
            scenario,
            size,
            writes: session.app ? session.app.writeCount : "n/a",
            scanPasses: stats.passes,
            scanSlots: stats.slotsScanned,
            // Library cost and handler cost, apart.
            detectionMs: stats.detectionMs,
            handlerMs: stats.handlerMs,
            maxDetectionMs: stats.maxDetectionMs,
            // Gestures still in flight at close.
            pendingTakes: stats.pendingTakes,
            // Passes that diffed the viewer's inventory, and resyncs that found an unreported change.
            playerScans: stats.playerScans,
            inventoryDrift: stats.inventoryDrift,
            // Scan ticks skipped while the viewer was idle.
            idleSkips: stats.idleSkips,
            // Copies the sweep took back from the viewer's inventory; growth with clicks means the marker is failing.
            scrubbedStacks: stats.scrubbedStacks,
            // What the guard saw on the ground while this menu was open. A removal failure is a dupe waiting to happen.
            guardInspected: guard.inspected - guardAtOpen.inspected,
            guardDestroyed: guard.destroyed - guardAtOpen.destroyed,
            guardRemovalFailed: guard.removalFailed - guardAtOpen.removalFailed,
        });
    });
    return session;
};

/**
 * Opens a menu for a scenario, logging the request, the open sequence and the closing record.
 *
 * @returns The session.
 */
export const openWithReport = ({ player, scenario, size, render }) => {
    const startedAtMs = Date.now();
    log("info", { event: "open-requested", scenario, size, player: player.name });

    const session = openContainer(player, render, {
        size,
        title: `§dCUI §7${scenario}`,
        ...reportingOptions({ scenario, size, startedAtMs }),
    });

    return reportOnClose({ session, scenario, size });
};
