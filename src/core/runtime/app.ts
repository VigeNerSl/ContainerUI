/** Mounting and the commit phase: renders a tree onto a host and writes only what changed. */

import { cloneItemView, isSameItem, type HostAdapter, type HostInteraction, type ItemView } from "../host/host.js";
import { createEffect } from "../reactive/effect.js";
import { signal, type Signal } from "../reactive/signal.js";
import { createScope, disposeScope, reportScopeError, runWithScope, type Scope } from "../reactive/owner.js";
import type { Dispose } from "../reactive/graph.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { getRuntimeScheduler } from "./context.js";
import { SURFACE_WIDTH } from "./layout.js";
import type { Child, InputEvent, SlotEvent } from "./element.js";
import type { ComponentInstance, InstanceParent, RenderErrorReport } from "./instance.js";
import { runRenderPass, type ResolvedSlot, type SlotMap } from "./renderer.js";

/** The commit runs after every render effect that can feed it. */
const COMMIT_DEPTH = Number.MAX_SAFE_INTEGER;

/** Diagnostics describing the tree's shape rather than an event, so each is reported once. */
const ONCE_PER_SURFACE_KINDS = new Set<Diagnostic["kind"]>(["overflow", "collision", "dev-warning"]);

/** What the player sees after a render error, for the diagnostic's message. */
const outcomeOf = (report: RenderErrorReport): string => {
    if (report.component === "root") return "the last screen stays up";
    if (report.isCaught) return "its ErrorBoundary shows the fallback";
    return "it renders nothing until it renders again";
};

/** How {@link mount} renders. */
export interface MountOptions {
    /** Columns on the surface. Defaults to 9. */
    width?: number | undefined;
    /** Scheduler to drive updates. Defaults to the runtime scheduler. */
    scheduler?: Scheduler | undefined;
    /** Flush before `mount` returns, so the first screen is complete. Defaults to `true`. */
    syncMount?: boolean | undefined;
    /** Receives every {@link Diagnostic}: overflows and collisions, handler and render errors, failed writes, development warnings and platform errors. */
    onDiagnostic?: ((diagnostic: Diagnostic) => void) | undefined;
}

/**
 * A problem reported by a mounted app. `platform-error` comes from the host: a surface that could
 * not spawn, mount or read, or an inventory that never reached its size. Core also creates one
 * when the host rejects the list of input slots it is given.
 */
export interface Diagnostic {
    kind: "overflow" | "collision" | "handler-error" | "write-failed" | "render-error" | "dev-warning" | "platform-error";
    message: string;
    /** The underlying error, when there is one. */
    detail?: unknown;
}

/** A mounted tree. */
export interface App {
    /** The surface it renders onto. */
    readonly host: HostAdapter;
    /** Slots as of the last commit. */
    readonly slots: ReadonlyMap<number, ResolvedSlot>;
    /** Physical writes issued since mount. */
    readonly writeCount: number;
    /** Runs pending reactive work immediately. */
    flush(): void;
    /** Tears the tree down and stops writing to the host. */
    unmount(): void;
}

/**
 * Renders an element tree onto a host surface.
 *
 * @param element The tree, or a function returning it.
 * @param host The surface to render onto.
 * @param options Mount options.
 * @returns The mounted app.
 * @example
 * const app = mount(() => <Shop player={player} />, host);
 * // later
 * app.unmount();
 */
export const mount = (element: Child | (() => Child), host: HostAdapter, options: MountOptions = {}): App => {
    return new SurfaceApp(element, host, options);
};

class SurfaceApp implements App {
    readonly host: HostAdapter;

    readonly #scheduler: Scheduler;
    readonly #width: number;
    readonly #onDiagnostic: ((diagnostic: Diagnostic) => void) | undefined;

    readonly #rootScope: Scope;
    readonly #rootChildren = new Map<string, ComponentInstance>();
    readonly #rootOrdinals = new Map<string, number>();
    readonly #root: InstanceParent;

    #currentSlots: SlotMap = new Map();
    readonly #lastWritten = new Map<number, ItemView | null>();
    readonly #inputState = new Map<number, ItemView | null>();
    readonly #knownInputs = new Set<number>();
    readonly #interactionRevision: Signal<number> = signal(0);
    readonly #reportedOnce = new Set<string>();

    readonly #unsubscribeInteraction: Dispose;
    readonly #unsubscribeClose: Dispose;
    #isUnmounted = false;
    #writeCount = 0;

    constructor(element: Child | (() => Child), host: HostAdapter, options: MountOptions) {
        this.host = host;
        this.#scheduler = options.scheduler ?? getRuntimeScheduler();
        this.#width = options.width ?? SURFACE_WIDTH;
        this.#onDiagnostic = options.onDiagnostic;
        this.#rootScope = createScope(null);
        this.#root = {
            scope: this.#rootScope,
            children: this.#rootChildren,
            ordinals: this.#rootOrdinals,
            reportRenderError: (report) => this.#reportRenderError(report),
            reportDevWarning: (message) => this.#report({ kind: "dev-warning", message }),
        };

