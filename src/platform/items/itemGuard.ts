/** Destroys rendered items that escape a menu, and refuses their use. */

import {
    system,
    world,
    type Block,
    type BlockContainerClosedAfterEvent,
    type BlockContainerOpenedAfterEvent,
    type Container,
    type ContainerAccessSource,
    type EntityContainerClosedAfterEvent,
    type EntityContainerOpenedAfterEvent,
    type Entity,
    type EntityItemDropAfterEvent,
    type EntityLoadAfterEvent,
    type EntitySpawnAfterEvent,
    type EntityItemComponent,
    type ItemStack,
    type ItemUseBeforeEvent,
    type Player,
    type PlayerInteractWithBlockBeforeEvent,
    type PlayerInteractWithEntityBeforeEvent,
    type PlayerSpawnAfterEvent,
} from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { HELD_STORAGE_ENTITY_TYPE_ID, ITEM_COMPONENT_ID, ITEM_ENTITY_TYPE_ID, SURFACE_ENTITY_TYPE_ID } from "../constants.js";
import { blockContainerOf, enderContainerOf, inventoryContainerOf } from "../storage/inventoryContainer.js";
import { isRenderedItem } from "./itemMarker.js";
import { takeOwnItemsOut } from "./storageItems.js";
import { removedProbeOf, scrubContainer, scrubInventoryOf, scrubStorageItem, setLostItemReporter, spillAt, spillToPlayer, type Place } from "./itemSweeps.js";
import type { SlotProbe } from "../scan/slotMatching.js";
import { onUninstall, type WorldSignal } from "../lifecycle.js";

/** What the guard has done since it was last installed. `uninstallBedrockRuntime` resets the counters. */
export interface ItemGuardStats {
    /** Loose item entities examined. */
    inspected: number;
    /** Rendered items destroyed. */
    destroyed: number;
    /** Rendered items the engine refused to remove. */
    removalFailed: number;
}

/**
 * Called when a rendered item was destroyed in the world.
 *
 * @param probe The destroyed item.
 * @param ownerId The entity that dropped it, when known.
 * @returns `true` to claim the item, so no other listener sees it.
 */
export type MarkedItemListener = (probe: SlotProbe, ownerId?: string) => boolean;

const stats: ItemGuardStats = { inspected: 0, destroyed: 0, removalFailed: 0 };
const listeners = new Set<MarkedItemListener>();

let isInstalled = false;
let logger: ((detail: string) => void) | null = null;

const report = (detail: string): void => {
    if (!logger) {
        log({ level: "info", source: "item-guard", message: detail });
        return;
    }
    try {
        logger(detail);
    } catch {
        // A logger must not break the guard.
    }
};

/** Offers a destroyed copy to the listeners until one claims it. */
const announce = (probe: SlotProbe, ownerId?: string): void => {
    Array.from(listeners).some((listener) => {
        try {
            return listener(probe, ownerId);
        } catch {
            // A listener must not break the guard.
            return false;
        }
    });
};

/** Subscribes to a world event until uninstall, with the handler guarded, and reports an event that is missing. */
const subscribeGuarded = <TEvent>({
    signal,
    label,
    handler,
}: {
    signal: WorldSignal<TEvent> | undefined;
    label: string;
    handler: (event: TEvent) => void;
}): void => {
    if (!signal) {
        report(`${label} unavailable`);
        return;
    }
    const guarded = (vigenersl: TEvent): void => {
        try {
            handler(vigenersl);
        } catch (error) {
            report(`handler=${label} failed error=${String(error)}`);
        }
    };
    try {
        signal.subscribe(guarded);
    } catch (error) {
        report(`${label} unavailable: ${String(error)}`);
        return;
    }
    onUninstall(() => signal.unsubscribe(guarded));
};

/** The dropped entities of an `entityItemDrop` event, whether it gives an array or an iterable. */
const droppedEntitiesOf = (value: unknown): Entity[] => {
    if (Array.isArray(value)) return value as Entity[];
    if (typeof value === "object" && value !== null && typeof (value as Iterable<Entity>)[Symbol.iterator] === "function") {
        return [...(value as Iterable<Entity>)];
    }
    return [];
};

const stackOf = (itemEntity: Entity): ItemStack | undefined => {
    try {
        const component = itemEntity.getComponent(ITEM_COMPONENT_ID) as EntityItemComponent | undefined;
        return component?.itemStack;
    } catch {
        return undefined;
    }
};

