/**
 * Menu entities this pack left behind: open when a restart, a crash or a script reload came, so no
 * surface owns them any more. They still hold their slots, and a click would show them to anyone.
 */

import { system, world, type Entity, type EntityLoadAfterEvent } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { SURFACE_ENTITY_TYPE_ID, SURFACE_MIRRORED_PROPERTY, SURFACE_VIEWER_PROPERTY } from "../constants.js";
import { realItemsOf, spillAt, spillToPlayer } from "../items/itemSweeps.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { forEachLoadedEntity, playerById } from "../world/entities.js";

let isOpen: (entityId: string) => boolean = () => false;
let isSweepInstalled = false;

/** Whether a menu entity is this pack's, and no open surface owns it. */
const isOrphanSurface = (entity: Entity): boolean => {
    return isOwnSurface(entity) && !isOpen(entity.id);
};

/** The mirror slots an entity recorded. */
const mirroredSlotsOf = (entity: Entity): Set<number> => {
    const recorded = entity.getDynamicProperty(SURFACE_MIRRORED_PROPERTY);
    if (typeof recorded !== "string" || recorded === "") return new Set();
    return new Set(recorded.split(",").map(Number));
};

const onSurfaceLoaded = (vigenersl: EntityLoadAfterEvent): void => {
    const { entity } = vigenersl;
    removeIfOrphaned(entity);
};

/** Every menu entity loaded when the sweep installs: after a reload or a restart, none is open. */
const sweepLoadedSurfaces = (): void => {
    forEachLoadedEntity({ type: SURFACE_ENTITY_TYPE_ID }, removeIfOrphaned);
};

/**
 * Whether a menu entity carries this pack's mark. Dynamic properties belong to the pack that set
 * them, so another pack's menu entity carries none this pack can read.
 *
 * @param entity A menu entity.
 * @returns Whether this pack spawned it.
 */
export const isOwnSurface = (entity: Entity): boolean => {
    try {
        return entity.getDynamicProperty(SURFACE_VIEWER_PROPERTY) !== undefined;
    } catch {
        return false;
    }
};

/**
 * Records a surface entity's mirror slots, for {@link removeIfOrphaned}.
 *
 * @param entity The surface entity, or `null` before it spawns.
 * @param mirrored The mirror slots.
 */
export const recordMirroredSlots = (entity: Entity | null, mirrored: ReadonlySet<number>): void => {
    if (!entity) return;
    const value = Array.from(mirrored).join(",");
    try {
        if (entity.getDynamicProperty(SURFACE_MIRRORED_PROPERTY) !== value) entity.setDynamicProperty(SURFACE_MIRRORED_PROPERTY, value);
    } catch {
        // Written again with the next change.
    }
};

/**
 * Empties and removes an orphaned menu entity. The real items a player put in go back to its viewer,
 * or to the ground; marked copies and mirror slots, whose items their storage still keeps, go nowhere.
 *
 * @param entity Any entity; one that is not an orphaned menu entity is left alone.
 * @returns Whether it was removed.
 */
export const removeIfOrphaned = (entity: Entity): boolean => {
    try {
        if (!entity.isValid || entity.typeId !== SURFACE_ENTITY_TYPE_ID || !isOrphanSurface(entity)) return false;
        const { id, dimension, location } = entity;
        const viewerId = String(entity.getDynamicProperty(SURFACE_VIEWER_PROPERTY));
        const container = inventoryContainerOf(entity);
        const mirrored = mirroredSlotsOf(entity);
        const real = container ? realItemsOf(container).filter(({ index }) => !mirrored.has(index)) : [];
        // Emptied before anything is handed out: an entity that failed halfway would hand it out again.
        container?.clearAll();
        try {
            entity.remove();
        } catch (error) {
            // Empty now, so it holds nothing to hand out twice; its items still go back below.
            log({ level: "warn", source: "surface", message: `orphan-surface-remove-failed error=${String(error)}` });
        }
        const viewer = playerById(viewerId);
        real.forEach(({ stack }) => (viewer ? spillToPlayer(viewer) : spillAt({ dimension, location }))(stack));
        log({ level: "info", source: "surface", message: `orphan-surface-removed entityId=${id} viewer=${viewerId} returned=${real.length}` });
        return true;
    } catch (error) {
        log({ level: "warn", source: "surface", message: `orphan-surface-remove-failed error=${String(error)}` });
        return false;
    }
};

/**
 * Removes this pack's orphaned menu entities: those loaded now, on the next tick, and each one whose
 * chunk loads later. Idempotent.
 *
 * @param isSurfaceOpen Whether an entity id belongs to an open surface.
 */
export const installOrphanSurfaceSweep = (isSurfaceOpen: (entityId: string) => boolean): void => {
    isOpen = isSurfaceOpen;
    if (isSweepInstalled) return;
    isSweepInstalled = true;
    onUninstall(() => {
        isSweepInstalled = false;
    });

    subscribeUntilUninstall(world.afterEvents.entityLoad, onSurfaceLoaded);
    const sweepRunId = system.run(sweepLoadedSurfaces);
    onUninstall(() => system.clearRun(sweepRunId));
};
