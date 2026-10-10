# Async data and Suspense

Some data arrives later: an HTTP request through `@minecraft/server-net`, a value computed over
several ticks, a database behind a script event. `useResource` loads it for a component, and
`Suspense` shows a placeholder while anything below it is still loading.

```tsx
import { Suspense, useResource } from "containerui";

function Balance({ player }: { player: Player }) {
    const balance = useResource(() => bank.fetchBalance(player.id), [player.id]);
    return <slot index={13} item={{ typeId: "minecraft:gold_ingot", name: `§6${balance.read()} coins` }} />;
}

function Wallet({ player }: { player: Player }) {
    return (
        <Suspense fallback={<slot index={13} item={{ typeId: "minecraft:clock", name: "§7Loading…" }} />}>
            <Balance player={player} />
        </Suspense>
    );
}
```

## `useResource`

```text
const resource = useResource(load, dependencies?)
```

`load` returns a value or a promise of one.

- **Without dependencies**, it loads once, when the component mounts.
- **With dependencies**, it loads again whenever one changes (`Object.is`, element by element). A
  load that a newer one replaced is ignored when it settles, so a slow old request cannot overwrite
  a fresh result.
- A `load` that returns a plain value (not a promise) is ready at once, in the same render.
- A `load` that throws synchronously fails at once.
- Reads inside `load` are not tracked.
- The latest `load` function is used for reloads.
- A load still running when the component unmounts is ignored when it settles.

A `Resource<T>` has:

| Member | Meaning |
| --- | --- |
| `read()` | The value. **Suspends** the component while loading, and **throws** the error once the load failed. |
| `status` | `"pending"`, `"ready"` or `"failed"`. Tracked. |
| `value` | The value when ready, otherwise `undefined`. Never suspends. Tracked. |
| `error` | The failure, once failed. Tracked. |
| `reload()` | Loads again with the same dependencies. |

### Two ways to read

**With `read()`**, the component is written as if the value were always there. While it loads, the
component *suspends*: it renders nothing, and the nearest `Suspense` shows its fallback. A failed
load throws from `read()`, which the nearest [`ErrorBoundary`](errors-and-diagnostics.md#errorboundary)
catches. Do not wrap `read()` in `try` — suspension works by throwing.

**With `status` / `value` / `error`**, you handle the states yourself, and no `Suspense` is needed:

```tsx
function Balance({ player }: { player: Player }) {
    const balance = useResource(() => bank.fetchBalance(player.id), [player.id]);

    if (balance.status === "pending") return <slot index={13} item={LOADING} />;
    if (balance.status === "failed") return <slot index={13} item={RETRY} onClick={() => balance.reload()} />;
    return <slot index={13} item={{ typeId: "minecraft:gold_ingot", name: `§6${balance.value}` }} />;
}
```

### `read()` inside an item function

`read()` may also be called inside a slot's item function. While loading, only that slot stays
empty; nothing suspends:

```tsx
<slot index={13} item={() => ({ typeId: "minecraft:gold_ingot", name: `${balance.read()}` })} />
```

## `Suspense`

```tsx
<Suspense fallback={<slot index={13} item={LOADING} />}>
    <Balance player={player} />
    <History player={player} />
</Suspense>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `fallback` | `Child` | Shown while any component beneath is waiting on a load. |
| `children` | `Child` | The content. |

- The children stay **mounted but hidden** while waiting: their state, effects and other resources
  keep going. Nothing of theirs is written to the menu until nothing is waiting.
- The fallback is shown **alongside** the hidden children: lay it out in the cells the children
  would use, as above.
- One `Suspense` waits for all the components below it. Nest `Suspense` boundaries to let parts of a
  screen appear independently.
- A component that suspends without any `Suspense` above it simply renders nothing until its data
  arrives.

`SuspenseProps` is the props type.

## Errors

A failed load, read with `read()`, is a render error: it goes to the nearest `ErrorBoundary` and is
reported as a `render-error` diagnostic. Offer a retry from the boundary's fallback:

```tsx
<ErrorBoundary
    fallback={(failure) => (
        <slot index={13} item={{ typeId: "minecraft:barrier", name: "§cBank offline — retry" }} onClick={failure.reset} />
    )}
>
    <Suspense fallback={<slot index={13} item={LOADING} />}>
        <Balance player={player} />
    </Suspense>
</ErrorBoundary>
```

`failure.reset()` renders the children again with fresh state, so `useResource` starts a new load.

## Loading over ticks

A promise is not the only way to wait. Anything that resolves later works, including a promise
you resolve from `system.runTimeout`:

```ts
const waitTicks = (ticks: number) => new Promise<void>((resolve) => system.runTimeout(resolve, ticks));

const report = useResource(async () => {
    await waitTicks(20);
    return buildReport();
}, []);
```
