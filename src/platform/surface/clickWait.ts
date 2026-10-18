/**
 * The wait for a player's click on an entity the engine opens by itself: how long it has run, and the
 * entity kept in their head meanwhile, where every click they make lands on it.
 */

import { system, type Entity, type Player, type Vector3 } from "@minecraft/server";

/** How far, in blocks, the player's head may move before the entity waiting for their click follows it. */
const FOLLOW_TOLERANCE = 0.01;

/**
 * The squared distance between two points.
 *
 * @returns It, in blocks squared.
 */
export const squaredDistance = (from: Vector3, to: Vector3): number => (from.x - to.x) ** 2 + (from.y - to.y) ** 2 + (from.z - to.z) ** 2;

/**
 * Moves an entity into a player's head once it has drifted out: a sneaking player's head drops, and
 * rises as they stand.
 *
 * @param entity The entity, or `null` once gone.
 * @param player The player, or `null` once gone.
 */
export const keepInHead = (entity: Entity | null, player: Player | null): void => {
    if (!entity || !player || entity.dimension.id !== player.dimension.id) return;
    try {
        const head = player.getHeadLocation();
        if (squaredDistance(head, entity.location) > FOLLOW_TOLERANCE ** 2) entity.teleport(head);
    } catch {
        // Gone mid-tick: whoever owns the entity notices.
    }
};

/**
 * Checks a wait for a click.
 *
 * @throws {RangeError} For a wait that is not a positive whole number of ticks.
 */
export const assertClickWaitTicks = (waitTicks: number): void => {
    if (!(Number.isInteger(waitTicks) && waitTicks > 0)) {
        throw new RangeError(`[ContainerUI] clickWaitTicks must be a positive whole number of ticks, not ${waitTicks}.`);
    }
};

/** A wait for a click, with an optional step run every tick until it ends. */
export class ClickWait {
    readonly #waitTicks: number;
    #since: number | null = null;
    #followRunId: number | null = null;

    /**
     * @param waitTicks How long the click is waited for.
     * @throws {RangeError} For a wait that is not a positive whole number of ticks.
     */
    constructor(waitTicks: number) {
        assertClickWaitTicks(waitTicks);
        this.#waitTicks = waitTicks;
    }

    /** Ticks waited, once the wait has run out; otherwise `undefined`. */
    get overdueTicks(): number | undefined {
        if (this.#since === null) return undefined;
        const waited = system.currentTick - this.#since;
        return waited >= this.#waitTicks ? waited : undefined;
    }

    /**
     * Starts the wait from this tick.
     *
     * @param follow Run every tick until the wait ends, such as {@link keepInHead}.
     */
    start(follow?: () => void): void {
        this.#since = system.currentTick;
        if (follow) this.#followRunId = system.runInterval(follow, 1);
    }

    /** Ends the wait: the click came, or it no longer matters. */
    end(): void {
        this.#since = null;
        this.dispose();
    }

    /** Stops the step the wait runs. */
    dispose(): void {
        if (this.#followRunId !== null) system.clearRun(this.#followRunId);
        this.#followRunId = null;
    }
}
