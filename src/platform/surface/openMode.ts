/** How a viewer gets a surface's screen: seated on the entity, or by their own click on it. */

import type { Entity, EntityRideableComponent, Player, Vector3 } from "@minecraft/server";
import { CLICK_OPEN_WAIT_TICKS, RIDEABLE_COMPONENT_ID, SURFACE_CLICK_BOX_EVENT, SURFACE_NO_SEAT_EVENT, SURFACE_VIEWER_PROPERTY } from "../constants.js";
import { ClickWait, keepInHead, squaredDistance } from "./clickWait.js";
import type { BedrockSurfaceOptions, SurfaceClickPoint, SurfaceOpenMode } from "./surfaceOptions.js";

/**
 * Seats the viewer on the surface entity.
 *
 * @returns Whether they were seated; a refusal is reported.
 */
const seatViewer = ({ entity, player, reportError }: { entity: Entity; player: Player; reportError: (message: string) => void }): boolean => {
    const rideable = entity.getComponent(RIDEABLE_COMPONENT_ID) as EntityRideableComponent | undefined;
    if (!rideable) {
        reportError("Surface entity has no rideable component.");
        return false;
    }
    if (!rideable.addRider(player)) {
        reportError("The viewer could not be seated on the surface entity.");
        return false;
    }
    return true;
};

/** Whether a value is a point of three finite coordinates. */
const isPoint = (value: unknown): value is Vector3 => {
    if (typeof value !== "object" || value === null) return false;
    const { x, y, z } = value as Partial<Vector3>;
    return [x, y, z].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
};

/**
 * Whether the viewer has gone out of the surface's reach: farther than `maxDistance` blocks from its
 * entity, or into another dimension, where coordinates mean another place.
 */
export const isBeyondReach = ({ player, entity, maxDistance }: { player: Player; entity: Entity; maxDistance: number }): boolean => {
    return player.dimension.id !== entity.dimension.id || squaredDistance(player.location, entity.location) > maxDistance ** 2;
};

/** What an `OpenMode` is built from. */
export interface OpenModeOptions {
    /** The surface's options: `openBy`, `clickAt`, `clickWaitTicks` and `hintMessage` are read. */
    options: Pick<BedrockSurfaceOptions, "openBy" | "clickAt" | "clickWaitTicks" | "hintMessage">;
    /** Where the viewer stands now, to check a click point against `maxViewDistance`. */
    viewerLocation: Vector3;
    maxViewDistance: number;
    /** The viewer and the entity, resolved on every use. */
    player: () => Player | null;
    entity: () => Entity | null;
    reportError: (message: string) => void;
}

/**
 * One surface's way to its viewer: where its entity spawns, how the viewer is let in once the menu is
 * written, and, for a click, the wait for it.
 */
export class OpenMode {
    readonly #openBy: SurfaceOpenMode;
    readonly #clickAt: SurfaceClickPoint;
    readonly #clickWait: ClickWait;
    readonly #hintMessage: string | undefined;
    readonly #player: () => Player | null;
    readonly #entity: () => Entity | null;
    readonly #reportError: (message: string) => void;
    #isLive = false;

