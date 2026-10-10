/** Layout: turns the element tree into slot indices by handing out cells from nested frames. */

/** Columns in a container surface. */
export const SURFACE_WIDTH = 9;

/** How a frame steps from one cell to the next. */
export type LayoutKind = "box" | "row" | "column" | "grid";

/** Where a {@link LayoutFrame} starts and how it steps. */
export interface LayoutFrameOptions {
    kind: LayoutKind;
    /** Index the frame starts at. */
    anchor: number;
    /** Empty cells between children, an integer. A negative gap counts as 0. Defaults to 0. */
    gap?: number | undefined;
    /** Cells per row, an integer. Grid only; below 1 counts as 1. Defaults to the surface width. */
    columns?: number | undefined;
    /** Slots per surface row. Defaults to {@link SURFACE_WIDTH}. */
    width?: number | undefined;
    /** Slot count; cells past it overflow. */
    size: number;
}

/** `value`, checked to be an integer. */
const requireInteger = (value: number, name: string): number => {
    if (Number.isInteger(value)) return value;
    throw new RangeError(`[ContainerUI] A layout's ${name} must be an integer, not ${String(value)}.`);
};

/** One layout frame. A nested frame takes one cell of its parent as its anchor. */
export class LayoutFrame {
    readonly kind: LayoutKind;
    readonly anchor: number;
    readonly gap: number;
    readonly columns: number;
    readonly width: number;
    readonly size: number;

    #cellIndex = 0;
    #overflowCount = 0;

    /**
     * @param options Where the frame starts and how it steps.
     * @throws {RangeError} When `gap` or `columns` is not an integer: a fraction, `NaN` or an infinity.
     */
    constructor(options: LayoutFrameOptions) {
        this.kind = options.kind;
        this.anchor = options.anchor;
        this.gap = Math.max(0, requireInteger(options.gap ?? 0, "gap"));
        this.width = options.width ?? SURFACE_WIDTH;
        this.columns = Math.max(1, requireInteger(options.columns ?? this.width, "columns"));
        this.size = options.size;
    }

    /** Cells that fell outside the surface. */
    get overflowCount(): number {
        return this.#overflowCount;
    }

    /**
     * Takes the next cell.
     *
     * @returns Its index, or `null` when it falls outside the surface.
     */
    takeIndex(): number | null {
        const cell = this.#cellIndex++;
        const index = this.#indexForCell(cell);
        if (index === null || !Number.isInteger(index) || index < 0 || index >= this.size) {
            this.#overflowCount++;
            return null;
        }
        return index;
    }

    /** Skips `count` cells. */
    skip(count: number): void {
        this.#cellIndex += Math.max(0, count);
    }

    #indexForCell(cell: number): number | null {
        const step = 1 + this.gap;

        switch (this.kind) {
            case "box":
            case "row":
                return this.anchor + cell * step;

            case "column":
                return this.anchor + cell * step * this.width;

            case "grid": {
                const rowOffset = Math.floor(cell / this.columns) * step;
                const columnOffset = (cell % this.columns) * step;
                const anchorColumn = this.anchor % this.width;
                // Past the right edge is overflow, not a wrap.
                if (anchorColumn + columnOffset >= this.width) return null;
                return this.anchor + rowOffset * this.width + columnOffset;
            }
        }
    }
}

/**
 * The row and column of a slot index.
 *
 * @param index The slot index.
 * @param width Slots per row.
 * @returns Zero-based row and column.
 */
export const toCoordinates = (index: number, width: number = SURFACE_WIDTH): { row: number; column: number } => {
    return { row: Math.floor(index / width), column: index % width };
};

/**
 * The slot index of a row and column.
 *
 * @param row Zero-based row.
 * @param column Zero-based column.
 * @param width Slots per row.
 * @returns The slot index.
 */
export const toIndex = (row: number, column: number, width: number = SURFACE_WIDTH): number => {
    return row * width + column;
};

/**
 * The indices on the edge of a surface, in order.
 *
 * @param size Slot count.
 * @param width Slots per row.
 * @returns The indices, ascending.
 * @example
 * borderIndices(27); // [0…8, 9, 17, 18…26]
 */
export const borderIndices = (size: number, width: number = SURFACE_WIDTH): number[] => {
    const rows = Math.ceil(size / width);
    const indices = new Set<number>();

    for (let column = 0; column < width; column++) {
        indices.add(toIndex(0, column, width));
        if (rows > 1) indices.add(toIndex(rows - 1, column, width));
    }
    for (let row = 1; row < rows - 1; row++) {
        indices.add(toIndex(row, 0, width));
        indices.add(toIndex(row, width - 1, width));
    }

    return [...indices].filter((index) => index < size).sort((first, second) => first - second);
};

/** An inclusive rectangle of cells. */
export interface RectOptions {
    startColumn: number;
    startRow: number;
    endColumn: number;
    endRow: number;
    /** Slot count; cells past it are dropped. */
    size: number;
    width?: number;
}

/**
 * The indices inside a rectangle, row by row.
 *
 * @param options The corners, in either order, and the surface size.
 * @returns The indices that fall on the surface.
 * @example
 * rectIndices({ startColumn: 1, startRow: 1, endColumn: 7, endRow: 3, size: 54 });
 */
export const rectIndices = ({ startColumn, startRow, endColumn, endRow, size, width = SURFACE_WIDTH }: RectOptions): number[] => {
    const firstColumn = Math.max(0, Math.min(startColumn, endColumn));
    const lastColumn = Math.min(width - 1, Math.max(startColumn, endColumn));
    const firstRow = Math.max(0, Math.min(startRow, endRow));
    const lastRow = Math.max(startRow, endRow);

    const indices: number[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
        for (let column = firstColumn; column <= lastColumn; column++) {
            const index = toIndex(row, column, width);
            if (index < size) indices.push(index);
        }
    }
    return indices;
};
