/** Who has a storage entity open: menus over it, and players viewing its inventory natively. */

import type { ContainerSession } from "../surface/openContainer.js";

/** Open menus per storage entity. */
const sessionsByEntityId = new Map<string, Set<ContainerSession>>();

/**
 * Records a menu opened over a storage entity.
 *
 * @param entityId The storage entity.
 * @param session The menu.
 * @returns How many menus are open over it.
 */
export const registerSession = (entityId: string, session: ContainerSession): number => {
    let sessions = sessionsByEntityId.get(entityId);
    if (!sessions) {
        sessions = new Set();
        sessionsByEntityId.set(entityId, sessions);
    }
    sessions.add(session);
    return sessions.size;
};

/** Forgets a closed menu. */
export const unregisterSession = (entityId: string, session: ContainerSession): void => {
    const sessions = sessionsByEntityId.get(entityId);
    if (!sessions) return;
    sessions.delete(session);
    if (sessions.size === 0) sessionsByEntityId.delete(entityId);
};

/**
 * Closes every menu open over a storage entity and forgets them. One that fails to close does not
 * stop the others, and is not kept: the entity it was open over is going.
 */
export const closeSessions = (entityId: string): void => {
    const sessions = sessionsByEntityId.get(entityId);
    if (!sessions) return;
    for (const session of Array.from(sessions)) {
        try {
            session.close();
        } catch {
            // Closed by the liveness check, or gone with its player.
        }
    }
    sessionsByEntityId.delete(entityId);
};

const nativeViewersByEntityId = new Map<string, Set<string>>();

/**
 * Records a native open or close of a storage entity's inventory.
 *
 * @returns How many players have it open.
 */
export const recordNativeAccess = ({ entityId, viewerId, isOpen }: { entityId: string; viewerId: string; isOpen: boolean }): number => {
    const viewers = nativeViewersByEntityId.get(entityId) ?? new Set<string>();
    if (isOpen) viewers.add(viewerId);
    else viewers.delete(viewerId);
    if (viewers.size > 0) nativeViewersByEntityId.set(entityId, viewers);
    else nativeViewersByEntityId.delete(entityId);
    return viewers.size;
};

/** Forgets a viewer on every storage entity. */
export const forgetNativeViewer = (viewerId: string): void => {
    for (const [entityId, viewers] of nativeViewersByEntityId) {
        viewers.delete(viewerId);
        if (viewers.size === 0) nativeViewersByEntityId.delete(entityId);
    }
};

/** Whether anyone has this storage entity open, through a menu or natively. */
export const hasOpenSessions = (entityId: string): boolean => {
    return (sessionsByEntityId.get(entityId)?.size ?? 0) + (nativeViewersByEntityId.get(entityId)?.size ?? 0) > 0;
};
