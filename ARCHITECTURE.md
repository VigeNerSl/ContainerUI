# Architecture

This document describes how the library works and why it is built this way. It is for people who
want to understand ContainerUI's internals or contribute to it; you do not need it to use the library,
and the [documentation](documentation/README.md) covers that. File paths are relative to the
repository (`src/…`); the npm package ships the compiled `dist/` instead. To build and check a change,
see [CONTRIBUTING.md](CONTRIBUTING.md).

## The one rule

```
Add-on code — components written with JSX, hooks and signals
──────────────────────────────────────────────────────────────────────
src/core/components/  Confirm, Modal, Suspense, PagedList, Routes…
src/core/hooks/       hooks, animation, context, outside state
src/core/runtime/     elements, instances, layout, render, commit
src/core/scheduler/   coalescing + time-slicing
src/core/reactive/    signals, computeds, effects, scopes
src/core/storage/     SlotStorage, key-value persistence
src/core/logging/     setLogger: where every channel's output goes
──────────────────────────────────────────────────────────────────────
src/core/host/        HostAdapter ← the only interface between worlds
──────────────────────────────────────────────────────────────────────
src/platform/         surface, scan, block, items, storage, world
```

`src/ContainerFormData.ts` joins the two, so a pack imports everything from
`ContainerUI/ContainerFormData.js`.
Off-game code imports `core/index.js`, which never loads `@minecraft/server`.

Nothing above `HostAdapter` imports `@minecraft/server`. That single constraint buys three
things: the UI layer is unit-testable without the game, platform bugs cannot hide inside
component logic, and a second backend is a new folder rather than a rewrite.

The boundary is a *checked* invariant, not a convention. `tools/check-layers.mjs` fails
`npm run check:layers` (part of `npm run verify`) if anything outside `src/platform/` reaches for
the Minecraft API, or if `src/core/` imports `src/platform/`. The layers are folders of one
package, not separate npm packages — see Distribution below for why.

The adapter's contract is deliberately small — read a slot, write a slot, report what the
player did, report when the surface closes. The optional members let a host play sounds, learn
which slots the player owns, and move items to and from the viewer:

```ts
interface HostAdapter {
    readonly slotCount: number;
    writeSlot(index: number, item: ItemView | null): void;
    readSlot(index: number): ItemView | null;
    playSound?(soundId: string): void;
    setPlayerWritableSlots?(indices: ReadonlySet<number>, mirrored?: ReadonlySet<number>): void;
    takeBackFromViewer?(item: ItemView): void;
    giveToViewer?(item: ItemView): void;
    onInteraction(handler: (interaction: HostInteraction) => void): Dispose;
    onClose(handler: (reason: CloseReason) => void): Dispose;
    close(reason?: CloseReason): void;
}
```

Note what is *not* there: no notion of buttons, pages, callbacks, middleware or restores.
The adapter reports that slot 4 went from an arrow to nothing. Whether that was a click or
theft is policy, and policy lives in the core.

## Reactivity

A push-pull graph. Writing a signal pushes invalidation downstream; reading a derived value
pulls a recomputation, and only if a dependency's version actually moved.

Each node carries a monotonic `version`, bumped only when its value truly changes, and each
computation stores the versions it observed. Two consequences fall out:

- **Diamonds evaluate once.** `A → B, A → C, (B,C) → D`: updating `A` marks `B` and `C`
  dirty and `D` *maybe* dirty. Reading `D` refreshes `B` and `C` first, then recomputes once.
- **Unchanged derivations stop propagation.** If `isPositive = count > 0` and `count` goes
  from `1` to `2`, `isPositive` recomputes, produces the same boolean, does not bump its
  version — and nothing downstream runs.

Dirty levels are three-valued (`CLEAN`, `MAYBE_DIRTY`, `DIRTY`) precisely so that
"a dependency *might* have changed" is representable without eagerly recomputing.

**Scopes** own everything allocated inside them. Disposal cascades depth-first and runs
cleanups in reverse registration order, so teardown mirrors construction. A component is one
scope; unmounting it disposes its render effect, every hook effect, and every user cleanup
in one call.

## Scheduling

The scheduler exists because a tick is a hard, shared 50 ms budget.

**Coalescing.** Effects are queued, deduplicated and flushed once per tick. On Bedrock the
flush point is `system.run`, which fires at the end of the current tick. Twenty state writes
in one tick produce one render and one diff.

**Ordering.** Tasks run shallowest-first by ownership depth, so a parent re-renders before the
components beneath it. Running first is not enough on its own: the subtree a parent stops
rendering is disposed only when the commit walks the new output, and until then its queued renders
would still run, against state that no longer supports them. So once a component's output has
changed, the queued renders beneath it are held. They stay dirty, and the commit's walk either
renders each one it still finds, inside that same pass, or disposes it. The commit phase is
registered at `Number.MAX_SAFE_INTEGER` so it always runs last, after every render that could
feed it.

