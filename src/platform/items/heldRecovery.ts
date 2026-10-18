/**
 * What becomes of a storage opened by click once its open is cut short. An owner who leaves with the
 * screen open can have taken an item out in their last tick, after the last write: the game saves it
 * on them, while the storage still has it. So their entity stays, marked as left, holding the screen as
 * they left it, and when they come back that is written into the storage before anything else. A copy
 * without the mark is what a restart, a crash or a reload left, and only ever thrown away.
 */

import { world, type Container, type Entity, type ItemStack, type Player } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { HELD_STORAGE_OWNER_PROPERTY, HELD_STORAGE_PENDING_PROPERTY, HELD_STORAGE_RETURN_PREFIX } from "../constants.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import type { HeldWriteResult } from "./heldStorage.js";
import { spillToPlayer } from "./itemSweeps.js";

/**
 * Undoes what an open of a kind of source left on a player when it ended before `release` could run,
 * say an item still locked. Runs whenever a player joins; make it cheap and safe to run when nothing
 * is left.
 */
export type HeldRelease = (player: Player) => void;

/**
 * Writes the screen as its owner left it into the storage their `key` names, as `write` does.
 *
 * @returns The slots the storage could not hold, which go to the owner; `undefined` when it cannot be
 * reached yet, to be tried again. Throw when the storage is gone.
 */
export type HeldResume = (resume: { player: Player; key: string; stacks: readonly (ItemStack | undefined)[] }) => HeldWriteResult | undefined;

/** How a kind of source cleans up after opens cut short. */
export interface HeldKind {
    /** Undoes what an open left on a player. */
    release: HeldRelease;
    /**
     * Writes what the screen held when the owner left. Without it, an owner who leaves with the screen
     * open keeps the storage as last written.
     */
    resume?: HeldResume | undefined;
}

/** What an entity whose owner left with the screen open keeps for their return. */
interface Pending {
    kind: string;
    key: string;
}

const kinds = new Map<string, HeldKind>();

/**
 * The ids of a player's entities kept for their return. Kept in the world, which a restart keeps too,
 * so a screen whose chunk loads late is still waited for.
 */
