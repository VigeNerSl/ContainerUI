/** Stack navigation inside one surface. The route is a signal, so navigating repaints only what differs. */

import { readonlySignal, signal, type ReadonlySignal, type Signal } from "../reactive/signal.js";
import { createContext, provideContext, useContext, useRequiredContext } from "../hooks/componentContext.js";
import { resolveInitial, resolveNext, useCallback, useRef } from "../hooks/hooks.js";
import { h, type Child, type ComponentType } from "../runtime/element.js";
import { requireActiveInstance } from "../runtime/instance.js";

/** A route on the stack. */
export interface RouteMatch<P = Record<string, unknown>> {
    /** Route name. */
    readonly name: string;
    /** Route parameters. */
    readonly params: P;
}

/** A navigation stack. */
export interface Router {
    /** The active route. Reading it inside a render subscribes to navigation. */
    readonly current: ReadonlySignal<RouteMatch>;
    /** The whole stack, oldest first. */
    readonly stack: ReadonlySignal<readonly RouteMatch[]>;
    /** Navigates forward, keeping the current route on the stack. `route` and `router` are reserved param names. */
    push(name: string, params?: Record<string, unknown>): void;
    /** Replaces the current route. */
    replace(name: string, params?: Record<string, unknown>): void;
    /**
     * Returns to the previous route.
     *
     * @returns `false` when already at the root.
     */
    back(): boolean;
    /** Clears the stack and starts again at `name`. */
    reset(name: string, params?: Record<string, unknown>): void;
    /** Whether there is a route to go back to. Reactive. */
    canGoBack(): boolean;
}

const EMPTY_PARAMS: Record<string, unknown> = {};

/**
 * Creates a router.
 *
 * @param initialName The first route.
 * @param initialParams Its parameters.
 * @returns The router.
 * @example
 * const router = createRouter("home");
 * router.push("shop", { category: "tools" });
 */
export const createRouter = (initialName: string, initialParams: Record<string, unknown> = EMPTY_PARAMS): Router => {
    const stack = signal<readonly RouteMatch[]>([{ name: initialName, params: initialParams }]);

    const current: ReadonlySignal<RouteMatch> = {
        get value() {
            const entries = stack.value;
            return entries[entries.length - 1]!;
        },
        peek: () => {
            const entries = stack.peek();
            return entries[entries.length - 1]!;
        },
    };

    return {
        current,
        stack: readonlySignal(stack),
        push: (name, params = EMPTY_PARAMS) => {
            stack.set([...stack.peek(), { name, params }]);
        },
        replace: (name, params = EMPTY_PARAMS) => {
            stack.set([...stack.peek().slice(0, -1), { name, params }]);
        },
        back: () => {
            const entries = stack.peek();
            if (entries.length <= 1) return false;
            stack.set(entries.slice(0, -1));
            return true;
        },
        reset: (name, params = EMPTY_PARAMS) => {
            stack.set([{ name, params }]);
        },
        canGoBack: () => {
            return stack.value.length > 1;
        },
    };
};

/** Props every screen and layout receives, on top of the route's params. */
export interface RouteProps {
    readonly route: RouteMatch;
    readonly router: Router;
}

/** A screen with its own layout. */
export interface RouteConfig {
    /** The screen component. */
    screen: ComponentType<any>;
    /** Wraps this screen, instead of the table-wide layout. */
    layout?: ComponentType<any> | undefined;
}

/** Screens by route name: a component, or a screen with its own layout. */
export type RouteTable = Record<string, ComponentType<any> | RouteConfig>;

const RouterContext = createContext<Router | null>(null, "RouterContext");

/**
 * The router provided by the nearest {@link Routes}.
 *
 * @throws {Error} Outside {@link Routes}.
 * @example
 * function BackButton() {
 *     const router = useRouter();
 *     if (!router.canGoBack()) return null;
 *     return <slot item={{ typeId: "minecraft:arrow" }} onClick={() => router.back()} />;
 * }
 */
export const useRouter = (): Router => {
    return useRequiredContext(RouterContext);
};

/**
 * The current stack entry of one route name. A context value is not reactive, so this holds a
 * signal: a descendant that reads it follows the entry through a `push` to the same route. A new
 * route name gets a new holder, so the screens being replaced keep watching their own entry.
 */