**Yielding.** A flush stops once it has spent its slice (8 ms by default) and reschedules
the remainder. Work is delayed; the frame is not dropped.

**Loop protection.** A task that re-runs more than `maxRunsPerTask` times (100) without
progress before the queue next settles is abandoned and reported once. Progress is the first run,
since the queue last drained, of a task that had not run yet: it resets every count. A reader fed
by many writers is therefore not a loop — 126 slot effects each bumping one shared total rerun
the reader up to once per write, and it ends on the right value — while two effects feeding each
other make no progress once both have run, and are still caught. The count spans flushes on
purpose: the budget cuts a flush long before a per-flush ceiling could trip, so a loop would
otherwise spend 8 ms every tick forever while the commit, sorted last, starved. Abandoning resets
the task to clean rather than merely dequeuing it — a dequeued effect stays dirty, ignores every
later invalidation and never runs again — so it runs normally the next time its dependencies
change. `maxPassesPerFlush` remains as a hard ceiling on one flush.

**Re-entry.** A `flushSync` called from inside an effect does not run that effect inside its own
run; it runs again once the outer run is over. A host whose `requestFlush` throws is reported
once per run of failures through `onError`, the write that triggered it does not throw, and the
next write asks again.

## Render and commit

Two phases, in the React sense, adapted to a flat surface.

**Render.** Each component instance owns a render effect. It runs the component function
and publishes the result into an `output` signal. Publishing *through the graph* rather than
through a dirty flag is the key move: the commit phase reads `output`, which subscribes it,
so there is no invalidation bookkeeping to get wrong.

Instances are matched by identity — explicit `key`, otherwise sibling order within a type —
so hook state stays attached to the right component across reorders. A type is the component
*function*, not its name: factories return anonymous components, and two modules may each
export a `Card`. Props are compared shallowly, so a re-rendering parent does not re-render
children whose props are structurally unchanged; a child whose props did change is rendered
inside the pass that changed them, so the commit never lays out its previous output.

**Commit.** One effect per surface. It walks the resolved tree with a `LayoutFrame` cursor,
producing a flat `Map<index, ResolvedSlot>`, then diffs that against what this surface last
wrote and issues only the differences. A slot is skipped when the item looks the same *and*,
for a real item, carries the same `native` payload: two unnamed swords look identical whatever
their enchantments, and skipping such a replacement would leave a viewer holding a real copy of an
item that had left the storage. Storages hand out one stable view per unchanged slot, so the
identity check costs nothing until a slot actually changes.

Because the walk reads reactive item sources (`item={() => …}`), those reads become
dependencies *of the commit effect*. A signal feeding one slot therefore invalidates the
pass without re-rendering any component, and the diff narrows it to one `writeSlot` call.
That is the fine-grained path; component re-render is the coarse path. Both end in the same
diff.

## When rendering goes wrong, and what sits on top

**Render errors cost one component.** A component that throws renders nothing; what it read
before throwing is still tracked, so it renders again by itself once that state changes. A
throwing item source costs its one slot, and a throwing root keeps the last screen. Each is
reported as a `render-error` diagnostic, caught or not. An `ErrorBoundary` is found by walking
the instance chain, as context is, and shows its fallback in place of its children until
`reset()`.

**Layers are composed after the walk.** A `Layer` (and `Modal`, and `Confirm`) lays its children
out on their own, from index 0, into slots collected apart from the base. Once the pass is done
the layers are stacked over the base by `z`, then declaration order. A backdrop makes a layer
modal by filling every cell it does not use. The layer's components stay children of whoever
declared it, so context and boundaries reach them, and the menu beneath stays mounted. A layer
never covers an input.

**Suspense hides; it does not unmount.** `resource.read()` throws a `Suspension` while loading.
The render effect treats that as waiting rather than failing, and tells the nearest `Suspense`,
which shows its fallback. The children go on rendering inside a hidden subtree that the pass
walks but writes nowhere, so a waiting component keeps its load instead of restarting it every
time the fallback appears. Since nothing of a hidden subtree is on the surface, the walk reports
no overflow from it and drops what its item sources or layouts throw; the pass that shows the
subtree reports both. A component that throws while rendering is reported either way.

**Development checks report; they never throw.** Setting a component's own state while it
renders, two siblings sharing a key, and an `async` function passed to `useEffect` each produce
a `dev-warning` diagnostic, once per surface, and the runtime carries on exactly as it would
have.

## Two ways to write a screen

Components and JSX are the general form and the right tool for anything with state, routing or
reuse. Without a build step they degrade into nested `h("slot", {…})` with string tags and a
`null` for absent props, which for a plain shop menu is more ceremony than the screen deserves.

