/** What a storage opened by click hears from the world, and the call that opens one. */

import {
    system,
    world,
    type Entity,
    type EntityContainerClosedAfterEvent,
    type EntityContainerOpenedAfterEvent,
    type EntityDieAfterEvent,
    type EntityLoadAfterEvent,
    type Player,
    type PlayerInteractWithBlockBeforeEvent,
    type PlayerInteractWithEntityBeforeEvent,
    type PlayerLeaveAfterEvent,
    type PlayerSpawnAfterEvent,
} from "@minecraft/server";
import { HELD_RESUME_ATTEMPTS, HELD_RESUME_RETRY_TICKS, HELD_STORAGE_ENTITY_TYPE_ID } from "../constants.js";
import { onUninstall, subscribeUntilUninstall } from "../lifecycle.js";
import { assertClickWaitTicks } from "../surface/clickWait.js";
import { entityById, forEachLoadedEntity, playerById } from "../world/entities.js";
import { addHeldItem, type HeldItemOptions } from "./heldItems.js";
import { abandonPending, awaitedOf, forgetAwaited, isAwaitingReturn, isPending, onKeptForOwner, ownerIdOf, registerHeldSource, releaseLeftovers, resumePending } from "./heldRecovery.js";
import { releaseShulkerBoxes, resumeEnderChest, resumeShulkerBox } from "./heldSources.js";
import { discardHeldStorage, endHeldSessions, heldSessionFor, heldSessionOf, startHeldSession, type HeldOpenOptions, type HeldSource } from "./heldStorage.js";

let isInstalled = false;
/** Players whose return is being settled, each with the run doing it: a run of an earlier visit stops. */
const settling = new Map<string, number>();
let lastRun = 0;

/** This pack's held entities loaded now that wait for `playerId`'s return. */
const waitingFor = (playerId: string): Entity[] => {
    const found: Entity[] = [];
    forEachLoadedEntity({ type: HELD_STORAGE_ENTITY_TYPE_ID }, (entity) => {
        if (ownerIdOf(entity) === playerId && isPending(entity)) found.push(entity);
    });
    return found;
};

/**
 * Settles what an open cut short left on a player who is back: first each screen they left open is
 * written into its storage, waited for while its chunk has not loaded and tried again while the
 * storage cannot be reached, then the rest is released, such as a shulker box still locked. A screen
 * that never comes leaves its storage as last written.
 */
const settleReturn = ({ playerId, run, attemptsLeft }: { playerId: string; run: number; attemptsLeft: number }): void => {
    if (settling.get(playerId) !== run) return;
    const owner = playerById(playerId);
    if (!owner) {
        settling.delete(playerId);
        return;
    }
    const later = heldSessionFor(playerId) ? [] : waitingFor(playerId).filter((entity) => resumePending({ entity, owner }) === "later");
    // An open of theirs is under way, from before they left the screens kept: release nothing under it.
    const isBusy = heldSessionFor(playerId) !== undefined;
    if ((isBusy || later.length > 0 || awaitedOf(playerId).length > 0) && attemptsLeft > 0) {
        system.runTimeout(() => settleReturn({ playerId, run, attemptsLeft: attemptsLeft - 1 }), HELD_RESUME_RETRY_TICKS);
        return;
    }
    settling.delete(playerId);
    if (isBusy) return;
    later.forEach(abandonPending);
    forgetAwaited(playerId);
    releaseLeftovers(owner);
};

/** Settles a player's return after `delayTicks`, unless it is already under way. */
const scheduleReturn = ({ playerId, delayTicks }: { playerId: string; delayTicks: number }): void => {
    if (settling.has(playerId)) return;
    const run = ++lastRun;
    settling.set(playerId, run);
    system.runTimeout(() => settleReturn({ playerId, run, attemptsLeft: HELD_RESUME_ATTEMPTS }), delayTicks);
};

/** Every held storage entity loaded now: after a restart or a reload, none has its session. */
const discardLoaded = (): void => {
    forEachLoadedEntity({ type: HELD_STORAGE_ENTITY_TYPE_ID }, (entity) => discardHeldStorage(entity));
};

