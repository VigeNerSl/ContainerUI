/**
 * A player's ender chest as a `SlotStorage`: the container every ender chest shows them. Unlike their
 * inventory, it is not on screen under a menu, so `StorageSlots` over it is the usual way to show it.
 */

import type { Container, Player } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { STORAGE_WATCH_INTERVAL_TICKS } from "../constants.js";
import { EntityInventoryStorage } from "./entityInventoryStorage.js";
import { enderContainerOf } from "./inventoryContainer.js";
import { PlayerRegistry } from "./playerRegistry.js";

/**
 * A player's ender chest as a live `SlotStorage`. What a menu writes is what every ender chest then
 * shows them, and what they change at an ender chest reaches a watching menu.
 */
export class PlayerEnderStorage extends EntityInventoryStorage<Player> {
    static readonly #registry = new PlayerRegistry<PlayerEnderStorage>((storage) => storage._dispose());

    readonly #playerName: string;

    private constructor(player: Player) {
        super(player, STORAGE_WATCH_INTERVAL_TICKS);
        this.#playerName = player.name;
    }

    /**
     * The shared storage for a player's ender chest, created on first use.
     *
     * @param player The player, online.
     * @returns The storage every view of that player's ender chest shares.
     */
    static forPlayer(player: Player): PlayerEnderStorage {
        return PlayerEnderStorage.#registry.obtain(player.id, () => new PlayerEnderStorage(player));
    }

    /** Drops a player's storage. */
    static evict(playerId: string): void {
        PlayerEnderStorage.#registry.evict(playerId);
    }

    /** The player's entity id. */
    get playerId(): string {
        return this.entityId;
    }

    /** The player, or `null` once they are gone. */
    get player(): Player | null {
        return this._entity();
    }

    protected override _containerOf(entity: Player): Container | null {
        return enderContainerOf(entity);
    }

    protected override _containerGone(index: number): Error {
        return new Error(`[ContainerUI] Player ${this.#playerName} is gone; cannot write ender chest slot ${index}.`);
    }

    protected override _onInvalid(): void {
        log({ level: "info", source: "storage", message: `player-ender invalidated player=${this.#playerName} playerId=${this.entityId}` });
        PlayerEnderStorage.evict(this.entityId);
    }
}
