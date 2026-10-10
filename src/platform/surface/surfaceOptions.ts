/** The options a Bedrock surface is opened with. */

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
    /** Action-bar text shown once mounted, for clients that do not open the screen by themselves. */
    hintMessage?: string | undefined;
    /** Receives platform failures. Defaults to the logger set by `setLogger`. */
    onError?: ((message: string) => void) | undefined;
    /** Receives interaction-tracking records. Silent by default. */
    onTrace?: ((message: string) => void) | undefined;
}
