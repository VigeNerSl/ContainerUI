/** How the scan compares items: cheap probes, full views, and the tables of what each slot holds. */

import { areLoresEqual, type InteractionKind, type ItemView } from "../../core/host/host.js";

/** A cheap read of a slot, without lore. */
export interface SlotProbe {
    typeId: string;
    amount: number;
    /** The name tag, or `""` for none. */
    name: string;
    /**
     * The lore without the anti-dupe marker. Read only for a copy the guard or a sweep removed, so
     * two buttons of one kind can be told apart; absent on the probes the scan takes every pass.
     */
    lore?: readonly string[];
}

/**
 * Whether two probes are the same kind of item, stack size aside. For matching a take against
 * the player's inventory or the ground; inside a slot use {@link isSameVisibleItem}.
 *
 * @param first A probe, or `null`.
 * @param second A probe, or `null`.
 * @returns `false` when either is `null`.
 */
export const isSameItemKind = (first: SlotProbe | null, second: SlotProbe | null): boolean => {
    if (!first || !second) return false;
    return first.typeId === second.typeId && first.name === second.name;
};

/**
 * Whether two full views look the same to the player, stack size aside. A rendered copy never
 * matches a player's item, however alike they look.
 */
export const isSameVisibleItem = (first: ItemView | null, second: ItemView | null): boolean => {
    if (!first || !second) return false;
    if ((first.native === undefined) !== (second.native === undefined)) return false;
    if (first.typeId !== second.typeId) return false;
    if ((first.name ?? "") !== (second.name ?? "")) return false;
    return areLoresEqual(first.lore, second.lore);
};

/** Whether a view read back from a slot is a rendered copy rather than the player's item. */
export const isRenderedView = (view: ItemView): boolean => {
    return view.native === undefined;
};

/** What a change from `previous` to `next` in one slot is. */
export const interactionKindOf = (previous: ItemView | null, next: ItemView | null): InteractionKind => {
    if (previous && !next) return "take";
    if (!previous && next) return "place";
    return "swap";
};

/**
 * Whether two probes read the same slot contents: type, amount and name.
 *
 * @param first A probe, or `null` for an empty slot.
 * @param second A probe, or `null` for an empty slot.
 * @returns `true` when both are empty or all three fields match.
 */
export const isSameProbe = (first: SlotProbe | null, second: SlotProbe | null): boolean => {
    if (!first || !second) return !first && !second;
    return first.typeId === second.typeId && first.amount === second.amount && first.name === second.name;
};

/** The probe of a full view. */
export const probeOfView = (view: ItemView): SlotProbe => {
    return { typeId: view.typeId, amount: view.amount ?? 1, name: view.name ?? "" };
};

/** What every surface slot should hold, kept as parallel arrays so a match allocates nothing. */
export class ExpectedSlots {
    readonly #typeId: string[];
    readonly #amount: number[];
    readonly #name: string[];
    readonly #view: (ItemView | null)[];

    constructor(slotCount: number) {
        this.#typeId = new Array<string>(slotCount).fill("");
        this.#amount = new Array<number>(slotCount).fill(0);
        this.#name = new Array<string>(slotCount).fill("");
        this.#view = new Array<ItemView | null>(slotCount).fill(null);
    }

    /**
     * Records what was written to a slot.
     *
     * @param index The slot.
     * @param item The view behind the write, kept for restores and reports.
     * @param written What the slot physically holds now, when the caller knows it. Without it the
     * signature is taken from the view, which assumes the write kept every field the scan compares.
     */
    record(index: number, item: ItemView | null, written?: SlotProbe | null): void {
        const signature = written === undefined ? (item ? probeOfView(item) : null) : written;
        this.#typeId[index] = signature?.typeId ?? "";
        this.#amount[index] = signature?.amount ?? 0;
        this.#name[index] = signature?.name ?? "";
        this.#view[index] = item;
    }

    /** Whether a probe matches what the slot should hold. */
    matches(index: number, probe: SlotProbe | null): boolean {
        if (!probe) return this.#typeId[index] === "";
        return this.#typeId[index] === probe.typeId && this.#amount[index] === probe.amount && this.#name[index] === probe.name;
    }

    /** What was last recorded for a slot. */
    view(index: number): ItemView | null {
        return this.#view[index] ?? null;
    }

    /** Whether a slot should hold this kind of item: type and name, whatever the count. */
    isKindAt(index: number, kind: { typeId: string; name: string }): boolean {
        const typeId = this.#typeId[index];
        return typeId !== "" && typeId === kind.typeId && this.#name[index] === kind.name;
    }
}

/** Probe signatures of a container whose size can change: the viewer's inventory. */
export class Signatures {
    #typeId: string[] = [];
    #amount: number[] = [];
    #name: string[] = [];
    #isPrimed = false;

    /** How many slots the snapshot covers. */
    get size(): number {
        return this.#typeId.length;
    }

    /** Whether a full snapshot has been taken; before that, differences are not changes. */
    get isPrimed(): boolean {
        return this.#isPrimed;
    }

    /** Matches a new container size, forgetting every signature when it changed. */
    resize(size: number): void {
        if (this.#typeId.length === size) return;
        this.#typeId = new Array<string>(size).fill("");
        this.#amount = new Array<number>(size).fill(0);
        this.#name = new Array<string>(size).fill("");
        this.#isPrimed = false;
    }

    /** Marks the signatures as a complete snapshot. */
    prime(): void {
        this.#isPrimed = true;
    }

    /** Records what a slot holds. */
    record(index: number, probe: SlotProbe | null): void {
        this.#typeId[index] = probe?.typeId ?? "";
        this.#amount[index] = probe?.amount ?? 0;
        this.#name[index] = probe?.name ?? "";
    }

    /** The recorded type id, or `""` for an empty slot. */
    typeIdAt(index: number): string {
        return this.#typeId[index] ?? "";
    }

    /** The recorded amount, or 0 for an empty slot. */
    amountAt(index: number): number {
        return this.#amount[index] ?? 0;
    }

    /** The recorded name, or `""`. */
    nameAt(index: number): string {
        return this.#name[index] ?? "";
    }
}
