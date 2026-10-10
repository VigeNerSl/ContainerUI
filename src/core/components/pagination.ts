/** Pagination: a list longer than its cells, shown one page at a time. */

import type { ItemView } from "../host/host.js";
import { h, type Child, type Key, type SlotProps } from "../runtime/element.js";
import { useEffect, useState } from "../hooks/hooks.js";

/** A page index and its setter, as `useState` and `useRouteState` return them. */
export type PageState = readonly [number, (next: number) => void];

/** What {@link usePagination} pages through. */
export interface PaginationOptions<T> {
    /** The whole list. */
    items: readonly T[];
    /** Items per page; at least 1. */
    pageSize: number;
    /**
     * Where the page index lives. Defaults to component state; pass `useRouteState("page", 0)` to
     * keep the page across navigation.
     */
    state?: PageState | undefined;
    /** First page, 0-based, when the component keeps its own state. */
    initialPage?: number | undefined;
}

/** The current page of a list, and the moves between pages. */
export interface Pagination<T> {
    /** The current page's items. */
    readonly items: readonly T[];
    /** The current page, 0-based, clamped to the pages that exist. */
    readonly page: number;
    /** How many pages there are; at least 1. */
    readonly pageCount: number;
    /** Position of the page's first item in the whole list. */
    readonly offset: number;
    /** Whether a page comes before this one. */
    readonly hasPrevious: boolean;
    /** Whether a page comes after this one. */
    readonly hasNext: boolean;
    /** Goes to the previous page. */
    previous(): void;
    /** Goes to the next page. */
    next(): void;
    /** Goes to `page`, clamped to the pages that exist. */
    goTo(page: number): void;
}

/**
 * The page of `items` to show, and the moves between pages.
 *
 * @param options The list, page size and where the page lives.
 * @returns The current page and its controls.
 * @example
 * const pages = usePagination({ items: goods, pageSize: 7 });
 * pages.items.map((good) => ...); pages.next();
 */
export const usePagination = <T>(options: PaginationOptions<T>): Pagination<T> => {
    const ownState = useState(Number.isNaN(options.initialPage) ? 0 : (options.initialPage ?? 0));
    const [requested, setPage] = options.state ?? ownState;
    const pageSize = Number.isNaN(options.pageSize) ? 1 : Math.max(1, Math.floor(options.pageSize));
    const pageCount = Math.max(1, Math.ceil(options.items.length / pageSize));
    const clampPage = (target: number): number => (Number.isNaN(target) ? 0 : Math.min(Math.max(0, Math.floor(target)), pageCount - 1));
    // The list can shrink under the page: the page is clamped to the last page, and the effect below stores the clamped value.
    const page = clampPage(requested);
    const offset = page * pageSize;
    const goTo = (target: number): void => setPage(clampPage(target));

    useEffect(() => {
        if (requested !== page) setPage(page);
    }, [requested, page]);

    return {
        items: options.items.slice(offset, offset + pageSize),
        page,
        pageCount,
        offset,
        hasPrevious: page > 0,
        hasNext: page < pageCount - 1,
        previous: () => goTo(page - 1),
        next: () => goTo(page + 1),
        goTo,
    };
};

/** An arrow cell of a `PagedList`. */
export interface PageControl {
    /** Surface index of the cell. */
    index: number;
    /** What it shows. Defaults to an arrow. */
    item?: ItemView;
    /** What it shows at the end of the list, where it does nothing. Omitted, the cell is empty there. */
    disabledItem?: ItemView;
}

/** Props of {@link PagedList}. */
export interface PagedListProps<T> {
    /** The whole list. */
    items: readonly T[];
    /** The cells a page fills, in order. Their count is the page size. */
    cells: readonly number[];
    /** One cell's slot props. `position` is the item's place in the whole list. */
    renderItem: (item: T, position: number) => Omit<SlotProps, "index" | "key">;
    /** A stable key per item. Defaults to the position. */
    keyOf?: (item: T, position: number) => Key;
    /** The previous-page arrow. */
    previous?: PageControl;
    /** The next-page arrow. */
    next?: PageControl;
    /** A cell showing the page; `item` receives the 1-based page and the page count. */
    indicator?: { index: number; item?: (page: number, pageCount: number) => ItemView };
    /** Shown in the cells the last page leaves empty. */
    filler?: ItemView;
    /** Where the page index lives; see `PaginationOptions.state`. */
    state?: PageState;
}

const DEFAULT_PREVIOUS: ItemView = { typeId: "minecraft:arrow", name: "§fPrevious page" };
const DEFAULT_NEXT: ItemView = { typeId: "minecraft:arrow", name: "§fNext page" };

const pageControl = ({
    key,
    control,
    isActive,
    fallback,
    move,
}: {
    key: string;
    control: PageControl | undefined;
    isActive: boolean;
    fallback: ItemView;
    move: () => void;
}): Child => {
    if (!control) return null;
    if (!isActive) return control.disabledItem ? h("slot", { key, index: control.index, item: control.disabledItem }) : null;
    return h("slot", { key, index: control.index, item: control.item ?? fallback, onClick: () => move() });
};

/**
 * A list laid out in fixed cells, one page at a time, with arrows and an optional page indicator.
 *
 * @example
 * h(PagedList, {
 *     items: goods,
 *     cells: rectIndices({ startColumn: 1, startRow: 1, endColumn: 7, endRow: 3, size: 54 }),
 *     renderItem: (good) => ({ item: good.icon, onClick: () => buy(good) }),
 *     previous: { index: 45 },
 *     next: { index: 53 },
 *     indicator: { index: 49 },
 * });
 */
export const PagedList = <T>(props: PagedListProps<T>): Child => {
    const pages = usePagination({ items: props.items, pageSize: props.cells.length, state: props.state });
    // With no cells there is nothing to page, and arrows would move through pages no cell can show.
    if (props.cells.length === 0) return null;

    const children: Child[] = props.cells.map((cell, place) => {
        if (place >= pages.items.length) return props.filler ? h("slot", { key: `filler:${cell}`, index: cell, item: props.filler }) : null;
        const item = pages.items[place] as T;
        const position = pages.offset + place;
        return h("slot", { ...props.renderItem(item, position), key: props.keyOf?.(item, position) ?? `item:${position}`, index: cell });
    });

    children.push(pageControl({ key: "previous", control: props.previous, isActive: pages.hasPrevious, fallback: DEFAULT_PREVIOUS, move: pages.previous }));
    children.push(pageControl({ key: "next", control: props.next, isActive: pages.hasNext, fallback: DEFAULT_NEXT, move: pages.next }));
    if (props.indicator) {
        const shown = props.indicator.item?.(pages.page + 1, pages.pageCount) ?? { typeId: "minecraft:paper", name: `§fPage ${pages.page + 1}/${pages.pageCount}` };
        children.push(h("slot", { key: "indicator", index: props.indicator.index, item: shown }));
    }
    return children;
};
