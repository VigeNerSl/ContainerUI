/** What closing a surface settles: unscanned input edits, and real items left in it. */

import type { Container, Entity, ItemStack } from "@minecraft/server";
import type { HostInteraction, ItemView } from "../../core/index.js";
import { fromItemStack } from "../items/itemConversion.js";
import { isRenderedItem } from "../items/itemMarker.js";
import { interactionKindOf, type ExpectedSlots, type SlotProbe } from "../scan/slotMatching.js";
import type { ReturnPlace } from "../scan/viewerInventory.js";
import { isRestrictedError } from "./mountSequence.js";

/** Drops an item where the surface stood. */
const dropAt = (entity: Entity | null, stack: ItemStack): boolean => {
    if (!entity) return false;
    try {
        entity.dimension.spawnItem(stack, entity.location);
        return true;
    } catch {
        return false;
    }
};

/** A return as the close record names it, or `null` when the player could not be given it. */
const destinationOf = (place: ReturnPlace | null): string | null => {
    if (place === "inventory") return "player";
    if (place === "feet") return "ground";
    if (place === "inventory+feet") return "player+ground";
    return null;
};

/**
 * Whether the engine accepts world changes now. A slot is rewritten with its own contents to find
 * out: a close from a `beforeEvents` handler runs in the engine's read-only window, where handing
 * items back and removing the entity would both fail.
 */
export const canWriteWorld = (container: Container | null): boolean => {
    if (!container) return true;
    try {
        container.setItem(0, container.getItem(0));
        return true;
    } catch (error) {
        return !isRestrictedError(error);
    }
};

/** Reports edits to input slots made since the last scan. UI-owned slots are left to {@link returnStrandedItems}. */
export const settleUnscannedInputs = ({
    playerWritable,
    expected,
    probe,
    read,
    emit,
}: {
    playerWritable: ReadonlySet<number>;
    expected: ExpectedSlots;
    probe: (index: number) => SlotProbe | null;
    read: (index: number) => ItemView | null;
    emit: (interaction: HostInteraction) => void;
}): void => {
    for (const index of playerWritable) {
        let current: SlotProbe | null;
        try {
            current = probe(index);
        } catch {
            // The container is gone.
            return;
        }
        if (expected.matches(index, current)) continue;

        const previous = expected.view(index);
        const next = current ? read(index) : null;
        expected.record(index, next);
        emit({ index, kind: interactionKindOf(previous, next), previous, next });
    }
};

/**
 * Returns the real items left in the surface to the player, or drops them, then empties it.
 * Mirror inputs are skipped: their source keeps the real item.
 */
export const returnStrandedItems = ({
    container,
    slotCount,
    mirrored,
    entity,
    returnToPlayer,
    trace,
    reportError,
}: {
    container: Container | null;
    slotCount: number;
    mirrored: ReadonlySet<number>;
    entity: Entity | null;
    returnToPlayer: (item: ItemView) => ReturnPlace | null;
    trace: (message: string) => void;
    reportError: (message: string) => void;
}): void => {
    if (!container) return;

    for (let index = 0; index < slotCount; index++) {
        if (mirrored.has(index)) continue;
        let stack: ItemStack | undefined;
        try {
            stack = container.getItem(index);
        } catch {
            continue;
        }
        if (!stack || isRenderedItem(stack)) continue;

        const view = fromItemStack(stack);
        const destination = destinationOf(view !== null ? returnToPlayer(view) : null) ?? (dropAt(entity, stack) ? "ground" : "lost");
        trace(`close-returned slot=${index} item=${stack.typeId} to=${destination}`);
    }

    // Emptied so that removing the entity cannot drop mirrored copies.
    try {
        container.clearAll();
    } catch (error) {
        reportError(`Failed to empty the surface on close: ${String(error)}`);
    }
};
