/** A fluent builder for container screens. It compiles to the same element tree as JSX. */

import { signal, type Signal } from "../reactive/signal.js";
import { h, type Child, type ComponentType, type InputEvent, type ItemSource, type SlotEvent, type VNode } from "../runtime/element.js";
import { SURFACE_WIDTH, borderIndices, rectIndices, toIndex } from "../runtime/layout.js";
import { StorageSlots } from "./storageSlots.js";
import { StorageView } from "./storageView.js";
import type { SlotStorage } from "../storage/slotStorage.js";
import type { ItemView } from "../host/host.js";

/** Options for an `input` declared through the builder. */
export interface InputOptions {
    /** Seeded once, then owned by the player. */
    initialItem?: ItemSource;
    /** Controlled: applied on every commit; edits reach `onChange`. */
    item?: ItemSource;
    /** Controlled only: the source holds the real item, so closing leaves it there. */
    isMirror?: boolean;
    /** Returns `false` to refuse an incoming item. */
    accept?: (item: ItemView) => boolean;
    /** Called when the player places an item. */
    onPlace?: (event: InputEvent) => void;
    /** Called when the player takes the item. */
    onTake?: (event: InputEvent) => void;
    /** Called on every change. */
    onChange?: (event: InputEvent) => void;
}

/** A rectangle in column/row coordinates, inclusive at both ends. */
export interface Area {
    /** `[column, row]` of one corner. */
    from: readonly [number, number];
    /** `[column, row]` of the opposite corner. */
    to: readonly [number, number];
}

/** How {@link ContainerFormBuilder.storage} mirrors a storage. */
export interface StorageOptions {
    /** First storage slot to mirror. Defaults to 0. */
    from?: number;
    /** How many slots. Defaults to the rest of the storage. */
    count?: number;
    /** Show copies the player cannot take. Defaults to `false`: real access. */
    readOnly?: boolean;
    /** Returns `false` to refuse an incoming item. */
    accept?: (item: ItemView) => boolean;
    /** Called after each edit reaches the storage. */
    onEdit?: (event: InputEvent) => void;
    /** Called for an edit refused because the slot changed under it. */
    onConflict?: (event: InputEvent) => void;
    /** Read-only mirrors: called when a slot is clicked. */
    onSlotClick?: (storageIndex: number, item: ItemView | null) => void;
}

/**
 * Builds a screen slot by slot. An item given as a function is re-read on every commit.
 *
 * The example uses `ContainerFormData`, the Bedrock entry's subclass, which adds `.open`.
 *
 * @example
 * new ContainerFormData(27)
 *     .title("§6Shop")
 *     .border({ typeId: "minecraft:gray_stained_glass_pane", name: " " })
 *     .button(11, { typeId: "minecraft:diamond", name: "§aBuy" }, (vigenersl) => buy(vigenersl))
 *     .slot(13, () => ({ typeId: "minecraft:paper", name: `§fCoins: ${coins.value}` }))
 *     .open(player);
 */
export class ContainerFormBuilder {
    readonly size: number;
    readonly width: number;

    readonly #elements = new Map<number, VNode>();
    readonly #ranges: Child[] = [];
    readonly #storageIndices = new Set<number>();
    readonly #revision: Signal<number> = signal(0);
    #title = "Container";

    /**
     * @param size Slot count.
     * @param width Slots per row. Defaults to 9.
     */
    constructor(size: number, width: number = SURFACE_WIDTH) {
        this.size = size;
        this.width = width;
    }

    /**
     * Sets the title shown on the container header.
     *
     * @param text The title.
     */
    title(text: string): this {
        this.#title = text;
        return this;
    }

    /** The title set so far. */
    get resolvedTitle(): string {
        return this.#title;
    }

