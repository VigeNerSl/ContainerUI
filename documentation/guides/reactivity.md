# Reactivity

State in ContainerUI is held in **signals**. Anything that reads a signal while it runs — a
component, a computed, an effect, an item function — is subscribed to it automatically, and runs
again when the signal changes. You never list dependencies by hand (except in the hooks that ask
for them, like React's).

```ts
import { computed, effect, signal } from "containerui";

const price = signal(10);
const quantity = signal(3);
const total = computed(() => price.value * quantity.value);

effect(() => console.info(`[shop] total=${total.value}`)); // logs 30 now
quantity.value = 5;                                          // logs 50 at the next flush
```

This page covers the primitives. Components use the same machinery through [hooks](hooks.md).

## Signals

```ts
const coins = signal(100);

coins.value;                  // read, tracked
coins.peek();                 // read, not tracked
coins.value = 150;            // write
coins.set(150);               // the same write
coins.update((value) => value + 50); // write from the current value
```

`signal(initial, equals?)` creates a writable value.

| Member | Meaning |
| --- | --- |
| `value` (get) | The current value. Subscribes whatever is running. |
| `value` (set) | Writes a new value. |
| `peek()` | The current value, without subscribing. |
| `set(next)` | Writes `next`. Does nothing if `equals(current, next)` holds. |
| `update(mutator)` | Writes `mutator(current)`. |

### Equality

A write equal to the current value does nothing: no subscriber runs. The default comparison is
`Object.is`, so **mutating an object or array in place is not a change**:

```ts
const cart = signal<string[]>([]);

cart.value.push("bread");              // wrong: same array, nobody is told
cart.value = [...cart.value, "bread"]; // right: a new array
cart.update((items) => [...items, "bread"]); // the same, shorter
```

Pass your own comparison when values are rebuilt but often identical:

```ts
const position = signal({ x: 0, y: 0 }, (a, b) => a.x === b.x && a.y === b.y);
```

### Read-only views

`readonlySignal(source)` returns a view that reads `source` but has no `set`. Hand it out when other
code should see a value but never change it:

```ts
const coins = signal(100);
export const balance = readonlySignal(coins); // ReadonlySignal<number>
```

`ReadonlySignal<T>` is the type for anything with `value` and `peek()`: signals, computeds, and
the values hooks like `useTween` return.

### Where signals live

A signal is an ordinary object. Where you create it decides who shares it:

| Created | Shared by | Lives |
| --- | --- | --- |
| At module level | **every player and every menu** | For the whole world session. |
| In a `Map` keyed by player id | One player, across menus | Until you delete it. |
| With `useSignal` / `useState` in a component | One component instance | Until it unmounts. |

A module-level signal is right for a server-wide value (an auction house, a shared counter). For
per-player values, key them by player; see [Multiplayer](multiplayer.md).

## Computed values

`computed(compute, equals?)` derives a value from other reactive values.

```ts
const total = computed(() => price.value * quantity.value);
total.value;   // 30, tracked
total.peek();  // 30, not tracked
total.dispose();
```

- **Lazy.** It computes when first read, and again only when read after a dependency changed.
  Nothing is computed for a computed nobody reads.
- **Cached.** Reading it twice without a change computes once.
- **Cut-off.** If it recomputes to an equal value (by `equals`, default `Object.is`), its own
  subscribers do not run.
- **Errors are values.** If `compute` throws, every read throws the same error, until a dependency
  it had read changes and it recomputes successfully.
- **Owned.** A computed created inside a scope — a component, an effect, a `createRoot` — is
  disposed with it. `dispose()` detaches it early; a disposed computed keeps its last value and
  never recomputes.

## Effects

`effect(body)` runs `body` now, and again whenever a value it read changes.

```ts
const stop = effect(() => {
    const player = world.getEntity(playerId);
    player?.onScreenDisplay.setActionBar(`§6${coins.value} coins`);
});

stop(); // dispose
```

- **The first run is immediate.** Later runs are scheduled and happen at the next flush. On
  Bedrock that is at most once per tick, however many times the values changed.
- **Cleanup.** If `body` returns a function, it runs before the next run and when the effect is
  disposed.
- **Dynamic dependencies.** Each run re-collects what it read. A branch not taken this time is not
  a dependency this time.
- **Owned.** An effect created in a scope is disposed with it. Whatever one run of an effect
  creates — inner effects, computeds, `onCleanup` callbacks — is disposed before the next run, so
  an effect that creates effects does not pile them up.
- **Errors** thrown by `body` or its cleanup are reported (see [`setErrorReporter`](#errors)) and do
  not stop other effects.

Inside components, use [`useEffect`](hooks.md#useeffect) instead: it ties the effect to the
component and supports dependency arrays.

## Untracking

`untrack(body)` runs `body` without subscribing to anything it reads, and returns its result. Use
it inside an effect or a computed to read a value you do not want to react to:

```ts
effect(() => {
    const target = selected.value;                 // react to selection changes
    const currentMode = untrack(() => mode.value); // but not to mode changes
    log(target, currentMode);
});
```

`signal.peek()` is the shorthand for untracking a single read.

## Batching and flushing

Writes never run subscribers immediately. They mark them dirty and ask the scheduler for a flush;
the flush runs every dirty effect and component once, shallowest first, then commits. On Bedrock,
the flush happens once per tick (through `system.run`), so any number of writes in one tick cost
one render and one commit.

| Function | Meaning |
| --- | --- |
| `batch(body)` | Runs `body`; the flush is requested only after it returns. Returns what `body` returns. |
| `flushSync()` | Runs all pending work right now, ignoring the tick and the time budget. |

`batch` is rarely needed on Bedrock, since the flush waits for the tick anyway. It matters with a
scheduler host that flushes sooner (tests, microtasks). Event handlers from the menu already run
inside a batch.

`flushSync` is for tests, and for rare cases where you must see the committed result before the
end of the tick. It throws if tasks keep scheduling each other past the pass limit.

### Time slicing

A flush on Bedrock may spend at most **8 ms** (`budgetMs`) before it stops and continues on the next
tick. A heavy burst of updates therefore spreads over several ticks instead of freezing the server.
`installBedrockRuntime({ budgetMs })` changes the budget; its options apply on the first call only,
so call it at startup. See [Performance](performance.md).

### Loop protection

An effect that writes a value it also reads can re-trigger itself forever. The scheduler stops that:

- a task that runs more than **100** times (`maxRunsPerTask`) without progress before the queue
  drains is abandoned and reported once; it runs again the next time its dependencies change.
  Progress is a task running for the first time since the queue last drained, so a value fed by
  many different writers — 126 slots each adding to one total — is not a loop, while two effects
  feeding each other are;
- a flush that runs more than **10,000** tasks (`maxPassesPerFlush`) abandons the rest of the queue.

Both reports go to the scheduler's `onError`, which defaults to the logger (`source: "scheduler"`).

## Scopes

Every computed, effect and cleanup belongs to the **scope** that was active when it was created.
Disposing a scope disposes everything in it, children first, then its cleanups in reverse order.
Components each have a scope, which is why unmounting a component leaks nothing.

For reactive work outside components, create a root:

```ts
const dispose = createRoot((dispose) => {
    effect(() => console.info(`[shop] coins=${coins.value}`));
    const doubled = computed(() => coins.value * 2);
    onCleanup(() => console.info("[shop] root disposed"));
    return dispose;
});

// later
dispose(); // runs the cleanup, then disposes the computed and the effect: reverse order of creation
```

| Function | Meaning |
| --- | --- |
| `createRoot(body)` | Runs `body` in a new scope with no parent. `body` receives the scope's disposer. Returns what `body` returns. |
| `onCleanup(fn)` | Registers `fn` on the active scope. Outside any scope it does nothing; on a scope already disposed it runs `fn` at once. |
| `createScope(parent?)` | Creates a scope, owned by `parent` (default: the active scope). Under a disposed parent it is born disposed. |
| `runWithScope(scope, body)` | Runs `body` with `scope` active; returns what `body` returns. |
| `disposeScope(scope)` | Disposes a scope. A throwing cleanup is reported and does not stop the rest. Disposing twice does nothing. |
| `getActiveScope()` | The active scope, or `null`. |

A `Scope` object exposes `depth`, `parent`, `disposables`, `children` and `isDisposed`; treat it as
opaque.

An `effect()` created at the top level of a script, outside any root, belongs to no scope and lives
until you call its disposer.

## Errors

Errors thrown by effects, cleanups and renders that nothing catches are reported through one
function. By default it writes a warning through the [logger](errors-and-diagnostics.md#logging)
(`source: "runtime"`). Replace it with:

```ts
setErrorReporter((error) => console.error(`[shop] ${String(error)}`));
setErrorReporter(null); // back to the logger
```

Inside a mounted menu with an `onDiagnostic` handler, render and handler errors go to
`onDiagnostic` instead, and are reported exactly once. See
[Errors, diagnostics and logging](errors-and-diagnostics.md).

## The scheduler

The functions above use the **runtime scheduler**. On Bedrock, `installBedrockRuntime()` installs
it. Outside the game, tests and tools install their own:

| Function | Meaning |
| --- | --- |
| `configureRuntime(host, options?)` | Creates a `Scheduler` over `host` and installs it. Returns it. |
| `setRuntimeScheduler(scheduler)` | Installs an existing scheduler. |
| `getRuntimeScheduler()` | The installed scheduler. Without one, installs a microtask scheduler and warns once. |
| `hasRuntimeScheduler()` | Whether one is installed. |
| `resetRuntime()` | Removes it. For tests. |

A `SchedulerHost` has two methods: `requestFlush(callback)`, which calls `callback` at the next
safe point, and `now()`, a millisecond clock used only for time slicing.
`createMicrotaskSchedulerHost()` flushes on the microtask queue; `createManualSchedulerHost()` flushes
only when you call `runPending()` and has a clock you move with `advance(ms)`. See
[Testing](testing.md) and [Custom hosts and schedulers](custom-hosts.md).

`SchedulerOptions`:

| Option | Default | Meaning |
| --- | --- | --- |
| `budgetMs` | `8` | Milliseconds a flush may run before yielding. |
| `maxPassesPerFlush` | `10000` | Tasks one flush may run before the queue is abandoned. |
| `maxRunsPerTask` | `100` | Runs one task may make without progress before the queue drains, before it is abandoned. |
| `onError` | the logger | Receives loop reports. |

The `Scheduler` class itself has `schedule(task)`, `batch(body)`, `flush()`, `flushSync()`,
`pendingCount` and `isFlushing`. You only touch it when writing a custom host.

## Quick reference

| Need | Use |
| --- | --- |
| A value that changes | `signal` (module or map) / `useState`, `useSignal` (component) |
| A value derived from others | `computed` / `useComputed`, `useMemo` |
| Do something when values change | `effect` / `useEffect` |
| Read without subscribing | `peek()`, `untrack` |
| Many writes, one update | `batch` (handlers are already batched) |
| See the result now | `flushSync` |
| Clean up a group of effects | `createRoot` + its disposer |
