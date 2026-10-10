/**
 * Sneak-to-break: a player sneaking at a container block parks its storage entity at a hidden Y,
 * so the block can be broken, and puts it back when they stop, look away or leave. Anything still
 * parked goes back at startup and when its entity loads.
 */

import {
    system,
    world,
    type Entity,
    type EntityHitBlockAfterEvent,
    type EntityHitEntityAfterEvent,
    type EntityLoadAfterEvent,
    type Player,
    type PlayerLeaveAfterEvent,
} from "@minecraft/server";
import {
    BREAKING_BLOCK_KEY_PROPERTY,
    BREAKING_COOLDOWN_TICKS,
    BREAKING_OWNER_PROPERTY,
    HIDDEN_TAG,
    SNEAK_BREAK_HINT_DURATION_TICKS,
    SNEAK_BREAK_HINT_MESSAGE,
    SNEAK_RAYCAST_DISTANCE,
    SNEAK_TICK_INTERVAL,
    STORAGE_ENTITY_TYPE_ID,
    STORAGE_UUID_PROPERTY,
    BLOCK_KEY_PROPERTY,
    DIMENSION_IDS,
    hiddenYFor,
} from "../constants.js";
import { componentNameOf, emitBlockEvent } from "./blockEvents.js";
import { blockKeyOf, isContainerBlockType, parseBlockKey, type ParsedBlockKey } from "./blockKeys.js";
import { findBlockStorageEntity, findHiddenStorageByStoredId } from "./blockRegistry.js";
import { hasOpenSessions } from "./blockSessions.js";
import { onUninstall, runIntervalUntilUninstall, subscribeUntilUninstall } from "../lifecycle.js";

/** A break in progress: whose storage, at which block. */
interface BreakingState extends ParsedBlockKey {
    storedId: string;
    blockKey: string;
    /** The parked entity, when known; otherwise it is found by `storedId`. */
    entityId: string | null;
}

const breakingByPlayerId = new Map<string, BreakingState>();
/** Each component's hint; `null` shows none. A component not listed gets the default. */
const hintByComponent = new Map<string, string | null>();
const restoreCooldownByStoredId = new Map<string, number>();
/** The hint timer each player has running; a new hit restarts it instead of adding another. */
const hintRunIdByPlayerId = new Map<string, number>();
const RAYCAST_OPTIONS = { maxDistance: SNEAK_RAYCAST_DISTANCE };

let isInstalled = false;

/** The block a storage entity belongs to, read from its recorded key. */
const recordedBlockOf = (entity: Entity): { blockKey: string; parsed: ParsedBlockKey } | null => {
    const blockKey = entity.getDynamicProperty(BLOCK_KEY_PROPERTY);
    if (typeof blockKey !== "string") return null;
    const parsed = parseBlockKey(blockKey);
    return parsed ? { blockKey, parsed } : null;
};

/**
 * Sets the hint a component's block shows when it is hit without sneaking.
 *
 * @param componentName The registered component.
 * @param message The action-bar text, or `null` for none.
 */
export const registerSneakHint = (componentName: string, message: string | null): void => {
    hintByComponent.set(componentName, message);
};

/** Starts a restored entity's cooldown, and forgets the cooldowns that have run out, so the map holds only the live ones. */
const startRestoreCooldown = (storedId: string): void => {
    const now = system.currentTick;
    for (const [knownId, restoredAt] of restoreCooldownByStoredId) {
        if (now - restoredAt >= BREAKING_COOLDOWN_TICKS) restoreCooldownByStoredId.delete(knownId);
    }
    restoreCooldownByStoredId.set(storedId, now);
};

/**
 * How many cooldowns the map holds. One that has run out stays until the next restore prunes it.
 *
 * @internal Exported for the cooldown pruning check in `tools/smoke/core/blocks.mjs`.
 */
export const countRestoreCooldowns = (): number => {
    return restoreCooldownByStoredId.size;
};

/** Whether an entity is a valid player. */
const isPlayer = (entity: Entity | undefined): entity is Player => {
    return entity !== undefined && entity.isValid && entity.typeId === "minecraft:player";
};

/** Whether an entity is a valid storage entity. */
const isStorage = (entity: Entity | undefined): entity is Entity => {
    return entity !== undefined && entity.isValid && entity.typeId === STORAGE_ENTITY_TYPE_ID;
};

const stopSneakHint = (playerId: string): void => {
    const runId = hintRunIdByPlayerId.get(playerId);
    if (runId === undefined) return;
    system.clearRun(runId);
    hintRunIdByPlayerId.delete(playerId);
};

/** Shows the hint of the storage's component on the action bar for a while. */
const showSneakHint = (player: Player, storage: Entity): void => {
    const component = componentNameOf(storage);
    const message = hintByComponent.has(component) ? hintByComponent.get(component) : SNEAK_BREAK_HINT_MESSAGE;
    if (!message) return;

    stopSneakHint(player.id);
    let elapsedTicks = 0;
    const runId = system.runInterval(() => {
        if (!player.isValid || elapsedTicks >= SNEAK_BREAK_HINT_DURATION_TICKS) {
            stopSneakHint(player.id);
            return;
        }
        try {
            player.onScreenDisplay.setActionBar(message);
        } catch {
            stopSneakHint(player.id);
        }
        elapsedTicks += SNEAK_TICK_INTERVAL;
    }, SNEAK_TICK_INTERVAL);
    hintRunIdByPlayerId.set(player.id, runId);
};

