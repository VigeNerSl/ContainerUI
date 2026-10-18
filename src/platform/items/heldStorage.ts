/**
 * A storage opened by click, whatever it is: an entity in the owner's head shows a copy of its
 * contents, the engine opens that entity's inventory as a chest on the owner's click, and every change
 * the owner makes there is written into the storage in the tick it happens. The place the contents
 * live is a {@link HeldSource}, and it stays the only owner of the items: the entity's copy is never
 * handed out, so a restart, a crash or a reload copies no item. The entity lives in the world's chunks
 * and the storage in the player's data, which the engine saves apart.
 */

import { system, type Container, type Entity, type ItemStack, type Player } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { CLICK_OPEN_WAIT_TICKS, HELD_CLOSE_RETRY_TICKS, HELD_STORAGE_ENTITY_TYPE_ID, HELD_STORAGE_OWNER_PROPERTY } from "../constants.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { ClickWait, keepInHead } from "../surface/clickWait.js";
import { entityById, playerById } from "../world/entities.js";
import { notifySafely } from "../observer.js";
import { addedPart, isUnchanged, signatureOf } from "./heldCompare.js";
import { canResume, discardCopy, isAwaitingReturn, isPending, markPending, notifyKept, stacksOf } from "./heldRecovery.js";
import { spillToPlayer } from "./itemSweeps.js";

/** Reports a step of a source to the observer, for a logger. */
export type HeldReport = (step: string, detail?: string) => void;

/** What a source made of a write. */
export interface HeldWriteResult {
    /** Slots whose items the source cannot hold: they go back to the owner, their inventory first. */
    refused: readonly number[];
}

/**
 * Where the contents of a storage opened by click live. The source keeps the items the whole time:
 * the entity only shows them. One source serves one open; make a new one for every call.
 */
export interface HeldSource {
    /** What it is, for the observer and for {@link registerHeldSource}: `"shulker"`, `"ender"`, or your own. */
    kind: string;
    /**
     * Reads what the storage holds, by the slot it will take in the entity, and moves nothing. May
     * take ticks. A failure is reported through `report`, and the open stops.
     *
     * @returns The stacks by slot, or `undefined` when it cannot be opened.
     */
    read(player: Player, report: HeldReport): (ItemStack | undefined)[] | undefined | Promise<(ItemStack | undefined)[] | undefined>;
    /**
     * Called after `read`, before the entity appears: checks the storage is still there and holds it
     * for the open, say by locking an item in its slot. `release` undoes it. A throw counts as a reason.
     *
     * @returns Why the open cannot go on, or `undefined`.
     */
    prepare?(player: Player): string | undefined;
    /**
     * Writes what the entity holds into the storage, in the tick the owner changed it.
     *
     * @param write `stacks`, the entity's slots; `changed`, the slots that differ from the last write.
     * @returns `undefined` when the storage is there but could not take it now: the same change comes
     * again next tick. Throw when the storage is gone: the open ends, and what the owner put in since
     * the last write goes back to them.
     */
    write(write: { player: Player; stacks: readonly (ItemStack | undefined)[]; changed: readonly number[]; report: HeldReport }): HeldWriteResult | undefined;
    /** Called once the open ends while the owner is in the world: undoes what `prepare` did. */
    release?(player: Player): void;
    /**
     * Names this open's storage for the kind's `resume`, should the owner leave with the screen open.
     * Without it, or without a `resume`, the storage keeps what was last written.
     */
    key?(): string | undefined;
}

/** One step of a storage opened by click, for a logger. */
export interface HeldOpenEvent {
    kind:
        /** The source reports a step; `step` says which. */
        | "step"
        /** The entity is in the owner's head, showing the contents. */
        | "ready"
        /** The owner has the screen. */
        | "opened"
        /** Items the source cannot hold went back to the owner. */
        | "refused"
        /** The open ended; the storage holds what the owner left in it. `detail` says why: `reason=…`. */
        | "closed"
        /** Nothing was opened: the source could not be read or held, or the owner stood up or left. */
        | "aborted";
    step?: string;
    detail?: string;
}

