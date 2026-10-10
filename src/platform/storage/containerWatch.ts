/** Watches a native container for changes made outside its owner. Reference-counted. */

import { system, type Container } from "@minecraft/server";
import { probeOfStack } from "../scan/slotHandles.js";
import { Signatures, type SlotProbe } from "../scan/slotMatching.js";

/** A shared watch over one container, as {@link createContainerWatcher} returns it. */
export interface ContainerWatcher {
    /** Starts, or joins, the watch. */
    start(intervalTicks: number): void;
    /** Leaves; the timer stops with the last watcher. */
    stop(): void;
    /** Stops regardless of watchers. */
    dispose(): void;
    /** Records the owner's own write, as the stack it wrote, so it does not read as a change. */
    record(index: number, written: SlotProbe | null): void;
    /** Re-reads every slot. */
    reset(): void;
    /** Cost so far. */
    readonly stats: { passes: number; totalMs: number };
}

/** What a watcher reads and whom it tells. */
interface ContainerWatchOptions {
    /** The container, or `null` once it is gone. */
    resolveContainer: () => Container | null;
    /** Called with the slots that changed outside the owner. */
    onExternalChange: (changedSlots: readonly number[]) => void;
    /** Called once when the container is gone. */
    onInvalid: () => void;
}

/**
 * A slot's probe, or `undefined` when the read failed and the slot should be left as it was.
 */
const probeAt = (container: Container, index: number): SlotProbe | null | undefined => {
    try {
        const stack = container.getItem(index);
        return stack ? probeOfStack(stack) : null;
    } catch {
        return undefined;
    }
};

class ContainerWatch implements ContainerWatcher {
    readonly #options: ContainerWatchOptions;
    readonly #signatures = new Signatures();
    #runId: number | null = null;
    #watcherCount = 0;
    #passes = 0;
    #totalMs = 0;

    constructor(options: ContainerWatchOptions) {
        this.#options = options;
    }

    get stats(): { passes: number; totalMs: number } {
        return { passes: this.#passes, totalMs: this.#totalMs };
    }

    start(intervalTicks: number): void {
        this.#watcherCount++;
        if (this.#runId !== null) return;
        this.reset();
        this.#runId = system.runInterval(() => this.#pass(), intervalTicks);
    }

    stop(): void {
        this.#watcherCount = Math.max(0, this.#watcherCount - 1);
        if (this.#watcherCount === 0) this.dispose();
    }

    dispose(): void {
        if (this.#runId !== null) system.clearRun(this.#runId);
        this.#runId = null;
        this.#watcherCount = 0;
    }

    record(index: number, written: SlotProbe | null): void {
        this.#signatures.record(index, written);
    }

    reset(): void {
        const container = this.#options.resolveContainer();
        const size = container?.size ?? 0;
        this.#signatures.resize(size);
        if (!container) return;
        for (let index = 0; index < size; index++) {
            const probe = probeAt(container, index);
            this.#signatures.record(index, probe ?? null);
        }
    }

    #pass(): void {
        const startedAtMs = Date.now();
        const container = this.#options.resolveContainer();
        if (!container) {
            this.dispose();
            this.#options.onInvalid();
            return;
        }

        const changed: number[] = [];
        for (let index = 0; index < container.size; index++) {
            const probe = probeAt(container, index);
            if (probe === undefined || this.#matches(index, probe)) continue;
            this.#signatures.record(index, probe);
            changed.push(index);
        }

        this.#passes++;
        this.#totalMs += Date.now() - startedAtMs;
        if (changed.length > 0) this.#options.onExternalChange(changed);
    }

    #matches(index: number, probe: SlotProbe | null): boolean {
        const signatures = this.#signatures;
        return (
            signatures.typeIdAt(index) === (probe?.typeId ?? "") &&
            signatures.amountAt(index) === (probe?.amount ?? 0) &&
            signatures.nameAt(index) === (probe?.name ?? "")
        );
    }
}

/**
 * Creates a watcher.
 *
 * @param options `resolveContainer`: the container, or `null` once gone. `onExternalChange`: called
 * with the changed slots. `onInvalid`: called once when the container is gone.
 * @returns The watcher.
 */
export const createContainerWatcher = (options: ContainerWatchOptions): ContainerWatcher => {
    return new ContainerWatch(options);
};