/** What opens cut short by a restart or a reload left: copies in the world, marks on the players. */
const cleanUpAfterRestart = (): void => {
    discardLoaded();
    world.getAllPlayers().forEach((player) => scheduleReturn({ playerId: player.id, delayTicks: 0 }));
};

const onHeldOpened = (vigenersl: EntityContainerOpenedAfterEvent): void => {
    const { entity } = vigenersl;
    if (entity?.typeId !== HELD_STORAGE_ENTITY_TYPE_ID) return;
    heldSessionOf(entity.id)?.notifyOpened();
};

const onHeldClosed = (vigenersl: EntityContainerClosedAfterEvent): void => {
    const { entity } = vigenersl;
    if (entity?.typeId !== HELD_STORAGE_ENTITY_TYPE_ID) return;
    heldSessionOf(entity.id)?.finish("closed");
};

/**
 * A click opens this pack's entity only for its owner, and only while it waits for that click. A click
 * on one without a session is refused, and a stale copy goes next tick; one that waits for its owner's
 * return stays. Another pack's entity is left to that pack.
 */
const onHeldClicked = (vigenersl: PlayerInteractWithEntityBeforeEvent): void => {
    const { player, target } = vigenersl;
    if (target?.typeId !== HELD_STORAGE_ENTITY_TYPE_ID || ownerIdOf(target) === undefined) return;
    const session = heldSessionOf(target.id);
    if (session?.acceptsClickFrom(player.id)) return;
    vigenersl.cancel = true;
    if (session) return;
    const targetId = target.id;
    system.run(() => {
        const entity = entityById(targetId);
        if (entity) discardHeldStorage(entity);
    });
};

/**
 * An ender chest block does not open for a player whose kept screen is not written yet: what they
 * changed in it would be written over.
 */
const onEnderChestClicked = (vigenersl: PlayerInteractWithBlockBeforeEvent): void => {
    const { block, player } = vigenersl;
    if (block.typeId !== "minecraft:ender_chest" || !isAwaitingReturn(player.id)) return;
    vigenersl.cancel = true;
};

/**
 * A held entity that loads with its chunk is a copy a restart or a crash left, and goes; one that
 * waits for its owner is settled once they are here.
 */
const onHeldLoaded = (vigenersl: EntityLoadAfterEvent): void => {
    const { entity } = vigenersl;
    if (entity.typeId !== HELD_STORAGE_ENTITY_TYPE_ID || discardHeldStorage(entity) || !isPending(entity)) return;
    const ownerId = ownerIdOf(entity);
    if (ownerId && playerById(ownerId)) scheduleReturn({ playerId: ownerId, delayTicks: 0 });
};

/** A player who joins: the screens they left open are written, then what an open left on them is undone. */
const onPlayerJoined = (vigenersl: PlayerSpawnAfterEvent): void => {
    const { initialSpawn, player } = vigenersl;
    if (!initialSpawn) return;
    discardLoaded();
    // Next tick, and every few ticks after while a kept screen has not loaded yet.
    scheduleReturn({ playerId: player.id, delayTicks: 1 });
};

/**
 * An owner who dies mid-open: the open ends with the last change written where the storage still can
 * take it. A shulker box dropped on their death is unmarked where it lies.
 */
const onOwnerDied = (vigenersl: EntityDieAfterEvent): void => {
    const { deadEntity } = vigenersl;
    heldSessionFor(deadEntity.id)?.finish("died");
};

/** An owner who leaves mid-open: see `notifyOwnerLeft`. */
const onPlayerLeft = (vigenersl: PlayerLeaveAfterEvent): void => {
    const { playerId } = vigenersl;
    try {
        heldSessionFor(playerId)?.notifyOwnerLeft();
    } finally {
        settling.delete(playerId);
    }
};