interface RouteEntryHolder {
    readonly name: string;
    readonly entry: Signal<RouteMatch>;
}

const RouteEntryContext = createContext<RouteEntryHolder | null>(null, "RouteEntryContext");

interface RouteStateSlot {
    value: unknown;
    readonly version: Signal<number>;
}

/** `useRouteState` values per stack entry; they live as long as the entry. */
const stateByEntry = new WeakMap<RouteMatch, Map<string, RouteStateSlot>>();

/**
 * State kept with the route's stack entry rather than with the screen: going back restores it,
 * and a new visit (`push`, `replace`, `reset`) starts from `initial`.
 *
 * @param key Name of the value. Components on one screen that use the same key share it.
 * @param initial The initial value, or a function returning it.
 * @returns The value and a setter.
 * @throws {Error} Outside {@link Routes}.
 * @example
 * const [page, setPage] = useRouteState("page", 0);
 */
export const useRouteState = <T>(key: string, initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
    const holder = useContext(RouteEntryContext);
    if (!holder) throw new Error(`[ContainerUI] useRouteState("${key}") must be called inside <Routes>.`);
    const entry = holder.entry.value;
    const latestSlot = useRef<RouteStateSlot | null>(null);

    let slots = stateByEntry.get(entry);
    if (!slots) {
        slots = new Map();
        stateByEntry.set(entry, slots);
    }
    let slot = slots.get(key);
    if (!slot) {
        slot = { value: resolveInitial(initial), version: signal(0) };
        slots.set(key, slot);
    }
    const current = slot;
    latestSlot.current = current;
    // Every reader re-renders when any of them writes.
    current.version.value;

    // Stable, like `useState`'s setter: it writes to the slot the latest render read.
    const setValue = useCallback((next: T | ((previous: T) => T)): void => {
        const target = latestSlot.current;
        if (!target) return;
        const previous = target.value as T;
        const resolved = resolveNext(next, previous);
        if (Object.is(previous, resolved)) return;
        target.value = resolved;
        target.version.update((revision) => revision + 1);
    });
    return [current.value as T, setValue];
};

/** Props of {@link Routes}. */
export interface RoutesProps {
    /** The router to follow. */
    router: Router;
    /** Screens by route name. */
    screens: RouteTable;
    /** Wraps every screen that does not name its own layout. */
    layout?: ComponentType<any> | undefined;
    /** Rendered when the active route is not in the table. */
    fallback?: ComponentType<any> | undefined;
}

/**
 * Renders the active route and provides the router to the subtree.
 *
 * @example
 * <Routes
 *     router={router}
 *     layout={Chrome}
 *     screens={{ home: Home, shop: { screen: Shop, layout: WideChrome } }}
 * />
 */
export const Routes = (props: RoutesProps): Child => {
    provideContext(RouterContext, props.router);

    const holder = useRef<RouteEntryHolder | null>(null);
    const match = props.router.current.value;
    if (holder.current?.name === match.name) holder.current.entry.set(match);
    else holder.current = { name: match.name, entry: signal(match) };
    provideContext(RouteEntryContext, holder.current);

    // Only the table's own names are routes: "toString" is not one.
    const entry = Object.prototype.hasOwnProperty.call(props.screens, match.name) ? props.screens[match.name] : undefined;

    if (!entry) {
        if (props.fallback) return h(props.fallback, { route: match, router: props.router });
        requireActiveInstance("Routes").reportDevWarning?.(
            `Route "${match.name}" is not in the screens table and no fallback is set; nothing is shown.`,
        );
        return null;
    }

    const config: RouteConfig = typeof entry === "function" ? { screen: entry } : entry;
    if ("route" in match.params || "router" in match.params) {
        requireActiveInstance("Routes").reportDevWarning?.(
            `Route "${match.name}" has a param named "route" or "router"; the router's own props replace it.`,
        );
    }
    const screenProps = { ...match.params, route: match, router: props.router };

    // Keyed by route name: two routes sharing a component do not share its state.
    const screen = h(config.screen, { key: `route:${match.name}`, ...screenProps });

    const layout = config.layout ?? props.layout;
    if (!layout) return screen;

    // A constant key: a shared layout keeps its state across navigation.
    return h(layout, { key: "layout", route: match, router: props.router, children: screen });
};