/** Every few ticks: starts breaks for sneaking players aimed at a storage entity, and ends breaks that stopped. */
const tick = (): void => {
    // Sneaking players looking at a storage entity start a break.
    for (const player of world.getAllPlayers()) {
        if (!player.isSneaking || breakingByPlayerId.has(player.id)) continue;
        try {
            const hits = player.getEntitiesFromViewDirection(RAYCAST_OPTIONS);
            for (const hit of hits) {
                if (isStorage(hit.entity)) {
                    tryHide(player, hit.entity);
                    break;
                }
            }
        } catch {
            // Retried next tick.
        }
    }

    // A break ends when the player stops sneaking or looks away.
    for (const [playerId, state] of breakingByPlayerId) {
        try {
            const player = world.getEntity(playerId) as Player | undefined;
            if (!player?.isValid || !player.isSneaking) {
                restoreByState(state, "stopped-sneaking");
                if (player?.isValid) clearBreakingFlags(player);
                else breakingByPlayerId.delete(playerId);
                continue;
            }

            const blockHit = player.getBlockFromViewDirection(RAYCAST_OPTIONS);
            const looksAtSameBlock =
                blockHit?.block !== undefined &&
                state.dimensionId === player.dimension.id &&
                state.x === Math.floor(blockHit.block.location.x) &&
                state.y === Math.floor(blockHit.block.location.y) &&
                state.z === Math.floor(blockHit.block.location.z);

            if (!looksAtSameBlock) {
                restoreByState(state, "looked-away");
                clearBreakingFlags(player);
            }
        } catch {
            // One bad player state does not stop the rest.
        }
    }
};

/** Parks a storage entity at the hidden Y so its block can be broken, unless it is open or just came back. */
const tryHide = (player: Player, entity: Entity): void => {
    const storedId = entity.getDynamicProperty(STORAGE_UUID_PROPERTY);
    if (typeof storedId !== "string") return;

    if (hasOpenSessions(entity.id)) return;

    const lastRestore = restoreCooldownByStoredId.get(storedId) ?? 0;
    if (system.currentTick - lastRestore < BREAKING_COOLDOWN_TICKS) return;

    const recorded = recordedBlockOf(entity);
    if (!recorded) return;
    const { blockKey, parsed } = recorded;

    try {
        const hiddenY = hiddenYFor(entity.dimension);
        entity.addTag(HIDDEN_TAG);
        entity.teleport({ x: entity.location.x, y: hiddenY, z: entity.location.z }, { dimension: entity.dimension });
    } catch {
        return;
    }

    player.setDynamicProperty(BREAKING_OWNER_PROPERTY, storedId);
    player.setDynamicProperty(BREAKING_BLOCK_KEY_PROPERTY, blockKey);
    breakingByPlayerId.set(player.id, { storedId, blockKey, ...parsed, entityId: entity.id });

    emitBlockEvent({ kind: "sneak-hide", component: componentNameOf(entity), blockKey, player: player.name, detail: `uuid=${storedId}` });
};

/** Ends a break: finds the parked entity by id or stored id and puts it back, starting its cooldown. */
const restoreByState = (state: BreakingState, reason: string): void => {
    try {
        const dimension = world.getDimension(state.dimensionId);

        let entity = state.entityId ? (world.getEntity(state.entityId) ?? null) : null;
        if (!entity?.isValid || entity.getDynamicProperty(STORAGE_UUID_PROPERTY) !== state.storedId) {
            entity = findHiddenStorageByStoredId(dimension, state.storedId);
        }

        // No entity: the block broke while it was parked.
        if (entity) {
            restoreToItsBlock(entity, reason);
            startRestoreCooldown(state.storedId);
        }
    } catch {
        // Restored as it loads.
    }
};

/** Moves a parked storage entity back into its block and clears its hidden tag. */
const restoreToItsBlock = (entity: Entity, reason: string): void => {
    const recorded = recordedBlockOf(entity);
    if (!recorded) return;
    const { blockKey, parsed } = recorded;

    try {
        entity.removeTag(HIDDEN_TAG);
        entity.teleport({ x: parsed.x + 0.5, y: parsed.y, z: parsed.z + 0.5 }, { dimension: entity.dimension });
        emitBlockEvent({ kind: "sneak-restore", component: componentNameOf(entity), blockKey, detail: `reason=${reason}` });
    } catch {
        // Restored as it loads.
    }
};

/** Forgets a player's break, in memory and in the properties that survive a rejoin. */
const clearBreakingFlags = (player: Player): void => {
    player.setDynamicProperty(BREAKING_OWNER_PROPERTY, undefined);
    player.setDynamicProperty(BREAKING_BLOCK_KEY_PROPERTY, undefined);
    breakingByPlayerId.delete(player.id);
};