/**
 * Subscribes storages opened by click to the world, and settles what a restart, a reload or an owner
 * who left cut short: the entities' copies, on the next tick and as they load, and the screens and
 * marks of players as they join. Idempotent; `installBedrockRuntime` calls it. An uninstall ends the
 * opens, each writing its last change.
 */
export const installHeldHooks = (): void => {
    if (isInstalled) return;
    isInstalled = true;
    onUninstall(() => {
        onKeptForOwner(undefined);
        endHeldSessions("uninstalled");
        settling.clear();
        isInstalled = false;
    });
    // A close the storage kept refusing, with the owner still here: written as soon as it can be.
    onKeptForOwner((ownerId) => scheduleReturn({ playerId: ownerId, delayTicks: HELD_RESUME_RETRY_TICKS }));

    registerHeldSource("shulker", { release: releaseShulkerBoxes, resume: resumeShulkerBox });
    registerHeldSource("ender", { release: () => undefined, resume: resumeEnderChest });
    subscribeUntilUninstall(world.afterEvents.entityContainerOpened, onHeldOpened);
    subscribeUntilUninstall(world.afterEvents.entityContainerClosed, onHeldClosed);
    subscribeUntilUninstall(world.beforeEvents.playerInteractWithEntity, onHeldClicked);
    subscribeUntilUninstall(world.beforeEvents.playerInteractWithBlock, onEnderChestClicked);
    subscribeUntilUninstall(world.afterEvents.entityLoad, onHeldLoaded);
    subscribeUntilUninstall(world.afterEvents.playerSpawn, onPlayerJoined);
    subscribeUntilUninstall(world.afterEvents.playerLeave, onPlayerLeft);
    subscribeUntilUninstall(world.afterEvents.entityDie, onOwnerDied);
    const sweepRunId = system.run(cleanUpAfterRestart);
    onUninstall(() => system.clearRun(sweepRunId));
};

/** What opens a storage by click: the source of its contents, and how it behaves. */
export interface HeldStorageOptions extends HeldOpenOptions {
    /** Where the contents live; one source serves one open. */
    source: HeldSource;
}

/**
 * Opens a storage by click: an entity in the player's head shows its contents, their next click opens
 * that entity as a chest, and every change they make is written into the storage as it happens.
 * Nothing is drawn, the screen is the engine's own chest. The storage keeps the items throughout, so
 * a restart or a crash copies none. `source` says what the storage is:
 * `shulkerBoxSource()`, `enderChestSource()`, or your own `HeldSource`.
 *
 * @param player The player.
 * @param options The source, title, wait and observer.
 * @returns Whether the entity is ready for the click; `false` when the player has a storage open
 * already, or the source could not be read.
 * @throws {RangeError} For a `clickWaitTicks` that is not a positive whole number, when called.
 * @example
 * world.afterEvents.itemUse.subscribe((vigenersl) => {
 *     const { source: player, itemStack } = vigenersl;
 *     if (itemStack.typeId === "minecraft:ender_chest") void openHeldStorage(player, { source: enderChestSource() });
 * });
 */
export const openHeldStorage = (player: Player, options: HeldStorageOptions): Promise<boolean> => {
    const { source, ...behaviour } = options;
    if (behaviour.clickWaitTicks !== undefined) assertClickWaitTicks(behaviour.clickWaitTicks);
    installHeldHooks();
    return startHeldSession({ player, source, options: behaviour });
};

/**
 * Makes an item open a storage by click: a player who starts sneaking with it in hand gets an entity in
 * their head showing the storage, their next click opens it as a chest, and their changes are written
 * into the storage. Standing up before the click closes it. Call it at startup, once per kind of item;
 * the first registered item that matches opens.
 *
 * @param options Which items, and the source of the storage for each open.
 * @throws {RangeError} For a `clickWaitTicks` that is not a positive whole number.
 * @example
 * installHeldItem({
 *     matches: (item) => item.typeId === "addon:backpack",
 *     source: (player, item) => backpackSource(item),
 *     title: "Backpack",
 * });
 */
export const installHeldItem = (options: HeldItemOptions): void => {
    addHeldItem(options);
    installHeldHooks();
};
