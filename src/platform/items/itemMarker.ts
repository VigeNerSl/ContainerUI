/** The invisible marker on rendered items: a dynamic property, or a lore line where the property does not stick. */

import type { ItemStack } from "@minecraft/server";
import { LEGACY_UI_ITEM_MARKER, UI_ITEM_MARKER_PROPERTY } from "../constants.js";

/**
 * Whether any lore line contains the legacy marker.
 *
 * @internal
 */
export const hasLegacyMarker = (lore: readonly string[]): boolean => {
    return lore.some((line) => line.includes(LEGACY_UI_ITEM_MARKER));
};

/**
 * Sets the marker property and reports whether it was kept: stackable items discard it.
 *
 * @internal
 */
export const applyDynamicMarker = (stack: ItemStack): boolean => {
    try {
        stack.setDynamicProperty(UI_ITEM_MARKER_PROPERTY, true);
        return stack.getDynamicProperty(UI_ITEM_MARKER_PROPERTY) === true;
    } catch {
        return false;
    }
};

/** The engine's lore limits: lines per stack, and characters per line, colour codes included. */
export const MAX_LORE_LINES = 20;
export const MAX_LORE_LINE_LENGTH = 50;

/** A line holding only the marker, twice, so a reader can tell it from a consumer line that ended in the marker. */
const MARKER_LINE = LEGACY_UI_ITEM_MARKER + LEGACY_UI_ITEM_MARKER;

/**
 * Marks a lore within the engine's limits. The marker rides the last line while that stays within
 * 50 characters, so a stack with lore gains no row; otherwise it takes a line of its own, and a
 * lore already at 20 lines gives up the tail of its last line instead. The lore is never left
 * unmarked.
 *
 * @internal
 */
export const applyLoreMarker = (lore: string[]): void => {
    if (lore.length === 0) {
        lore.push(LEGACY_UI_ITEM_MARKER);
        return;
    }
    const lastIndex = lore.length - 1;
    const last = lore[lastIndex] ?? "";
    if (last.length + LEGACY_UI_ITEM_MARKER.length <= MAX_LORE_LINE_LENGTH) {
        lore[lastIndex] = last + LEGACY_UI_ITEM_MARKER;
        return;
    }
    if (lore.length < MAX_LORE_LINES) {
        lore.push(MARKER_LINE);
        return;
    }
    // Cut before a colour-code introducer, so the marker does not follow half a code.
    const room = MAX_LORE_LINE_LENGTH - LEGACY_UI_ITEM_MARKER.length;
    const kept = last.slice(0, room);
    lore[lastIndex] = (kept.endsWith("§") ? kept.slice(0, -1) : kept) + LEGACY_UI_ITEM_MARKER;
};

/**
 * Removes the lore marker, keeping every consumer line. A lore of the marker alone becomes empty;
 * a marker ending a longer lore sits on its last line, which stays even when it is then empty;
 * a line of the marker twice is the one added to hold it and goes.
 *
 * @internal
 */
export const stripLoreMarker = (lore: readonly string[]): string[] => {
    if (lore.length === 1 && lore[0] === LEGACY_UI_ITEM_MARKER) return [];
    return lore.filter((line) => line !== MARKER_LINE).map((line) => line.split(LEGACY_UI_ITEM_MARKER).join(""));
};

/**
 * Whether a stack was made by the renderer: it carries the marker property or the legacy lore
 * marker.
 *
 * @param stack Any stack, or `undefined`.
 * @returns `false` for `undefined` or an unreadable stack.
 */
export const isRenderedItem = (stack: ItemStack | undefined): boolean => {
    if (!stack) return false;
    try {
        if (stack.getDynamicProperty(UI_ITEM_MARKER_PROPERTY) === true) return true;
    } catch {
        // Fall through to the lore check.
    }
    try {
        return hasLegacyMarker(stack.getLore());
    } catch {
        return false;
    }
};
