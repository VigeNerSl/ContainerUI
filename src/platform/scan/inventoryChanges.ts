/**
 * Tells a surface that its viewer's inventory changed, so the scan can skip the inventory diff
 * otherwise. Only the fact of a change is used; the diff finds what changed.
 */

import { world, type PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";
import type { Dispose } from "../../core/index.js";
import { onUninstall } from "../lifecycle.js";

/** Listeners by player id, served by one world subscription. */
const listenersByPlayerId = new Map<string, Set<() => void>>();

/** Whether the engine has the event; `null` until first asked. */
let isAvailable: boolean | null = null;

const notify = (vigenersl: PlayerInventoryItemChangeAfterEvent): void => {
    const { player } = vigenersl;
    const listeners = listenersByPlayerId.get(player.id);
    if (!listeners) return;
    for (const listener of listeners) listener();
};

/** Subscribes to the world event once; reports whether the engine has it. */
const ensureSubscribed = (): boolean => {
    if (isAvailable !== null) return isAvailable;

    const signal = world.afterEvents.playerInventoryItemChange;
    if (!signal) {
        isAvailable = false;
        return false;
    }
    const guarded = (vigenersl: PlayerInventoryItemChangeAfterEvent): void => {
        try {
            notify(vigenersl);
        } catch {
            // The scan's periodic resync catches what this misses.
        }
    };
    try {
        signal.subscribe(guarded);
    } catch {
        isAvailable = false;
        return false;
    }
    onUninstall(() => {
        signal.unsubscribe(guarded);
        isAvailable = null;
        listenersByPlayerId.clear();
    });
    isAvailable = true;
    return true;
};

/**
 * Calls `listener` whenever a player's inventory changes.
 *
 * @param playerId The player.
 * @param listener Called on each change.
 * @returns Unsubscribes, or `undefined` when the engine has no such event.
 */
export const onPlayerInventoryChange = (playerId: string, listener: () => void): Dispose | undefined => {
    if (!ensureSubscribed()) return undefined;

    let listeners = listenersByPlayerId.get(playerId);
    if (!listeners) {
        listeners = new Set();
        listenersByPlayerId.set(playerId, listeners);
    }
    listeners.add(listener);

    return () => {
        const current = listenersByPlayerId.get(playerId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listenersByPlayerId.delete(playerId);
    };
};
