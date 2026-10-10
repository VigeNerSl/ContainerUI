/** Slot handles: read a slot's type, count and name without copying the stack. */

import type { Container, ContainerSlot, ItemStack } from "@minecraft/server";
import type { SlotProbe } from "./slotMatching.js";

/**
 * The probe of a stack already read.
 *
 * @returns Its type, amount and name.
 */
export const probeOfStack = (stack: ItemStack): SlotProbe => {
    return { typeId: stack.typeId, amount: stack.amount, name: stack.nameTag ?? "" };
};

/**
 * A probe read through a slot handle.
 *
 * @returns The probe, or `null` for an empty slot.
 */
export const probeOfHandle = (handle: ContainerSlot): SlotProbe | null => {
    // `typeId` throws on an empty slot.
    if (!handle.hasItem()) return null;
    return { typeId: handle.typeId, amount: handle.amount, name: handle.nameTag ?? "" };
};

/**
 * Handles for every slot of a container. Reuses `kept` while it is the right size and its first handle is still valid.
 *
 * @param container The container.
 * @param kept Handles from an earlier pass.
 * @returns One handle per slot.
 */
export const slotHandlesOf = (container: Container, kept: ContainerSlot[] | null): ContainerSlot[] => {
    const size = container.size;
    if (kept && kept.length === size && kept[0]?.isValid) return kept;
    return Array.from({ length: size }, (_unused, index) => container.getSlot(index));
};