/** Removes `candidate` if it is a loose rendered item, and announces it. */
const destroyIfRendered = ({ candidate, reason, ownerId }: { candidate: Entity | undefined; reason: string; ownerId?: string | undefined }): boolean => {
    // Cheap rejections first: this runs for every entity spawn in the world.
    if (!candidate) return false;
    if (candidate.typeId !== ITEM_ENTITY_TYPE_ID) return false;
    if (!candidate.isValid) return false;

    stats.inspected++;

    const stack = stackOf(candidate);
    if (!stack || !isRenderedItem(stack)) return false;

    const { dimension, location } = candidate;
    const own = takeOwnItemsOut(stack);
    try {
        candidate.remove();
        stats.destroyed++;
        report(`reason=${reason} item=${stack.typeId} destroyed=${stats.destroyed}`);
    } catch (error) {
        stats.removalFailed++;
        report(`reason=${reason} removal-failed error=${String(error)}`);
        return false;
    }
    // Only once the copy is gone: the player's own items left beside it would be a second set.
    own.forEach(spillAt({ dimension, location }));
    announce(removedProbeOf(stack), ownerId);
    return true;
};

/**
 * Replaces a thrown storage item that holds rendered copies with a clean one. A loose item's stack
 * cannot be written, so a clean copy is spawned in its place before the old one goes: a failed spawn
 * leaves the player's storage item where it was, and a failed removal takes the clean copy back.
 * Own items that did not fit back into it drop beside it.
 */
const cleanThrownStorage = ({ candidate, ownerId }: { candidate: Entity; ownerId: string | undefined }): void => {
    if (candidate.typeId !== ITEM_ENTITY_TYPE_ID || !candidate.isValid) return;
    const stack = stackOf(candidate);
    if (!stack || isRenderedItem(stack)) return;
    const probes: SlotProbe[] = [];
    const spilled: ItemStack[] = [];
    const removed = scrubStorageItem(stack, { onRemoved: (probe) => probes.push(probe), spill: (own) => spilled.push(own) });
    if (removed === 0) return;
    const { dimension, location } = candidate;
    let clean: Entity;
    try {
        clean = dimension.spawnItem(stack, location);
    } catch (error) {
        report(`reason=drop storage-respawn-failed item=${stack.typeId} error=${String(error)}`);
        return;
    }
    try {
        candidate.remove();
    } catch (error) {
        // Two of the player's storage items would lie there: the clean one goes back.
        if (clean.isValid) clean.remove();
        report(`reason=drop storage-removal-failed item=${stack.typeId} error=${String(error)}`);
        return;
    }
    // Only once the old one is gone: the own items that did not fit back would otherwise be a second set.
    spilled.forEach(spillAt({ dimension, location }));
    report(`reason=drop item=${stack.typeId} swept=${removed}`);
    probes.forEach((probe) => announce(probe, ownerId));
};

/** Cancels an action performed with a rendered stack. */
const refuseMarked = ({
    event,
    stack,
    reason,
    isReported = true,
}: {
    event: { cancel: boolean };
    stack: ItemStack | undefined;
    reason: string;
    isReported?: boolean;
}): void => {
    if (!stack || !isRenderedItem(stack)) return;
    event.cancel = true;
    if (isReported) report(`reason=${reason} item=${stack.typeId}`);
};

/** The container of a valid entity, or `null`. */
const entityContainerOf = (entity: Entity | undefined): Container | null => {
    return entity?.isValid ? inventoryContainerOf(entity) : null;
};

/**
 * Sweeps a player's inventory, worn slots and ender chest; the copies removed go to `onRemoved`.
 *
 * @returns How many stacks were removed.
 */
const scrubPlayer = (player: Player, onRemoved?: (probe: SlotProbe) => void): number => {
    return scrubInventoryOf(player, onRemoved) + scrubContainer(enderContainerOf(player), { onRemoved, spill: spillToPlayer(player) });
};

/**
 * Sweeps a container someone opened or closed, and the player who did, their ender chest included,
 * which every ender chest shows them. Each copy removed is announced as that player's, like a thrown
 * one. Their own items that do not fit back go to them, or, with nobody known, drop at the container's
 * place.
 */
