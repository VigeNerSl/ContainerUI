# The Bedrock runtime

This page covers the Bedrock adapter directly: starting it, opening menus, what a session gives you,
the surface underneath, sizes, scanning, closing and uninstalling. Most add-ons only need
`installBedrockRuntime()` and `openContainer()`.

## `installBedrockRuntime`

```ts
installBedrockRuntime({ budgetMs? });
```

Installs, once:

- a **scheduler** whose flush runs through `system.run`, so every change made in a tick commits
  together;
- a **time source** over `system.runTimeout` / `system.runInterval`, for `useTicker`, `useReveal`,
  `useTween`.

`budgetMs` (default `8`) is how long one flush may run before it yields to the next tick. It returns
the scheduler. Options apply only on the first call; later calls return the same scheduler and ignore
theirs. It also installs the world hooks: the anti-duplication guard, the cancelling of clicks on
someone else's menu, the sweep of menu entities a restart or a reload left behind, and the hooks of
[storages opened by click](held-storage.md), which settle what an open cut short left. `openContainer`
calls it with the defaults if nothing has installed yet, but call it yourself at startup: the guard
then sweeps the players who join after a restart before any menu opens, the leftovers are cleared,
and you can set `budgetMs` or run reactive code before the first menu.

## `openContainer`

```ts
const session = openContainer(player, element, options);
```

Opens `element` — an element, or a function returning one — as a menu for `player`.

```tsx
const session = openContainer(player, () => <Shop player={player} />, {
    size: 54,
    title: "§6Shop",
    onDiagnostic: (vigenersl) => console.warn(`[shop] ${vigenersl.kind}: ${vigenersl.message}`),
});
```

Passing a function (`() => <Shop />`) rather than an element lets the root re-render when signals it
reads change; both work.

It is safe to call from `beforeEvents` handlers, where spawning entities is not allowed: the spawn is
retried on the following ticks (up to 5 attempts).

### Options (`OpenContainerOptions`)

