/** The Bedrock surface: an invisible rideable entity whose inventory the viewer sees as a chest. */

import { system, world, type Container, type Entity, type Player, type EntityRideableComponent } from "@minecraft/server";
import type { CloseReason, Dispose, HostAdapter, HostInteraction, ItemView } from "../../core/index.js";
import { log } from "../../core/logging/logger.js";
import { canWriteWorld, returnStrandedItems, settleUnscannedInputs } from "./closeSettlement.js";
import { Revocations } from "../scan/conflictRevocations.js";
import {
    IDLE_SCAN_INTERVAL_TICKS,
    MAX_VIEW_DISTANCE,
    RIDEABLE_COMPONENT_ID,
    SCAN_INTERVAL_TICKS,
    SURFACE_ENTITY_TYPE_ID,
    SUPPORTED_SIZES,
    WATCHDOG_INTERVAL_TICKS,
    openEventFor,
    surfaceNameTag,
} from "../constants.js";
import { fromItemStack, toItemStack } from "../items/itemConversion.js";
import { installItemGuard, onMarkedItemDestroyed } from "../items/itemGuard.js";
import { classifySpawnError, type SpawnOutcome } from "./mountSequence.js";
import { ExpectedSlots } from "../scan/scanPass.js";
import { SurfaceScanner, type ScanPhases, type ScanStats } from "./surfaceScanner.js";
import { installContainerClosedHook, surfaceByPlayerId, surfacesByEntityId } from "./surfaceRegistry.js";
import { ViewerInventory } from "../scan/viewerInventory.js";
import { WrittenSlots } from "./writtenSlots.js";
import type { BedrockSurfaceOptions } from "./surfaceOptions.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";

/** Rescans of the viewer's inventory after closing, in ticks: the client applies item moves late. */
const CLOSE_SCRUB_DELAYS_TICKS: readonly number[] = [1, 5, 10];

export type { BedrockSurfaceOptions };

/** A container surface for one viewer. */
export class BedrockSurface implements HostAdapter {
    readonly slotCount: number;

    readonly #viewer: ViewerInventory;
    readonly #revocations: Revocations;
    #entity: Entity | null = null;
    #entityId: string | null = null;
    readonly #title: string;
    readonly #maxViewDistance: number;
    readonly #hintMessage: string | undefined;
    readonly #onError: ((message: string) => void) | undefined;
    readonly #onTrace: ((message: string) => void) | undefined;

    readonly #expected: ExpectedSlots;
    readonly #scanner: SurfaceScanner;
    #playerWritable: ReadonlySet<number> = new Set();
    #mirrored: ReadonlySet<number> = new Set();
    readonly #written: WrittenSlots;
    #unsubscribeGuard: Dispose | null = null;

    readonly #interactionHandlers = new Set<(interaction: HostInteraction) => void>();
    readonly #closeHandlers = new Set<(reason: CloseReason) => void>();

    #watchdogRunId: number | null = null;
    #isClosed = false;
    #isClosing = false;

