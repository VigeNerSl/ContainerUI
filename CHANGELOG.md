# Changelog

Every public release, newest first. Breaking changes are listed under their own heading.

## 1.0.0-beta.4 - 2026-10-18

The shared packs are now version `1.0.2`: they add the entity behind storages opened by click, and the
menu entity's seat moves into a component group a menu opened by click removes. Install the new packs
with this release.

### Breaking

- **`CloseReason` gains `"timeout"`**: a menu opened by click that was never clicked. An exhaustive
  `switch` over close reasons needs the branch.
- **`ShulkerReadEvent.kind` gains `"written"`**, reported by `writeShulkerContents`. The same goes for
  an exhaustive `switch` over it.

### Added

- **Storages opened by click.** `installHeldItem` makes an item open a storage when a player sneaks
  with it in hand; `openHeldStorage` opens one from your own code. An entity in the player's head shows
  the storage's contents, the player's click opens it as the game's own chest, and every change is
  written into the storage in the tick it happens. The storage keeps the items throughout and the
  entity's copy is never handed out, so a restart or a crash copies none; a crash rolls the player
  and the storage back together to the game's last save. A player who leaves with the screen open has
  the screen as they left it written into the storage when they come back, so a take in their last
  moment is not kept twice. Sources: `shulkerBoxSource()` (the shulker box in hand, locked in its slot
  while open), `enderChestSource()`, or your own `HeldSource`; `registerHeldSource(kind, { release,
  resume })` says how a kind of your own cleans up after an open cut short. `matches(item, player)`
  decides per player, such as only for players with a tag. Types: `HeldSource`, `HeldWriteResult`,
  `HeldKind`, `HeldRelease`, `HeldResume`, `HeldReport`, `HeldItemOptions`, `HeldStorageOptions`,
  `HeldOpenOptions`, `HeldOpenEvent`. See [Storages opened by click](documentation/guides/held-storage.md).
- **`openBy: "click"`.** A menu can open without the inventory key: its entity spawns in the player's
  head, or at a point given by `clickAt`, and the player's click on it opens the screen. Nobody is
  seated, and the entity has no seat, since a click on a rideable entity seats the player instead. A
  click by another player is cancelled, and a menu never clicked closes with `"timeout"` once
  `clickWaitTicks` (default `CLICK_OPEN_WAIT_TICKS`, 100) have passed, within the 10 ticks the
  watchdog takes, refusing a click meanwhile. An `openBy` other than `"seat"` or `"click"`, and a
  `clickAt` that is not `"head"` or a point, throw a `RangeError`. The default, `"seat"`, is unchanged.
  Types: `SurfaceOpenMode`, `SurfaceClickPoint`.
- **`PlayerEnderStorage`**, a player's ender chest as a storage, and `enderContainerOf(player)`.
- **`writeShulkerContents`**, which makes a shulker box item holding the contents you give it, in one
  tick. Another shulker box is refused and returned in `leftovers`, as the game refuses it, and so is
  an item no stack can be made from. Type: `ShulkerWriteResult`.
- **`EntityInventoryStorage._containerOf(entity)`**, a protected member, so a storage can keep its
  items in another of the entity's containers.

### Fixed

- **The player's own items no longer vanish when a sweep has no room for them.** A copy of a menu
  button in a bundle is taken out with the player's own items left in place; those that did not fit
  back were reported lost and gone. They now go to the player's inventory, and what does not fit there
  drops at their feet, or at the centre of the block for a container's sweep, only once the cleaned
  bundle is written.
- **Fixed a duplication through a thrown bundle.** A thrown bundle holding a copy is replaced by a
  clean one; if the thrown one could not be removed, both stayed. The clean copy is now taken back
  then.
- **Fixed menu items surviving a restart.** The anti-duplication guard was installed by the first
  menu, so after a server restart a player who joined before anyone opened a menu was never swept,
  and a copy in their inventory, or in a bundle there, survived. `installBedrockRuntime()` now installs
  the guard, and the guard sweeps every player already in the world on the next tick, which also
  covers a script reload. It sweeps the player's ender chest too.
- **A block's storage is released when its seated menu closes**, instead of staying in memory until
  the block was broken.
- **A click on someone's menu entity is now cancelled** for any other player, in both open modes, and
  so is the viewer's own click before their menu is ready.
- **A menu entity a restart left behind keeps no player's item when the engine refuses to remove
  it:** the items it held still go back to its viewer.

### Changed

- `installBedrockRuntime()` also installs the hooks of storages opened by click, which settle what an
  open cut short left: copies in the world, a screen a player left open, and a shulker box still
  locked on a player who joins.