`ContainerFormData` is the other form: a fluent builder. It
matters that it is a **facade, not a second render path**: it emits the same element tree JSX
does, so the commit diff, deferred triggers, the anti-dupe guard and input ownership are
inherited rather than reimplemented. A builder with a render path of its own would have to be
kept in step with the tree by hand, and every feature would have to be built twice.

Two properties make it a facade rather than a snapshot:

- **Structure resolves eagerly.** `border`, `fill`, `rect` and `pattern` compute their indices
  when called, so a bad pattern throws while the screen is being written rather than mid-commit.
- **Contents stay lazy.** Any `item` may be a function, read inside the commit pass exactly as
  `<slot item={() => …}>` is — one signal, one slot, one write. Structural edits after `open()`
  are reactive too, through a revision signal `build()` reads.

`ContainerFormBuilder` (core) stops at `.build()`, so it is testable without a game;
`ContainerFormData` (platform) adds `.open(player)`. `.component(index, Comp, props)` is the
bridge back to the general form.

## Layout

A surface is a fixed grid, 9 columns wide. Layout is a cursor walk, not index arithmetic:
each leaf asks its enclosing frame for the next cell. A component can therefore emit any
number of leaves without its parent knowing the count.

- `row` / `box` — linear stepping; indices continue onto the next line naturally.
- `column` — steps by whole rows.
- `grid` — wraps at `columns`, and stays rectangular: a cell that would spill past the right
  edge is reported as overflow rather than silently wrapped.
- `index` on any element pins it absolutely and consumes no cell.
- `gap` and `columns` are integers. A fraction, `NaN` or an infinity is a `render-error`, like a
  throwing item source: that layout draws nothing, and still takes its cell in the parent.

Overflow and double-assigned indices are surfaced as diagnostics. Silent truncation reads as
"it worked" when it did not.

Those two are *structural* — they describe the shape of the tree, not something that happened —
so each distinct signature is reported once per surface. Repeating them on every commit floods
the log at one line per tick during an animation, which buries the diagnostics that really are
events. Errors (`handler-error`, `write-failed`) are events and keep reporting.

## Interaction semantics

The adapter reports a physical change; the commit-time slot map says what that slot is.

| Declaration | Meaning | Runtime behaviour |
| --- | --- | --- |
| `<slot item>` | decorative | restore the item |
| `<slot item onClick>` | button | play sound, invoke handler, restore the item |
| `<slot item={null} onClick>` | empty button | inert — no sound, no handler; the slot is still repainted |
| `<input initialItem>` | player-owned | seed once, then never overwrite; invoke `onPlace` / `onTake` / `onChange` |
| `<input item>` | controlled | the declaration is authoritative every commit; edits reach the source via `onChange` |
| undeclared index | not part of the UI | clear it |

**An empty button is not a button.** A slot whose item resolves to `null` has no control in it
to press, so it neither sounds nor fires — it is still repainted, so anything dropped on it
does not stay drawn. This matters because a button's *declaration* rarely changes while its
contents do: a shop slot that sells out or an auction lot that is bought keeps its `onClick`
and simply renders nothing. Without the rule, the only way left to interact with that square —
dropping an item into it — would answer with the purchase sound and a handler call for something
the player could not see.

`accept` on an input refuses an incoming item: the item is given back to the player and the slot
is left empty. If the slot held an item that the player's swap took out, that is reported as a
take. A throwing `accept` is reported and counts as accepting. Handlers run inside a batch, so
state they change produces one follow-up commit. A handler that throws is reported and does not
prevent the restore — a broken callback cannot leave a button missing from the surface.

**A UI-owned slot going empty is not yet a click.** The adapter defers it. An emptied slot
only means the item is *somewhere* — on the cursor mid-drag, in the player's inventory, in
another slot, on the ground — and firing on disappearance runs the handler for a gesture
still in progress while repainting the slot underneath it, which is also the moment a
duplicate exists. So the take is held until the item is **located**:

- in another slot of the same container;
- in the player's inventory;
- on the ground (the item guard routes that one back);
- on the cursor, where a marked copy is taken straight out of the player's hand;
- in an input, where it is taken back out because a copy is never a deposit;
- among what the inventory sweep removed, when the sweep got there before the pass.

Then the stray copy is reclaimed and the trigger fires exactly once. Touch controls use no cursor
(the API documents `PlayerCursorInventoryComponent` as "not used with touch controls"), so there a
tap moves the button straight into the inventory. Until the item is located the slot stays empty,
which is the honest picture: the item is in transit.

**The player's inventory is diffed only when it may have changed.** Locating a taken copy, and
finding where an inserted item came from, both compare the viewer's inventory against an
earlier state. Run on every pass, that diff would be the larger half of the scan's cost. A
pass runs it only when one of these holds:

- the `playerInventoryItemChange` event reported a change;
- a gesture is in flight;
- `maxPendingTicks` passes have gone by since the last diff (a resync).

