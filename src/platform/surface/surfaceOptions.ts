/** The options a Bedrock surface is opened with. */

import type { Vector3 } from "@minecraft/server";

/**
 * How the viewer gets the screen. `"seat"` seats them on the menu entity, and they open the screen
 * with the inventory key. `"click"` leaves the open to their own click on the entity, which the
 * engine answers by opening its inventory.
 */
export type SurfaceOpenMode = "seat" | "click";

/**
 * Where a menu opened by click puts its entity. `"head"` puts it in the viewer's head and keeps it
 * there until they click, so the click lands wherever they look. A point puts a block-sized entity
 * there, its base centred on the point, in the viewer's dimension.
 */
export type SurfaceClickPoint = "head" | Vector3;

/** How a `BedrockSurface` looks, paces its scan and reports. */
export interface BedrockSurfaceOptions {
    /** Slot count; one of `SUPPORTED_SIZES`. */
    size: number;
    /** Title shown on the container header. */
    title?: string | undefined;
    /** Ticks between interaction scans. */
    scanIntervalTicks?: number | undefined;
    /**
     * Ticks between scans once the viewer has been quiet for `IDLE_SCAN_AFTER_PASSES` scan passes. 1 turns the slowdown off.
     * Defaults to `IDLE_SCAN_INTERVAL_TICKS`.
     */
    idleScanIntervalTicks?: number | undefined;
    /** Blocks the viewer may drift before the surface closes. */
    maxViewDistance?: number | undefined;
    /** How the viewer gets the screen. Defaults to `"seat"`. */
    openBy?: SurfaceOpenMode | undefined;
    /** With `openBy: "click"`: where the entity goes. Defaults to `"head"`. */
    clickAt?: SurfaceClickPoint | undefined;
    /** With `openBy: "click"`: ticks to wait for the click before closing with `"timeout"`. Defaults to `CLICK_OPEN_WAIT_TICKS`. */
    clickWaitTicks?: number | undefined;
    /** Action-bar text shown once the menu is ready, before the viewer opens the screen. */
    hintMessage?: string | undefined;
    /** Receives platform failures. Defaults to the logger set by `setLogger`. */
    onError?: ((message: string) => void) | undefined;
    /** Receives interaction-tracking records. Silent by default. */
    onTrace?: ((message: string) => void) | undefined;
}
