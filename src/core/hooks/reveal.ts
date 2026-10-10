/** Staggered reveals: the step at which each slot appears, kept as state. */

import { signal, type ReadonlySignal } from "../reactive/signal.js";
import { SURFACE_WIDTH, toCoordinates } from "../runtime/layout.js";

/** Order in which slots take their turn. */
export type RevealOrder =
    /** Left to right, top to bottom. */
    | "sweep"
    /** Bottom-right to top-left. */
    | "sweep-reverse"
    /** Whole rows at a time. */
    | "rows"
    /** Whole columns at a time. */
    | "columns"
    /** Diagonal wave from the top-left corner. */
    | "wave"
    /** Rings growing out of the middle. */
    | "center-out"
    /** Rings collapsing inward. */
    | "center-in"
    /** A square spiral from the middle. */
    | "spiral"
    /** Scattered, but deterministic for a given seed. */
    | "random";

/** How a reveal is laid out and paced. */
export interface RevealOptions {
    /** Slot count. */
    size: number;
    /** Order of appearance. Defaults to `"sweep"`. */
    order?: RevealOrder;
    /** Slots per row. Defaults to 9. */
    width?: number;
    /** Ticks between steps, for {@link useReveal}. Defaults to 1. */
    stepTicks?: number;
    /** Steps advanced each time the timer fires, for {@link useReveal}. Defaults to 1. */
    stepsPerTick?: number;
    /** Seed for `"random"`. Defaults to 1. */
    seed?: number;
    /** Start finished. Defaults to `false`. */
    startComplete?: boolean;
}

/** A running reveal. */
export interface Reveal {
    /** Whether this slot's turn has come. Read it inside an item function to write only the revealed slots. */
    isVisible(index: number): boolean;
    /** Whether every slot is visible. */
    readonly isComplete: ReadonlySignal<boolean>;
    /** The current step. */
    readonly step: ReadonlySignal<number>;
    /** Plays it again from the start. */
    restart(): void;
    /** Reveals everything at once. */
    finish(): void;
}

/** A reveal moved by hand, as {@link createReveal} returns it. */
export interface RevealState extends Reveal {
    /** Moves forward by `steps`, at least one. */
    advance(steps: number): void;
    /** The step at which the last slot appears. */
    readonly maxStep: number;
}

/** Indices in square-spiral order, from the middle of the surface. */
const spiralOrder = (size: number, width: number): number[] => {
    const rows = Math.ceil(size / width);
    const visited = new Array<boolean>(size).fill(false);
    const result: number[] = [];

    let row = Math.floor((rows - 1) / 2);
    let column = Math.floor((width - 1) / 2);

    const rowDeltas = [0, 1, 0, -1];
    const columnDeltas = [1, 0, -1, 0];
    let direction = 0;
    let runLength = 1;

    const visit = (): void => {
        if (row < 0 || row >= rows || column < 0 || column >= width) return;
        const index = row * width + column;
        if (index >= size || visited[index]) return;
        visited[index] = true;
        result.push(index);
    };

    visit();
    // Two runs of equal length, then the length grows.
    while (result.length < size && runLength <= rows + width) {
        for (let leg = 0; leg < 2; leg++) {
            for (let step = 0; step < runLength; step++) {
                row += rowDeltas[direction]!;
                column += columnDeltas[direction]!;
                visit();
            }
            direction = (direction + 1) % 4;
        }
        runLength++;
    }

    // Slots the spiral could not reach go last.
    for (let index = 0; index < size; index++) if (!visited[index]) result.push(index);
    return result;
};

/** A deterministic Fisher–Yates shuffle over a small LCG. */
const shuffledIndices = (size: number, seed: number): number[] => {
    const indices = Array.from({ length: size }, (_unused, index) => index);
    // Seed 0 shuffles as seed 1 does.
    const seeded = seed | 0;
    let state = seeded === 0 ? 1 : seeded;

    for (let position = size - 1; position > 0; position--) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        const target = state % (position + 1);
        const swap = indices[position]!;
        indices[position] = indices[target]!;
        indices[target] = swap;
    }
    return indices;
};

