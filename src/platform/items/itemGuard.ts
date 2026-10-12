/** Destroys rendered items that escape a menu, and refuses their use. */

import {
    EquipmentSlot,
    world,
    type Block,
    type BlockContainerClosedAfterEvent,
    type BlockContainerOpenedAfterEvent,
    type BlockInventoryComponent,
    type Container,
    type ContainerAccessSource,
    type EntityContainerClosedAfterEvent,
    type EntityContainerOpenedAfterEvent,
    type Entity,
    type EntityItemDropAfterEvent,
    type EntityLoadAfterEvent,
    type EntitySpawnAfterEvent,
    type EntityEquippableComponent,
    type EntityItemComponent,
    type ItemStack,
    type Player,
    type PlayerSpawnAfterEvent,
} from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { EQUIPPABLE_COMPONENT_ID, INVENTORY_COMPONENT_ID, ITEM_COMPONENT_ID, ITEM_ENTITY_TYPE_ID, SURFACE_ENTITY_TYPE_ID } from "../constants.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { isRenderedItem, stripLoreMarker } from "./itemMarker.js";
import { addOwnItems, storageContainerOf, takeOwnItemsOut } from "./storageItems.js";
import { probeOfStack } from "../scan/slotHandles.js";
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

/** Worn slots and the off hand; the main hand is part of the inventory container. */
const SCRUBBED_EQUIPMENT: readonly EquipmentSlot[] = [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Offhand,
];

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

/** A player's own item, taken out of a removed copy, that nothing could take. */
const reportLost = (stack: ItemStack): void => report(`reason=sweep own-item-lost item=${stack.typeId} amount=${stack.amount}`);

/** A removed copy's probe, with its lore: the one read that tells two buttons of one kind apart. */
const removedProbeOf = (stack: ItemStack): SlotProbe => {
    const probe = probeOfStack(stack);
    try {
        return { ...probe, lore: stripLoreMarker(stack.getLore()) };
    } catch {
        return probe;
    }
};

