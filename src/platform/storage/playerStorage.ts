/**
 * A player's inventory as a `SlotStorage`. Show the viewer's own inventory with `StorageView`:
 * `StorageSlots` would put the same slots on one screen twice.
 */

import { world, type Player } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { EntityInventoryStorage } from "./entityInventoryStorage.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";

/** Ticks between watch passes. */
export const PLAYER_INVENTORY_WATCH_INTERVAL_TICKS = 2;

/** One storage per player. */
const storageByPlayerId = new Map<string, PlayerInventoryStorage>();

let isLeaveHookInstalled = false;

/** Evicts a player's storage when they leave, and every storage on uninstall. */
const installLeaveHook = (): void => {
    if (isLeaveHookInstalled) return;
    isLeaveHookInstalled = true;
    onUninstall(() => {
        isLeaveHookInstalled = false;
        for (const playerId of Array.from(storageByPlayerId.keys())) PlayerInventoryStorage.evict(playerId);
    });

    subscribeUntilUninstall(world.afterEvents.playerLeave, (vigenersl) => {
        const { playerId } = vigenersl;
        PlayerInventoryStorage.evict(playerId);
    });
};

/** A player's inventory as a live `SlotStorage`. Slots 0–8 are the hotbar, 9–35 the main grid. */
export class PlayerInventoryStorage extends EntityInventoryStorage<Player> {
    readonly #playerName: string;

    private constructor(player: Player) {
        super(player, PLAYER_INVENTORY_WATCH_INTERVAL_TICKS);
        this.#playerName = player.name;
    }

    /**
     * The shared storage for a player, created on first use.
     *
     * @param player The player.
     * @returns The storage every view of that player's inventory shares.
     */
    static forPlayer(player: Player): PlayerInventoryStorage {
        installLeaveHook();
        const existing = storageByPlayerId.get(player.id);
        if (existing) return existing;
        const created = new PlayerInventoryStorage(player);
        storageByPlayerId.set(player.id, created);
        return created;
    }

    /** Drops a player's storage. */
    static evict(playerId: string): void {
        storageByPlayerId.get(playerId)?._dispose();
        storageByPlayerId.delete(playerId);
    }

    /** The player's entity id. */
    get playerId(): string {
        return this.entityId;
    }

    /** The player, or `null` once they are gone. */
    get player(): Player | null {
        return this._entity();
    }

    protected override _containerGone(index: number): Error {
        return new Error(`[ContainerUI] Player ${this.#playerName} is gone; cannot write inventory slot ${index}.`);
    }

    protected override _onInvalid(): void {
        log({ level: "info", source: "storage", message: `player-inventory invalidated player=${this.#playerName} playerId=${this.entityId}` });
        PlayerInventoryStorage.evict(this.entityId);
    }
}
