/** The viewer's side of a surface: their inventory, their cursor, and the sweep for rendered copies. */

import { world, type Container, type ContainerSlot, type ItemStack, type Player, type PlayerCursorInventoryComponent } from "@minecraft/server";
import { areItemsEqual, type Dispose, type ItemView } from "../../core/index.js";
import { CURSOR_INVENTORY_COMPONENT_ID } from "../constants.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { onPlayerInventoryChange } from "./inventoryChanges.js";
import { fromItemStack, toStorageStack } from "../items/itemConversion.js";
import { isRenderedItem } from "../items/itemMarker.js";
import { scrubInventoryOf, scrubStorageItem, spillToPlayer } from "../items/itemSweeps.js";
import { takeOwnItemsOut } from "../items/storageItems.js";
import { probeOfHandle, probeOfStack, slotHandlesOf } from "./slotHandles.js";
import type { SlotProbe } from "./slotMatching.js";

/** Where a returned item went: the inventory, the ground at the player's feet, or both when only part fit. */
export type ReturnPlace = "inventory" | "feet" | "inventory+feet";

const NOTHING_SWEPT: readonly SlotProbe[] = [];

const areTagsEqual = (first: ItemView["tags"], second: ItemView["tags"]): boolean => {
    const firstKeys = Object.keys(first ?? {});
    if (firstKeys.length !== Object.keys(second ?? {}).length) return false;
    return firstKeys.every((key) => first?.[key] === second?.[key]);
};

/** Whether a read item is the one being taken back: the same look, stack size aside, and the same tags. */
const isTakeBackMatch = (view: ItemView | null, wanted: ItemView): boolean => {
    if (!view || !areItemsEqual({ ...view, amount: 1 }, { ...wanted, amount: 1 })) return false;
    return areTagsEqual(view.tags, wanted.tags);
};

/** Where a {@link ViewerInventory} reports. */
export interface ViewerInventoryOptions {
    /** Receives failed reads and writes. */
    onError: (message: string) => void;
    /** Receives one record per notable step. */
    onTrace: (message: string) => void;
}

/** The viewer's inventory and cursor, as a surface needs them. */
export class ViewerInventory {
    #player: Player;
    readonly #playerId: string;
    readonly #onError: (message: string) => void;
    readonly #onTrace: (message: string) => void;
    #isInPass = false;
    #passContainer: Container | null = null;
    #slots: ContainerSlot[] | null = null;
    #unsubscribeChanges: Dispose | null;
    #isDirty = true;
    #scrubbedStacks = 0;
    #swept: SlotProbe[] = [];