const announce = (probe: SlotProbe, ownerId?: string): void => {
    for (const listener of Array.from(listeners)) {
        try {
            if (listener(probe, ownerId)) return;
        } catch {
            // A listener must not break the guard.
        }
    }
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
const destroyIfRendered = (candidate: Entity | undefined, reason: string, ownerId?: string): boolean => {
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
    own.forEach((ownStack) => {
        try {
            dimension.spawnItem(ownStack, location);
        } catch (error) {
            report(`reason=${reason} own-item-lost item=${ownStack.typeId} amount=${ownStack.amount} error=${String(error)}`);
        }
    });
    announce(removedProbeOf(stack), ownerId);
    return true;
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

const scrubEquipmentOf = (player: Player, onRemoved?: (probe: SlotProbe) => void): number => {
    let equippable: EntityEquippableComponent | undefined;
    try {
        equippable = player.getComponent(EQUIPPABLE_COMPONENT_ID) as EntityEquippableComponent | undefined;
    } catch {
        return 0;
    }
    if (!equippable) return 0;

    let removed = 0;
    for (const slot of SCRUBBED_EQUIPMENT) {
        // One unreadable slot must not hide the ones already cleaned, or the ones after it.
        try {
            const stack = equippable.getEquipment(slot);
            if (!stack) continue;
            if (!isRenderedItem(stack)) {
                removed += cleanStorageIn({ stack, write: () => equippable.setEquipment(slot, stack), onRemoved });
                continue;
            }
            const own = takeOwnItemsOut(stack);
            equippable.setEquipment(slot);
            removed++;
            onRemoved?.(removedProbeOf(stack));
            addOwnItems(inventoryContainerOf(player), own).forEach(reportLost);
        } catch {
            continue;
        }
    }
    return removed;
};

/** Removes rendered copies from a container, and from the storage items in it. An empty one is left without reading a slot. */
const scrubContainer = (container: Container | null | undefined, onRemoved?: (probe: SlotProbe) => void): number => {
    let removed = 0;
    try {
        if (!container || container.emptySlotsCount === container.size) return 0;
        for (let index = 0; index < container.size; index++) {
            const stack = container.getItem(index);
            if (!stack) continue;
            if (!isRenderedItem(stack)) {
                removed += cleanStorageIn({ stack, write: () => container.setItem(index, stack), onRemoved });
                continue;
            }
            const own = takeOwnItemsOut(stack);
            container.setItem(index, undefined);
            onRemoved?.(removedProbeOf(stack));
            removed++;
            addOwnItems(container, own).forEach(reportLost);
        }
    } catch {
        // The container went mid-sweep.
    }
    return removed;
};

/**
 * Removes rendered copies from inside a storage item, such as a bundle, and from the storage items
 * nested in it. A button put in a bundle leaves the menu with no trace in any slot the scan reads.
 *
 * @param stack Any stack. It is changed in place, so a caller that read it as a copy writes it back.
 * @param onRemoved Called with each copy removed.
 * @returns How many stacks were removed; 0 for an item that stores nothing.
 */
export const scrubStorageItem = (stack: ItemStack, onRemoved?: (probe: SlotProbe) => void): number => {
    return scrubContainer(storageContainerOf(stack), onRemoved);
};

/**
 * Cleans a storage item read from a slot and writes it back there. Reads hand out copies, so the
 * cleaning sticks only once written, and the copies removed are announced only after that: a failed
 * write leaves them for the next sweep, not counted as gone.
 *
 * @returns How many stacks were removed; 0 when nothing was, or the write failed.
 */
const cleanStorageIn = ({ stack, write, onRemoved }: { stack: ItemStack; write: () => void; onRemoved: ((probe: SlotProbe) => void) | undefined }): number => {
    const probes: SlotProbe[] = [];
    const removed = scrubStorageItem(stack, (probe) => probes.push(probe));
    if (removed === 0) return 0;
    try {
        write();
    } catch {
        return 0;
    }
    if (onRemoved) probes.forEach(onRemoved);
    return removed;
};

const scrubContainerOf = (player: Player, onRemoved?: (probe: SlotProbe) => void): number => {
    return scrubContainer(inventoryContainerOf(player), onRemoved);
};

/** A block's container, or `null` for a block that has none or cannot be read. */
const blockContainerOf = (block: Block | undefined): Container | null => {
    try {
        return (block?.getComponent(INVENTORY_COMPONENT_ID) as BlockInventoryComponent | undefined)?.container ?? null;
    } catch {
        return null;
    }
};

/**
 * Sweeps a container someone opened or closed, and the player who did. Each copy removed is
 * announced as that player's, like a thrown one.
 */
const sweepAccessed = ({ container, source, reason }: { container: Container | null; source: ContainerAccessSource | undefined; reason: string }): void => {
    const accessor = source?.entity;
    const player = accessor?.typeId === "minecraft:player" ? (accessor as Player) : undefined;
    const ownerId = player?.id;
    const announceRemoved = (probe: SlotProbe): void => announce(probe, ownerId);
    const removed = scrubContainer(container, announceRemoved) + (player ? scrubInventoryOf(player, announceRemoved) : 0);
    if (removed > 0) report(`reason=${reason} swept=${removed}`);
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
 * Removes rendered items from a player's inventory, worn slots and off hand.
 *
 * @param player The player to sweep.
 * @param onRemoved Called with each removed item.
 * @returns How many stacks were removed.
 */
export const scrubInventoryOf = (player: Player, onRemoved?: (probe: SlotProbe) => void): number => {
    return scrubContainerOf(player, onRemoved) + scrubEquipmentOf(player, onRemoved);
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
        if (!destroyIfRendered(item, "drop", ownerId)) cleanThrownStorage(item, ownerId);
    });
};

/**
 * Replaces a thrown storage item that holds rendered copies with a clean one. A loose item's stack
 * cannot be written, so a clean copy is spawned in its place before the old one goes: a failed spawn
 * leaves the player's storage item where it was.
 */
const cleanThrownStorage = (candidate: Entity, ownerId?: string): void => {
    if (candidate.typeId !== ITEM_ENTITY_TYPE_ID || !candidate.isValid) return;
    const stack = stackOf(candidate);
    if (!stack || isRenderedItem(stack)) return;
    const probes: SlotProbe[] = [];
    const removed = scrubStorageItem(stack, (probe) => probes.push(probe));
    if (removed === 0) return;
    try {
        candidate.dimension.spawnItem(stack, candidate.location);
        candidate.remove();
    } catch (error) {
        report(`reason=drop storage-respawn-failed item=${stack.typeId} error=${String(error)}`);
        return;
    }
    report(`reason=drop item=${stack.typeId} swept=${removed}`);
    probes.forEach((probe) => announce(probe, ownerId));
};

/** A loose item spawned during play. One loaded with its chunk goes through `onEntityLoaded` instead. */
const onEntitySpawned = (vigenersl: EntitySpawnAfterEvent): void => {
    destroyIfRendered(vigenersl.entity, "spawn");
};

/**
 * A loose item in a chunk that has just loaded: a copy lying on the ground when the world last
 * saved is not a spawn, so `entitySpawn` never saw it.
 */
const onEntityLoaded = (vigenersl: EntityLoadAfterEvent): void => {
    destroyIfRendered(vigenersl.entity, "load");
};

/** A player who logged out holding a copy. */
const onPlayerJoined = (vigenersl: PlayerSpawnAfterEvent): void => {
    const { player, initialSpawn } = vigenersl;
    if (!initialSpawn) return;
    const removed = scrubInventoryOf(player);
    if (removed > 0) report(`reason=join player=${player.name} swept=${removed}`);
};

/**
 * A chest, furnace or hopper: its contents and whoever opened it are swept. On open, because a
 * hopper can have filled it unopened; on close, for a copy put in while it was open.
 */
const onBlockContainerOpened = (vigenersl: BlockContainerOpenedAfterEvent): void => {
    const { block, openSource } = vigenersl;
    sweepAccessed({ container: blockContainerOf(block), source: openSource, reason: "container-opened" });
};

const onBlockContainerClosed = (vigenersl: BlockContainerClosedAfterEvent): void => {
    const { block, closeSource } = vigenersl;
    sweepAccessed({ container: blockContainerOf(block), source: closeSource, reason: "container-closed" });
};

/** The container of a valid entity, or `null`. */
const entityContainerOf = (entity: Entity | undefined): Container | null => {
    return entity?.isValid ? inventoryContainerOf(entity) : null;
};

/**
 * A chest minecart, a donkey, a llama, a block's storage entity: swept on open and on close. A menu
 * entity is skipped by type, whichever pack spawned it: its slots are the menu's copies, and its
 * viewer's inventory is the menu's own business.
 */
const onEntityContainerOpened = (vigenersl: EntityContainerOpenedAfterEvent): void => {
    const { entity, openSource } = vigenersl;
    if (entity?.typeId === SURFACE_ENTITY_TYPE_ID) return;
    sweepAccessed({ container: entityContainerOf(entity), source: openSource, reason: "entity-container-opened" });
};

/** See {@link onEntityContainerOpened}; a menu entity is skipped the same way. */
const onEntityContainerClosed = (vigenersl: EntityContainerClosedAfterEvent): void => {
    const { entity, closeSource } = vigenersl;
    if (entity?.typeId === SURFACE_ENTITY_TYPE_ID) return;
    sweepAccessed({ container: entityContainerOf(entity), source: closeSource, reason: "entity-container-closed" });
};

/** Subscribes the guard to the world. Idempotent; every surface calls it on construction. */
export const installItemGuard = (): void => {
    if (isInstalled) return;
    isInstalled = true;
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

    // A copy that escaped still cannot be used, or used on a block or an entity.
    subscribeGuarded({
        signal: world.beforeEvents.itemUse,
        label: "itemUse",
        handler: (vigenersl) => refuseMarked({ event: vigenersl, stack: vigenersl.itemStack, reason: "use-refused" }),
    });
    subscribeGuarded({
        signal: world.beforeEvents.playerInteractWithBlock,
        label: "playerInteractWithBlock",
        handler: (vigenersl) =>
            refuseMarked({ event: vigenersl, stack: vigenersl.itemStack, reason: "interact-refused", isReported: vigenersl.isFirstEvent !== false }),
    });
    subscribeGuarded({
        signal: world.beforeEvents.playerInteractWithEntity,
        label: "playerInteractWithEntity",
        handler: (vigenersl) => refuseMarked({ event: vigenersl, stack: vigenersl.itemStack, reason: "entity-interact-refused" }),
    });
};
