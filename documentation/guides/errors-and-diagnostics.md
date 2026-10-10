# Errors, diagnostics and logging

A menu should not crash because one part of it failed, and when something goes wrong you should be
told what and where. This page covers the three mechanisms:

- **`ErrorBoundary`** — shows a fallback in place of a part of the menu that threw while rendering.
- **Diagnostics** — structured reports from a mounted menu: layout mistakes, handler errors, failed
  writes, platform failures, development warnings.
- **Logging** — one function that receives everything the library has to say.

## What a failure costs

| What throws | Effect | Reported as |
| --- | --- | --- |
| A component, while rendering | It renders nothing (its children neither), and retries when a signal it read changes. | `render-error` |
| A slot's item function | That slot is empty. | `render-error` |
| The root element function | The last screen stays up. | `render-error` |
| An event handler (`onClick`, `onChange`, …) | The handler stops; the slot is still restored. | `handler-error` |
| `accept` | The item is accepted. | `handler-error` |
| An effect or a cleanup | That effect stops; others run. | the error reporter |
| A slot write | The slot keeps its old contents; the write is not retried until the item changes. | `write-failed` |

Nothing a component does can take the whole menu down.

## `ErrorBoundary`

Wrap a risky part of a menu to show something better than empty slots while it is broken:

```tsx
<ErrorBoundary
    fallback={(failure) => (
        <slot index={13} item={{ typeId: "minecraft:barrier", name: "§cShop unavailable — click to retry" }} onClick={failure.reset} />
    )}
    onError={(failure) => console.warn(`[shop] ${failure.component}: ${String(failure.error)}`)}
>
    <Shop player={player} />
</ErrorBoundary>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `fallback` | `Child \| (failure) => Child` | Shown instead of the children once one of them throws while rendering. |
| `onError` | `(failure) => void` | Called once per caught failure. |
| `children` | `Child` | The protected content. |

The `RenderFailure` passed to both:

| Member | Meaning |
| --- | --- |
| `error` | What was thrown. |
| `component` | What threw: a component identity such as `Shop@3#ord:0`, or a slot, such as `Shop@3#ord:0 (item of slot 13)`. |
| `reset()` | Clears the failure and renders the children again **with fresh state**. |

Rules:

- It catches errors thrown **while rendering**: component bodies and item functions. It does not
  catch errors in handlers, effects or timers.
- The children are unmounted while the fallback shows, so `reset()` starts them from scratch. A
  failed `useResource` load therefore loads again.
- An error thrown while the fallback is showing (by the fallback itself) goes to the next boundary up.
  Several children failing in the same pass all stay with their own boundary: the first one shows the
  fallback, and the others are reported as `render-error` but not passed on.
- A caught error is still reported as a `render-error` diagnostic to `onDiagnostic` (on Bedrock, the
  logger by default). It never reaches the error reporter.
- `onError` throwing is reported through the error reporter and does not break the boundary.

Place boundaries around independent parts of a screen: a failing shop section should not blank the
navigation.

## Diagnostics

A mounted menu reports problems as `Diagnostic` objects:

```ts
interface Diagnostic {
    kind: "overflow" | "collision" | "handler-error" | "write-failed" | "render-error" | "dev-warning" | "platform-error";
    message: string;
    detail?: unknown; // the underlying error, or the indices involved
}
```

| Kind | Meaning |
| --- | --- |
| `overflow` | Cells fell outside the menu: a layout ran past the last slot or the right edge, or an `index` was pinned off the surface. |
| `collision` | Two elements claimed one slot (the last wins), or a layer tried to cover an input. |
| `render-error` | A component or item function threw while rendering. The message says what the player sees now. |
| `handler-error` | An event handler or `accept` threw. |
| `write-failed` | A slot could not be written (for example, an invalid item id). |
| `platform-error` | The Bedrock surface failed: it could not spawn, mount the player, read, or its inventory never reached its size. |
| `dev-warning` | A mistake caught at runtime; see below. |

`overflow`, `collision` and `dev-warning` describe the shape of the tree rather than an event, so each
distinct message is reported **once per menu**.

### Receiving diagnostics

Pass `onDiagnostic` when opening:

```tsx
openContainer(player, () => <Shop />, {
    size: 54,
    onDiagnostic: (vigenersl) => console.warn(`[shop] ${vigenersl.kind}: ${vigenersl.message}`),
});
```

It is also an option of `mount`, of `ContainerFormData.open`, and of block containers
(`BlockContainerOptions.onDiagnostic`).