- The item guard and the scan read less per tick: a plain item costs one read in the guard, a slot's
  type is compared before the whole stack, and container sizes are read once per pass.

## 1.0.0-beta.3 - 2026-10-12

The shared packs keep version `1.0.1`. The settings text of ContainerUI BP now shows the pack version
rather than the library's, so a release that leaves the packs alone builds them byte for byte the same.

- **Fixed a duplication through bundles.** A menu button put in a bundle stayed there as an item:
  the sweeps never looked inside storage items, so the menu repainted the button and the copy
  survived. The sweeps now open bundles, nested ones included, in the inventory, the worn slots and
  the off hand, in containers the guard sweeps, and on the cursor. A bundle on the cursor goes to the
  inventory once cleaned, since the cursor cannot be written. A bundle thrown with a copy in it is
  replaced by a clean one. The player's own items in the bundle stay.
- **Fixed a duplication through a real bundle on a button.** A button showing a real bundle
  (`native`) held real items, which a player could take out of it in the slot, again after every
  repaint. Every item in a storage item on a button is now marked, so what comes out is a copy; the
  tooltip still lists the contents. A bundle button that changed is written again.
- **Fixed the loss of an item put in a bundle on a button.** It went down with the button when the
  button was reclaimed or the menu closed. A check every half second now gives it back and repaints
  the button, and repaints, reclaims, sweeps, the world guard and closing take it out first.

## 1.0.0-beta.2 - 2026-10-12

The shared packs are version `1.0.1`. Their version is now counted apart from the library's and goes
up whenever a release changes them, so a game that kept pack `1.0.0` downloads or imports the new one.

- **Hover text on touch.** On a phone, a slot now shows its name and lore under the finger, in
  ContainerUI menus and in vanilla container screens: chests, the inventory, furnaces and the rest.
  Before, a menu button's lore never showed on touch, since a tap is a click. The ContainerUI RP
  gains `ui/ui_common.json`, which changes the vanilla `common` namespace: the held item's own hover
  text, the selected slot frame and the item details panel are hidden, since they repeated it.
- **Mouse scrollbar on touch.** Scrolling container grids (menus from 63 slots, the recipe book, the
  creative inventory) use the mouse scrollbar on every device, and a swipe over the grid moves the
  hover instead of scrolling. The touch scrollbar did not fit the menu's scrollbar backdrop.

## 1.0.0-beta.1 - 2026-10-10

First public release.

- **Reactivity and scheduling:** signals, computeds and effects with ownership scopes, and a
  scheduler that coalesces writes and yields within a per-flush budget (8 ms by default), so the
  server keeps its 50 ms tick.
- **Components:** JSX or `h()`, keyed reconciliation, context, and hooks — `useState`,
  `useSignal`, `useReducer`, `useComputed`, `useMemo`, `useRef`, `useCallback`, `useId`,
  `useEffect`, `useContextSelector`, `useResource`, `useExternal`.
- **Building blocks:** `Routes` with `useRouteState`, `ErrorBoundary`, `Suspense`, `Layer`,
  `Modal`, `Confirm`, `PagedList` with `usePagination`, `QuantityPicker`, `StorageSlots` and
  `StorageView`; `useReveal`, `useTween` and `useTicker` for animation.
- **`ContainerFormData`:** a fluent builder that emits the same tree as JSX.
- **Bedrock adapter:** menus from 1 to 126 slots, one click per gesture with a mouse or on touch,
  an anti-duplication guard, and a slower scan while a menu is idle.
- **Block containers** that open like a chest or show a menu, **persistence** with versioned
  records, the **shulker reader**, storages over player and entity inventories, and `useScore` /
  `useDynamicProperty`.
- **Checked arguments:** stores, reveals, layout frames and storage ranges throw `RangeError` for
  sizes, widths and ranges that cannot work, instead of hanging or writing nothing.
- **Items:** enchantments, durability, potions, block states, invisible `tags`, real items through
  `native`, and `itemFromLootTable` for what only a loot table can build.
- **Shared packs:** ContainerUI BP and RP hold the menu and storage entities, the screen layouts and
  the flat glass blocks, with no scripts and fixed UUIDs. A world installs them once, and every add-on built on the library
  depends on them. `npm run generate:pack` builds them; the npm package ships them.
- **Flat glass:** seventeen flat glass blocks in the shared packs (`containerui:flat_glass` and one
  per dye colour) that fill a menu slot as a seamless tile.
- **User guide** in `documentation/`.
