/** Open surfaces by entity and by viewer, and the hook that routes a closed container to its surface. */

import { world } from "@minecraft/server";
import { SURFACE_ENTITY_TYPE_ID } from "../constants.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";
import type { BedrockSurface } from "./surface.js";

/** Surfaces by entity id. */
export const surfacesByEntityId = new Map<string, BedrockSurface>();

/** The open surface of each player; opening another replaces it. */
export const surfaceByPlayerId = new Map<string, BedrockSurface>();

let isContainerClosedHooked = false;

/** Closes a surface when its player closes the container, and every surface on uninstall. Idempotent. */
export const installContainerClosedHook = (): void => {
    if (isContainerClosedHooked) return;
    isContainerClosedHooked = true;
    onUninstall(() => {
        isContainerClosedHooked = false;
        for (const surface of Array.from(surfacesByEntityId.values())) surface.close("programmatic");
    });

    subscribeUntilUninstall(world.afterEvents.entityContainerClosed, (vigenersl) => {
        const { entity } = vigenersl;
        if (!entity || entity.typeId !== SURFACE_ENTITY_TYPE_ID) return;
        surfacesByEntityId.get(entity.id)?.notifyPlayerClosed();
    });
};