    /** Slot indices claimed so far, in order. */
    get claimedIndices(): number[] {
        return [...this.#elements.keys()].sort((first, second) => first - second);
    }

    /**
     * A display slot. The item is put back if the player takes it.
     *
     * @param index Slot index.
     * @param item The item, or a function returning it.
     * @throws {RangeError} For an index outside the surface, or inside a storage mirror.
     */
    slot(index: number, item: ItemSource): this {
        return this.#claim(index, h("slot", { index, item }));
    }

    /**
     * A button: `onClick` runs once the player's gesture completes.
     *
     * @param index Slot index.
     * @param item The item, or a function returning it.
     * @param onClick Called on click.
     * @param sound Sound played on click.
     * @throws {RangeError} For an index outside the surface, or inside a storage mirror.
     */
    button(index: number, item: ItemSource, onClick?: (event: SlotEvent) => void, sound?: string): this {
        return this.#claim(
            index,
            h("slot", {
                index,
                item,
                ...(onClick ? { onClick } : {}),
                ...(sound ? { sound } : {}),
            }),
        );
    }

    /**
     * A slot the player owns.
     *
     * @param index Slot index.
     * @param options Input options.
     * @throws {RangeError} For an index outside the surface, or inside a storage mirror.
     */
    input(index: number, options: InputOptions = {}): this {
        return this.#claim(index, h("input", { index, ...options }));
    }

    /**
     * Leaves a slot empty; `fill` and `border` skip it.
     *
     * @param index Slot index.
     */
    reserve(index: number): this {
        return this.#claim(index, h("slot", { index, item: null }));
    }

    /**
     * Places a component at a slot.
     *
     * @param index Slot index.
     * @param type The component.
     * @param props Its props.
     */
    component<P extends object>(index: number, type: ComponentType<P>, props?: P): this {
        return this.#claim(index, h("box", { index }, h(type, (props ?? {}) as P & { key?: never })));
    }

    /**
     * Fills the perimeter, skipping claimed slots.
     *
     * @param item The item, or a function returning it.
     */
    border(item: ItemSource): this {
        for (const index of borderIndices(this.size, this.width)) this.#fillIfFree(index, item);
        return this;
    }

    /**
     * Fills every unclaimed slot. Call it last.
     *
     * @param item The item, or a function returning it.
     */
    fill(item: ItemSource): this {
        for (let index = 0; index < this.size; index++) this.#fillIfFree(index, item);
        return this;
    }

    /**
     * Fills an inclusive rectangle, skipping claimed slots.
     *
     * @param area The rectangle.
     * @param item The item, or a function returning it.
     */
    rect(area: Area, item: ItemSource): this {
        const [startColumn, startRow] = area.from;
        const [endColumn, endRow] = area.to;
        const indices = rectIndices({ startColumn, startRow, endColumn, endRow, size: this.size, width: this.width });
        for (const index of indices) this.#fillIfFree(index, item);
        return this;
    }

    /**
     * Lays slots out from rows of characters. A space leaves a slot alone.
     *
     * @param rows One string per row.
     * @param mapping The item for each character.
     * @throws {RangeError} For a row wider than the surface, an unmapped character, or a row past the last slot.
     * @example
     * .pattern(
     *     ["#########",
     *      "#       #",
     *      "#########"],
     *     { "#": pane },
     * )
     */
    pattern(rows: readonly string[], mapping: Readonly<Record<string, ItemSource>>): this {
        rows.forEach((row, rowIndex) => {
            if (row.length > this.width) {
                throw new RangeError(
                    `[ContainerUI] Pattern row ${rowIndex} is ${row.length} characters wide; the surface is ${this.width}.`,
                );
            }

            [...row].forEach((character, column) => {
                if (character === " ") return;
                if (!(character in mapping)) {
                    throw new RangeError(
                        `[ContainerUI] Pattern character "${character}" at row ${rowIndex}, column ${column} is not in the mapping.`,
                    );
                }

                const index = toIndex(rowIndex, column, this.width);
                if (index >= this.size) {
                    throw new RangeError(
                        `[ContainerUI] Pattern row ${rowIndex} lands outside a ${this.size}-slot surface.`,
                    );
                }
                this.#fillIfFree(index, mapping[character]!);
            });
        });
        return this;
    }