The event says *that* something changed, never *what*, so a late or missing event delays the
diff instead of misleading it.

A take that is never located is **abandoned rather than fired** — the engine destroyed the
item, so there is no copy to reclaim and no finished gesture to report. The slot is quietly
repainted after `MAX_PENDING_TAKE_TICKS`.

The reverse is a trigger too: an item pushed *into* a UI-owned slot is not a deposit, because
that slot is a control. It goes back to the exact inventory slot it came from and the
interaction is reported, so handlers still see the gesture. If the inventory has no room the
item drops at the player's feet. Only when even that fails is it left in the
slot and *not* reported — a visibly wrong slot is recoverable, a destroyed item is not.

**A swap is one gesture, so it is one trigger.** Dropping your own item onto an occupied
button makes the slot lose the button and gain the item at the same time, and leaves the
button on your cursor. Only the insertion is reported; the displaced button is tracked purely
so its copy can be reclaimed wherever it lands, and locating it fires nothing. Two constraints
shape this: the pick-up and the click land on *different ticks*, so the record of which
inventory slot the item left has to outlive the pass that saw it; and the reclaim-only half
does not repaint its slot on abandonment, since the insertion already had the core repaint it.

**A repaint ends any gesture in flight on that slot.** A deferred take is bound to the slot as
it was declared when the item left it, so if the screen navigates — or any signal repaints that
index — the button the player lifted no longer exists. `writeSlot` therefore demotes pending
takes on that index to reclaim-only: the copy still comes back off the player, but nothing
fires, because firing would deliver a click meant for one screen to whatever the next screen
put there.

None of this applies to `input` slots, whose takes and places are the player's own and stay
immediate. The core tells the host which slots those are through `setPlayerWritableSlots`, at
the start of each commit, before its writes; without that, the library would reclaim items players
legitimately withdrew from a mirrored chest. It also means a mirrored chest never has a
gesture in flight to go stale when another viewer navigates — the stale-gesture case is
specific to UI-owned slots.

A **controlled** input is how an external container is mirrored into the surface: the external
source stays the truth, and the declaration is re-applied on every commit. If `onChange` fails
to write the edit back to that source, the item visibly snaps back rather than the two drifting
apart in silence. One piece of plumbing makes that work: a player's
edit changes no signal, so the commit has no reason to re-run and check on its own. An interaction
revision signal, read by the commit and bumped after input handlers, puts physical edits inside
the same reactive loop as everything else.

## The Bedrock adapter

The mechanism: spawn an invisible rideable entity, switch its inventory to the requested size
via a `containerui:open_<size>` event, mount the player, and let the client render that
inventory as a chest screen. The title's first characters select the JSON UI grid variant:
`RP/ui/chest_screen.json` matches the title prefix, and the generated `ui/container.json`
defines the grid of each size.

The scan loop compares physical slots against expected state using three primitive comparisons —
`typeId`, `amount`, `nameTag` — and allocates only when something actually differs. The platform
holds no callbacks, pending-restore tables or page maps; those belong to the core.

The probes go through `ContainerSlot` handles kept across passes, which read those three fields
without the full copy `getItem` makes of every stack. The viewer's inventory is diffed only on
the passes that can need it: its change event fired, a gesture is in flight, or a resync is
due. Once the viewer has done nothing for a second, the scan runs every other tick.

The adapter is split by concern, one folder each under `src/platform/`. `constants.ts`, `index.ts`
and `lifecycle.ts` sit at its root. Every world subscription and timer an install function makes
goes through `lifecycle.ts`, so `uninstallBedrockRuntime()` can undo all of it. After an
uninstall, the next `installBedrockRuntime()` or `openContainer` installs everything again, block
containers registered at startup included.

