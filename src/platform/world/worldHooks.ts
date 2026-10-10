/** Hooks for world state: a scoreboard score and a dynamic property, polled while mounted. */

import { system, world, type Entity, type Vector3 } from "@minecraft/server";
import { useExternal, type ExternalSubscribe } from "../../core/index.js";

/** Ticks between reads when a hook is given no interval. */
const DEFAULT_POLL_TICKS = 10;

const readScore = ({ name, entityId, objective }: { name: string | undefined; entityId: string | undefined; objective: string }): number | undefined => {
    try {
        const scoreObjective = world.scoreboard.getObjective(objective);
        if (!scoreObjective) return undefined;
        if (name !== undefined) return scoreObjective.getScore(name);
        const entity = entityId !== undefined ? world.getEntity(entityId) : undefined;
        return entity ? scoreObjective.getScore(entity) : undefined;
    } catch {
        return undefined;
    }
};

const readDynamicProperty = ({ key, ownerId }: { key: string; ownerId: string | undefined }): DynamicPropertyValue => {
    try {
        if (ownerId === undefined) return world.getDynamicProperty(key);
        return world.getEntity(ownerId)?.getDynamicProperty(key);
    } catch {
        return undefined;
    }
};

/** Vectors compare by coordinates. */
const isSamePropertyValue = (previous: DynamicPropertyValue, next: DynamicPropertyValue): boolean => {
    if (Object.is(previous, next)) return true;
    if (typeof previous !== "object" || typeof next !== "object") return false;
    return previous.x === next.x && previous.y === next.y && previous.z === next.z;
};

/** A subscription that notifies every `intervalTicks`. */
const pollEvery = (intervalTicks: number): ExternalSubscribe => {
    return (vigenersl) => {
        const handle = system.runInterval(vigenersl, Math.max(1, Math.floor(intervalTicks)));
        return () => system.clearRun(handle);
    };
};

/** Whose score {@link useScore} reads, and how often. */
export interface ScoreOptions {
    /** An entity, or a fake player's name. */
    participant: Entity | string;
    /** The objective's id. */
    objective: string;
    /** Ticks between reads. Defaults to 10. */
    intervalTicks?: number;
}

/**
 * A participant's score on an objective.
 *
 * @param options Participant, objective and poll interval.
 * @returns The score, or `undefined` when there is none.
 * @example
 * const coins = useScore({ participant: player, objective: "coins" });
 */
export const useScore = (options: ScoreOptions): number | undefined => {
    const { participant, objective } = options;
    const name = typeof participant === "string" ? participant : undefined;
    const entityId = typeof participant === "string" ? undefined : participant.id;
    return useExternal({
        subscribe: pollEvery(options.intervalTicks ?? DEFAULT_POLL_TICKS),
        read: () => readScore({ name, entityId, objective }),
    });
};

/** What a dynamic property can hold; `undefined` when unset. */
export type DynamicPropertyValue = boolean | number | string | Vector3 | undefined;

/** Which dynamic property {@link useDynamicProperty} reads, and how often. */
export interface DynamicPropertyOptions {
    /** The property id. */
    key: string;
    /** The entity holding it. Defaults to the world. */
    owner?: Entity;
    /** Ticks between reads. Defaults to 10. */
    intervalTicks?: number;
}

/**
 * A dynamic property of the world or of an entity.
 *
 * @param options Key, owner and poll interval.
 * @returns The value, or `undefined` when unset.
 * @example
 * const motd = useDynamicProperty({ key: "server:motd" });
 */
export const useDynamicProperty = (options: DynamicPropertyOptions): DynamicPropertyValue => {
    const { key } = options;
    const ownerId = options.owner?.id;
    return useExternal({
        subscribe: pollEvery(options.intervalTicks ?? DEFAULT_POLL_TICKS),
        read: () => readDynamicProperty({ key, ownerId }),
        equals: isSamePropertyValue,
    });
};