/**
 * The step at which each slot appears. Deterministic, `"random"` included.
 *
 * @param order Order of appearance.
 * @param size Slot count.
 * @param width Slots per row.
 * @param seed Seed for `"random"`.
 * @returns One step per slot index, the first at step 0.
 * @throws {RangeError} For a `size` that is not a non-negative integer, a `width` that is not a
 * positive integer, or a `seed` that is not finite.
 * @example
 * revealSteps("rows", 18); // [0, 0, …, 0, 1, 1, …, 1]
 */
export const revealSteps = (order: RevealOrder, size: number, width: number = SURFACE_WIDTH, seed = 1): number[] => {
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new RangeError(`[ContainerUI] Reveal size must be a non-negative integer; got ${String(size)}.`);
    }
    if (!Number.isSafeInteger(width) || width < 1) {
        throw new RangeError(`[ContainerUI] Reveal width must be a positive integer; got ${String(width)}.`);
    }
    if (!Number.isFinite(seed)) {
        throw new RangeError(`[ContainerUI] Reveal seed must be a finite number; got ${String(seed)}.`);
    }
    const steps = new Array<number>(size).fill(0);
    const rows = Math.ceil(size / width);

    switch (order) {
        case "sweep":
            for (let index = 0; index < size; index++) steps[index] = index;
            break;

        case "sweep-reverse":
            for (let index = 0; index < size; index++) steps[index] = size - 1 - index;
            break;

        case "rows":
            for (let index = 0; index < size; index++) steps[index] = toCoordinates(index, width).row;
            break;

        case "columns":
            for (let index = 0; index < size; index++) steps[index] = toCoordinates(index, width).column;
            break;

        case "wave":
            for (let index = 0; index < size; index++) {
                const { row, column } = toCoordinates(index, width);
                steps[index] = row + column;
            }
            break;

        case "center-out":
        case "center-in": {
            const centreRow = (rows - 1) / 2;
            const centreColumn = (width - 1) / 2;
            let maximum = 0;
            for (let index = 0; index < size; index++) {
                const { row, column } = toCoordinates(index, width);
                // Chebyshev distance: square rings.
                const distance = Math.round(Math.max(Math.abs(row - centreRow), Math.abs(column - centreColumn)));
                steps[index] = distance;
                maximum = Math.max(maximum, distance);
            }
            if (order === "center-in") {
                for (let index = 0; index < size; index++) steps[index] = maximum - steps[index]!;
            }
            break;
        }

        case "spiral":
            for (const [position, index] of spiralOrder(size, width).entries()) steps[index] = position;
            break;

        case "random":
            for (const [position, index] of shuffledIndices(size, seed).entries()) steps[index] = position;
            break;
    }

    // Some slot shows on step 0: rings on a surface with an even row count otherwise start at 1.
    const first = steps.reduce((minimum, step) => Math.min(minimum, step), Number.POSITIVE_INFINITY);
    return first > 0 && Number.isFinite(first) ? steps.map((step) => step - first) : steps;
};

/**
 * Creates the state behind a staggered reveal. {@link useReveal} drives it from a component.
 *
 * @param options Size, order, width, seed and `startComplete`; `stepTicks` and `stepsPerTick` are
 * not read.
 * @returns The reveal, with `advance` to move it by hand.
 * @throws {RangeError} For a `size`, `width` or `seed` that {@link revealSteps} refuses.
 * @example
 * const reveal = createReveal({ size: 27, order: "wave" });
 * reveal.advance(1);
 */
export const createReveal = (options: RevealOptions): RevealState => {
    const steps = revealSteps(options.order ?? "sweep", options.size, options.width ?? SURFACE_WIDTH, options.seed ?? 1);
    const maxStep = steps.reduce((maximum, step) => Math.max(maximum, step), 0);

    const current = signal(options.startComplete ? maxStep : -1);
    const isComplete: ReadonlySignal<boolean> = {
        get value() {
            return current.value >= maxStep;
        },
        peek: () => current.peek() >= maxStep,
    };

    return {
        maxStep,
        isVisible: (index) => {
            const step = steps[index];
            return step !== undefined && step <= current.value;
        },
        isComplete,
        step: {
            get value() {
                return current.value;
            },
            peek: () => current.peek(),
        },
        advance: (count) => {
            if (current.peek() >= maxStep) return;
            current.set(Math.min(maxStep, current.peek() + Math.max(1, count)));
        },
        restart: () => {
            current.set(-1);
        },
        finish: () => {
            current.set(maxStep);
        },
    };
};
