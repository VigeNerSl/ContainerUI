/** Finds a player's stack swapped onto a button it reads exactly like. */

import type { ItemView } from "../../core/host/host.js";
import { isRenderedView, type SlotProbe } from "./slotMatching.js";
import type { TrackerIO } from "./trackerTypes.js";

/**
 * A player's stack that reads like a button (same type, count and name) swapped onto it leaves the
 * slot looking unchanged, so the probe scan never sees it. The copy it displaced does show: on the
 * cursor, or in the inventory. Each such copy names a kind, and the UI slots of that kind are read
 * in full on the next pass.
 */
export class LookalikeWatch {
    readonly #io: TrackerIO;
    readonly #hasPendingOfKind: (probe: SlotProbe) => boolean;
    /** Kinds of rendered copy found out of place, whose button slots may now hold a player's stack. */
    #suspectKinds: SlotProbe[] = [];
    #isWatchingCursor = false;

    /**
     * @param io The tracker's reads and writes.
     * @param hasPendingOfKind Whether a take of this kind is pending: a lifted button explains its copy.
     */
    constructor(io: TrackerIO, hasPendingOfKind: (probe: SlotProbe) => boolean) {
        this.#io = io;
        this.#hasPendingOfKind = hasPendingOfKind;
    }

    /** Whether a UI-owned slot is meant to hold this kind of item. */
    isUiKind(kind: { typeId: string; name: string }): boolean {
        const io = this.#io;
        for (let index = 0; index < io.slotCount; index++) {
            if (!io.isPlayerWritable(index) && io.expected.isKindAt(index, kind)) return true;
        }
        return false;
    }

    /** Starts watching the cursor, which may now hold a player's look-alike of a button. */
    watchCursor(): void {
        this.#isWatchingCursor = this.#io.isCursorRendered !== undefined;
    }

    /**
     * Suspects the kind of a rendered copy found in the player's inventory slot.
     *
     * @returns Whether the slot held a rendered copy.
     */
    suspectCopyAt(index: number, probe: SlotProbe): boolean {
        if (!this.#io.isPlayerSlotRendered?.(index)) return false;
        this.#suspectKinds.push(probe);
        return true;
    }

    /**
     * Reads the UI slots of every suspected kind and hands each that now holds a real item to `visit`.
     *
     * @param visit Handles one slot; returns `true` to stop, when a handler closed the surface.
     * @returns Whether `visit` stopped the walk.
     */
    reconcile(visit: (index: number, view: ItemView) => boolean): boolean {
        if (this.#isWatchingCursor) this.#checkCursor();
        if (this.#suspectKinds.length === 0) return false;

        const io = this.#io;
        const kinds = this.#suspectKinds;
        this.#suspectKinds = [];
        for (const kind of kinds) {
            for (let index = 0; index < io.slotCount; index++) {
                if (io.isPlayerWritable(index) || !io.expected.isKindAt(index, kind)) continue;
                // A real item already recorded here was met by an earlier pass or suspect.
                if (io.expected.view(index)?.native !== undefined) continue;
                const view = io.readSurface(index);
                if (!view || isRenderedView(view)) continue;

                io.report?.(`lookalike-found slot=${index} item=${view.typeId}`);
                if (visit(index, view)) return true;
            }
        }
        return false;
    }

    /** Forgets every suspect and stops watching the cursor. */
    clear(): void {
        this.#suspectKinds = [];
        this.#isWatchingCursor = false;
    }

    /**
     * Watching stops at the first rendered copy on the cursor, or when the cursor empties or holds
     * another kind. A copy a pending take explains is not suspected.
     */
    #checkCursor(): void {
        const io = this.#io;
        const cursor = io.probeCursor();
        if (!cursor || !this.isUiKind(cursor)) {
            this.#isWatchingCursor = false;
            return;
        }
        if (!io.isCursorRendered?.()) return;

        this.#isWatchingCursor = false;
        // A lifted button is explained by its take.
        if (this.#hasPendingOfKind(cursor)) return;
        this.#suspectKinds.push(cursor);
    }
}