/** How a storage opened by click behaves. */
export interface HeldOpenOptions {
    /** Title of the screen. Defaults to `"Storage"`. */
    title?: string | undefined;
    /** Ticks to wait for the click before the entity goes. Defaults to `CLICK_OPEN_WAIT_TICKS`. */
    clickWaitTicks?: number | undefined;
    /** Cancel when the owner stops sneaking before the click. */
    whileSneaking?: boolean | undefined;
    /** Observes every step. */
    onEvent?: ((event: HeldOpenEvent) => void) | undefined;
}

/** What the world hooks ask of a session. */
interface HeldHandle {
    acceptsClickFrom(playerId: string): boolean;
    notifyOpened(): void;
    notifyOwnerLeft(): void;
    finish(reason: string): void;
    end(reason: string): void;
}

/** `closing`: the screen is shut, and the last change waits for a write the storage took. */
type SessionState = "reading" | "waiting" | "open" | "closing" | "done";

/** What a pass of the write-through did; `gone` is a copy no longer there to read. */
type SyncOutcome = "unchanged" | "written" | "retry" | "lost" | "gone";

/** Open sessions, by owner and by entity. */
const sessionsByPlayerId = new Map<string, HeldHandle>();
const sessionsByEntityId = new Map<string, HeldHandle>();

/** One storage open by click, from the request to the close. */
class HeldSession implements HeldHandle {
    readonly #playerId: string;
    readonly #source: HeldSource;
    readonly #options: HeldOpenOptions;
    readonly #clickWait: ClickWait;
    #state: SessionState = "reading";
    #entityId: string | null = null;
    /** What the storage holds as of the last write, slot by slot, and each non-stackable item's signature. */
    #written: (ItemStack | undefined)[] = [];
    #signatures: (string | undefined)[] = [];
    #closeReason = "closed";
    /** Ticks the close has waited for a write the storage refused. */
    #closingTicks = 0;
    #syncRunId: number | null = null;
    readonly #report: HeldReport = (step, detail) => this.#emit({ kind: "step", step, ...(detail === undefined ? {} : { detail }) });

    /** @throws {RangeError} For a `clickWaitTicks` that is not a positive whole number. */
    constructor({ player, source, options }: { player: Player; source: HeldSource; options: HeldOpenOptions }) {
        this.#playerId = player.id;
        this.#source = source;
        this.#options = options;
        this.#clickWait = new ClickWait(options.clickWaitTicks ?? CLICK_OPEN_WAIT_TICKS);
    }

    /** Whether a click by `playerId` may open the entity: only the owner's, and only while it waits for it. */
    acceptsClickFrom(playerId: string): boolean {
        return this.#state === "waiting" && playerId === this.#playerId;
    }