    /**
     * Mirrors a storage from the next free slot. With `readOnly` the player sees copies they
     * cannot take; otherwise they get real access.
     *
     * @param storage The storage to mirror.
     * @param options Mirror options.
     * @throws {RangeError} When every slot is already claimed, the range runs past the last slot, or
     * it runs over a slot already claimed; or when `from` and `count` are not whole numbers inside
     * the storage.
     */
    storage(storage: SlotStorage, options: StorageOptions = {}): this {
        const { readOnly = false, from, count, accept, onEdit, onConflict, onSlotClick } = options;
        this.#assertStorageRange({ size: storage.size, from: from ?? 0, count });
        const anchor = this.#nextFreeIndex();
        const claimed = count ?? Math.max(0, storage.size - (from ?? 0));
        if (anchor + claimed > this.size) {
            throw new RangeError(
                `[ContainerUI] A storage mirror of ${claimed} slots from slot ${anchor} runs past a ${this.size}-slot form.`,
            );
        }
        // The range is contiguous: a claimed slot inside it would be replaced by a storage slot.
        const taken = Array.from({ length: claimed }, (_unused, offset) => anchor + offset).find((index) => this.#elements.has(index));
        if (taken !== undefined) {
            throw new RangeError(
                `[ContainerUI] A storage mirror of ${claimed} slots from slot ${anchor} runs over slot ${taken}, which is already claimed.`,
            );
        }

        this.#ranges.push(
            readOnly
                ? h(StorageView, { storage, index: anchor, from, count, onSlotClick })
                : h(StorageSlots, { storage, index: anchor, from, count, accept, onEdit, onConflict }),
        );

        // Claim the range so `fill` skips it.
        for (let offset = 0; offset < claimed; offset++) {
            this.#elements.set(anchor + offset, h("box", { index: anchor + offset }));
            this.#storageIndices.add(anchor + offset);
        }
        this.#touch();
        return this;
    }

    /** The element tree. Rebuilt on every commit, so changes made after opening take effect. */
    build(): Child {
        this.#revision.value;
        return [...this.#elements.values(), ...this.#ranges];
    }

    #claim(index: number, element: VNode): this {
        this.#assertIndex(index);
        if (this.#storageIndices.has(index)) {
            throw new RangeError(`[ContainerUI] Slot ${index} belongs to a storage mirror and cannot be claimed again.`);
        }
        this.#elements.set(index, element);
        this.#touch();
        return this;
    }

    #fillIfFree(index: number, item: ItemSource): void {
        if (this.#elements.has(index)) return;
        this.#elements.set(index, h("slot", { index, item }));
        this.#touch();
    }

    #touch(): void {
        this.#revision.update((revision) => revision + 1);
    }

    #nextFreeIndex(): number {
        for (let index = 0; index < this.size; index++) {
            if (!this.#elements.has(index)) return index;
        }
        throw new RangeError(`[ContainerUI] No free slot left for a storage mirror: all ${this.size} slots are claimed.`);
    }

    #assertStorageRange({ size, from, count }: { size: number; from: number; count: number | undefined }): void {
        if (!Number.isInteger(from) || from < 0) {
            throw new RangeError(`[ContainerUI] A storage mirror cannot start at slot ${from}; it must be a whole number from 0.`);
        }
        if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
            throw new RangeError(`[ContainerUI] A storage mirror cannot hold ${count} slots; it must be a whole number from 0.`);
        }
        // A storage that cannot say how big it is cannot be checked.
        if (!Number.isFinite(size)) return;
        if (from > size || from + (count ?? 0) > size) {
            throw new RangeError(`[ContainerUI] A storage mirror of slots ${from} to ${from + (count ?? size - from) - 1} runs past a ${size}-slot storage.`);
        }
    }

    #assertIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.size) {
            throw new RangeError(`[ContainerUI] Slot index ${index} is outside 0..${this.size - 1}.`);
        }
    }
}
