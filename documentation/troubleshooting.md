# Troubleshooting

Problems people run into, grouped by symptom, with the cause and the fix. For anything not listed,
turn on the info-level logger first (see
[Seeing activity while developing](guides/errors-and-diagnostics.md#seeing-activity-while-developing))
and read the content log.

The **content log** is the game's own log of script errors, pack loading problems and
`console.warn`/`console.error` output. Enable it in the game's settings, under the creator or content
log options; it can be shown on screen and is written to a file.

## The menu never opens

**The log says `Surface inventory never reached N slots … Is the ContainerUI behaviour pack with the
surface entity active in this world?`** The menu entity is missing or out of date. Make sure the
shared ContainerUI BP and RP are active in the world, and that your add-on does not carry an older copy
of `rideable_entity.json` of its own. See [Installation → Pack assets](getting-started/installation.md#pack-assets).

**Nothing in the log, nothing on screen.**

- Check that `openContainer` is actually called: log right before it.
- `size` must be one of the supported sizes; any other throws `RangeError` — check that your caller does
  not swallow the error.
- Check the content log for script errors at load: an import path without `.js`, or a copied tree in the
  wrong folder.

**A chest screen opens with the wrong layout, or a plain entity inventory.** The shared ContainerUI RP
is not active in the world, or another pack replaces its `ui/chest_screen.json` or `ui/container.json`
and wins.

**Opening from `beforeEvents` fails.** It should not: a spawn the read-only window refuses is retried
on the next tick, up to 5 attempts in all. `spawn-failed` in `onMountEvent` has two causes. A real spawn
error is also reported as a `platform-error` diagnostic, `Failed to spawn the surface entity: …`, with
the engine's message. Five refused spawns in a row report `spawn-failed` with no message: the menu was
opened from a read-only window that lasted five ticks, so open it from `system.run(() => …)` instead.

**My own code in a `beforeEvents` handler throws.** The handler runs in the game's read-only window,
where `sendMessage` and most changes to the world are refused. `openContainer` defers its own spawn,
but the rest of your handler has to defer too: wrap it in `system.run(() => …)`.

**One click opens the menu several times.** `world.beforeEvents.playerInteractWithBlock` fires more
than once for a single interaction. Open the menu only when the event's `isFirstEvent` is `true`.

## Clicks

**A button's handler runs twice.** Two causes:

- The handler is attached twice (the slot is declared twice at the same index — look for a `collision`
  diagnostic).
- The handler opens a menu that has the same button at the same place, and the player double-clicked.
  Guard long actions with a ref or state.

**A button made from a real item fires by itself, straight after the menu opens.** A view carrying a
real item (`native`) is written wearing the name and lore the view names, and the scan compares a slot
with the stack that was really written, so a button built from, say, `itemFromLootTable(…)` and renamed
through a spread does not read as a click. If one still fires on its own, report a reproducible case.

**A button does not react.**

- Its item is `null`: an empty button is inert by design.
- The slot is covered by a layer or modal (a higher-`z` layer, or a backdrop).
- A layout pushed it to another index or out of the menu: look for `overflow` and `collision`
  diagnostics.
- The handler throws: look for `handler-error`.

**The first click after a pause is a little slow.** Idle menus scan every other tick. Set
`idleScanIntervalTicks: 1` for menus where that tick matters.

**On a phone, tapping a button moves it into my inventory for a moment.** That is how touch controls
work: there is no cursor, so the tap moves the item. The library removes the copy and fires the
handler on the same pass.

## Items

**A menu item stayed in my inventory.** It is removed within half a second while the menu is open, and
again several times on close. If one survives, it carries the marker and is removed when thrown, used,
or when the player opens any container or rejoins. Report a reproducible case.

**A plain stackable item shows an empty line in its tooltip.** Stackable items cannot keep dynamic
properties, so the anti-duplication marker falls back to an invisible lore line, which takes a row
when the item has no lore of its own. Give such items lore, or accept the row. See
[Items → The anti-duplication guard](guides/items.md#the-anti-duplication-guard).

**A potion shows as the plain bottle.** Give it a `potion` field: the script API has no data values.
A warning names the effect and delivery the engine refused; effect ids carry their strength and
duration (`strong_healing`, `long_nightvision`). See [Items → Potions](guides/items.md#potions).

**A tipped arrow shows as a plain arrow.** The engine builds no arrows from a potion effect; only
drinkable, splash and lingering bottles. Build one with a loot table instead:
[Items → Items only a loot table can build](guides/items.md#items-only-a-loot-table-can-build).

**A block item ignores its data value** (`minecraft:brown_mushroom_block:14`, `minecraft:dropper:3`).
Give it `blockStates` instead: `{ typeId: "minecraft:dropper", blockStates: { facing_direction: 3 } }`.
A warning that the engine could not resolve the block means the value is not a block state at all — a
bed's colour, for example, is entity data. See
[Items → Block items with states](guides/items.md#block-items-with-states).

**A slot stays empty and the log says `Invalid item identifier`.** Not every block id is an item id.
`minecraft:item_frame` is a block identifier, and `minecraft:bricks` is refused where
`minecraft:brick_block` works. Check an id as an item, with `/give`, before putting it in a slot.

**`tags` disappear.** Only non-stackable items keep them. See [Items → Tags](guides/items.md#tags).

**A warning says an enchantment or durability is ignored.** The item type cannot take it (a diamond,
the gem, has no durability; a glass pane cannot be enchanted). The warning appears once per item type.

**An item's `amount` does not show as written.** A stack cannot exceed its item's stack size (64,
16 or 1); the engine either limits it or refuses the write (a `write-failed` diagnostic). Keep
`amount` within `maxStackOf(typeId)`, and show larger quantities another way, such as a counter item;
see [QuantityPicker](guides/lists-and-quantities.md#items-that-stack-to-fewer-than-max).

**An item is duplicated when a menu with my own chest mirror closes.** The mirror's inputs are not
marked `isMirror`, so closing gives the player the slot's copy while the chest keeps the original. Add
`isMirror`, or use `StorageSlots`; see [Interaction → Controlled inputs](guides/interaction.md#controlled-inputs).

## State and rendering

**The screen does not update after I change a value.**

- The value is not in a signal (or `useState`), so nothing knows it changed.
- An array or object was changed in place: `list.value.push(x)` is not a change. Assign a new one.
- A child component received a context value that is not a signal, and was skipped because its props
  did not change. Put signals in context.
- An effect with a dependency array reads a signal that is not in the list: with dependencies, reads are
  untracked.

**A component loses its state.**

- The component function is defined inside another component, so it is a new type on every render.
  Move it to module level.
- It is in a list without keys, and the list changed. Add keys.
- It is a screen you navigated away from and back to: screens start fresh. Use `useRouteState`.
- An `ErrorBoundary` above it showed its fallback, which unmounts the children.

**`Hook order changed between renders`.** A hook is called conditionally, in a loop, or after an early
`return`. Move hooks to the top of the component. When a hook is skipped rather than replaced by another
kind, the message is a `dev-warning` instead: "called a different number of hooks than on its first render".

**`useX() may only be called while a component is rendering`.** A hook was called from a handler,
effect, timer or plain function.

**`No time source is installed`.** An animation hook ran before `installBedrockRuntime()` (in tests,
before `configureTimeSource`).

**A warning about falling back to microtask scheduling.** Reactive code ran before
`installBedrockRuntime()`. Call it at the top of your entry script.

**`A reactive task ran 100 times without the queue settling`.** An effect writes a value it also reads,
directly or through a chain. Break the cycle: compute the value with `computed`, compare before
writing, or read with `peek()`.

**Everything shows the same value for every player.** A signal at module level is shared by everyone.
Key per-player state by player id; see [Multiplayer](guides/multiplayer.md).

## Block containers

**Right-clicking a native block opens nothing, and the log says `native: reached the block, not its
storage entity`.** Block container records are `info` level: the default logger drops them, so they
appear only with the info-level logger from
[Seeing activity while developing](guides/errors-and-diagnostics.md#seeing-activity-while-developing).
The storage entity is missing from the block: it was never spawned (the block was placed before the
component was registered, or by a command that skipped `onPlace`), or it was removed. Break and
re-place the block.

**`storage-missing … gave up after 8 retries`.** The same, for a menu block: there is no storage entity
at the block. Break and re-place it.

**Right after joining, the first click on a block opens a moment late.** A chunk's entities load after
its blocks start answering clicks. The library waits for the storage entity (`storage-wait`, up to 8
tries 5 ticks apart) instead of spawning another one, which would duplicate the storage.

**I cannot break my container block.** The storage entity fills the block and takes the hits. Sneak
and look at the block while breaking it. The action-bar hint says so; customise it with
`sneakHintMessage`.

**Items duplicated or vanished when a block was broken while chunks reloaded.** Report it with the
block records (`setBlockContainerLogger`). The orphan check removes storage entities whose block is
gone; it leaves them alone while it cannot tell.

**`registerBlockContainer` throws `has a render function but opens natively`.** A native inventory
cannot show a custom menu. Remove `open: "native"` (a `render` function implies `"menu"`).

## Persistence

**`JsonStore.get` returns the fallback although data exists.** Pass `onCorrupt` to see why: bad JSON, a
migration that threw, a record from a newer version, or a gone entity.

**Data written by another script does not show.** `JsonStore` caches reads. Call `forget(key)`, or keep
one store instance for the namespace and write through it.

**`Store namespace "…" contains "|"`.** `|` separates the namespace from the keys; pick another
character.

## Known limitations

- **Two players editing one storage slot in the same tick.** The first edit wins and the second is
  taken back; the rare case it cannot settle is reported as a `conflict-unresolved` trace line, sent
  to the menu's `onTrace` callback and silent by default.
- **No enchantment glint or durability bar on items that cannot have them.** The item type decides.
  To show a glint or a durability bar on such an item, define a custom item in your add-on's behaviour
  pack with the matching item components.
- **A shulker box item's contents** can only be read through the dispenser method of the
  [Shulker reader](guides/shulker-reader.md).