| Folder | Module | Owns |
| --- | --- | --- |
| `surface/` | `surface.ts` | the entity, writes, the host-adapter contract, closing |
| `surface/` | `surfaceScanner.ts` | the scan loop, its pace and cost, `measureScanCost` |
| `surface/` | `openContainer.ts`, `mountSequence.ts`, `openForm.ts` | opening a menu for a player; `openForm.ts` holds the `ContainerFormData` class |
| `surface/` | `surfaceOptions.ts` | the options a surface is opened with |
| `surface/` | `runtimeInstall.ts` | installing the scheduler and timers, the default diagnostic sink |
| `surface/` | `closeSettlement.ts` | what closing owes the player |
| `surface/` | `writtenSlots.ts` | what was written into each slot, in the forms the scan and restores need |
| `surface/` | `surfaceRegistry.ts` | open surfaces by entity and player, close routing |
| `scan/` | `scanPass.ts` | the interaction tracker: what a change means |
| `scan/` | `pendingTakes.ts` | takes waiting to be located, collect-all detection |
| `scan/` | `playerInventoryDiff.ts` | the inventory snapshot, origins, the diff gate |
| `scan/` | `slotMatching.ts`, `trackerTypes.ts` | item comparison, shared shapes |
| `scan/` | `viewerInventory.ts` | the player's inventory, cursor and sweeps |
| `scan/` | `conflictRevocations.ts` | winning back what a refused take handed the viewer |
| `scan/` | `heldGround.ts` | ground events that arrived before the take they resolve |
| `scan/` | `lookalikeWatch.ts` | a player's stack swapped onto a button it reads exactly like |
| `scan/` | `scanPacing.ts`, `slotHandles.ts`, `inventoryChanges.ts` | pace and meter, handles, the change event |
| `block/` | `blockContainer.ts`, `blockRegistry.ts` | registering a block container; shared state and the log |
| `block/` | `blockHooks.ts`, `blockMenu.ts` | what the block does when placed, clicked and broken; opening its menu |
| `block/` | `blockEvents.ts`, `blockKeys.ts`, `blockSessions.ts` | the records written; block keys; who has a storage entity open |
| `block/` | `blockStorage.ts` | a storage entity's inventory as a `SlotStorage` |
| `block/` | `blockSneak.ts` | sneak-to-break |
| `block/` | `storageAccess.ts` | how a click on a storage entity is answered (natively, or by a menu), who has it open, and the log of it |
| `block/` | `storageRemoval.ts` | removing a block's storage entity, and finding orphaned ones |
| `items/` | `itemConversion.ts`, `itemGuard.ts`, `itemMarker.ts` | `ItemStack` ↔ `ItemView`, the anti-dupe guard, the invisible marker |
| `items/` | `shulkerReader.ts`, `shulkerLeftovers.ts` | shulker contents; the record and sweep of blocks a cut-short read leaves |
| `items/` | `lootItems.ts` | items built by a loot table |
| `storage/` | `entityInventoryStorage.ts`, `playerStorage.ts`, `containerWatch.ts`, `inventoryContainer.ts` | the shared base of entity storages, a player's inventory as a `SlotStorage`, the external-change watch, reading a container |
| `world/` | `worldHooks.ts`, `persistence.ts` | `useScore` and `useDynamicProperty`; dynamic-property backends |

Rendered items carry an invisible marker, because they are real `ItemStack`s in a real
container and can therefore escape — into a player's inventory when a grab races the scan, or
into the world if the player simply throws one. Left alone, that is a duplication exploit: the
surface repaints the button on the next pass and the copy is free.

Three layers answer it, and each
covers what the others structurally cannot:

- **A world-level item guard** (`src/platform/items/itemGuard.ts`). Any loose item carrying the
  marker is destroyed the moment it exists, on `entityItemDrop` (a player threw it) and on
  `entitySpawn` (it got there any other way — a death drop, a broken container, a script).
  `entitySpawn` fires for every entity in the world, so the handler rejects non-item entities
  on a `typeId` compare before allocating anything; `getItemGuardStats()` reports what it
  actually inspected and destroyed, so the cost is measured rather than assumed.
- **The close-time inventory scrub.** Copies sitting in an inventory rather than on the
  ground — the container, the worn slots and the off hand — swept on close and on the
  liveness check. A marked copy still on the cursor when the surface closes is cleared first,
  since closing ends the gesture that could have reclaimed it. Opening or closing any block
  or entity container sweeps it and whoever did it: a copy moved into a chest is somewhere no
  other sweep looks. A menu's own entity is skipped by type.
- **Refusal.** Using a marked stack, using it on a block or an entity, and placing it are
  cancelled at the before-event. The sweeps work in ticks; in those ticks a copy placed as a
  block could be mined back as a real one.

Rendered stacks are deliberately left *unlocked*. `ItemLockMode.inventory` would let the
engine refuse the drop outright, but the engine stamps a lock badge on every locked stack — a
red marker on every button in every menu. A UI library cannot pay that; refusing the *use* of a
marked stack costs nothing visible, which is why the third layer is event cancellation rather
than the lock.

The marker follows the slot's owner as well as the item's origin. A conjured view is always
marked. A real item — a view carrying `native` — is written unmarked only into a slot the player
owns, an `input`; into any other slot it is marked, because a real item *shown* on a button is
still only shown. Marking every real item would destroy items players legitimately withdrew
from a mirrored chest; marking none would leave a thrown copy of a shown item free. The core
declares which slots are inputs at the start of each commit, before its writes, so the first
write already knows.

A closing surface settles and hands back. Input slots whose contents changed after the last
scan are reported through the core while it is still mounted — a take from a chest mirror in
the closing tick reaches the storage instead of leaving the item in two places. Real items left
in UI-owned slots or unmirrored inputs go back to the player, and the container is emptied
before the entity is removed.