    /**
     * @param setup The surface's options, and its viewer and entity.
     * @throws {RangeError} For an `openBy` other than `"seat"` or `"click"`, click options without
     * `openBy: "click"`, a `clickAt` that is neither `"head"` nor a point, a wait that is not a
     * positive whole number of ticks, or a point beyond `maxViewDistance`.
     */
    constructor(setup: OpenModeOptions) {
        const { options, viewerLocation, maxViewDistance } = setup;
        const { clickAt, clickWaitTicks } = options;
        const openBy = options.openBy ?? "seat";
        if (openBy !== "seat" && openBy !== "click") throw new RangeError(`[ContainerUI] openBy must be "seat" or "click", not ${String(openBy)}.`);
        if (openBy !== "click" && (clickAt !== undefined || clickWaitTicks !== undefined)) {
            throw new RangeError(`[ContainerUI] clickAt and clickWaitTicks need openBy: "click".`);
        }
        if (clickAt !== undefined && clickAt !== "head" && !isPoint(clickAt)) {
            throw new RangeError(`[ContainerUI] clickAt must be "head" or a point { x, y, z } of finite numbers.`);
        }
        if (typeof clickAt === "object" && squaredDistance(clickAt, viewerLocation) > maxViewDistance ** 2) {
            throw new RangeError(`[ContainerUI] clickAt is farther than maxViewDistance (${maxViewDistance}) from the viewer: the menu would close at once.`);
        }
        this.#openBy = openBy;
        this.#clickAt = clickAt ?? "head";
        this.#clickWait = new ClickWait(clickWaitTicks ?? CLICK_OPEN_WAIT_TICKS);
        this.#hintMessage = options.hintMessage;
        this.#player = setup.player;
        this.#entity = setup.entity;
        this.#reportError = setup.reportError;
    }

    /** Whether the viewer has been let in. Until then the menu is not ready, and a click on it is refused. */
    get isLive(): boolean {
        return this.#isLive;
    }

    /** Ticks waited, once the wait for the click has run out; otherwise `undefined`. */
    get overdueTicks(): number | undefined {
        return this.#clickWait.overdueTicks;
    }

    /**
     * Where the surface entity spawns: at the viewer's feet to seat them, in their head, or at the
     * chosen point.
     *
     * @param player The viewer.
     * @returns The spawn location.
     */
    spawnLocationFor(player: Player): Vector3 {
        const point = this.#openBy === "seat" ? player.location : this.#clickAt === "head" ? player.getHeadLocation() : this.#clickAt;
        const { x, y, z } = point;
        return { x, y, z };
    }

    /**
     * Marks a freshly spawned entity as this pack's, for its viewer. A menu opened by click takes its
     * seat away, or the click would seat the viewer, and at a chosen point gives it a block-sized box.
     *
     * @param entity The surface entity.
     * @param viewerId The viewer's id.
     */
    prepare(entity: Entity, viewerId: string): void {
        try {
            entity.setDynamicProperty(SURFACE_VIEWER_PROPERTY, viewerId);
            if (this.#openBy !== "click") return;
            entity.triggerEvent(SURFACE_NO_SEAT_EVENT);
            if (this.#clickAt !== "head") entity.triggerEvent(SURFACE_CLICK_BOX_EVENT);
        } catch (error) {
            this.#reportError(`Failed to prepare the surface entity: ${String(error)}`);
        }
    }

    /**
     * Lets the viewer in: seats them, or starts the wait for their click, and shows the hint.
     *
     * @returns Whether they were let in; a failure is reported.
     */
    letIn(): boolean {
        const entity = this.#entity();
        const player = this.#player();
        if (!entity || !player) return false;
        try {
            if (this.#openBy === "seat" && !seatViewer({ entity, player, reportError: this.#reportError })) return false;
        } catch (error) {
            this.#reportError(`Failed to mount the player: ${String(error)}`);
            return false;
        }
        if (this.#hintMessage) {
            try {
                player.onScreenDisplay.setActionBar(this.#hintMessage);
            } catch (error) {
                this.#reportError(`Failed to show the hint: ${String(error)}`);
            }
        }
        // In the head, the entity keeps to it until the click: a sneaking viewer's head drops, and rises as they stand.
        if (this.#openBy === "click") this.#clickWait.start(this.#clickAt === "head" ? () => keepInHead(this.#entity(), this.#player()) : undefined);
        this.#isLive = true;
        return true;
    }

    /** Ends the wait for the click: the viewer has the screen. */
    markOpened(): void {
        this.#clickWait.end();
    }

    /** Stops what the wait runs. */
    dispose(): void {
        this.#clickWait.dispose();
    }
}
