# Changelog

Every public release, newest first. Breaking changes are listed under their own heading.

## 1.0.0-beta.3 - 2026-10-12

The shared packs are unchanged and stay at version `1.0.1`.

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