/** Puts back anything left parked, and reloads the breaks saved on players. */
const resumeAfterStartup = (): void => {
    for (const dimensionId of DIMENSION_IDS) {
        try {
            const dimension = world.getDimension(dimensionId);
            const hidden = dimension.getEntities({ type: STORAGE_ENTITY_TYPE_ID, tags: [HIDDEN_TAG] });
            for (const entity of hidden) restoreToItsBlock(entity, "startup");
        } catch {
            // Restored as its entities load.
        }
    }

    for (const player of world.getAllPlayers()) {
        const storedId = player.getDynamicProperty(BREAKING_OWNER_PROPERTY);
        const blockKey = player.getDynamicProperty(BREAKING_BLOCK_KEY_PROPERTY);
        if (typeof storedId !== "string" || typeof blockKey !== "string") continue;
        const parsed = parseBlockKey(blockKey);
        if (!parsed) continue;
        breakingByPlayerId.set(player.id, { storedId, blockKey, ...parsed, entityId: null });
    }
};

const onStorageLoaded = (vigenersl: EntityLoadAfterEvent): void => {
    const { entity } = vigenersl;
    if (entity.typeId !== STORAGE_ENTITY_TYPE_ID) return;

    const blockKey = entity.getDynamicProperty(BLOCK_KEY_PROPERTY);
    emitBlockEvent({
        kind: "storage-loaded",
        component: componentNameOf(entity),
        ...(typeof blockKey === "string" ? { blockKey } : {}),
        detail: `entityId=${entity.id} hidden=${entity.hasTag(HIDDEN_TAG)}`,
    });

    if (entity.hasTag(HIDDEN_TAG)) restoreToItsBlock(entity, "entity-load");
};

const onPlayerLeft = (vigenersl: PlayerLeaveAfterEvent): void => {
    const { playerId } = vigenersl;
    // Put back what they parked: once the break is forgotten, no tick would.
    const state = breakingByPlayerId.get(playerId);
    if (state) restoreByState(state, "player-left");
    breakingByPlayerId.delete(playerId);
    stopSneakHint(playerId);
};

/** Hides the storage for a sneaking player, or shows the hint to one standing. */
const answerHit = (player: Player, storage: Entity): void => {
    if (player.isSneaking) tryHide(player, storage);
    else showSneakHint(player, storage);
};

const onStorageHit = (vigenersl: EntityHitEntityAfterEvent): void => {
    const { damagingEntity, hitEntity } = vigenersl;
    if (!isPlayer(damagingEntity) || !isStorage(hitEntity)) return;

    const blockKey = hitEntity.getDynamicProperty(BLOCK_KEY_PROPERTY);
    emitBlockEvent({
        kind: "hit-entity",
        component: componentNameOf(hitEntity),
        ...(typeof blockKey === "string" ? { blockKey } : {}),
        player: damagingEntity.name,
        detail: `sneaking=${damagingEntity.isSneaking === true}`,
    });
    answerHit(damagingEntity, hitEntity);
};

const onContainerBlockHit = (vigenersl: EntityHitBlockAfterEvent): void => {
    const { damagingEntity, hitBlock } = vigenersl;
    // Any block hit by any player lands here: look up storage only for container block types.
    if (!isPlayer(damagingEntity) || !hitBlock || !isContainerBlockType(hitBlock.typeId)) return;

    let storageEntity: Entity | null = null;
    try {
        storageEntity = findBlockStorageEntity(hitBlock.dimension, hitBlock.location);
    } catch {
        return;
    }
    if (!storageEntity) return;

    emitBlockEvent({
        kind: "hit-block",
        component: componentNameOf(storageEntity),
        blockKey: blockKeyOf(hitBlock.dimension.id, hitBlock.location),
        player: damagingEntity.name,
        detail: `block=${hitBlock.typeId} sneaking=${damagingEntity.isSneaking === true}`,
    });
    answerHit(damagingEntity, storageEntity);
};

/** Starts sneak-to-break. Idempotent; called by `registerBlockContainer`. */
export const installBlockSneak = (): void => {
    if (isInstalled) return;
    isInstalled = true;
    onUninstall(() => {
        isInstalled = false;
        breakingByPlayerId.clear();
        restoreCooldownByStoredId.clear();
        for (const playerId of Array.from(hintRunIdByPlayerId.keys())) stopSneakHint(playerId);
    });

    runIntervalUntilUninstall(tick, SNEAK_TICK_INTERVAL);
    system.run(resumeAfterStartup);
    subscribeUntilUninstall(world.afterEvents.entityLoad, onStorageLoaded);
    subscribeUntilUninstall(world.afterEvents.playerLeave, onPlayerLeft);
    subscribeUntilUninstall(world.afterEvents.entityHitEntity, onStorageHit);
    subscribeUntilUninstall(world.afterEvents.entityHitBlock, onContainerBlockHit);
};
