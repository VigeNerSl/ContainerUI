/** The shared shape of a storage over an entity's inventory: cached views, a version signal and an outside-change watch. */

import { ItemStack, world, type Container, type ContainerSlot, type Entity } from "@minecraft/server";
import { areItemsEqual, signal, type ItemView, type ReadonlySignal, type SlotStorage } from "../../core/index.js";
import { createContainerWatcher, type ContainerWatcher } from "./containerWatch.js";
import { inventoryContainerOf } from "./inventoryContainer.js";
import { fromItemStack, toStorageStack } from "../items/itemConversion.js";
import { probeOfHandle, probeOfStack, slotHandlesOf } from "../scan/slotHandles.js";
import { isSameProbe, type SlotProbe } from "../scan/slotMatching.js";

/** A slot's view, with the probe of the stack it was read from or written as. */
interface CachedSlot {
    readonly view: ItemView | null;
    readonly probe: SlotProbe | null;
}

const EMPTY_SLOT: CachedSlot = { view: null, probe: null };

/**
 * A live `SlotStorage` over an entity's inventory. The inventory itself is the persistence.
 * Subclasses pass the entity to the constructor and implement the hooks.
 */
export abstract class EntityInventoryStorage<TEntity extends Entity = Entity> implements SlotStorage {
    readonly #entityId: string;
    readonly #defaultWatchIntervalTicks: number;
    readonly #version = signal(0);
    readonly #watcher: ContainerWatcher;
    /** One view per slot until the slot changes. */
    readonly #cache = new Map<number, CachedSlot>();
    /** Slot handles for checking a cached view against its slot, kept while valid. */
    #handles: ContainerSlot[] | null = null;
    /** Whether the container's handles are invalid as soon as they are handed out, so slots are read instead. */
    #hasDeadHandles = false;
    #entity: TEntity | null;
    /** Read failures report once per outage. */
    #hasReportedReadFailure = false;

