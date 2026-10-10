/** When the scan runs, and what it costs. */

/** Scans on every scan tick while the viewer is active, and every `idleIntervalTicks` once they go quiet. */
export class ScanPacer {
    readonly #idleAfterPasses: number;
    readonly #idleIntervalTicks: number;
    #quietPasses = 0;
    #ticksSincePass = 0;
    #skippedTicks = 0;

    /**
     * @param options.idleAfterPasses Quiet passes before idling.
     * @param options.idleIntervalTicks Ticks between idle passes.
     */
    constructor(options: { idleAfterPasses: number; idleIntervalTicks: number }) {
        this.#idleAfterPasses = options.idleAfterPasses;
        this.#idleIntervalTicks = options.idleIntervalTicks;
    }

    /** Scan ticks skipped while idle. */
    get skippedTicks(): number {
        return this.#skippedTicks;
    }

    /**
     * Whether this scan tick runs a pass.
     *
     * @param pace.intervalTicks Ticks between scan ticks.
     * @param pace.isUrgent Whether to run regardless of pace.
     * @returns Whether to run a pass now.
     */
    shouldRun({ intervalTicks, isUrgent }: { intervalTicks: number; isUrgent: boolean }): boolean {
        this.#ticksSincePass += intervalTicks;
        const isIdle = this.#quietPasses >= this.#idleAfterPasses;
        if (isUrgent || !isIdle || this.#ticksSincePass >= this.#idleIntervalTicks) {
            this.#ticksSincePass = 0;
            return true;
        }
        this.#skippedTicks++;
        return false;
    }

    /** Records whether a pass saw activity; any activity resumes scanning on every scan tick. */
    recordPass(isActive: boolean): void {
        this.#quietPasses = isActive ? 0 : this.#quietPasses + 1;
    }
}

/** Scan cost figures, with handler time kept apart from detection. */
export class ScanMeter {
    #passes = 0;
    #slotsScanned = 0;
    #detectionMs = 0;
    #handlerMs = 0;
    #maxDetectionMs = 0;
    #handlerMsThisPass = 0;

    /** Passes recorded. */
    get passes(): number {
        return this.#passes;
    }

    /** Surface slots examined, summed over passes. */
    get slotsScanned(): number {
        return this.#slotsScanned;
    }

    /** Pass time spent outside handlers, summed. */
    get detectionMs(): number {
        return this.#detectionMs;
    }

    /** Time spent in interaction handlers, summed. */
    get handlerMs(): number {
        return this.#handlerMs;
    }

    /** The longest pass, handlers excluded. */
    get maxDetectionMs(): number {
        return this.#maxDetectionMs;
    }

    /** Starts a pass. */
    beginPass(): void {
        this.#handlerMsThisPass = 0;
    }

    /** Adds handler time to the current pass. */
    addHandlerMs(ms: number): void {
        this.#handlerMsThisPass += ms;
    }

    /** Ends the pass that began at `startedAtMs`. */
    record({ startedAtMs, slotsScanned }: { startedAtMs: number; slotsScanned: number }): void {
        this.#passes++;
        this.#slotsScanned += slotsScanned;

        const elapsedMs = Date.now() - startedAtMs;
        const detectionMs = Math.max(0, elapsedMs - this.#handlerMsThisPass);
        this.#detectionMs += detectionMs;
        this.#handlerMs += this.#handlerMsThisPass;
        if (detectionMs > this.#maxDetectionMs) this.#maxDetectionMs = detectionMs;
    }
}
