/** An in-memory surface and player inventory that drive the built interaction tracker. */

/** An item view with a probe's three fields. */
export const item = (typeId, amount = 1, name = "") => ({ typeId, amount, name });

/** The probe of a view, or `null`. */
export const probeOf = (view) => (view ? { typeId: view.typeId, amount: view.amount ?? 1, name: view.name ?? "" } : null);

/**
 * Creates `makeWorld` over the tracker classes loaded from the build.
 *
 * `makeWorld` options: `surface` and `player` slots; `writable` input indices; `maxPendingTicks`;
 * `onEmit(state, interaction)`; `changeEvents` to gate the inventory diff on a reported change;
 * `reclaimsCursor` to let the tracker clear a copy from the cursor; `restoreInvalidates` to make
 * a restore end a pending take, as the real surface does.
 */
export const worldFactory = ({ ExpectedSlots, InteractionTracker }) => ({
    surface = [],
    player = [],
    writable = [],
    maxPendingTicks = 20,
    onEmit,
    changeEvents = false,
    reclaimsCursor = false,
    restoreInvalidates = false,
} = {}) => {
    const state = {
        surface: [...surface],
        player: [...player],
        /** Cheap inventory reads, which the scan gate saves. */
        playerProbes: 0,
        /** Stands in for the engine's inventory-change event. */
        inventoryChanged: false,
        emitted: [],
        traces: [],
        inventoryFull: false,
        isClosed: false,
        playerGone: false,
        probes: 0,
        /** Full inventory reads, which must stay rare. */
        playerReads: 0,
        /** The stack on the player's cursor, or null. */
        cursor: null,
        /** What the inventory sweep removed since the last pass. */
        swept: [],
        /** Cursor probes, which must stay out of idle passes. */
        cursorProbes: 0,
    };

    const expected = new ExpectedSlots(state.surface.length);
    state.surface.forEach((view, index) => expected.record(index, view));

    state.tracker = new InteractionTracker({
        slotCount: state.surface.length,
        expected,
        probeSurface: (index) => {
            state.probes++;
            return probeOf(state.surface[index] ?? null);
        },
        readSurface: (index) => state.surface[index] ?? null,
        restoreSurface: (index, view) => {
            state.surface[index] = view;
            expected.record(index, view);
            if (restoreInvalidates) state.tracker.invalidatePending(index);
        },
        isPlayerWritable: (index) => writable.includes(index),
        probeCursor: () => {
            state.cursorProbes++;
            return probeOf(state.cursor ?? null);
        },
        isCursorRendered: () => Boolean(state.cursor) && !state.cursor.native,
        isPlayerSlotRendered: (index) => Boolean(state.player[index]) && !state.player[index].native,
        reclaimFromCursor: reclaimsCursor
            ? () => {
                  const held = state.cursor;
                  // A real item carries `native`; a copy does not.
                  if (!held || held.native) return 0;
                  state.cursor = null;
                  return held.amount ?? 1;
              }
            : undefined,
        readCursor: () => state.cursor ?? null,
        takeSwept: () => {
            const swept = state.swept;
            state.swept = [];
            return swept;
        },
        playerSlotCount: () => (state.playerGone ? 0 : state.player.length),
        probePlayer: (index) => {
            state.playerProbes++;
            return probeOf(state.player[index] ?? null);
        },
        takePlayerInventoryChange: changeEvents
            ? () => {
                  const hasChanged = state.inventoryChanged;
                  state.inventoryChanged = false;
                  return hasChanged;
              }
            : undefined,
        readPlayer: (index) => {
            state.playerReads++;
            return state.player[index] ?? null;
        },
        reducePlayer: (index, amount) => {
            const current = state.player[index];
            if (!current) return;
            const remaining = (current.amount ?? 1) - amount;
            state.player[index] = remaining > 0 ? { ...current, amount: remaining } : null;
        },
        returnToPlayer: (originSlot, view) => {
            if (state.inventoryFull) return false;
            if (originSlot !== null && !state.player[originSlot]) {
                state.player[originSlot] = view;
                return true;
            }
            const free = state.player.findIndex((slot) => !slot);
            if (free === -1) return false;
            state.player[free] = view;
            return true;
        },
        emit: (interaction) => {
            state.emitted.push(interaction);
            onEmit?.(state, interaction);
        },
        isClosed: () => state.isClosed,
        maxPendingTicks,
        report: (message) => state.traces.push(message),
    });

    /** The core's repaint of a slot after an interaction, invalidation included. */
    state.applyCoreRepaint = (index, view) => {
        state.surface[index] = view;
        expected.record(index, view);
        state.tracker.invalidatePending(index);
    };
    state.expected = expected;
    return state;
};