const sweepAccessed = ({
    container,
    place,
    source,
    reason,
}: {
    container: Container | null;
    place: Place | undefined;
    source: ContainerAccessSource | undefined;
    reason: string;
}): void => {
    const accessor = source?.entity;
    const player = accessor?.typeId === "minecraft:player" ? (accessor as Player) : undefined;
    const ownerId = player?.id;
    const onRemoved = (probe: SlotProbe): void => announce(probe, ownerId);
    const spill = player ? spillToPlayer(player) : place ? spillAt(place) : undefined;
    const removed = scrubContainer(container, { onRemoved, spill }) + (player ? scrubPlayer(player, onRemoved) : 0);
    if (removed > 0) report(`reason=${reason} swept=${removed}`);
};

/** Sweeps one player, their ender inventory included, and reports what went. */
const sweepPlayer = (player: Player, reason: string): void => {
    const removed = scrubPlayer(player);
    if (removed > 0) report(`reason=${reason} player=${player.name} swept=${removed}`);
};

/**
 * Everyone already in the world when the guard installs: after a script reload nobody joins, and an
 * add-on that installs the guard with its first menu has missed every join before it.
 */
const sweepOnlinePlayers = (): void => {
    try {
        world.getAllPlayers().forEach((player) => sweepPlayer(player, "install"));
    } catch (error) {
        report(`reason=install sweep-failed error=${String(error)}`);
    }
};

/** A thrown item: the only event that names the thrower. */
const onItemDropped = (vigenersl: EntityItemDropAfterEvent): void => {
    const { entity, items } = vigenersl;
    const ownerId = entity?.id;
    const dropped = droppedEntitiesOf(items);
    if (dropped.length === 0) {
        report(`reason=drop items-unreadable owner=${ownerId ?? "unknown"}`);
        return;
    }
    dropped.forEach((item) => {
        if (!destroyIfRendered({ candidate: item, reason: "drop", ownerId })) cleanThrownStorage({ candidate: item, ownerId });
    });
};

/** A loose item spawned during play. One loaded with its chunk goes through `onEntityLoaded` instead. */
const onEntitySpawned = (vigenersl: EntitySpawnAfterEvent): void => {
    const { entity } = vigenersl;
    destroyIfRendered({ candidate: entity, reason: "spawn" });
};

/**
 * A loose item in a chunk that has just loaded: a copy lying on the ground when the world last
 * saved is not a spawn, so `entitySpawn` never saw it.
 */
const onEntityLoaded = (vigenersl: EntityLoadAfterEvent): void => {
    const { entity } = vigenersl;
    destroyIfRendered({ candidate: entity, reason: "load" });
};

/** A player who logged out holding a copy. */
const onPlayerJoined = (vigenersl: PlayerSpawnAfterEvent): void => {
    const { player, initialSpawn } = vigenersl;
    if (initialSpawn) sweepPlayer(player, "join");
};

/** Where what a block's sweep cannot put back drops: the centre of the block, not its corner. */
const centreOf = (block: Block): Place | undefined => {
    try {
        return { dimension: block.dimension, location: block.center() };
    } catch {
        return undefined;
    }
};

/**
 * A chest, furnace, hopper or ender chest: its contents and whoever opened it are swept. On open,
 * because a hopper can have filled it unopened; on close, for a copy put in while it was open.
 */
const onBlockContainerOpened = (vigenersl: BlockContainerOpenedAfterEvent): void => {
    const { block, openSource } = vigenersl;
    sweepAccessed({ container: blockContainerOf(block), place: centreOf(block), source: openSource, reason: "container-opened" });
};

const onBlockContainerClosed = (vigenersl: BlockContainerClosedAfterEvent): void => {
    const { block, closeSource } = vigenersl;
    sweepAccessed({ container: blockContainerOf(block), place: centreOf(block), source: closeSource, reason: "container-closed" });
};

/**
 * Whether an entity's container is swept by its own owner: a menu entity's slots are the menu's
 * copies and its viewer's inventory the menu's to sweep, whichever pack spawned it; a held storage
 * entity's slots are the storage's items, which its open writes through and never hands out twice.
 */
const isSweptElsewhere = (entity: Entity | undefined): boolean => {
    return entity?.typeId === SURFACE_ENTITY_TYPE_ID || entity?.typeId === HELD_STORAGE_ENTITY_TYPE_ID;
};

/** A chest minecart, a donkey, a llama, a block's storage entity: swept on open and on close. */
const onEntityContainerOpened = (vigenersl: EntityContainerOpenedAfterEvent): void => {
    const { entity, openSource } = vigenersl;
    if (isSweptElsewhere(entity)) return;
    sweepAccessed({ container: entityContainerOf(entity), place: entity?.isValid ? entity : undefined, source: openSource, reason: "entity-container-opened" });
};

