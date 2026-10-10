# Hooks

Hooks give a component state, derived values, side effects and access to shared values. They look
like React's and mostly behave like them; the differences come from ContainerUI being built on
signals, and are called out below.

## Rules

1. **Call hooks only while a component renders.** Not in handlers, effects, timers or plain
   functions. Outside a render a hook throws `useX() may only be called while a component is
   rendering`.
2. **Call them in the same order on every render.** Not inside `if`, loops, or after an early
   `return`. Two things report a break of this rule:
   - A hook of a different kind in the same position throws `Hook order changed between renders`;
     the component renders nothing, like any [render error](errors-and-diagnostics.md).
   - A render that calls a different number of hooks than the component's first complete render
     (a hook skipped by an early `return` or an `if`, or one that appears later) is reported as a
     [`dev-warning`](errors-and-diagnostics.md#development-warnings), once per surface. The menu keeps
     running, but the hooks after the skipped one now read each other's state.

   The check counts hooks, so it cannot see two hooks of the same kind that swap places between
   branches (`if (flag) { useState("a"); useState("b") } else { useState("b"); useState("a") }`): they
   silently swap values. Keep the order the same in every branch.

Custom hooks — your own functions that call hooks — follow the same rules and are called the same
way.

## All hooks

| Hook | Page |
| --- | --- |
| `useState`, `useSignal`, `useReducer` | [State](#state) |
| `useMemo`, `useComputed` | [Derived values](#derived-values) |
| `useEffect`, `onUnmount` | [Side effects](#side-effects) |
| `useRef`, `useCallback`, `useId` | [Stable values](#stable-values) |
| `useContext`, `useContextSelector`, `useRequiredContext` | [Context](context.md) |
| `useRouter`, `useRouteState` | [Navigation](navigation.md) |
| `usePagination` | [Lists and quantities](lists-and-quantities.md) |
| `useResource` | [Async data and Suspense](async-data.md) |
| `useTicker`, `useReveal`, `useTween` | [Animation](animation.md) |
| `useExternal`, `useScore`, `useDynamicProperty` | [Outside state](outside-state.md) |

## State

### `useState`

```ts
const [value, setValue] = useState(initial);
```

Component state. `initial` is a value, or a function called once on the first render (use it for
an expensive initial value). The setter takes a new value or an updater:

```tsx
function Pager() {
    const [page, setPage] = useState(0);
    return <slot item={NEXT} onClick={() => setPage((previous) => previous + 1)} />;
}
```

- Setting a value equal to the current one (`Object.is`) does nothing.
- The setter is the same function on every render; pass it down freely.
- The new value shows on the next render, at the next flush. `value` in the current render does
  not change.
- Setting your own state *while rendering* works but renders again and can loop; it is reported
  as a `dev-warning`.

### `useSignal`

```ts
const query = useSignal("");
```

Component state as a [signal](reactivity.md#signals). Same lifetime as `useState` — created on the
first render, gone on unmount — but you get the signal itself, so you choose who subscribes:

```tsx
function Stopwatch() {
    const seconds = useSignal(0);
    useTicker(20, () => seconds.value++);

    // Only this slot repaints each second; Stopwatch renders once.
    return <slot item={() => ({ typeId: "minecraft:clock", name: `${seconds.value}s` })} />;
}
```

Read `seconds.value` in the component body instead and the whole component renders every second.
Pass the signal to child components to share it without re-rendering the parent.

### `useReducer`

```ts
const [state, dispatch] = useReducer(reducer, initialState);
```

State changed by actions. `reducer(state, action)` returns the next state. `initialState` may be a
function, called once.

```tsx
type Cart = { items: string[] };
type Action = { type: "add"; item: string } | { type: "clear" };

const cartReducer = (state: Cart, action: Action): Cart => {
    switch (action.type) {
        case "add":
            return { items: [...state.items, action.item] };
        case "clear":
            return { items: [] };
    }
};

function CartView() {
    const [cart, dispatch] = useReducer(cartReducer, { items: [] });
    return (
        <>
            <slot item={BREAD} onClick={() => dispatch({ type: "add", item: "bread" })} />
            <slot item={{ typeId: "minecraft:chest", name: `${cart.items.length} items` }} />
            <slot item={CLEAR} onClick={() => dispatch({ type: "clear" })} />
        </>
    );
}
```

`dispatch` is stable. The reducer used is always the one from the latest render, so it may read
props.

## Derived values

### `useMemo`

```text
const value = useMemo(factory, dependencies?)
```

Caches a computed value.

**With dependencies**, `factory` runs on the first render and again whenever a dependency differs
(`Object.is`, element by element) from the last render. Signals read inside `factory` are **not**
tracked: the value changes only when the dependencies do.

```tsx
const sorted = useMemo(() => [...goods].sort(byPrice), [goods]);
```

**Without dependencies**, `useMemo` is a [computed](reactivity.md#computed-values) owned by the
component: it tracks the signals `factory` reads and recomputes when they change. The `factory`
from the **first** render is used for the component's whole life, so read signals in it, not props.

```tsx
const total = useMemo(() => cart.value.reduce((sum, item) => sum + item.price, 0));
```

### `useComputed`

```ts
const total = useComputed(() => cart.value.length);
total.value;
```

A derived signal that lives as long as the component. Like `useMemo` without dependencies, but it
returns the signal (`ReadonlySignal<T>`) rather than its value, so you choose where it is read —
in the body, in an item function, or in a child. As with `useMemo`, the function from the first
render is kept.

## Side effects

### `useEffect`

```text
useEffect(body, dependencies?)
```

Runs a side effect for the component: start a timer, subscribe to an event, log. `body` may return
a cleanup function.

```tsx
function Countdown({ player }: { player: Player }) {
    const [left, setLeft] = useState(10);

    useEffect(() => {
        const runId = system.runInterval(() => setLeft((value) => value - 1), 20);
        return () => system.clearRun(runId);
    }, []);

    return <slot item={{ typeId: "minecraft:clock", amount: Math.max(1, left) }} />;
}
```

Three modes, picked by `dependencies`:

| `dependencies` | Runs |
| --- | --- |
| `[]` | Once, on mount. Cleanup on unmount. |
| `[a, b]` | On mount, and again after any render where `a` or `b` differs from the last render. |
| omitted | On mount, and again whenever a **signal it read** changes. |

How it differs from React:

- **The first run is immediate**, during the component's first render, at the line where
  `useEffect` is called. Later runs happen after the render that triggered them, in the same flush.
- **Without dependencies it is reactive, not "after every render".** It re-runs when signals it read
  change, and only then. A new prop value alone does not re-run it; list the prop as a dependency
  if the effect must follow it.
- **With dependencies, reads are untracked.** Signals read inside do not re-run it; only the
  dependency list does.
- The latest `body` is always the one run, so it sees the latest props when it does run.
- **Pick one mode per effect.** Switching between "with dependencies" and "without" across renders
  keeps the first mode and reports a `dev-warning`.
- **`async` functions are not cleanups.** Passing an `async` function reports a `dev-warning`, since
  its promise cannot tear anything down. Start async work inside a plain function:

  ```ts
  useEffect(() => {
      let isCancelled = false;
      void load().then((data) => {
          if (!isCancelled) setData(data);
      });
      return () => {
          isCancelled = true;
      };
  }, []);
  ```

On unmount every effect's cleanup runs. An error thrown by `body` or its cleanup is reported and
does not break the menu.

### `onUnmount`

```ts
onUnmount(() => console.info("[shop] menu closed"));
```

Registers a callback that runs once when the component unmounts. Only the callback from the first
render is registered; later calls are ignored. Equivalent to `useEffect(() => cleanup, [])` without
the mount half.

## Stable values

### `useRef`

```ts
const box = useRef(initial);
box.current;
```

A mutable box that keeps its value across renders and never causes one. Use it for values a
handler needs but the screen does not show: the last click time, a timer handle, a previous value.

```tsx
function DoubleClick({ onDouble }: { onDouble: () => void }) {
    const lastClick = useRef(0);
    const handle = () => {
        const now = system.currentTick;
        if (now - lastClick.current < 10) onDouble();
        lastClick.current = now;
    };
    return <slot item={BUTTON} onClick={handle} />;
}
```

`useRef()` without an argument starts at `undefined`.

### `useCallback`

```text
const stable = useCallback(callback, dependencies?)
```

A function that keeps its identity across renders, so passing it to a child does not make the child
render again (see [props are compared shallowly](components.md#props-are-compared-shallowly)).

- **Without dependencies**, you get one function for the component's whole life, and it always calls
  the latest `callback`. This is the form you usually want: stable *and* never stale.
- **With dependencies**, you get `callback` itself, replaced only when a dependency changes (React's
  behaviour).

```tsx
const onBuy = useCallback(() => buy(player, item)); // stable, sees the latest item
return <ShopItem item={item} onBuy={onBuy} />;
```

### `useId`

```ts
const id = useId(); // "cui-1f"
```

A string unique to this component instance within the script context, stable for its life. Useful
for log lines and keys in outside maps. Not unique across world reloads.

## Writing your own hooks

A custom hook is a function whose name starts with `use` and that calls other hooks:

```ts
function useToggle(initial = false): [boolean, () => void] {
    const [on, setOn] = useState(initial);
    const toggle = useCallback(() => setOn((value) => !value));
    return [on, toggle];
}

function useBalance(playerId: string): ReadonlySignal<number> {
    return useComputed(() => balances.value.get(playerId) ?? 0);
}
```

It follows the rules of hooks, because the hooks inside it do.