    /**
     * @param player The viewer.
     * @param options Surface options.
     * @throws {RangeError} For an unsupported size.
     */
    constructor(player: Player, options: BedrockSurfaceOptions) {
        if (!SUPPORTED_SIZES.includes(options.size)) {
            throw new RangeError(
                `[ContainerUI] Unsupported size ${options.size}. Supported sizes: ${SUPPORTED_SIZES.join(", ")}.`,
            );
        }

        this.slotCount = options.size;
        this.#title = options.title ?? "Container";
        this.#maxViewDistance = options.maxViewDistance ?? MAX_VIEW_DISTANCE;
        this.#hintMessage = options.hintMessage;
        this.#onError = options.onError;
        this.#onTrace = options.onTrace;

        this.#viewer = new ViewerInventory(player, {
            onError: (message) => this.#reportError(message),
            onTrace: (message) => this.#trace(message),
        });
        this.#revocations = new Revocations({
            takeBack: (item, amount) => this.#viewer.takeBack(item, amount),
            trace: (message) => this.#trace(message),
        });
        this.#expected = new ExpectedSlots(this.slotCount);
        this.#written = new WrittenSlots(this.#expected);
        this.#scanner = new SurfaceScanner(
            {
                slotCount: this.slotCount,
                expected: this.#expected,
                viewer: this.#viewer,
                container: () => this.#container(),
                readSlot: (index) => this.readSlot(index),
                restoreSlot: (index, item) => this.writeSlot(index, this.#written.restorable(index, item)),
                isPlayerWritable: (index) => this.#playerWritable.has(index),
                emit: (interaction) => this.#emitInteraction(interaction),
                isClosed: () => this.#isClosed,
                close: (reason) => this.close(reason),
                reportError: (message) => this.#reportError(message),
                trace: (message) => this.#trace(message),
            },
            {
                intervalTicks: options.scanIntervalTicks ?? SCAN_INTERVAL_TICKS,
                idleIntervalTicks: options.idleScanIntervalTicks ?? IDLE_SCAN_INTERVAL_TICKS,
            },
        );

        installContainerClosedHook();
        installItemGuard();
        this.#unsubscribeGuard = onMarkedItemDestroyed((probe, ownerId) => {
            if (this.#isClosed) return false;
            // Another player's throw is not this surface's take.
            if (ownerId !== undefined && ownerId !== this.#viewer.playerId) return false;
            // Only a copy thrown by this viewer is worth holding for a take the scan has not seen yet.
            return this.#scanner.resolveFromGround(probe, { shouldHold: ownerId !== undefined });
        });
    }

    /** Whether the surface has closed. */
    get isClosed(): boolean {
        return this.#isClosed;
    }

    /** The viewer, or `null` once they are gone. */
    get player(): Player | null {
        return this.#viewer.player;
    }

    /** The surface entity, or `null` once it is gone. */
    get entity(): Entity | null {
        if (this.#entity?.isValid) return this.#entity;
        if (!this.#entityId) return null;
        this.#entity = world.getEntity(this.#entityId) ?? null;
        return this.#entity;
    }

    /**
     * Spawns the surface entity and requests its inventory size. Does not mount the viewer.
     *
     * @returns How the spawn went.
     */
    open(): SpawnOutcome {
        const player = this.player;
        if (!player) return "failed";

        // One surface per viewer.
        const previous = surfaceByPlayerId.get(this.#viewer.playerId);
        if (previous && previous !== this && !previous.isClosed) {
            previous.close("programmatic");
        }

        try {
            const entity = player.dimension.spawnEntity(SURFACE_ENTITY_TYPE_ID, {
                x: player.location.x,
                y: player.location.y,
                z: player.location.z,
            });

            this.#entity = entity;
            this.#entityId = entity.id;
            surfacesByEntityId.set(entity.id, this);
            surfaceByPlayerId.set(this.#viewer.playerId, this);

            entity.nameTag = surfaceNameTag(this.slotCount, this.#title);
            entity.triggerEvent(openEventFor(this.slotCount));

            return "spawned";
        } catch (error) {
            const outcome = classifySpawnError(error);
            if (outcome === "failed") this.#reportError(`Failed to spawn the surface entity: ${String(error)}`);
            return outcome;
        }
    }

    /** Whether the container exists with the requested size. */
    isInventoryReady(): boolean {
        const container = this.#container();
        return container !== null && container.size === this.slotCount;
    }

    /**
     * Mounts the viewer and starts scanning. Call once the inventory is ready and rendered.
     *
     * @returns Whether the viewer was mounted.
     */
    activate(): boolean {
        const entity = this.entity;
        const player = this.player;
        if (!entity || !player) return false;

        const container = this.#container();
        if (!container || container.size !== this.slotCount) {
            this.#reportError(`Surface inventory is not ready (expected ${this.slotCount} slots).`);
            return false;
        }

        try {
            const rideable = entity.getComponent(RIDEABLE_COMPONENT_ID) as EntityRideableComponent | undefined;
            if (!rideable) {
                this.#reportError("Surface entity has no rideable component.");
                return false;
            }
            if (!rideable.addRider(player)) {
                this.#reportError("The viewer could not be seated on the surface entity.");
                return false;
            }

            if (this.#hintMessage) {
                try {
                    player.onScreenDisplay.setActionBar(this.#hintMessage);
                } catch (error) {
                    this.#reportError(`Failed to show the hint: ${String(error)}`);
                }
            }
        } catch (error) {
            this.#reportError(`Failed to mount the player: ${String(error)}`);
            return false;
        }

        this.#scanner.start();
        this.#watchdogRunId = system.runInterval(() => this.#checkLiveness(), WATCHDOG_INTERVAL_TICKS);
        return true;
    }

    /** {@inheritDoc HostAdapter.writeSlot} */
    writeSlot(index: number, item: ItemView | null): void {
        if (this.#isClosed) return;
        const container = this.#container();
        if (!container) return;

        const isUiOwned = !this.#playerWritable.has(index);
        try {
            const stack = toItemStack(item, { isUiOwned });
            this.#scanner.writeSlot({ container, index, stack, isUiOwned });
            this.#written.record({ index, item, isUiOwned, stack });
        } catch (error) {
            this.#reportError(`Failed to write slot ${index}: ${String(error)}`);
        }
    }

    /** {@inheritDoc HostAdapter.readSlot} */
    readSlot(index: number): ItemView | null {
        const container = this.#container();
        if (!container) return null;
        try {
            return fromItemStack(container.getItem(index));
        } catch (error) {
            this.#reportError(`Failed to read slot ${index}: ${String(error)}`);
            return null;
        }
    }

    /** {@inheritDoc HostAdapter.playSound} */
    playSound(soundId: string): void {
        try {
            this.player?.playSound(soundId);
        } catch (error) {
            this.#reportError(`Failed to play sound "${soundId}": ${String(error)}`);
        }
    }

    /**
     * See `HostAdapter.takeBackFromViewer`. Retried on watchdog ticks, up to `MAX_REVOKE_ATTEMPTS`
     * attempts, and once more on close; what is never found is reported to `onTrace` as a
     * `conflict-unresolved` record.
     */
    takeBackFromViewer(item: ItemView): void {
        this.#revocations.request(item);
    }

    /** See `HostAdapter.giveToViewer`. */
    giveToViewer(item: ItemView): void {
        const isGiven = this.#viewer.returnItem(null, item) !== null;
        this.#trace(`conflict-given-back item=${item.typeId} amount=${item.amount ?? 1} ok=${isGiven}`);
    }

    /** {@inheritDoc HostAdapter.onInteraction} */
    onInteraction(handler: (interaction: HostInteraction) => void): Dispose {
        this.#interactionHandlers.add(handler);
        return () => {
            this.#interactionHandlers.delete(handler);
        };
    }

    /** {@inheritDoc HostAdapter.onClose} */
    onClose(handler: (reason: CloseReason) => void): Dispose {
        this.#closeHandlers.add(handler);
        return () => {
            this.#closeHandlers.delete(handler);
        };
    }

    /**
     * Closes the surface: settles inputs, hands real items back, removes the entity and sweeps the
     * viewer's inventory. Idempotent.
     *
     * @param reason Why it closes.
     */
    close(reason: CloseReason = "programmatic"): void {
        if (this.#isClosed || this.#isClosing) return;
        this.#isClosing = true;
        // Settle inputs first, while the core is still mounted.
        settleUnscannedInputs({
            playerWritable: this.#playerWritable,
            expected: this.#expected,
            probe: (index) => this.#scanner.probe(index),
            read: (index) => this.readSlot(index),
            emit: (interaction) => this.#emitInteraction(interaction),
        });
        this.#isClosed = true;

        this.#stopWatching();
        this.#settleWorld();
        for (const handler of Array.from(this.#closeHandlers)) {
            try {
                handler(reason);
            } catch (error) {
                this.#reportError(`Close handler threw: ${String(error)}`);
            }
        }
    }

    /**
     * Removes rendered items from the viewer's inventory.
     *
     * @returns How many stacks were removed.
     */
    scrubPlayerInventory(): number {
        return this.#viewer.scrub();
    }

    /** @internal Called by the global container-closed hook. */
    notifyPlayerClosed(): void {
        this.close("player");
    }

    /**
     * Scan cost and activity. `detectionMs` sums one 1 ms-quantised sample per pass, so it
     * overstates passes under a millisecond; use {@link measureScanCost} for those.
     */
    get scanStats(): ScanStats & { scrubbedStacks: number } {
        return {
            ...this.#scanner.stats,
            scrubbedStacks: this.#viewer.scrubbedStacks,
        };
    }

    /**
     * Times scan passes run back to back.
     *
     * @param passes How many passes to run.
     * @returns Milliseconds, or `null` while a take is in flight.
     */
    measureScanCost(passes: number): number | null {
        return this.#scanner.measureCost(passes);
    }

    /**
     * Times the parts of a scan pass apart, each over `passes` passes: the setup alone
     * (`setupMs`), the setup with a probe of every slot (`probesMs`), and whole passes
     * (`passesMs`).
     *
     * @param passes How many passes to run for each part.
     * @returns The timings in milliseconds, or `null` while a take is in flight.
     */
    measureScanPhases(passes: number): ScanPhases | null {
        return this.#scanner.measurePhases(passes);
    }

    /** @internal See `HostAdapter.setPlayerWritableSlots`. */
    setPlayerWritableSlots(indices: ReadonlySet<number>, mirrored: ReadonlySet<number> = new Set()): void {
        this.#playerWritable = indices;
        this.#mirrored = mirrored;
    }

    /** Stops the scan, the watchdog and the guard subscription, and leaves the registry. */
    #stopWatching(): void {
        this.#scanner.stop();
        if (this.#watchdogRunId !== null) system.clearRun(this.#watchdogRunId);
        this.#watchdogRunId = null;

        this.#unsubscribeGuard?.();
        this.#unsubscribeGuard = null;
        this.#viewer.dispose();

        if (this.#entityId) surfacesByEntityId.delete(this.#entityId);
        if (surfaceByPlayerId.get(this.#viewer.playerId) === this) surfaceByPlayerId.delete(this.#viewer.playerId);
    }

    /**
     * Hands back and removes now, or next tick when the engine is in its read-only window: a close
     * from a `beforeEvents` handler could neither return items nor remove the entity.
     */
    #settleWorld(): void {
        if (canWriteWorld(this.#container())) {
            this.#handBackAndRemove();
            return;
        }
        this.#trace("close-deferred reason=restricted-execution");
        system.run(() => this.#handBackAndRemove());
    }

    /** Hands the viewer what is theirs, removes the entity, and sweeps their inventory now and a few ticks later. */
    #handBackAndRemove(): void {
        this.#viewer.discardMarkedCursor();
        this.#revocations.settle();
        this.#scanner.rescueStorageButtons();
        returnStrandedItems({
            container: this.#container(),
            slotCount: this.slotCount,
            mirrored: this.#mirrored,
            entity: this.entity,
            returnToPlayer: (item) => this.#viewer.returnItem(null, item),
            trace: (message) => this.#trace(message),
            reportError: (message) => this.#reportError(message),
        });

        const entity = this.entity;
        if (entity?.isValid) {
            try {
                entity.remove();
            } catch (error) {
                this.#reportError(`Failed to remove the surface entity: ${String(error)}`);
            }
        }

        this.scrubPlayerInventory();
        for (const delayTicks of CLOSE_SCRUB_DELAYS_TICKS) system.runTimeout(() => this.#scrubAfterClose(), delayTicks);
    }

    /**
     * A delayed sweep of the viewer after this surface closed. While the viewer has a newer surface
     * that surface sweeps instead: what it removes reaches its tracker, which owns the copies of
     * its own buttons, where this surface's tracker is gone.
     */
    #scrubAfterClose(): void {
        const current = surfaceByPlayerId.get(this.#viewer.playerId);
        if (current && current !== this && !current.isClosed) {
            current.scrubPlayerInventory();
            return;
        }
        this.scrubPlayerInventory();
    }

    #container(): Container | null {
        const entity = this.entity;
        return entity ? inventoryContainerOf(entity) : null;
    }

    #emitInteraction(interaction: HostInteraction): void {
        for (const handler of Array.from(this.#interactionHandlers)) {
            try {
                handler(interaction);
            } catch (error) {
                this.#reportError(`Interaction handler threw: ${String(error)}`);
            }
        }
    }

    #checkLiveness(): void {
        if (this.#isClosed) return;

        const entity = this.entity;
        const player = this.player;
        if (!entity?.isValid || !player?.isValid) {
            this.close("invalidated");
            return;
        }

        const dx = player.location.x - entity.location.x;
        const dy = player.location.y - entity.location.y;
        const dz = player.location.z - entity.location.z;
        if (dx * dx + dy * dy + dz * dz > this.#maxViewDistance * this.#maxViewDistance) {
            this.close("distance");
            return;
        }

        this.#revocations.retry();
        this.scrubPlayerInventory();
    }

    #trace(message: string): void {
        this.#onTrace?.(message);
    }

    #reportError(message: string): void {
        if (this.#onError) {
            this.#onError(message);
            return;
        }
        log({ level: "warn", source: "surface", message });
    }
}