    /**
     * Reads the source and shows a copy of its contents in an entity in the owner's head, all checked
     * again after the read.
     *
     * @returns Whether the entity is ready for the click.
     */
    async begin(player: Player): Promise<boolean> {
        sessionsByPlayerId.set(this.#playerId, this);
        // A screen they left open is written first: until then the storage may not hold their last change.
        if (isAwaitingReturn(this.#playerId)) return this.#abort("a screen left open waits to be written");
        let read: (ItemStack | undefined)[] | undefined;
        try {
            read = await this.#source.read(player, this.#report);
        } catch (error) {
            return this.#abort(`read-failed error=${String(error)}`);
        }
        // Ended during the read: the owner left, or the runtime was uninstalled.
        if (this.#state !== "reading") return this.#abort("ended during the read");
        const owner = playerById(this.#playerId);
        if (!owner) return this.#abort("the owner left");
        if (!read) return this.#abort("nothing was read");
        if (this.#options.whileSneaking && !owner.isSneaking) return this.#abort("the owner stopped sneaking");
        let problem: string | undefined;
        try {
            problem = this.#source.prepare?.(owner);
        } catch (error) {
            problem = `prepare-failed error=${String(error)}`;
        }
        if (problem) return this.#abort(problem);

        try {
            const entity = this.#spawn({ owner, title: this.#options.title ?? "Storage" });
            const container = inventoryContainerOf(entity);
            if (!container) throw new Error("the entity has no inventory");
            if (read.length > container.size) throw new Error(`the entity has ${container.size} slots, the source ${read.length}`);
            read.forEach((stack, index) => {
                if (stack) container.setItem(index, stack);
            });
            this.#remember(stacksOf(container));
        } catch (error) {
            discardCopy(entityById(this.#entityId));
            return this.#abort(`fill-failed error=${String(error)}`);
        }

        this.#state = "waiting";
        this.#clickWait.start(() => this.#watch());
        this.#emit({ kind: "ready", detail: `occupied=${read.filter(Boolean).length}` });
        return true;
    }

    /** The owner has the screen: from now on every change is written through. */
    notifyOpened(): void {
        if (this.#state !== "waiting") return;
        this.#state = "open";
        this.#clickWait.end();
        this.#syncRunId = system.runInterval(() => this.#step(), 1);
        this.#emit({ kind: "opened" });
    }

    /**
     * The owner left. Before the screen opened nothing changed, and the copy goes. With it open, their
     * last tick may hold a change no write took: the entity keeps the screen as they left it, for
     * {@link HeldKind.resume} on their return. What else the open left on them is undone then too.
     */
    notifyOwnerLeft(): void {
        if (this.#state === "done" || this.#state === "reading") this.#forget();
        else if (this.#state === "waiting") this.finish("owner-left");
        else this.#keepForReturn("owner-left");
    }

    /** Ends the open: the last change is written, then the copy goes and the source is released. */
    finish(reason: string): void {
        if (this.#state === "waiting") {
            this.#closeReason = reason;
            this.#complete();
            return;
        }
        if (this.#state !== "open") return;
        this.#state = "closing";
        this.#closeReason = reason;
        this.#step();
    }

    /** Ends the open however far it got, for an uninstall: a close the storage cannot take now is kept for later. */
    end(reason: string): void {
        if (this.#state === "reading") {
            this.#forget();
            return;
        }
        this.finish(reason);
        if (this.#state === "closing") this.#keepForReturn(reason);
    }

    /** Spawns the entity in the owner's head, named and marked with its owner. */
    #spawn({ owner, title }: { owner: Player; title: string }): Entity {
        const entity = owner.dimension.spawnEntity(HELD_STORAGE_ENTITY_TYPE_ID, owner.getHeadLocation());
        try {
            entity.nameTag = title;
            entity.setDynamicProperty(HELD_STORAGE_OWNER_PROPERTY, this.#playerId);
        } catch (error) {
            if (entity.isValid) entity.remove();
            throw error;
        }
        this.#entityId = entity.id;
        sessionsByEntityId.set(entity.id, this);
        return entity;
    }

    /** Every tick while waiting: keeps the entity in the owner's head, and gives up on a stand or a timeout. */
    #watch(): void {
        const owner = playerById(this.#playerId);
        if (!owner) return;
        keepInHead(entityById(this.#entityId) ?? null, owner);
        if (this.#options.whileSneaking && !owner.isSneaking) this.finish("stood-up");
        else if (this.#clickWait.overdueTicks !== undefined) this.finish("timeout");
    }

    /**
     * Every tick while open or closing: the write-through, and the close once the last change is in. A
     * copy gone without a close, say removed, ends the open; a close the storage keeps refusing is kept
     * for the owner's return.
     */
    #step(): void {
        const isClosing = this.#state === "closing";
        const outcome = this.#sync(isClosing);
        if (outcome === "gone") {
            if (!isClosing) this.#closeReason = "entity-gone";
            this.#complete();
        } else if (isClosing && (outcome === "unchanged" || outcome === "written")) {
            this.#complete();
        } else if (isClosing && outcome === "retry" && ++this.#closingTicks >= HELD_CLOSE_RETRY_TICKS) {
            this.#keepForReturn(this.#closeReason);
        }
    }

    /**
     * Writes what the owner changed in the entity into the source. Items the source refuses go back to
     * the owner; a source that is gone ends the open.
     *
     * @param isClosing The close writes every slot once more when one holds a non-stackable item: data
     * no script reads can differ between two of them.
     */
    #sync(isClosing: boolean): SyncOutcome {
        const owner = playerById(this.#playerId);
        if (!owner) return "retry";
        const entity = entityById(this.#entityId);
        const container = entity ? inventoryContainerOf(entity) : null;
        // The copy is gone, so the owner cannot change it any more: the storage keeps what was last written.
        if (!container) return "gone";
        const stacks = stacksOf(container);
        const isForced = isClosing && [...stacks, ...this.#written].some((stack) => stack !== undefined && !stack.isStackable);
        const changed = stacks.flatMap((stack, index) =>
            !isForced && isUnchanged({ current: stack, written: this.#written[index], signature: this.#signatures[index] }) ? [] : [index],
        );
        if (changed.length === 0) return "unchanged";
        let result: HeldWriteResult | undefined;
        try {
            result = this.#source.write({ player: owner, stacks, changed, report: this.#report });
        } catch (error) {
            this.#endOnLostSource({ owner, container, stacks, changed, error });
            return "lost";
        }
        if (!result) return "retry";
        const refused = result.refused ?? [];
        refused.forEach((index) => {
            const stack = stacks[index];
            if (!stack) return;
            container.setItem(index, undefined);
            stacks[index] = undefined;
            spillToPlayer(owner)(stack);
        });
        if (refused.length > 0) this.#emit({ kind: "refused", detail: `slots=${refused.join(",")}` });
        this.#remember(stacks);
        return "written";
    }

    /** What the storage now holds, slot by slot. */
    #remember(stacks: (ItemStack | undefined)[]): void {
        this.#written = stacks;
        this.#signatures = stacks.map(signatureOf);
    }

    /**
     * The source is gone, and with it what it held as last written: what the owner put in since goes
     * back to them, the copy is thrown away, and the open ends.
     */
    #endOnLostSource({ owner, container, stacks, changed, error }: { owner: Player; container: Container; stacks: readonly (ItemStack | undefined)[]; changed: readonly number[]; error: unknown }): void {
        log({ level: "warn", source: "storage", message: `held-write-failed kind=${this.#source.kind} error=${String(error)}` });
        container.clearAll();
        changed.forEach((index) => {
            const added = addedPart({ current: stacks[index], written: this.#written[index], signature: this.#signatures[index] });
            if (added) spillToPlayer(owner)(added);
        });
        discardCopy(entityById(this.#entityId));
        this.#release();
        this.#forget();
        this.#emit({ kind: "closed", detail: `reason=source-lost error=${String(error)}` });
    }

    /**
     * Keeps the entity, marked, with the screen as the owner left it, for the kind's `resume`: when they
     * are back, or at once for an owner still here. A source without a `key` or a kind without a
     * `resume` keeps what was last written, and is released.
     */
    #keepForReturn(reason: string): void {
        const entity = entityById(this.#entityId);
        const key = this.#keyOf();
        const isKept =
            entity !== undefined && key !== undefined && canResume(this.#source.kind) && markPending({ entity, kind: this.#source.kind, key, ownerId: this.#playerId });
        if (!isKept) {
            discardCopy(entity);
            this.#release();
        }
        this.#forget();
        this.#emit({ kind: "closed", detail: `reason=${reason}${isKept ? " kept-for-return" : ""}` });
        if (isKept && playerById(this.#playerId)) notifyKept(this.#playerId);
    }

    #keyOf(): string | undefined {
        try {
            return this.#source.key?.();
        } catch (error) {
            log({ level: "warn", source: "storage", message: `held-key-failed kind=${this.#source.kind} error=${String(error)}` });
            return undefined;
        }
    }

    /** The close, once the storage holds the last change. */
    #complete(): void {
        discardCopy(entityById(this.#entityId));
        this.#release();
        this.#forget();
        this.#emit({ kind: "closed", detail: `reason=${this.#closeReason}` });
    }

    /** Nothing was opened: the source is released. @returns `false`, for `begin` to return. */
    #abort(detail: string): false {
        this.#release();
        this.#emit({ kind: "aborted", detail });
        this.#forget();
        return false;
    }

    #release(): void {
        const owner = playerById(this.#playerId);
        if (!owner) return;
        try {
            this.#source.release?.(owner);
        } catch (error) {
            log({ level: "warn", source: "storage", message: `held-release-failed kind=${this.#source.kind} error=${String(error)}` });
        }
    }

    #forget(): void {
        this.#state = "done";
        this.#clickWait.dispose();
        if (this.#syncRunId !== null) system.clearRun(this.#syncRunId);
        this.#syncRunId = null;
        if (sessionsByPlayerId.get(this.#playerId) === this) sessionsByPlayerId.delete(this.#playerId);
        if (this.#entityId && sessionsByEntityId.get(this.#entityId) === this) sessionsByEntityId.delete(this.#entityId);
    }

    #emit(event: HeldOpenEvent): void {
        notifySafely(this.#options.onEvent, event);
    }
}

/**
 * Starts a storage opened by click; `openHeldStorage` is the public way in.
 *
 * @internal
 * @returns Whether the entity is ready for the click.
 * @throws {RangeError} For a `clickWaitTicks` that is not a positive whole number, before anything starts.
 */
export const startHeldSession = ({ player, source, options = {} }: { player: Player; source: HeldSource; options?: HeldOpenOptions }): Promise<boolean> => {
    if (sessionsByPlayerId.has(player.id)) return Promise.resolve(false);
    return new HeldSession({ player, source, options }).begin(player);
};

/**
 * Ends every open, for an uninstall: each writes its last change and releases its source.
 *
 * @internal Used by the world hooks.
 */
export const endHeldSessions = (reason: string): void => {
    [...sessionsByPlayerId.values()].forEach((session) => session.end(reason));
};

/**
 * Throws away an entity of this pack that no open owns and no owner waits for, such as one a
 * restart or a crash left: its items are a copy, and the storage they came from still has them.
 *
 * @internal Used by the world hooks.
 * @returns Whether it was thrown away.
 */
export const discardHeldStorage = (entity: Entity): boolean => {
    try {
        if (!entity.isValid || entity.typeId !== HELD_STORAGE_ENTITY_TYPE_ID || sessionsByEntityId.has(entity.id)) return false;
        // Another pack's entity: its own copy of the library decides.
        if (entity.getDynamicProperty(HELD_STORAGE_OWNER_PROPERTY) === undefined) return false;
        if (isPending(entity)) return false;
        const { id } = entity;
        discardCopy(entity);
        log({ level: "info", source: "storage", message: `held-storage-discarded entityId=${id}` });
        return true;
    } catch (error) {
        log({ level: "warn", source: "storage", message: `held-storage-discard-failed error=${String(error)}` });
        return false;
    }
};

/**
 * The session an entity belongs to, for the world hooks.
 *
 * @internal
 */
export const heldSessionOf = (entityId: string): HeldHandle | undefined => sessionsByEntityId.get(entityId);

/**
 * The session a player has open, for the world hooks.
 *
 * @internal
 */
export const heldSessionFor = (playerId: string): HeldHandle | undefined => sessionsByPlayerId.get(playerId);