A menu opened on Bedrock (`openContainer`, `ContainerFormData.open`, block menus) without
`onDiagnostic` sends its diagnostics to the [logger](#logging) with source `diagnostic`:
`render-error`, `handler-error`, `write-failed` and `platform-error` as errors, the rest as warnings.
The default logger prints both, so layout mistakes show up in the content log without any setup.

Every failure is reported **once**, to one place — never to two.

A tree mounted directly with core `mount` has no such default. Without `onDiagnostic`, its uncaught
failures — a `render-error` no `ErrorBoundary` caught, a `handler-error` — go to the
[error reporter](reactivity.md#errors), and everything else is dropped, including a `render-error`
that a boundary caught.

### Development warnings

`dev-warning` flags code that works but is probably wrong:

| Warning | Fix |
| --- | --- |
| A component set its own state while rendering. A write inside an effect body is not this, even though the effect's first run happens during the render. | Move the write into a handler or effect, or derive the value instead. |
| A component called a different number of hooks than on its first render. | Call every hook on every render, in the same order; see [Hooks](hooks.md#rules). |
| A route is not in `screens` and there is no `fallback`. | Add the screen, or a `fallback`. |
| Two siblings share a key (`Duplicate key "x" among the children of …`). | Make keys unique among siblings. |
| An `async` function was passed to `useEffect`. | Use a plain function that starts the async work; see [Hooks](hooks.md#useeffect). |
| `useEffect` switched between having dependencies and not. | Pick one form for each effect. |
| A route has a param named `route` or `router`. | Rename the param. |

## Logging

Everything the library writes goes through one function, the **logger**:

```ts
import { setLogger } from "containerui";

setLogger(({ level, source, message, detail }) => {
    if (level === "info" && source !== "block") return;
    console.warn(`[myaddon] ${level} ${source}: ${message}`);
});
```

`setLogger(logger)` replaces it; `setLogger(null)` restores the default, `consoleLogger`, which prints
errors with `console.error`, warnings with `console.warn`, and drops `info`. A logger that throws is
ignored.

A `LogRecord`:

| Field | Meaning |
| --- | --- |
| `level` | `"error"`, `"warn"` or `"info"`. |
| `source` | Which part of the library, below. |
| `message` | One line of text. |
| `detail` | The error or event behind it, when there is one. |

| `source` | Records |
| --- | --- |
| `runtime` | Uncaught errors in effects, renders and cleanups; running without an installed scheduler. |
| `scheduler` | Loop protection: a task or a flush abandoned. |
| `diagnostic` | Diagnostics of menus without `onDiagnostic`. |
| `surface` | Surface failures without an `onError` (Bedrock). |
| `block` | Block container records (`info`; `warn` for `error`). |
| `storage` | Storage activity, such as a player inventory storage invalidated (`info`). |
| `item-guard` | Anti-duplication guard activity (`info`). |
| `items` | Item warnings: an enchantment, durability, tags, a potion or block states the engine refused, or a loot table it does not know. |

`LogLevel`, `LogSource`, `LogRecord` and `Logger` are the types.

### Channels with their own handler

Some channels can be sent elsewhere instead of the logger. Setting one takes that channel away from
the logger; `null` gives it back.

| Channel | Handler | Default |
| --- | --- | --- |
| Uncaught errors (effects, renders, cleanups) | `setErrorReporter(fn \| null)` | logger, `runtime`, `warn` |
| A menu's diagnostics | `onDiagnostic` option | logger, `diagnostic` |
| A surface's platform failures | `onError` option of `openContainer` / `BedrockSurface` | a `platform-error` diagnostic (`openContainer`); logger, `surface`, `warn` (a `BedrockSurface` you create yourself) |
| A surface's tracking lines | `onTrace` option | nowhere |
| Scheduler loops | `onError` of `SchedulerOptions` | logger, `scheduler`, `error` |
| Block container records | `setBlockContainerLogger(fn \| null)`, or `onEvent` per component | logger, `block`, `info` |
| Item guard activity | `setItemGuardLogger(fn \| null)` | logger, `item-guard`, `info` |

The full list of records and trace lines is in
[Diagnostics and log records](../reference/records.md).

### Seeing activity while developing

The default logger hides `info`, which is where block and guard activity goes. To see everything in
the content log while developing:

```ts
setLogger((record) => {
    const line = `[ContainerUI] ${record.level} ${record.source}: ${record.message}`;
    if (record.level === "error") console.error(line);
    else console.warn(line); // warn shows in the content log; info would not
});
```

And trace a menu's gesture tracking:

```tsx
openContainer(player, () => <Shop />, { size: 27, onTrace: (line) => console.warn(`[trace] ${line}`) });
```