| Option | Default | Meaning |
| --- | --- | --- |
| `size` | required | Slot count. One of the [supported sizes](#sizes). |
| `title` | `"Container"` | Title shown on the container header. Colour codes allowed. |
| `onDiagnostic` | the logger | Receives the menu's [diagnostics](errors-and-diagnostics.md#diagnostics). |
| `onMountEvent` | none | Observes the open sequence; see [Opening](#opening). |
| `maxWaitTicks` | `60` | Ticks to wait for the inventory to reach its size before giving up. |
| `scanIntervalTicks` | `1` | Ticks between interaction scans. |
| `idleScanIntervalTicks` | `2` | Ticks between scans after about a second without player activity. `1` turns the slowdown off. |
| `maxViewDistance` | `8` | Blocks the player may move from the menu entity before it closes. |
| `openBy` | `"seat"` | How the player gets the screen; see [Opening by click](#opening-by-click). |
| `clickAt` | `"head"` | With `openBy: "click"`: where the menu entity goes, `"head"` or a point `{ x, y, z }`. |
| `clickWaitTicks` | `CLICK_OPEN_WAIT_TICKS` (100) | With `openBy: "click"`: ticks to wait for the click before the menu closes with `"timeout"`. |
| `hintMessage` | none | Action-bar text shown once the menu is ready, before the player opens the screen. |
| `onError` | a `platform-error` diagnostic | Receives platform failures as text. |
| `onTrace` | none | Receives gesture-tracking lines; see [records](../reference/records.md#trace-lines). |

### `ContainerSession`

| Member | Meaning |
| --- | --- |
| `surface` | The `BedrockSurface` the menu renders onto. |
| `app` | The mounted `App`, once the menu is live; `null` before that and if opening failed. |
| `closed` | A promise that resolves when the menu closes, however it closed. |
| `close()` | Closes the menu (`"programmatic"`). |

```tsx
const session = openContainer(player, () => <Shop />, { size: 27 });
await session.closed;
player.sendMessage("§7Thanks for shopping!");
```

### One menu per player

Opening a menu for a player who already has one open closes the old one first. To go from one menu to
another, just open the next one; for screens *within* a menu, use the [router](navigation.md), which
avoids the reopen entirely.

## Opening

Opening takes these steps:

1. Spawn the menu entity at the player, name it (the name picks the screen layout), and set its
   inventory size.
2. Wait until the inventory reports the requested size — usually the same tick, at most
   `maxWaitTicks`.
3. Mount your tree and write every slot, **before** the player sees anything.
4. Seat the player on the entity. The game does not open the chest screen by itself: the player
   opens it with the inventory key (E on a keyboard, the inventory button on a phone), and it opens
   already full. `hintMessage` can tell them so.
5. Start scanning.

### Opening by click

With `openBy: "click"` the player is never seated. The menu entity spawns in the player's head and
the menu is written into it as usual; the player then clicks, and the game opens the entity's
inventory itself, so no inventory key is needed. In the head, the click lands on the entity wherever
the player looks.

```ts
world.afterEvents.itemUse.subscribe((vigenersl) => {
    const { source, itemStack } = vigenersl;
    if (!source.isSneaking || itemStack.typeId !== "minecraft:compass") return;
    openContainer(source, () => <Shop />, { size: 27, openBy: "click" });
});
```

- **Open it from an `afterEvents` signal or a command.** The click that opens the screen comes right
  after the one that asked for the menu, and from `beforeEvents` the spawn waits a tick or two.
- **A click by anyone else is cancelled**, so no other player can open someone's menu.
- **A click that never comes closes the menu** once `clickWaitTicks` (default
  `CLICK_OPEN_WAIT_TICKS`, 100 ticks) have passed, with the close reason `"timeout"` and a
  `click-open-timeout` trace. The watchdog that closes it runs every `WATCHDOG_INTERVAL_TICKS` (10), so
  the close comes up to 9 ticks later; a click in that time is refused already. Once the player has
  the screen, it closes as any menu does.
- **The menu entity has no seat in this mode.** A click on an entity a player can ride seats them
  instead of opening it, so the library takes the seat away before the click.
- Step 1 spawns the entity in the player's head, or at `clickAt`; steps 4 and 5 become: write the
  slots, then start scanning; nothing is seated.

**At a point.** `clickAt: { x, y, z }` puts a block-sized entity there, its base centred on the point,
in the player's dimension, and leaves it in place; the player clicks it like a block. A point farther
than `maxViewDistance` from the player would close the menu at once, so it is refused.

```ts
openContainer(player, () => <Shop />, { size: 27, openBy: "click", clickAt: { x: 10.5, y: 64, z: -3.5 } });
```

`openContainer` throws a `RangeError` for an `openBy` other than `"seat"` or `"click"`, a `clickAt`
that is neither `"head"` nor a point of finite numbers, `clickAt` or `clickWaitTicks` without
`openBy: "click"`, a
`clickWaitTicks` that is not a positive whole number, or a point beyond `maxViewDistance`.

For something the player carries, shown as the game's own chest rather than a menu, see
[Storages opened by click](held-storage.md).

**From `beforeEvents` it takes about two ticks longer.** The game refuses to spawn an entity there,
so step 1 is retried on the next tick (`spawn-deferred`). Measured in a world, the first paint took
3–8 ms when the menu opened from a command handler, and about 90–110 ms from a `beforeEvents`
handler. If a menu opens on a block click and the delay matters, open it from the matching
`afterEvents` signal instead.

`onMountEvent` observes them (`MountEvent`):

| `kind` | Meaning |
| --- | --- |
| `spawn-deferred` | The spawn was refused in a read-only context (`beforeEvents`); retried next tick. `attempt` says which try. |
| `spawn-failed` | The spawn failed for good. The menu closes. |
| `inventory-ready` | The inventory reached its size. `ticksWaited`. |
| `inventory-timeout` | It did not within `maxWaitTicks`. Reported as a `platform-error` naming the likely cause: the shared ContainerUI behaviour pack with the menu entity is not active. The menu closes. |
| `activation-failed` | Mounting or seating the player failed. The menu closes. |
| `mounted` | The menu is live. `ticksWaited`. |

## Sizes

A menu must have one of these slot counts (`SUPPORTED_SIZES`):

**1, 5, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117, 126**

Up to 54 they are ordinary chest-style screens; 63 and above scroll. Each size has an inventory group
in the menu entity and a layout in the resource pack, both generated from this list (see
[Pack assets](../getting-started/installation.md#pack-assets)). Any other size throws `RangeError`.

## Scanning

A Bedrock container has no click events, so the menu **scans** its slots: every tick while the player
is active, every `idleScanIntervalTicks` ticks after 20 quiet passes. A scan compares each slot with
what was written there, using three cheap properties (type, amount, name), and investigates only slots
that differ. The player's inventory is compared only when it may have changed: its change event fired,
a gesture is in flight, or a periodic resync is due.

Every half second a watchdog also checks that the player and the entity still exist, that the player is
within `maxViewDistance`, sweeps marked copies from the player's inventory, and retries pending
`takeBack`s.

See [Interaction](interaction.md) for what the scan decides, and [Performance](performance.md) for its
cost.

## `BedrockSurface`

The surface is the `HostAdapter` a menu renders onto: the entity, its inventory, the scan, and the
viewer. `openContainer` creates one; you only touch it for measurements or advanced setups.

| Member | Meaning |
| --- | --- |
| `new BedrockSurface(player, options)` | Creates a surface (`BedrockSurfaceOptions`: `size`, `title`, `scanIntervalTicks`, `idleScanIntervalTicks`, `maxViewDistance`, `openBy`, `clickAt`, `clickWaitTicks`, `hintMessage`, `onError`, `onTrace`). Throws `RangeError` for an unsupported size, and for the click options as `openContainer` does. |
| `open()` | Spawns the entity; returns `"spawned"`, `"deferred"` or `"failed"` (`SpawnOutcome`). |
| `isInventoryReady()` | Whether the inventory has reached its size. |
| `activate()` | Seats the player, or with `openBy: "click"` starts the wait for the click, and starts scanning. Returns `false` while the inventory is not ready. |
| `slotCount` | The size. |
| `player`, `entity` | The viewer and the entity, or `null` once gone. |
| `isClosed` | Whether it has closed. |
| `close(reason?)` | Closes it (default `"programmatic"`). Idempotent. |
| `scrubPlayerInventory()` | Removes marked copies from the viewer's inventory; returns how many stacks. |
| `scanStats` | Counters since opening; see below. |
| `measureScanCost(passes)` | Runs `passes` scan passes back to back and returns the milliseconds, or `null` while a gesture is in flight. |
| `measureScanPhases(passes)` | Times the setup, the probes and whole passes apart (`{ setupMs, probesMs, passesMs }`), or `null`. |

Plus the `HostAdapter` methods the core calls: `writeSlot`, `readSlot`, `playSound`,
`takeBackFromViewer`, `giveToViewer`, `onInteraction`, `onClose`.

`runMountSequence(options)` is the open sequence as a function, and `classifySpawnError(error)` tells a
retryable spawn refusal from a real failure; `openContainer` is built from them.

### `scanStats`

| Field | Meaning |
| --- | --- |
| `passes` | Scan passes run. |
| `slotsScanned` | Slots examined. |
| `detectionMs` | Time spent detecting, as one 1 ms-resolution sample per pass. Overstates passes under a millisecond; use `measureScanCost` for those. |
| `handlerMs` | Time spent in your handlers. |
| `maxDetectionMs` | The longest pass. |
| `pendingTakes` | Gestures in flight at the last pass. |
| `playerScans` | Passes that compared the viewer's inventory. |
| `inventoryDrift` | Resyncs that found an inventory change no event reported. |
| `idleSkips` | Scan ticks skipped while the viewer was idle. |
| `scrubbedStacks` | Marked copies removed from the viewer's inventory. |

Log them on close to see what a menu costs:

```tsx
const session = openContainer(player, () => <Shop />, { size: 54 });
void session.closed.then(() => console.info(`[shop] ${JSON.stringify(session.surface.scanStats)}`));
```

## Closing

See [Interaction → Closing](interaction.md#closing) for the reasons and the order of what happens.
`ContainerSession.closed` resolves after all of it.

## Uninstalling

```ts
uninstallBedrockRuntime();
```

Undoes everything the adapter set up: closes every open menu, unsubscribes from every world event,
stops its timers, drops the storages it keeps, and removes the installed scheduler and time source. The
next `openContainer` or install call sets everything up again, block containers registered at startup
included. The first install after an uninstall applies its options again.

Use it for hot-reload setups and tests; a normal add-on never needs it.

## Constants

The identifiers, sizes and timings the adapter uses are exported; see [Constants](../reference/constants.md).
