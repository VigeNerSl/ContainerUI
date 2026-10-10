# Performance

A Bedrock tick is 50 ms for everything the server does. A UI library must not take a noticeable share
of it. This page lists what ContainerUI costs, measured in a world, and what you can do to spend less.

## What costs time

| Work | When | Cost |
| --- | --- | --- |
| **Scanning** | Every tick per open menu (every other tick when idle) | ~0.5 ms for a fully occupied 27-slot menu, timed back to back |
| **Slot writes** | Only for slots whose item changed | One `setItem` each |
| **Rendering** | Only components whose signals or props changed | Your component code |
| **Your handlers** | On clicks and edits | Your code; reported separately as `handlerMs` |
| **Opening** | Once per menu | The inventory is ready in 0–1 ticks at every size; first paint a few ms (126 slots: ~20 ms) |

The diff is what keeps writes low: a 126-slot menu costs 126 writes to paint, then one write per
button press. Two hundred state changes inside one tick collapse into one render and one commit.

## Measuring

`session.surface.scanStats` counts a menu's work; log it on close:

```ts
void session.closed.then(() => {
    const stats = session.surface.scanStats;
    console.info(`[shop] passes=${stats.passes} detectionMs=${stats.detectionMs} handlerMs=${stats.handlerMs} idleSkips=${stats.idleSkips}`);
});
```

`detectionMs` sums one 1 ms-resolution sample per pass, so it overstates passes shorter than a
millisecond. For an exact figure, time passes back to back:

```ts
const ms = session.surface.measureScanCost(100); // 100 passes
console.info(`[shop] ${((ms ?? 0) / 100).toFixed(3)} ms per pass`);
```

`app.writeCount` (`session.app?.writeCount`) counts slot writes since the menu opened.

In tests, `host.writes` shows exactly which slots a change wrote; see [Testing](testing.md).

## Writing fewer slots

- **Read changing values in item functions**, not in component bodies. A function item repaints one
  slot; a component body re-renders the component and all its children.

  ```tsx
  <slot item={() => ({ typeId: "minecraft:clock", name: `${seconds.value}s` })} />
  ```

- **Keep items stable when nothing changed.** The diff compares type, amount, name, lore,
  enchantments, durability, potion and block states. A value that changes every render — a timestamp
  in the lore — forces a write every render.
- **Animate few slots at a time.** An animation changing 50 slots per tick is 50 writes per tick. A
  reveal writes each slot once.
- **Don't rebuild what you don't show.** Unmount hidden screens (the router does) rather than drawing
  them over each other.

## Rendering less

- **Stable props.** A child is skipped when its props are shallowly equal. Inline arrow functions and
  object literals defeat that; `useCallback` and `useMemo` keep them stable. See
  [Components](components.md#props-are-compared-shallowly).
- **Pass signals down** instead of their values, and let the child read them.
- **Select from context** with `useContextSelector` when a context holds a large state object.
- **Split large components** so a change re-renders the small part that depends on it.

## Scan pacing

Scanning is the standing cost of an open menu. Two options trade latency for it:

| Option | Default | Effect |
| --- | --- | --- |
| `idleScanIntervalTicks` | `2` | After 20 quiet passes (about a second), scan only every N ticks. The first click after a pause may take up to N−1 extra ticks. `1` disables the slowdown. |
| `scanIntervalTicks` | `1` | Scan every N ticks always. Every click may take up to N−1 extra ticks. |

```tsx
openContainer(player, () => <Leaderboard />, { size: 54, idleScanIntervalTicks: 4 });
```

A read-only menu (a leaderboard, a status screen) can afford a slower scan; a shop that players click
quickly should keep the defaults.

## Time slicing

A flush may run for `budgetMs` (default 8 ms) before it continues on the next tick. If a burst of
updates needs more, it is spread over several ticks rather than freezing one. Lower the budget on a
busy server, raise it if large menus visibly paint across ticks:

```ts
installBedrockRuntime({ budgetMs: 4 });
```

(Options apply on the first call only, so call `installBedrockRuntime` at startup, before anything
else installs the runtime.)

## Watches

Storages watch for outside changes with a timer while a menu shows them: block storages every 10 ticks
(`watchIntervalTicks`), player inventories every 2 ticks. Each watch pass reads every slot. Turn it off
for blocks nothing else touches:

```ts
registerBlockContainer(registry, "myaddon:locker", { size: 27, render, watchIntervalTicks: null });
```

`storage.watchStats` reports `{ passes, totalMs }`; block menus log it on close.

## The item guard

The world guard examines every loose item that appears in the world (`entitySpawn`), rejecting
non-items with a type comparison before doing any work. `getItemGuardStats().inspected` shows how many
it looked at. On a server with heavy item traffic (farms, `/give` loops) that number is large and the
cost per item is small; it is not a reason to worry unless a profiler says so.

## Checklist for a heavy menu

1. Values that change often → item functions.
2. Children with handlers → `useCallback`.
3. Large contexts → signals inside, `useContextSelector` to read.
4. Read-only screens → `idleScanIntervalTicks: 4` or more.
5. Log `scanStats` and `writeCount` on close while tuning, and remove it after.