    /**
     * @param entity The entity whose inventory is the storage.
     * @param defaultWatchIntervalTicks Ticks between watch passes when {@link startWatching} is given none.
     */
    protected constructor(entity: TEntity, defaultWatchIntervalTicks: number) {
        this.#entity = entity;
        this.#entityId = entity.id;
        this.#defaultWatchIntervalTicks = defaultWatchIntervalTicks;
        this.#watcher = createContainerWatcher({
            resolveContainer: () => this._container(),
            onExternalChange: (changedSlots) => {
                this._onExternalChange(changedSlots.length);
                for (const index of changedSlots) this.#cache.delete(index);
                this.#bumpVersion();
            },
            onInvalid: () => {
                this.#forget();
                this._onInvalid();
            },
        });
    }

    /** The entity's id. */
    get entityId(): string {
        return this.#entityId;
    }

    /** Whether the entity's inventory can be read. */
    get isValid(): boolean {
        return this._container() !== null;
    }

    /** {@inheritDoc SlotStorage.size} */
    get size(): number {
        // Tracked, so a render against a late container runs again.
        this.#version.value;
        return this._container()?.size ?? 0;
    }

    /** {@inheritDoc SlotStorage.version} */
    get version(): ReadonlySignal<number> {
        return this.#version;
    }

    /** Cost of the outside-change watch so far. */
    get watchStats(): { passes: number; totalMs: number } {
        return this.#watcher.stats;
    }

    /**
     * {@inheritDoc SlotStorage.get}
     *
     * The view is kept while the slot holds what it was read from, so an unchanged slot returns the
     * same object. A slot changed behind the storage's back — through a chest's own screen, or by
     * the player dropping an item — is read again, watched or not.
     */
    get(index: number): ItemView | null {
        this.#version.value;
        const cached = this.#cache.get(index);
        if (cached && this.#isCurrentByHandle(index, cached)) return cached.view;

        const container = this._container();
        if (!container) {
            this.#reportReadFailure(`no container reading slot ${index}`);
            return null;
        }
        try {
            const stack = container.getItem(index);
            const probe = stack ? probeOfStack(stack) : null;
            this.#hasReportedReadFailure = false;
            // Where no handle could tell, the read itself does: an unchanged slot keeps its view. As
            // with a handle, unchanged means the same type, amount and name: a change made elsewhere
            // to only the enchantments, durability, lore or data of a stack is seen with the next
            // change the probe sees.
            if (cached && isSameProbe(probe, cached.probe)) return cached.view;
            const view = fromItemStack(stack);
            this.#cache.set(index, { view, probe });
            return view;
        } catch (error) {
            this.#reportReadFailure(`slot ${index}: ${String(error)}`);
            return null;
        }
    }

    /**
     * {@inheritDoc SlotStorage.set}
     *
     * Writing an empty slot as empty, or writing back the view {@link get} returned for a slot that
     * still holds that item, changes nothing and notifies no one.
     *
     * @throws {Error} When the entity is gone.
     */
    set(index: number, item: ItemView | null): void {
        const container = this._container();
        if (!container) throw this._containerGone(index);
        if (this.#isUnchanged(container, index, item)) return;
        const stack = toStorageStack(item);
        container.setItem(index, stack);
        this.#remember(index, item, stack);
        this._onWritten(index, item);
        this.#bumpVersion();
    }

    /** Whether the slot already holds `item`: both empty, or `item` is its current view. */
    #isUnchanged(container: Container, index: number, item: ItemView | null): boolean {
        try {
            const current = container.getItem(index);
            if (item === null) {
                if (current !== undefined) return false;
                // Emptied behind the storage's back: the next read must not return what was there.
                this.#cache.set(index, EMPTY_SLOT);
                return true;
            }
            // Identity, not a look: two stacks that look alike can differ in data a view does not carry.
            return this.#cache.get(index)?.view === item && areItemsEqual(fromItemStack(current), item);
        } catch {
            return false;
        }
    }

    /**
     * Records a write. A view carrying its stack, or an empty slot, is kept; a described view is
     * dropped, so the next read returns the real item. The watch learns the stack that was written.
     */
    #remember(index: number, item: ItemView | null, stack: ItemStack | undefined): void {
        const probe = stack ? probeOfStack(stack) : null;
        this.#watcher.record(index, probe);
        if (item === null || item.native instanceof ItemStack) {
            this.#cache.set(index, { view: item, probe });
            return;
        }
        this.#cache.delete(index);
    }

    /**
     * Whether a cached view still describes its slot, compared through a kept slot handle. A container
     * that hands out no usable handles answers `false`, and the slot is read once to tell.
     */
    #isCurrentByHandle(index: number, cached: CachedSlot): boolean {
        try {
            const handle = this.#handleAt(index);
            return handle !== undefined && isSameProbe(probeOfHandle(handle), cached.probe);
        } catch {
            return false;
        }
    }

    /**
     * A slot's handle, or `undefined` where there is none to use. The container is resolved again only
     * once the kept handles go invalid. A player's ender chest hands out handles that are invalid from
     * the start, measured in a world; such a container is read slot by slot from then on.
     */
    #handleAt(index: number): ContainerSlot | undefined {
        if (this.#hasDeadHandles) return undefined;
        if (!this.#handles?.[0]?.isValid) {
            const container = this._container();
            this.#handles = container ? slotHandlesOf(container, null) : null;
            this.#hasDeadHandles = container !== null && container.size > 0 && this.#handles?.[0]?.isValid === false;
            if (this.#hasDeadHandles) this.#handles = null;
        }
        return this.#handles?.[index];
    }

    /** Reports a change made outside this storage, such as by a command. */
    notifyExternalChange(): void {
        this.#forget();
        this.#watcher.reset();
        this.#bumpVersion();
    }

    /**
     * Starts, or joins, the outside-change watch. Reference-counted; call {@link stopWatching} on close.
     *
     * @param intervalTicks Ticks between checks.
     */
    startWatching(intervalTicks: number = this.#defaultWatchIntervalTicks): void {
        this.#watcher.start(intervalTicks);
    }

    /** Leaves the outside-change watch. */
    stopWatching(): void {
        this.#watcher.stop();
    }

    /** The entity, or `null` once it is gone; re-resolved by id after a reload. */
    protected _entity(): TEntity | null {
        if (this.#entity?.isValid) return this.#entity;
        this.#entity = (world.getEntity(this.#entityId) as TEntity | undefined) ?? null;
        return this.#entity?.isValid ? this.#entity : null;
    }

    /** The entity's container, or `null` when it cannot be read. */
    protected _container(): Container | null {
        const entity = this._entity();
        return entity ? this._containerOf(entity) : null;
    }

    /**
     * Which of the entity's containers is the storage. Override it to store in another one, such as
     * a player's ender inventory.
     *
     * @param entity The entity, valid.
     * @returns The container, or `null` when it cannot be used.
     */
    protected _containerOf(entity: TEntity): Container | null {
        return inventoryContainerOf(entity);
    }

    /** Stops the watch for good and forgets every view. */
    protected _dispose(): void {
        this.#watcher.dispose();
        this.#forget();
    }

    /** The error a write throws when the entity is gone. */
    protected abstract _containerGone(index: number): Error;

    /** Called after a write reaches the inventory, before dependents hear of it. */
    protected _onWritten(_index: number, _item: ItemView | null): void {}

    /** Called when the watch finds slots changed outside, before the views are dropped. */
    protected _onExternalChange(_slotsChanged: number): void {}

    /** Called once when the watch finds the entity gone, after the views are dropped. */
    protected _onInvalid(): void {}

    /** Called once per outage when a read fails. */
    protected _onReadFailure(_detail: string): void {}

    #reportReadFailure(detail: string): void {
        if (this.#hasReportedReadFailure) return;
        this.#hasReportedReadFailure = true;
        this._onReadFailure(detail);
    }

    /** Drops every cached view and slot handle. */
    #forget(): void {
        this.#cache.clear();
        this.#handles = null;
    }

    #bumpVersion(): void {
        this.#version.update((revision) => revision + 1);
    }
}
