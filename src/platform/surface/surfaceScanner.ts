/** The scan loop of one surface: its pace, its cost, and the tracker it drives. */

import { system, type Container, type ContainerSlot, type ItemStack } from "@minecraft/server";
import type { CloseReason, HostInteraction, ItemView } from "../../core/index.js";
import { IDLE_SCAN_AFTER_PASSES, MAX_PENDING_TAKE_TICKS, STORAGE_BUTTON_CHECK_INTERVAL_TICKS } from "../constants.js";
import { ScanMeter, ScanPacer } from "../scan/scanPacing.js";
import { InteractionTracker, type ExpectedSlots, type SlotProbe } from "../scan/scanPass.js";
import { probeOfHandle, probeOfStack, slotHandlesOf } from "../scan/slotHandles.js";
import type { ViewerInventory } from "../scan/viewerInventory.js";
import { StorageButtons, type StorageButtonSink } from "./storageButtons.js";

/** What the scanner needs from its surface. */
export interface ScannerHost {
    /** Surface slot count. */
    readonly slotCount: number;
    /** What each slot should hold. */
    readonly expected: ExpectedSlots;
    /** The viewer's inventory and cursor. */
    readonly viewer: ViewerInventory;
    /** The surface's container, or `null` once it is gone. */
    container(): Container | null;
    /** Full read of a slot. */
    readSlot(index: number): ItemView | null;
    /** Writes a slot without telling the core. */
    restoreSlot(index: number, item: ItemView | null): void;
    /** Whether the player owns the slot: an `input`. */
    isPlayerWritable(index: number): boolean;
    /** Delivers an interaction to the surface's handlers. */
    emit(interaction: HostInteraction): void;
    /** Whether the surface has closed. */
    isClosed(): boolean;
    /** Closes the surface. */
    close(reason: CloseReason): void;
    /** Receives failures. */
    reportError(message: string): void;
    /** Receives tracking records. */
    trace(message: string): void;
}

/** How often a {@link SurfaceScanner} scans. */
export interface ScannerOptions {
    /** Ticks between scan ticks. */
    intervalTicks: number;
    /** Ticks between passes once the viewer is idle. */
    idleIntervalTicks: number;
}

/** Timings behind `BedrockSurface.measureScanPhases`, in milliseconds. */
export interface ScanPhases {
    /** The per-pass setup alone. */
    setupMs: number;
    /** The setup with a probe of every slot. */
    probesMs: number;
    /** Whole passes. */
    passesMs: number;
}

/** Figures behind `BedrockSurface.scanStats`. */
export interface ScanStats {
    /** Scan passes run. */
    passes: number;
    /** Slots examined. */
    slotsScanned: number;
    /** Time spent detecting, as one 1 ms-quantised sample per pass. */
    detectionMs: number;
    /** Time spent in interaction handlers. */
    handlerMs: number;
    /** The longest pass. */
    maxDetectionMs: number;
    /** Takes in flight as of the last pass. */
    pendingTakes: number;
    /** Passes that diffed the viewer's inventory. */
    playerScans: number;
    /** Resyncs that found a change no event reported. */
    inventoryDrift: number;
    /** Scan ticks skipped while the viewer was idle. */
    idleSkips: number;
}

/** Scans a surface for interactions, pacing the passes and metering their cost. */
export class SurfaceScanner {
    readonly #host: ScannerHost;
    readonly #tracker: InteractionTracker;
    readonly #pacer: ScanPacer;
    readonly #meter = new ScanMeter();
    readonly #intervalTicks: number;
    #runId: number | null = null;
    #isScanning = false;
    #pendingTakes = 0;
    #passContainer: Container | null = null;
    #surfaceSlots: ContainerSlot[] | null = null;
    readonly #storageButtons = new StorageButtons();
    #nextStorageCheckTick = 0;