**The marker is a dynamic property, not a lore line**, and that is a visual decision as much as
a technical one. An item described as `{ typeId: "minecraft:diamond" }` must render as an
ordinary diamond — the runtime writes no name and no lore it was not given, so the vanilla ones
show. A lore line that renders as nothing still takes a row in the tooltip, so a lore marker would
leave a blank strip under every plain item. Dynamic properties live in the stack's NBT, survive
cloning and container moves, and show the player nothing. The lore marker is always *detected*,
so a menu item that carries only that marker is recognised too, and it is *written* as the
fallback on stackable items, where the engine drops the dynamic property (see Item metadata).

Reading a shulker box's contents places the box in the world for a moment. A read that is cut
short records the dispenser, the redstone block and every place the shulker can land; the next
read, or `sweepShulkerLeftovers()`, empties and removes them.

## Item metadata

`ItemView.tags` is invisible per-item data — Bedrock dynamic properties on the stack. It is for
facts *about* an item that must not be part of how it looks: which auction listing it belongs
to, who deposited it, whether it is soulbound.

Lore is the wrong place for all of those. It is visible, a player can copy it onto another item,
and it changes what the commit diff considers a different item. `areItemsEqual` therefore
ignores `tags` on purpose, exactly as it ignores `native`: equality is about what the player
sees, and invisible metadata changing must not cost a physical write.

**`tags` only work on items that do not stack.** An engine cannot let two items sharing a stack
carry different per-instance data, so `setDynamicProperty` on anything with a max stack above
one is accepted and discarded — measured, not inferred. A sword, a piece of
armour or an elytra keeps its tags; a stack of apples does not, and there is no fallback,
because the whole value of `tags` is being invisible and lore is not. The runtime warns once
per item type rather than losing the data quietly. If the data must survive on a stackable
item, keep it in your own store keyed by slot or listing id — which is what a listing table is
anyway — and let the item stay an item.

The anti-dupe marker faces the same limit and answers it differently, because it *can*: it
falls back to a lore line where the property will not stick, since a marker that is sometimes
absent is a duplication exploit while one that is sometimes visible is only ugly.

`ItemView.enchantments` and `ItemView.durability` are visible facts, and honest ones: exactly
the enchantments asked for, and remaining durability, applied only where the engine allows it
and skipped with one warning per item type where it does not — a diamond takes neither. Both
are read back from real items, so the diff notices when one sword is swapped for a differently
enchanted one, and a display copy keeps its glint. On a view carrying `native` they describe
the stack rather than instruct it: the payload is the item.

Two more fields cover what the legacy **data values** carried, which the script API does not
expose. `ItemView.potion` names an effect and a delivery, and the engine builds the bottle from them
(`Consume`, `ThrownSplash`, `ThrownLingering`; no delivery builds an arrow). `ItemView.blockStates`
builds a block item from its permutation, for the variants that really are block states — a bed's
colour is not one. What neither reaches, a tipped arrow or a map variant, is built by a loot table
the consuming pack ships, rolled through `itemFromLootTable`, whose `set_data` function sets the data
value.

The counterpart is display-only decoration. `StorageView`'s `decorate` hook rewrites the
*rendered copy* of a stored item without touching what is stored — which is what an auction
listing is: the storage holds the seller's original item, the view adds a price and a seller
line. Nothing has to be stripped when someone buys, because the listing lines were never on the
item. Writing them into the item and stripping them later would mean reconstructing it, and a
reconstruction loses whatever it does not know about.

## Block containers

A block-bound container is a custom block and an invisible storage entity filling it. By default
the engine opens the entity's inventory itself; a block drawn with `render` adds a surface that
mirrors that inventory. The inventory **is** the state: Minecraft persists
it natively — enchantments and NBT included — so there is no serialiser anywhere in the library.

The mirror is built from core primitives. `SlotStorage` is the core-side
interface (read a slot, write a slot, a version signal that announces change); `StorageSlots`
renders a range of controlled inputs over one — the declaration is authoritative on every
commit, and a player's edit reaches the storage through `onChange`. `BlockStorage` implements
the interface over the storage entity's container, one shared instance per entity, so every
viewer of the same block repaints through the same signal and multiplayer sync is nothing but
reactivity.

Two platform rules make the item flow safe. A view read from a physical slot carries a clone of
its real stack in `ItemView.native` — opaque to the core — and writing that view writes the
clone, so a stored sword comes back out with its enchantments. And the invisible marker is
never applied to a native-backed item in a mirrored slot: the close-time inventory scrub
destroys escaped marked copies, and an item legitimately taken out of a chest must not be one
of them. The same item shown on a button elsewhere on the screen *is* marked — see the marker
rule under The Bedrock adapter.

`registerBlockContainer` ties it to the world. Place spawns the storage entity, which fills its
block. By default the entity takes the click and the engine opens its inventory the way it opens
a chest's, with no surface at all (`storageAccess.ts` logs who has it open). A block drawn with
`render` opens the mirror above as a menu instead. Break closes every viewer, drops the real
stacks and removes the entity. An optional reference-counted poll runs while a menu is open to
notice out-of-band edits and a dead entity; its cost is measured and reported per close, like
everything else here.

