/** One storage per player of each kind, dropped when the player leaves, and every one on uninstall. */

import { world } from "@minecraft/server";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";

/** What the leave hook needs of a registry. */
interface Evicting {
    evict(playerId: string): void;
    evictAll(): void;
}

const registries = new Set<Evicting>();

let isLeaveHookInstalled = false;

/** Evicts a player's storages when they leave, and every storage on uninstall. */
const installLeaveHook = (): void => {
    if (isLeaveHookInstalled) return;
    isLeaveHookInstalled = true;
    onUninstall(() => {
        isLeaveHookInstalled = false;
        registries.forEach((registry) => registry.evictAll());
    });

    subscribeUntilUninstall(world.afterEvents.playerLeave, (vigenersl) => {
        const { playerId } = vigenersl;
        registries.forEach((registry) => registry.evict(playerId));
    });
};

/** The storages of one kind, by player id. */
export class PlayerRegistry<TStorage> implements Evicting {
    readonly #byPlayerId = new Map<string, TStorage>();
    readonly #dispose: (storage: TStorage) => void;

    /** @param dispose Stops a storage for good when it is evicted. */
    constructor(dispose: (storage: TStorage) => void) {
        this.#dispose = dispose;
        registries.add(this);
    }

    /**
     * A player's storage, created on first use.
     *
     * @param playerId The player's id.
     * @param create Builds the storage the first time.
     * @returns The storage every caller for that player shares.
     */
    obtain(playerId: string, create: () => TStorage): TStorage {
        installLeaveHook();
        const existing = this.#byPlayerId.get(playerId);
        if (existing) return existing;
        const created = create();
        this.#byPlayerId.set(playerId, created);
        return created;
    }

    /** Drops a player's storage. */
    evict(playerId: string): void {
        const storage = this.#byPlayerId.get(playerId);
        if (!storage) return;
        this.#byPlayerId.delete(playerId);
        this.#dispose(storage);
    }

    /** Drops every storage. */
    evictAll(): void {
        Array.from(this.#byPlayerId.keys()).forEach((playerId) => this.evict(playerId));
    }
}
