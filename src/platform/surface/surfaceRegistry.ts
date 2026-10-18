/** Open surfaces by entity and by viewer, and the hooks that route world events to them. */

import { system, world, type EntityContainerOpenedAfterEvent, type PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";
import { SURFACE_ENTITY_TYPE_ID } from "../constants.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";
import { entityById } from "../world/entities.js";
import { installOrphanSurfaceSweep, isOwnSurface, removeIfOrphaned } from "./surfaceOrphans.js";
import type { BedrockSurface } from "./surface.js";

/** Surfaces by entity id. */
export const surfacesByEntityId = new Map<string, BedrockSurface>();

/** The open surface of each player; opening another replaces it. */
export const surfaceByPlayerId = new Map<string, BedrockSurface>();

let isInstalled = false;

/** Ends a click-opened surface's wait once its viewer has the screen. */
const onSurfaceOpened = (vigenersl: EntityContainerOpenedAfterEvent): void => {
    const { entity } = vigenersl;
    if (entity?.typeId !== SURFACE_ENTITY_TYPE_ID) return;
    surfacesByEntityId.get(entity.id)?.notifyPlayerOpened();
};

/**
 * Cancels a click that would show a menu's slots to the wrong player or too early: anyone's but the
 * viewer's, the viewer's before the menu is ready, and any click on an orphaned menu entity of this
 * pack, which goes on the next tick. Another pack's menus are left to that pack.
 */
const onSurfaceClicked = (vigenersl: PlayerInteractWithEntityBeforeEvent): void => {
    const { player, target } = vigenersl;
    if (target?.typeId !== SURFACE_ENTITY_TYPE_ID) return;
    const surface = surfacesByEntityId.get(target.id);
    if (surface && !surface.acceptsClickFrom(player.id)) vigenersl.cancel = true;
    if (surface) return;
    const targetId = target.id;
    // Read-only window: the orphan check and its removal wait a tick.
    system.run(() => {
        const entity = entityById(targetId);
        if (entity) removeIfOrphaned(entity);
    });
    if (isOwnSurface(target)) vigenersl.cancel = true;
};

/**
 * Routes container opens and closes to their surface, refuses the clicks above, removes this pack's
 * orphaned menu entities, and closes every surface on uninstall. Idempotent.
 */
export const installSurfaceHooks = (): void => {
    if (isInstalled) return;
    isInstalled = true;
    onUninstall(() => {
        isInstalled = false;
        for (const surface of Array.from(surfacesByEntityId.values())) surface.close("programmatic");
    });

    subscribeUntilUninstall(world.afterEvents.entityContainerClosed, (vigenersl) => {
        const { entity } = vigenersl;
        if (!entity || entity.typeId !== SURFACE_ENTITY_TYPE_ID) return;
        surfacesByEntityId.get(entity.id)?.notifyPlayerClosed();
    });
    subscribeUntilUninstall(world.afterEvents.entityContainerOpened, onSurfaceOpened);
    subscribeUntilUninstall(world.beforeEvents.playerInteractWithEntity, onSurfaceClicked);
    installOrphanSurfaceSweep((entityId) => surfacesByEntityId.has(entityId));
};