## Distribution

Bedrock runs each behaviour pack's scripts in its own context. There is no shared global —
`globalThis` does not cross pack boundaries — so a library **cannot** be published as a
separate add-on that others depend on at runtime. There is no object to hand across.

A pack has no bundler, the game has no `node_modules`, and it resolves no extensionless paths.
A pack without a bundler therefore receives the library as a **source tree copied into it**.
Projects that do bundle install the same tree from npm as the `containerui` package, with `.`
(everything), `./core` (the platform-free core) and `./jsx-runtime` subpaths. JSX requires that
route, since the transform emits an import of `containerui/jsx-runtime` that only a bundler can
resolve.

Three rules keep the tree loadable, and all three are machine-checked:

- Every relative import ends in `.js`. Enforced by `moduleResolution: "Node16"` at compile
  time and by the layer check on the source.
- The only bare specifiers allowed are `@minecraft/*`, because those are the ones a pack
  manifest can declare. Anything else fails `npm run check:layers`.
- Only `src/platform/` may use them.

This is why the library is one tree rather than two npm packages. Split into `@containerui/core`
and `@containerui/bedrock`, the emitted adapter would contain `import { … } from
"@containerui/core"`, which resolves under Node and never in the game. Folders plus the check
give the same isolation and produce an artifact that loads where the tree is copied.

`tools/smoke/vendored.mjs` closes the loop: it copies `dist/` to a temporary directory and
drives it through Node's real ESM loader — mount, signal update, click, restore, unmount. A
bad specifier fails there, not on someone's server.

## Pack assets

The runtime cannot render without two generated artifacts: the surface entity, whose
`containerui:open_<size>` events swap its inventory component, and the JSON UI, which selects
a grid layout by matching the first six characters of the entity's name tag.

Both ship as two **shared packs that hold no script**, ContainerUI BP and ContainerUI RP, with
UUIDs that never change. A world installs them once and every add-on built on the library depends
on them by UUID. Scripts cannot be shared between packs, so each add-on still carries the library;
entities and UI files are the part that can be shared. A world loads the first copy of an entity id
or a UI file by pack order and skips the rest with a warning, so with a copy in every add-on the
version in use would be whichever pack is listed first.

`tools/generate-pack.mjs` emits both for every supported size, importing `SUPPORTED_SIZES`
and `SIZE_TITLE_PREFIX` from the compiled runtime. One array drives the runtime's constants,
the sixteen entity component groups and the sixteen JSON UI variants, so they cannot drift
apart.

## Navigation

The router is `src/core/components/router.ts`. It is built from a `signal` holding the stack, the
context hooks, `h` and one component (`Routes`), and it never touches the host: navigation is
ordinary reactive state.

The route stack is a signal; `Routes` reads it during the render pass. Navigating therefore
invalidates the commit effect exactly like any other state change, and the reconciler rewrites
only the slots that differ — measured at one write for a one-slot screen change. Navigation
changes the route signal and the surface stays open, so there is no new mount sequence and no
blink.

A screen's identity is keyed on the route name, so hook state is discarded when navigation changes
the route, even when two routes share one component. Navigating to the same route name with other
params keeps the component and its state, with new props; a visit that must start fresh keeps its
state in `useRouteState` or keys an inner component by the param. State that must survive belongs
in a store, which is the same rule React has and for the same reason.

## Animation

An animation that wrote to the container directly would be a second render path, racing the
first: a `setItem` per slot on a growing delay, and a table of pending restores so the scan does
not read a half-drawn frame as a player's click.

An animation therefore only moves a signal. `useReveal` holds one integer, the elapsed step count,
plus a pure `index → step` table; each slot asks whether its turn has come. The commit effect
reads those answers, so a step invalidates the pass and the diff writes precisely the slots
that just appeared. A 54-slot reveal costs 54 writes in total, one per slot, and the component
never re-renders — provided `isVisible` is read inside an item thunk rather than in the
component body.

Timers come from a `TimeSource` installed alongside the scheduler (`system.runInterval` on
Bedrock, a controllable stub in tests), which is why every animation behaviour above is unit
tested: reveal ordering, cadence, one-write-per-slot, timer disposal on unmount, and the timer
stopping once the reveal completes.

There is no fallback time source on purpose. Treating a microtask as a tick would make every
animation run at the wrong speed while appearing to work.

## Measured cost

Numbers from a real world, not estimates. Collected with the diagnostic add-on in
`examples/diagnostics/`, which reports them on every close. They come from one machine and one game
version: read them as the order of magnitude, not as a guarantee.