    /**
     * @param host The surface.
     * @param options Scan intervals.
     */
    constructor(host: ScannerHost, options: ScannerOptions) {
        this.#host = host;
        this.#intervalTicks = options.intervalTicks;
        this.#pacer = new ScanPacer({ idleAfterPasses: IDLE_SCAN_AFTER_PASSES, idleIntervalTicks: options.idleIntervalTicks });

        const viewer = host.viewer;
        this.#tracker = new InteractionTracker({
            slotCount: host.slotCount,
            expected: host.expected,
            probeSurface: (index) => this.probe(index),
            readSurface: (index) => host.readSlot(index),
            restoreSurface: (index, item) => host.restoreSlot(index, item),
            isPlayerWritable: (index) => host.isPlayerWritable(index),
            probeCursor: () => viewer.probeCursor(),
            reclaimFromCursor: () => viewer.reclaimCursor(),
            readCursor: () => viewer.readCursor(),
            isCursorRendered: () => viewer.isCursorRendered(),
            isPlayerSlotRendered: (index) => viewer.isSlotRendered(index),
            takeSwept: () => viewer.takeSwept(),
            playerSlotCount: () => viewer.prepareSlots(),
            takePlayerInventoryChange: () => viewer.takeChange(),
            probePlayer: (index) => viewer.probe(index),
            readPlayer: (index) => viewer.read(index),
            reducePlayer: (index, amount) => viewer.reduce(index, amount),
            returnToPlayer: (originSlot, item) => viewer.returnItem(originSlot, item) !== null,
            emit: (interaction) => this.#emit(interaction),
            isClosed: () => host.isClosed(),
            maxPendingTicks: MAX_PENDING_TAKE_TICKS,
            report: (message) => host.trace(message),
        });
    }

    /** Starts scanning. */
    start(): void {
        if (this.#runId !== null) return;
        this.#runId = system.runInterval(() => this.#scan(), this.#intervalTicks);
    }

    /** Stops scanning and drops every take in flight. */
    stop(): void {
        if (this.#runId !== null) system.clearRun(this.#runId);
        this.#runId = null;
        this.#tracker.clear();
    }

    /**
     * Writes a slot. Takes in flight on it no longer fire, though each still reclaims its copy; a
     * storage item written to a UI-owned slot is watched; and a storage button the write replaces
     * gives the viewer back what they put in it.
     *
     * @param write.container The surface's container.
     * @param write.index Surface slot.
     * @param write.stack The stack to write, or `undefined` to empty the slot.
     * @param write.isUiOwned Whether the slot is the UI's rather than an `input`.
     * @throws When the engine refuses the write.
     */
    writeSlot({ container, index, stack, isUiOwned }: { container: Container; index: number; stack: ItemStack | undefined; isUiOwned: boolean }): void {
        const own = this.#storageButtons.takeOwnItemsAt(container, index);
        container.setItem(index, stack);
        this.#tracker.invalidatePending(index);
        this.#storageButtons.record({ index, stack, isUiOwned });
        this.#host.viewer.returnOwnItems(own);
    }

    /** Gives the viewer back what they put in a storage item on a button, as the surface closes. */
    rescueStorageButtons(): void {
        const container = this.#host.container();
        if (container) this.#storageButtons.rescueAll(container, this.#storageSink());
    }

    /**
     * Resolves a take from a rendered copy destroyed on the ground.
     *
     * @param options `shouldHold`: whether an event with no take yet waits for one.
     * @returns Whether a take resolved.
     */
    resolveFromGround(probe: SlotProbe, options: { shouldHold: boolean }): boolean {
        const isResolved = this.#tracker.resolveFromGround(probe, options);
        this.#pendingTakes = this.#tracker.pendingCount;
        return isResolved;
    }

    /** Cheap read of a surface slot: through a kept handle during a pass, a plain read otherwise. */
    probe(index: number): SlotProbe | null {
        const handle = this.#isScanning ? this.#surfaceSlots?.[index] : undefined;
        if (handle) return probeOfHandle(handle);
        const container = this.#passContainer ?? this.#host.container();
        if (!container) return null;
        const stack = container.getItem(index);
        return stack ? probeOfStack(stack) : null;
    }

    /** Scan activity and cost so far. */
    get stats(): ScanStats {
        return {
            passes: this.#meter.passes,
            slotsScanned: this.#meter.slotsScanned,
            detectionMs: this.#meter.detectionMs,
            handlerMs: this.#meter.handlerMs,
            maxDetectionMs: this.#meter.maxDetectionMs,
            pendingTakes: this.#pendingTakes,
            playerScans: this.#tracker.playerScanCount,
            inventoryDrift: this.#tracker.inventoryDriftCount,
            idleSkips: this.#pacer.skippedTicks,
        };
    }

    /**
     * Times passes run back to back.
     *
     * @returns Milliseconds, or `null` while a take is in flight.
     */
    measureCost(passes: number): number | null {
        if (!this.#canMeasure()) return null;
        return this.#timePasses(passes, () => this.#tracker.runPass());
    }

    /**
     * Times the parts of a pass apart.
     *
     * @returns The timings, or `null` while a take is in flight.
     */
    measurePhases(passes: number): ScanPhases | null {
        if (!this.#canMeasure()) return null;
        const setupMs = this.#timePasses(passes, () => undefined);
        const probesMs = this.#timePasses(passes, () => {
            for (let index = 0; index < this.#host.slotCount; index++) this.probe(index);
        });
        const passesMs = this.#timePasses(passes, () => this.#tracker.runPass());
        if (setupMs === null || probesMs === null || passesMs === null) return null;
        return { setupMs, probesMs, passesMs };
    }

    /** Whether passes can be timed: the surface is open and nothing is in flight. */
    #canMeasure(): boolean {
        return !this.#host.isClosed() && !this.#isScanning && this.#tracker.pendingCount === 0;
    }

    /** Times `passes` rounds of `work`, each between a pass's setup and teardown. */
    #timePasses(passes: number, work: () => void): number | null {
        const startedAtMs = Date.now();
        try {
            for (let pass = 0; pass < passes; pass++) {
                if (!this.#beginPass()) return null;
                work();
                this.#endPass();
            }
            return Date.now() - startedAtMs;
        } finally {
            this.#endPass();
        }
    }

    /** Resolves the container and its handles for one pass. `false` when the surface is gone. */
    #beginPass(): boolean {
        const container = this.#host.container();
        if (!container) return false;
        this.#isScanning = true;
        this.#passContainer = container;
        this.#surfaceSlots = slotHandlesOf(container, this.#surfaceSlots);
        this.#host.viewer.beginPass();
        return true;
    }

    #endPass(): void {
        this.#isScanning = false;
        this.#passContainer = null;
        this.#host.viewer.endPass();
    }

    #scan(): void {
        if (this.#host.isClosed() || this.#isScanning) return;
        // A reported inventory change scans now, idle or not.
        const isUrgent = this.#host.viewer.hasPendingChange;
        if (!this.#pacer.shouldRun({ intervalTicks: this.#intervalTicks, isUrgent })) return;

        if (!this.#beginPass()) {
            this.#host.close("invalidated");
            return;
        }
        const startedAtMs = Date.now();
        this.#meter.beginPass();

        try {
            const result = this.#tracker.runPass();
            this.#checkStorageButtons();
            this.#pendingTakes = result.pendingCount;
            this.#meter.record({ startedAtMs, slotsScanned: result.slotsScanned });
            this.#pacer.recordPass(isUrgent || result.changedSlots > 0 || result.interactionCount > 0 || result.pendingCount > 0);
        } catch (error) {
            // A read failed unexpectedly: treat the surface as gone.
            this.#host.reportError(`Scan failed, closing surface: ${String(error)}`);
            // Ended before closing: closing reads the slots outside a pass.
            this.#endPass();
            this.#host.close("invalidated");
        } finally {
            this.#endPass();
        }
    }

    /** Checks the storage items on buttons, once every {@link STORAGE_BUTTON_CHECK_INTERVAL_TICKS}. */
    #checkStorageButtons(): void {
        const container = this.#passContainer;
        if (!container || this.#host.isClosed() || system.currentTick < this.#nextStorageCheckTick) return;
        this.#nextStorageCheckTick = system.currentTick + STORAGE_BUTTON_CHECK_INTERVAL_TICKS;
        this.#storageButtons.check(container, this.#storageSink());
    }

    /** Where the storage buttons send the viewer's own items and their records. */
    #storageSink(): StorageButtonSink {
        return {
            giveBack: (stacks) => this.#host.viewer.returnOwnItems(stacks),
            trace: (message) => this.#host.trace(message),
        };
    }

    /** Delivers an interaction, counting handler time apart from detection. */
    #emit(interaction: HostInteraction): void {
        const startedAtMs = Date.now();
        this.#host.emit(interaction);
        this.#meter.addHandlerMs(Date.now() - startedAtMs);
    }
}