/** See {@link onEntityContainerOpened}. */
const onEntityContainerClosed = (vigenersl: EntityContainerClosedAfterEvent): void => {
    const { entity, closeSource } = vigenersl;
    if (isSweptElsewhere(entity)) return;
    sweepAccessed({ container: entityContainerOf(entity), place: entity?.isValid ? entity : undefined, source: closeSource, reason: "entity-container-closed" });
};

/** A copy that escaped cannot be used. */
const onItemUse = (vigenersl: ItemUseBeforeEvent): void => {
    const { itemStack } = vigenersl;
    refuseMarked({ event: vigenersl, stack: itemStack, reason: "use-refused" });
};

/** A copy cannot be used on a block. The engine repeats the event while the button is held: only the first is reported. */
const onInteractWithBlock = (vigenersl: PlayerInteractWithBlockBeforeEvent): void => {
    const { itemStack, isFirstEvent } = vigenersl;
    refuseMarked({ event: vigenersl, stack: itemStack, reason: "interact-refused", isReported: isFirstEvent !== false });
};

/** A copy cannot be used on an entity. */
const onInteractWithEntity = (vigenersl: PlayerInteractWithEntityBeforeEvent): void => {
    const { itemStack } = vigenersl;
    refuseMarked({ event: vigenersl, stack: itemStack, reason: "entity-interact-refused" });
};

/**
 * Subscribes to rendered items destroyed in the world. The first listener to claim one wins.
 *
 * @param listener Called for each destroyed item.
 * @returns A function that unsubscribes.
 */
export const onMarkedItemDestroyed = (listener: MarkedItemListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/**
 * Sets a reporter for guard activity alone, instead of the logger set by `setLogger`, where it
 * arrives as `info` records.
 *
 * @param reporter Receives one line per event, or `null` to send them to the logger again.
 */
export const setItemGuardLogger = (reporter: ((detail: string) => void) | null): void => {
    logger = reporter;
};

/**
 * A snapshot of guard activity so far.
 *
 * @returns A copy of the counters.
 */
export const getItemGuardStats = (): ItemGuardStats => {
    return { ...stats };
};

/**
 * Subscribes the guard to the world, and sweeps every player in it on the next tick: at startup the
 * world has not loaded yet. Idempotent; `installBedrockRuntime` and every surface call it.
 */
export const installItemGuard = (): void => {
    if (isInstalled) return;
    isInstalled = true;
    setLostItemReporter(report);
    onUninstall(() => {
        isInstalled = false;
        stats.inspected = 0;
        stats.destroyed = 0;
        stats.removalFailed = 0;
    });

    subscribeGuarded({ signal: world.afterEvents.entityItemDrop, label: "entityItemDrop", handler: onItemDropped });
    subscribeGuarded({ signal: world.afterEvents.entitySpawn, label: "entitySpawn", handler: onEntitySpawned });
    subscribeGuarded({ signal: world.afterEvents.entityLoad, label: "entityLoad", handler: onEntityLoaded });
    subscribeGuarded({ signal: world.afterEvents.playerSpawn, label: "playerSpawn", handler: onPlayerJoined });
    subscribeGuarded({ signal: world.afterEvents.blockContainerOpened, label: "blockContainerOpened", handler: onBlockContainerOpened });
    subscribeGuarded({ signal: world.afterEvents.blockContainerClosed, label: "blockContainerClosed", handler: onBlockContainerClosed });
    subscribeGuarded({ signal: world.afterEvents.entityContainerOpened, label: "entityContainerOpened", handler: onEntityContainerOpened });
    subscribeGuarded({ signal: world.afterEvents.entityContainerClosed, label: "entityContainerClosed", handler: onEntityContainerClosed });
    subscribeGuarded({ signal: world.beforeEvents.itemUse, label: "itemUse", handler: onItemUse });
    subscribeGuarded({ signal: world.beforeEvents.playerInteractWithBlock, label: "playerInteractWithBlock", handler: onInteractWithBlock });
    subscribeGuarded({ signal: world.beforeEvents.playerInteractWithEntity, label: "playerInteractWithEntity", handler: onInteractWithEntity });

    // Subscribing is allowed before the world loads and in a read-only window; sweeping is not.
    system.run(sweepOnlinePlayers);
};