export const awaitedOf = (playerId: string): string[] => {
    try {
        const raw = world.getDynamicProperty(`${HELD_STORAGE_RETURN_PREFIX}${playerId}`);
        const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
};

/** @returns Whether the record was written. */
const setAwaited = ({ playerId, entityIds }: { playerId: string; entityIds: readonly string[] }): boolean => {
    try {
        world.setDynamicProperty(`${HELD_STORAGE_RETURN_PREFIX}${playerId}`, entityIds.length > 0 ? JSON.stringify(entityIds) : undefined);
        return true;
    } catch (error) {
        log({ level: "warn", source: "storage", message: `held-pending-failed player=${playerId} error=${String(error)}` });
        return false;
    }
};

/** Whether a screen a player left open still waits to be written: until then nothing else opens for them. */
export const isAwaitingReturn = (playerId: string): boolean => awaitedOf(playerId).length > 0;

/**
 * Stops waiting for a player's kept screens that never showed up: their storages keep what was last written.
 *
 * @internal Used by the world hooks.
 */
export const forgetAwaited = (playerId: string): void => {
    if (awaitedOf(playerId).length > 0) log({ level: "warn", source: "storage", message: `held-resume-failed player=${playerId} error=a kept screen never loaded` });
    setAwaited({ playerId, entityIds: [] });
};

const stopAwaiting = ({ playerId, entityId }: { playerId: string | undefined; entityId: string }): void => {
    if (playerId === undefined) return;
    setAwaited({ playerId, entityIds: awaitedOf(playerId).filter((id) => id !== entityId) });
};

/** A container's slots, as stacks. */
export const stacksOf = (container: Container): (ItemStack | undefined)[] => {
    const { size } = container;
    const stacks: (ItemStack | undefined)[] = [];
    for (let index = 0; index < size; index++) stacks.push(container.getItem(index));
    return stacks;
};

/** Empties an entity's copy and removes it: the copy is never handed out. */
export const discardCopy = (entity: Entity | undefined): void => {
    try {
        if (!entity?.isValid) return;
        inventoryContainerOf(entity)?.clearAll();
        entity.remove();
    } catch (error) {
        log({ level: "warn", source: "storage", message: `held-storage-discard-failed error=${String(error)}` });
    }
};

/**
 * Registers how a kind of source cleans up after opens cut short: `release` for every player who
 * joins, and `resume` for an owner who left with the screen open. The library registers its shulker
 * box and ender chest; register your kind at startup.
 *
 * @param kind The source's `kind`.
 * @param handling Its `release`, and its `resume`.
 * @example
 * registerHeldSource("backpack", { release: (player) => unlockBackpacks(player), resume: writeBackpack });
 */
export const registerHeldSource = (kind: string, handling: HeldKind): void => {
    kinds.set(kind, handling);
};

/** Whether a kind can write the screen as its owner left it. */
export const canResume = (kind: string): boolean => kinds.get(kind)?.resume !== undefined;

/**
 * Runs every registered release for a player: what an open cut short left on them.
 *
 * @internal Used by the world hooks, for a player with no open.
 */
export const releaseLeftovers = (player: Player): void => {
    for (const [kind, { release }] of kinds) {
        try {
            release(player);
        } catch (error) {
            log({ level: "warn", source: "storage", message: `held-release-failed kind=${kind} error=${String(error)}` });
        }
    }
};

let keptListener: ((ownerId: string) => void) | undefined;

/**
 * Hears each screen kept for an owner who is still here, so it is written without waiting for a join.
 *
 * @internal Used by the world hooks.
 */
export const onKeptForOwner = (listener: ((ownerId: string) => void) | undefined): void => {
    keptListener = listener;
};

/**
 * Tells the world hooks a screen was kept for an owner who is still here.
 *
 * @internal Used by a session whose close the storage kept refusing.
 */
export const notifyKept = (ownerId: string): void => keptListener?.(ownerId);

/**
 * Marks an entity as its owner's screen at the moment they left, for their return.
 *
 * @internal Used by a session whose owner left.
 * @returns Whether it was marked.
 */
export const markPending = ({ entity, kind, key, ownerId }: { entity: Entity; kind: string; key: string; ownerId: string }): boolean => {
    try {
        entity.setDynamicProperty(HELD_STORAGE_PENDING_PROPERTY, JSON.stringify({ kind, key } satisfies Pending));
        return setAwaited({ playerId: ownerId, entityIds: [...awaitedOf(ownerId).filter((id) => id !== entity.id), entity.id] });
    } catch (error) {
        log({ level: "warn", source: "storage", message: `held-pending-failed kind=${kind} error=${String(error)}` });
        return false;
    }
};

/** What an entity keeps for its owner's return, or `undefined` for a plain copy. */
const pendingOf = (entity: Entity): Pending | undefined => {
    try {
        const raw = entity.getDynamicProperty(HELD_STORAGE_PENDING_PROPERTY);
        if (typeof raw !== "string") return undefined;
        const parsed = JSON.parse(raw) as Partial<Pending>;
        return typeof parsed.kind === "string" && typeof parsed.key === "string" ? { kind: parsed.kind, key: parsed.key } : undefined;
    } catch {
        return undefined;
    }
};

/** The id of the player an entity of this pack belongs to, or `undefined`. */
export const ownerIdOf = (entity: Entity): string | undefined => {
    try {
        const owner = entity.getDynamicProperty(HELD_STORAGE_OWNER_PROPERTY);
        return typeof owner === "string" ? owner : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Whether an entity waits for its owner's return: marked, and still in their record. One whose wait was
 * given up, or whose copy outlived its write, is only a stale copy, and its screen is never written.
 */
export const isPending = (entity: Entity): boolean => {
    const ownerId = ownerIdOf(entity);
    return pendingOf(entity) !== undefined && ownerId !== undefined && awaitedOf(ownerId).includes(entity.id);
};

/**
 * Writes a waiting entity's screen into its owner's storage and throws the copy away. What the storage
 * cannot hold goes to the owner.
 *
 * @internal Used by the world hooks.
 * @returns `"later"` when the storage cannot be reached yet and the entity still waits, else `"done"`.
 */
export const resumePending = ({ entity, owner }: { entity: Entity; owner: Player }): "done" | "later" => {
    const pending = pendingOf(entity);
    if (!pending) return "done";
    const { id } = entity;
    let stacks: (ItemStack | undefined)[] = [];
    let result: HeldWriteResult | undefined;
    try {
        const container = inventoryContainerOf(entity);
        // Its inventory not readable yet: an empty screen written over the storage would wipe it.
        if (!container) return "later";
        stacks = stacksOf(container);
        const resume = kinds.get(pending.kind)?.resume;
        if (!resume) throw new Error(`no resume is registered for ${pending.kind}`);
        result = resume({ player: owner, key: pending.key, stacks });
        if (!result) return "later";
    } catch (error) {
        log({ level: "warn", source: "storage", message: `held-resume-failed kind=${pending.kind} error=${String(error)}` });
    }
    stopAwaiting({ playerId: owner.id, entityId: id });
    discardCopy(entity);
    const refused = result?.refused ?? [];
    refused.forEach((index) => {
        const stack = stacks[index];
        if (stack) spillToPlayer(owner)(stack);
    });
    if (result) log({ level: "info", source: "storage", message: `held-storage-resumed kind=${pending.kind} entityId=${id} refused=${refused.length}` });
    return "done";
};

/**
 * Gives up on a waiting entity that could not be written: the storage keeps what was last written.
 *
 * @internal Used by the world hooks.
 */
export const abandonPending = (entity: Entity): void => {
    const kind = pendingOf(entity)?.kind ?? "?";
    stopAwaiting({ playerId: ownerIdOf(entity), entityId: entity.id });
    discardCopy(entity);
    log({ level: "warn", source: "storage", message: `held-resume-failed kind=${kind} error=the storage could not be reached` });
};