**Opening.** The surface inventory reaches its requested size in **0–1 ticks at every
supported size, including 126**. This is why the mount sequence waits for the condition
rather than a duration: a fixed 30-tick delay would add roughly a second and a half of
latency the engine never needs. First paint is 3–5 ms when the
inventory is ready on the same tick; a 126-slot surface adds about 20 ms of commit on top.

**Writes.** The diff does what it claims. A 126-slot menu costs 126 writes to paint and then
exactly **one write per button press** — five clicks produced `writes=131`. A 27-slot hub
reports the same write count on every open, so nothing is being redundantly rewritten. Two
hundred state changes inside one tick collapse to a single commit.

**Scanning.** This is the standing expense of the polling design. Interaction handlers run
*synchronously from inside the pass*, so `scanStats` reports `detectionMs` and `handlerMs`
separately — the first is the library's cost, the second is the consumer's. In the runs below
handler cost was negligible (3 ms against 303 ms of detection), so the detection figures are
the library's own.

| Surface | Occupied | Detection per pass |
| --- | --- | --- |
| 27 slots | 26 | ~0.8 ms |
| 54 slots | 17 | ~0.8 ms |
| 54 slots | 50 | ~1.4 ms |
| 126 slots | 126 | ~2.2 ms |

The per-pass figures overstate a sub-millisecond pass: they add up 1 ms clock samples taken at a
fixed point in the tick. Timed back to back with `measureScanCost`, a fully occupied 27-slot pass
costs about 0.5 ms, because the slot probes use kept handles and the inventory diff is gated on
its change event. Two levers exist for heavy servers. A menu nobody is touching is scanned every
other tick after a quiet second (`idleScanIntervalTicks`, default 2), which costs at most one tick
on the first click after the pause. And `scanIntervalTicks` slows every pass, for a screen that can
afford the latency on every click.

Two things this table deliberately does not claim. It does not give a per-slot coefficient:
`Date.now()` resolves to 1 ms while a single pass takes about that long, so a derived per-slot
figure ranges from 18 to 48 µs across these samples and is measurement noise, not signal. And
it does not explain the whole shape — occupancy clearly matters (17 versus 50 occupied at the
same size is 0.8 versus 1.4 ms, since an occupied slot needs three native property reads while
an empty one needs none), but a linear fit over these four points does not hold, and four noisy
points support no model. Establishing one would take a dedicated benchmark holding occupancy
fixed over several hundred passes. The per-pass range above is what the evidence supports; it
places a pass well inside the 50 ms tick budget.

## What it does not do, and why

Each of these is left out on purpose.

- **No virtual DOM or fiber reconciler.** A surface holds at most 126 slots; at that size a
  dependency graph beats a tree walk, and one signal → one slot → one write needs no memoisation.
  The hook API is kept because it is the one people know.
- **No `React.memo`-style API, transitions or concurrent rendering.** Props are compared shallowly
  and `useMemo` caches values. The commit already writes only the slots that changed, and the
  measured cost is the scan, not rendering.
- **No chest-skinned `server-ui` form.** A form is drawn once per show and cannot change while open,
  and it cannot hold a real item, so a storage built on it has to serialise every item by hand.
- **No separate add-on shared between packs.** `globalThis` does not cross behaviour packs, so the
  library is copied into the pack that uses it (see [Distribution](#distribution)).
- **No messages in chat.** `sendMessage` is refused in the read-only window, where a report matters
  most. Diagnostics go to the console through the logger as `kind: message`; trace lines are
  `key=value` and silent unless `onTrace` is set.
- **No `ItemLockMode` on rendered items.** `inventory` draws a lock badge on every button, and `slot`
  forbids the very move the scan reads as a click. Use of a marked stack is refused instead.
- **No look-alike items for glint or a durability bar.** `enchantments` and `durability` apply where
  the engine allows and warn once per item type elsewhere; a custom item of your own does the rest.
- **No lore fallback for `tags` on stackable items.** Invisible is the feature, and lore is visible.
  Data a stackable item must carry belongs in a store keyed by listing or slot.
- **No second surface for dialogs.** A `Layer` writes a few slots of the same surface; a second
  entity would mean a second open sequence and a screen flicker.
- **No locked inputs under a modal.** Putting an item back while it sits on the player's cursor
  would duplicate it, so inputs stay live and `Confirm` reads its value again when "yes" is pressed.
- **No warning for unkeyed lists.** `h` stores static children as an array too, so the check would
  fire on correct code. The development checks that do exist warn once and never throw.

## Testing strategy

`createTestHost()` implements `HostAdapter` in memory and records every write. Combined with
`createManualSchedulerHost()`, which only advances when told to, every behaviour in the
stack is deterministic: reactivity, hook order, keyed reconciliation, click semantics,
input ownership, budget yielding.

Tests assert on `host.writes`, not just on final state. Final state proves correctness;
write count proves the diff is doing its job — and write count is what costs tick budget in
production.