    /**
     * @param player The viewer.
     * @param options Error and trace channels.
     */
    constructor(player: Player, options: ViewerInventoryOptions) {
        this.#player = player;
        this.#playerId = player.id;
        this.#onError = options.onError;
        this.#onTrace = options.onTrace;
        this.#unsubscribeChanges =
            onPlayerInventoryChange(this.#playerId, () => {
                this.#isDirty = true;
            }) ?? null;
    }

    /** The viewer's entity id. */
    get playerId(): string {
        return this.#playerId;
    }

    /** The viewer, or `null` once they are gone. */
    get player(): Player | null {
        if (this.#player.isValid) return this.#player;
        const resolved = world.getEntity(this.#playerId);
        if (!resolved) return null;
        this.#player = resolved as Player;
        return this.#player;
    }

    /** Rendered stacks removed from this inventory so far. */
    get scrubbedStacks(): number {
        return this.#scrubbedStacks;
    }

    /** Whether the engine reported an inventory change that no pass has taken yet. */
    get hasPendingChange(): boolean {
        return this.#unsubscribeChanges !== null && this.#isDirty;
    }

    /** Starts a scan pass: the container is resolved at most once until {@link endPass}. */
    beginPass(): void {
        this.#isInPass = true;
    }

    /** Ends a scan pass. */
    endPass(): void {
        this.#isInPass = false;
        this.#passContainer = null;
    }

    /** Whether the inventory may have changed since the last call. Always `true` without the change event. */
    takeChange(): boolean {
        if (!this.#unsubscribeChanges) return true;
        const hasChanged = this.#isDirty;
        this.#isDirty = false;
        return hasChanged;
    }

    /**
     * Resolves the inventory and its slot handles for a diff.
     *
     * @returns The slot count, or 0 when the inventory cannot be read.
     */
    prepareSlots(): number {
        const container = this.#container();
        if (!container) {
            this.#slots = null;
            return 0;
        }
        this.#slots = slotHandlesOf(container, this.#slots);
        return this.#slots.length;
    }

    /** Cheap read of an inventory slot, through its handle. */
    probe(index: number): SlotProbe | null {
        const handle = this.#slots?.[index];
        if (!handle) return null;
        try {
            return probeOfHandle(handle);
        } catch {
            return null;
        }
    }

    /** Full read of an inventory slot. */
    read(index: number): ItemView | null {
        const container = this.#container();
        if (!container) return null;
        try {
            return fromItemStack(container.getItem(index));
        } catch {
            return null;
        }
    }

    /** Removes `amount` items from a slot. */
    reduce(index: number, amount: number): void {
        const container = this.#container();
        if (!container) return;
        try {
            const stack = container.getItem(index);
            if (!stack) return;
            if (stack.amount <= amount) {
                const own = isRenderedItem(stack) ? takeOwnItemsOut(stack) : [];
                container.setItem(index, undefined);
                this.returnOwnItems(own);
                return;
            }
            const remainder = stack.clone();
            remainder.amount = stack.amount - amount;
            container.setItem(index, remainder);
        } catch (error) {
            this.#onError(`Failed to reclaim from player slot ${index}: ${String(error)}`);
        }
    }

    /**
     * Gives an item back to the player: into `originSlot` when it is free, else anywhere in the
     * inventory, else at their feet.
     *
     * @returns Where it went, or `null` when it could not be given.
     */
    returnItem(originSlot: number | null, item: ItemView): ReturnPlace | null {
        const container = this.#container();
        if (!container) return null;

        try {
            // A real, unmarked stack: the sweeps destroy marked ones.
            const stack = toStorageStack(item);
            if (!stack) return null;

            if (originSlot !== null && originSlot >= 0 && originSlot < container.size && !container.getItem(originSlot)) {
                container.setItem(originSlot, stack);
                return "inventory";
            }
            // `addItem` returns whatever did not fit.
            const overflow = container.addItem(stack);
            if (overflow === undefined) return "inventory";

            const player = this.player;
            if (!player) return null;
            player.dimension.spawnItem(overflow, player.location);
            this.#onTrace(`insert-dropped item=${overflow.typeId} reason=inventory-full`);
            return overflow.amount < stack.amount ? "inventory+feet" : "feet";
        } catch (error) {
            this.#onError(`Failed to return an item to the player: ${String(error)}`);
            return null;
        }
    }

    /**
     * Gives the player back their own items, taken out of a copy the menu wrote, such as a bundle on
     * a button they put an item in.
     *
     * @param stacks The items, unmarked.
     */
    returnOwnItems(stacks: readonly ItemStack[]): void {
        stacks.forEach((stack) => {
            const view = fromItemStack(stack);
            const place = view ? this.returnItem(null, view) : null;
            this.#onTrace(`own-item-returned item=${stack.typeId} amount=${stack.amount} to=${place ?? "lost"}`);
        });
    }

    /** What the viewer holds on the cursor, or `null`. */
    probeCursor(): SlotProbe | null {
        try {
            const stack = this.#cursor()?.item;
            return stack ? probeOfStack(stack) : null;
        } catch {
            return null;
        }
    }

    /** Whether the cursor holds a rendered copy. */
    isCursorRendered(): boolean {
        try {
            return isRenderedItem(this.#cursor()?.item);
        } catch {
            return false;
        }
    }

    /** Whether an inventory slot holds a rendered copy. */
    isSlotRendered(index: number): boolean {
        try {
            return isRenderedItem(this.#container()?.getItem(index));
        } catch {
            return false;
        }
    }

    /** Full read of what the viewer holds on the cursor, lore included, or `null`. */
    readCursor(): ItemView | null {
        try {
            return fromItemStack(this.#cursor()?.item);
        } catch {
            return null;
        }
    }

    /** Removes a rendered copy from the viewer's cursor, as the surface closes. */
    discardMarkedCursor(): void {
        try {
            const cursor = this.#cursor();
            const stack = cursor?.item;
            if (!cursor || !stack || !isRenderedItem(stack)) return;
            const own = takeOwnItemsOut(stack);
            cursor.clear();
            this.#onTrace(`cursor-discarded item=${stack.typeId}`);
            this.returnOwnItems(own);
        } catch {
            // A read-only window, or the player is gone; the sweeps still run.
        }
    }

    /**
     * Takes a rendered copy off the cursor.
     *
     * @returns How many items went; 0 when the cursor held nothing of ours.
     */
    reclaimCursor(): number {
        try {
            const cursor = this.#cursor();
            const stack = cursor?.item;
            if (!cursor || !stack || !isRenderedItem(stack)) return 0;
            const amount = stack.amount;
            const own = takeOwnItemsOut(stack);
            cursor.clear();
            this.returnOwnItems(own);
            return amount;
        } catch {
            return 0;
        }
    }

    /**
     * Takes back up to `amount` of an item like `item`, from the cursor first, then the inventory.
     * Never a rendered copy.
     *
     * @returns How many items were taken.
     */
    takeBack(item: ItemView, amount: number): number {
        let taken = this.#takeBackFromCursor(item, amount);
        const container = this.#container();
        if (!container) return taken;
        const { size } = container;
        for (let index = 0; index < size && taken < amount; index++) {
            let stack: ItemStack | undefined;
            try {
                stack = container.getItem(index);
            } catch {
                continue;
            }
            // The type first: most slots fail it, and are not read whole.
            if (!stack || stack.typeId !== item.typeId || isRenderedItem(stack) || !isTakeBackMatch(fromItemStack(stack), item)) continue;
            const share = Math.min(stack.amount, amount - taken);
            this.reduce(index, share);
            taken += share;
        }
        return taken;
    }

    #takeBackFromCursor(item: ItemView, amount: number): number {
        try {
            const cursor = this.#cursor();
            const stack = cursor?.item;
            if (!cursor || !stack || stack.typeId !== item.typeId || isRenderedItem(stack) || !isTakeBackMatch(fromItemStack(stack), item)) return 0;
            const held = stack.amount;
            const taken = Math.min(held, amount);
            // `clear()` takes the whole stack; the rest goes to the inventory.
            cursor.clear();
            if (held > taken) {
                const rest = stack.clone();
                rest.amount = held - taken;
                const restView = fromItemStack(rest);
                if (restView) this.returnItem(null, restView);
            }
            return taken;
        } catch {
            return 0;
        }
    }

    /**
     * Removes rendered items from the inventory, worn slots and off hand, and from storage items
     * there and on the cursor.
     *
     * @returns How many stacks were removed.
     */
    scrub(): number {
        const player = this.player;
        if (!player) return 0;
        const onRemoved = (probe: SlotProbe): void => {
            this.#swept.push(probe);
        };
        const removed = scrubInventoryOf(player, onRemoved) + this.#scrubCursorStorage({ player, onRemoved });
        if (removed > 0) {
            this.#scrubbedStacks += removed;
            this.#onTrace(`scrub-swept stacks=${removed} total=${this.#scrubbedStacks}`);
        }
        return removed;
    }

    /** Rendered copies the sweep removed since the last call. */
    takeSwept(): readonly SlotProbe[] {
        if (this.#swept.length === 0) return NOTHING_SWEPT;
        const swept = this.#swept;
        this.#swept = [];
        return swept;
    }

    /** Unsubscribes from the inventory-change event. */
    dispose(): void {
        this.#unsubscribeChanges?.();
        this.#unsubscribeChanges = null;
    }

    /**
     * Removes rendered copies from a storage item on the cursor, such as a bundle a button was put
     * in. The cursor can only be cleared, not written, so the cleaned item goes to the inventory.
     */
    #scrubCursorStorage({ player, onRemoved }: { player: Player; onRemoved: (probe: SlotProbe) => void }): number {
        try {
            const cursor = this.#cursor();
            const stack = cursor?.item;
            // Nowhere to put the cleaned item back: clearing the cursor would destroy the player's own.
            if (!cursor || !stack || isRenderedItem(stack) || !this.#container()) return 0;
            const probes: SlotProbe[] = [];
            const spilled: ItemStack[] = [];
            const removed = scrubStorageItem(stack, { onRemoved: (probe) => probes.push(probe), spill: (own) => spilled.push(own) });
            const cleaned = removed > 0 ? fromItemStack(stack) : null;
            if (!cleaned) return 0;
            cursor.clear();
            const place = this.returnItem(null, cleaned);
            this.#onTrace(`cursor-storage-swept item=${stack.typeId} stacks=${removed} to=${place ?? "lost"}`);
            // Only once the cursor is cleared: the own items that did not fit back would otherwise be a second set.
            spilled.forEach(spillToPlayer(player));
            probes.forEach(onRemoved);
            return removed;
        } catch {
            return 0;
        }
    }

    /**
     * The viewer's cursor component.
     *
     * @returns The component, or `undefined` once the viewer is gone.
     * @throws When the engine refuses the read; callers catch.
     */
    #cursor(): PlayerCursorInventoryComponent | undefined {
        return this.player?.getComponent(CURSOR_INVENTORY_COMPONENT_ID) as PlayerCursorInventoryComponent | undefined;
    }

    #container(): Container | null {
        if (this.#passContainer) return this.#passContainer;
        const player = this.player;
        const container = player ? inventoryContainerOf(player) : null;
        if (container && this.#isInPass) this.#passContainer = container;
        return container;
    }
}
