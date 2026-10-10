# Components

A component is a function that takes props and returns elements. It is how you split a menu into
parts, give those parts state, and reuse them.

```tsx
function ShopItem({ item, price, onBuy }: { item: ItemView; price: number; onBuy: () => void }) {
    return <slot item={{ ...item, lore: [`§7Price: §e${price}`] }} sound="random.orb" onClick={onBuy} />;
}

<row index={10}>
    <ShopItem item={BREAD} price={3} onBuy={() => buy("bread")} />
    <ShopItem item={APPLE} price={2} onBuy={() => buy("apple")} />
</row>
```

## What a component may return

Anything a child position accepts (`Child`):

- an element (`<slot … />`, `<row>…</row>`, `<OtherComponent />`);
- an array of children, or a fragment;
- `null`, `undefined`, `true` or `false`, which render nothing.

A component adds no layout of its own: its output flows into the layout it was placed in. See
[Elements and layout](elements-and-layout.md#components-in-a-layout).

## Props and children

Props are the object passed to the element, without `key`. Elements nested inside a component's
tag arrive as `props.children`:

```tsx
function Panel({ title, children }: { title: string; children?: Child }) {
    return (
        <box>
            <slot item={{ typeId: "minecraft:name_tag", name: title }} />
            {children}
        </box>
    );
}

<Panel title="§6Tools">
    <slot item={PICKAXE} />
</Panel>
```

One nested child arrives as it is; several arrive as an array. Render `children` wherever you want
them; you may also ignore them or render them twice.

## When a component renders

A component renders:

1. **when it first appears** in the tree;
2. **when a signal it read during its last render changes** — including its own state from
   `useState`, `useReducer` or `useSignal`, a context value that is a signal, a router, a storage;
3. **when its parent renders it with different props.**

Rendering is batched: every change made during one tick produces at most one render of each
affected component, at the end of the tick, followed by one commit.

### Props are compared shallowly

When a parent renders again, each child component receives its new props and is compared with the
previous ones **one level deep**: same keys, and each value the same by `Object.is`. If nothing
differs, the child is skipped.

That makes skipping automatic for primitive props, and easy to break with values created during
render:

```tsx
// Renders ShopItem again on every parent render: a new function each time.
<ShopItem item={BREAD} onBuy={() => buy("bread")} />

// Stable across renders: ShopItem is skipped while nothing else changed.
const onBuy = useCallback(() => buy("bread"));
<ShopItem item={BREAD} onBuy={onBuy} />
```

The same applies to objects and arrays built inline, and to `children`: nested elements are new
objects on every render, so a component that receives children renders whenever its parent does.
Most of the time this does not matter, because the commit writes only slots whose items changed.
It matters for large components; see [Performance](performance.md).

### Reading signals: in the body or in an item function

A signal read in the component body subscribes the **component**; a signal read inside an item
function subscribes only **that slot**:

```tsx
function Wallet() {
    // Subscribes the component: Wallet renders again when coins change.
    const label = `${coins.value} coins`;
    return <slot item={{ typeId: "minecraft:gold_ingot", name: label }} />;
}

function WalletFast() {
    // Subscribes only the slot: WalletFast never renders again.
    return <slot item={() => ({ typeId: "minecraft:gold_ingot", name: `${coins.value} coins` })} />;
}
```

Both show the same thing. Prefer the second for values that change many times a second.

## Identity

The library matches each component element to the instance it created before, so hooks keep their
state. An instance is identified by:

- **its type**, the component function itself; and
- **its `key`**, if it has one; otherwise **its position among siblings of the same type** under
  the same parent component.

Two consequences:

**Define components once, at module level.** A component written inside another component's body
is a new function on every render, so it is a new type every time, and its state is thrown away on
every render:

```tsx
function Menu() {
    // Wrong: a new Row type on every render of Menu.
    const Row = () => <slot item={A} />;
    return <Row />;
}
```

**Key lists whose order can change.** Without keys, removing the first item of a list gives every
following component its predecessor's state. See [Keys](elements-and-layout.md#keys).

## Lifecycle

| Moment | What happens |
| --- | --- |
| Mount | The component renders for the first time. Each `useEffect` body runs **at once, where the hook is called**, during this first render. |
| Update | The component renders again. Effects whose dependencies changed clean up and run again **after** the render, in the same flush. |
| Unmount | The element left the tree, or the menu closed. Every effect's cleanup runs, `onUnmount` callbacks run, timers from `useTicker` stop, and every `computed` created inside is disposed. |

Everything a component creates while rendering — computeds, effects, child scopes — belongs to it
and goes with it. See [Reactivity](reactivity.md#scopes).

## Errors while rendering

A component that throws while rendering:

- renders nothing, and stops its children from showing;
- is reported as a `render-error` diagnostic, with its identity (for example `Balance@14#ord:0`);
- tries again by itself as soon as a signal it read before throwing changes;
- is replaced by the fallback of the nearest `ErrorBoundary`, if there is one.

A throw at the root keeps the last screen up. See
[Errors, diagnostics and logging](errors-and-diagnostics.md).

## Rules of hooks

Hooks (`useState`, `useEffect`, …) store their data by call order. So:

- call hooks only while a component renders, never in a handler, an effect or a timer;
- call them unconditionally and in the same order on every render: not inside `if`, loops or early
  returns placed before them.

Calling a hook outside a render throws `useX() may only be called while a component is rendering`.
Calling a hook of another kind in a position throws `Hook order changed between renders`, and
calling fewer or more hooks than the first render is reported as a `dev-warning`. See
[Hooks](hooks.md#rules).

## Setting state while rendering

Writing a component's own state while it renders works, but makes it render again, and can loop.
It is reported as a `dev-warning`. Move the write into an effect or a handler:

```tsx
// Warned: sets state during render.
if (count > 10) setCount(10);

// Better: derive the value instead.
const shown = Math.min(count, 10);
```

## Component patterns

**Container and presentational components.** Keep state high and pass values down; keep leaf
components pure functions of their props. They are then skipped whenever their props do not
change.

**Passing signals.** A signal passed as a prop is a stable reference, so the child is not
re-rendered by the parent; the child subscribes itself by reading `.value`. This is an efficient way
to share changing values.

```tsx
function Timer({ seconds }: { seconds: ReadonlySignal<number> }) {
    return <slot item={() => ({ typeId: "minecraft:clock", amount: Math.max(1, seconds.value) })} />;
}
```

**Render props.** A prop that is a function returning elements lets a parent decide how a child
draws part of itself. `ErrorBoundary`'s `fallback` and `PagedList`'s `renderItem` work this way.