        this.#unsubscribeInteraction = host.onInteraction((interaction) => this.#handleInteraction(interaction));
        this.#unsubscribeClose = host.onClose(() => this.unmount());

        runWithScope(this.#rootScope, () => {
            createEffect(() => this.#renderAndCommit(element), this.#scheduler, { depth: COMMIT_DEPTH });
        });

        if (options.syncMount !== false) this.#scheduler.flushSync();
    }

    get slots(): ReadonlyMap<number, ResolvedSlot> {
        return this.#currentSlots;
    }

    get writeCount(): number {
        return this.#writeCount;
    }

    flush(): void {
        this.#scheduler.flushSync();
    }

    unmount(): void {
        if (this.#isUnmounted) return;
        this.#isUnmounted = true;
        this.#unsubscribeInteraction();
        this.#unsubscribeClose();
        disposeScope(this.#rootScope);
        this.#rootChildren.clear();
        this.#currentSlots.clear();
    }

    #renderAndCommit(element: Child | (() => Child)): void {
        if (this.#isUnmounted) return;
        // Player edits re-run the commit.
        this.#interactionRevision.value;
        let tree: Child;
        try {
            tree = typeof element === "function" ? element() : element;
        } catch (error) {
            // The root has no fallback: the last screen stays up.
            this.#reportRenderError({ error, component: "root", isCaught: false });
            return;
        }
        const slotCount = this.host.slotCount;
        const result = runRenderPass(tree, { size: slotCount, width: this.#width, scheduler: this.#scheduler, root: this.#root });

        if (result.overflowCount > 0) {
            this.#report({
                kind: "overflow",
                message: `${result.overflowCount} cell(s) did not fit on a ${slotCount}-slot surface. Reported once per surface.`,
            });
        }
        if (result.collisions.length > 0) {
            this.#report({
                kind: "collision",
                message: `Slot index(es) ${result.collisions.join(", ")} were assigned more than once; the last assignment wins. Reported once per surface.`,
                detail: result.collisions,
            });
        }
        if (result.coveredInputs.length > 0) {
            this.#report({
                kind: "collision",
                message: `Layer slot(s) ${result.coveredInputs.join(", ")} landed on an input below and were dropped: a layer never covers a player's items. Reported once per surface.`,
                detail: result.coveredInputs,
            });
        }

        this.#commit(result.slots);
    }

    #commit(slots: SlotMap): void {
        this.#currentSlots = slots;

        // Declared before the writes: the host marks what it writes by who owns the slot.
        const playerWritable = new Set<number>();
        const mirrored = new Set<number>();
        for (let index = 0; index < this.host.slotCount; index++) {
            const slot = slots.get(index);
            if (slot?.kind === "input") {
                playerWritable.add(index);
                if (slot.isMirror) mirrored.add(index);
                continue;
            }
            // An input slot that disappeared stops being player-owned.
            if (this.#knownInputs.delete(index)) this.#inputState.delete(index);
        }
        try {
            this.host.setPlayerWritableSlots?.(playerWritable, mirrored);
        } catch (error) {
            // The writes still go out, so what was written stays in step with the slot map.
            this.#reportFailure({ kind: "platform-error", message: `The host could not be told which slots are inputs: ${String(error)}`, detail: error });
        }

        for (let index = 0; index < this.host.slotCount; index++) {
            // A write may close the surface.
            if (this.#isUnmounted) return;
            const slot = slots.get(index);
            const desired = this.#desiredItem(index, slot);
            if (isSameItem(this.#lastWritten.get(index) ?? null, desired)) continue;

            try {
                this.host.writeSlot(index, desired);
            } catch (error) {
                this.#report({
                    kind: "write-failed",
                    message: `Slot ${index} could not be written (${desired?.typeId ?? "empty"}): ${String(error)}`,
                    detail: error,
                });
            }
            // Recorded either way, so a bad item is not retried on every commit. A copy, so an item
            // changed in place still differs from what was written.
            this.#lastWritten.set(index, cloneItemView(desired));
            this.#writeCount++;
        }
    }

    #desiredItem(index: number, slot: ResolvedSlot | undefined): ItemView | null {
        if (!slot) return null;
        if (slot.kind !== "input") return slot.item;

        // A controlled input shows its declaration on every commit.
        if (slot.isControlled) return slot.item;

        if (!this.#knownInputs.has(index)) {
            // First appearance: seed the slot, then hand it to the player.
            this.#knownInputs.add(index);
            const seed = cloneItemView(slot.item);
            this.#inputState.set(index, seed);
            return seed;
        }
        return this.#inputState.get(index) ?? null;
    }

    #handleInteraction(interaction: HostInteraction): void {
        if (this.#isUnmounted) return;
        const slot = this.#currentSlots.get(interaction.index);

        this.#scheduler.batch(() => {
            if (!slot) {
                // Nothing declares this slot, so nothing may live in it.
                this.#write(interaction.index, null);
                return;
            }

            if (slot.kind === "input") {
                this.#handleInputInteraction(slot, interaction.next);
                return;
            }

            // An empty slot is not a button.
            if (slot.kind === "button" && slot.item) {
                if (slot.sound) this.host.playSound?.(slot.sound);
                this.#invoke(() => slot.onClick?.(this.#createSlotEvent(slot)), "onClick");
                // The handler closed the menu: nothing is restored into it.
                if (this.#isUnmounted) return;
            }

            // Display and button slots belong to the tree: put the item back.
            this.#write(slot.index, slot.item);
        });
    }

    #handleInputInteraction(slot: ResolvedSlot, next: ItemView | null): void {
        // A controlled slot's previous item is what was last written to it.
        const previous = this.#knownInputs.has(slot.index)
            ? (this.#inputState.get(slot.index) ?? null)
            : (this.#lastWritten.get(slot.index) ?? null);

        const isRefused = next !== null && slot.accept !== undefined && !this.#invoke(() => slot.accept!(next), "accept", true);
        if (isRefused) {
            // The refused item goes back to the player, and the slot is left empty.
            this.host.giveToViewer?.(cloneItemView(next)!);
            this.#write(slot.index, null);
            // An empty slot had nothing to lose. An occupied one lost its item to the player's swap,
            // so the edit below reports it as a take.
            if (!previous) return;
        }

        const stored = isRefused ? null : cloneItemView(next);
        this.#inputState.set(slot.index, stored);
        // The player moved the item already: no write needed.
        this.#lastWritten.set(slot.index, stored);

        const event: InputEvent = {
            ...this.#createSlotEvent(slot),
            item: stored,
            previous,
            next: stored,
            takeBack: (item) => this.host.takeBackFromViewer?.(cloneItemView(item)!),
            giveBack: (item) => this.host.giveToViewer?.(cloneItemView(item)!),
            clear: () => {
                if (this.#knownInputs.has(slot.index)) this.#inputState.set(slot.index, null);
                this.#write(slot.index, null);
            },
        };

        if (!previous && stored) this.#invoke(() => slot.onPlace?.(event), "onPlace");
        else if (previous && !stored) this.#invoke(() => slot.onTake?.(event), "onTake");
        this.#invoke(() => slot.onChange?.(event), "onChange");
        // Every handler hears of the edit even when one closed the menu: the item really moved.
        if (this.#isUnmounted) return;

        // Re-run the commit, so a controlled slot shows its declaration again.
        this.#interactionRevision.update((revision) => revision + 1);
    }

    #createSlotEvent(slot: ResolvedSlot): SlotEvent {
        return {
            index: slot.index,
            item: slot.item,
            close: () => this.host.close("programmatic"),
        };
    }

    #write(index: number, item: ItemView | null): void {
        if (this.#isUnmounted) return;
        try {
            this.host.writeSlot(index, item);
        } catch (error) {
            this.#report({ kind: "write-failed", message: `Slot ${index} could not be written (${item?.typeId ?? "empty"}): ${String(error)}`, detail: error });
        }
        this.#lastWritten.set(index, cloneItemView(item));
        this.#writeCount++;
    }

    #invoke<T>(body: () => T, label: string, fallback?: T): T | undefined {
        try {
            return body();
        } catch (error) {
            this.#reportFailure({ kind: "handler-error", message: `${label} handler threw: ${String(error)}`, detail: error });
            return fallback;
        }
    }

    /** Reports a render error. A caught one only reaches `onDiagnostic`, never the error reporter. */
    #reportRenderError(report: RenderErrorReport): void {
        const diagnostic: Diagnostic = {
            kind: "render-error",
            message: `${report.component} threw while rendering; ${outcomeOf(report)}: ${String(report.error)}`,
            detail: report.error,
        };
        if (report.isCaught) this.#report(diagnostic);
        else this.#reportFailure(diagnostic);
    }

    /** Reports a failure: to `onDiagnostic` when the app has one, to the error reporter when not. */
    #reportFailure(diagnostic: Diagnostic): void {
        if (this.#onDiagnostic) this.#report(diagnostic);
        else reportScopeError(diagnostic.detail);
    }

    #report(diagnostic: Diagnostic): void {
        if (ONCE_PER_SURFACE_KINDS.has(diagnostic.kind)) {
            const signature = `${diagnostic.kind}:${diagnostic.message}`;
            if (this.#reportedOnce.has(signature)) return;
            this.#reportedOnce.add(signature);
        }
        this.#onDiagnostic?.(diagnostic);
    }
}
