# Changelog

Every public release, newest first. Breaking changes are listed under their own heading.

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
