# ContainerUI documentation

ContainerUI is a reactive UI library for Minecraft Bedrock container screens. You describe what a
chest-style menu should show; the library works out the smallest set of slot writes to get there,
watches what the player does to the slots, and calls your handlers once per finished gesture.

This folder is the user documentation. It explains every public API, the rules behind it, and
the Bedrock behaviour you will run into. The repository's `ARCHITECTURE.md` explains *how* and *why*
the library is built; you do not need it to use it.

## Where to start

| You want to… | Read |
| --- | --- |
| Put the library into a behaviour pack and open a first menu | [Installation](getting-started/installation.md), then [Your first menu](getting-started/first-menu.md) |
| Write menus without a build step, in plain JavaScript | [Your first menu](getting-started/first-menu.md) and [The fluent builder](guides/fluent-builder.md) |
| Understand how a screen is described | [Elements and layout](guides/elements-and-layout.md), [Components](guides/components.md) |
| Keep state and react to it | [Reactivity](guides/reactivity.md), [Hooks](guides/hooks.md) |
| Handle clicks, sounds and slots the player fills | [Interaction](guides/interaction.md) |
| Show a chest, a block inventory or a player's inventory | [Storage and mirroring](guides/storage-and-mirroring.md), [Block containers](guides/block-containers.md) |
| Save data between sessions | [Persistence](guides/persistence.md) |
| Build a multi-screen menu | [Navigation](guides/navigation.md) |
| Show long lists, pick quantities | [Lists and quantities](guides/lists-and-quantities.md) |
| Show dialogs and confirmations | [Layers, modals and Confirm](guides/layers-and-modals.md) |
| Load data asynchronously | [Async data and Suspense](guides/async-data.md) |
| Animate a menu | [Animation](guides/animation.md) |
| Read scores and dynamic properties | [Outside state](guides/outside-state.md) |
| Put real or decorated items on the screen, or an item Bedrock tells apart by a data value (potions, block variants, loot-only items) | [Items](guides/items.md) |
| Draw a seamless border or backdrop | [Flat glass](guides/flat-glass.md) |
| Read a shulker box's contents | [Shulker reader](guides/shulker-reader.md) |
| See what went wrong | [Errors, diagnostics and logging](guides/errors-and-diagnostics.md) |
| Test menus without starting the game | [Testing](guides/testing.md) |
| Tune the Bedrock runtime or open menus at a low level | [The Bedrock runtime](guides/bedrock-runtime.md) |
| Serve several players at once | [Multiplayer](guides/multiplayer.md) |
| Keep a server fast | [Performance](guides/performance.md) |
| Render onto something other than Bedrock | [Custom hosts and schedulers](guides/custom-hosts.md) |
| Look up one function | [API reference](reference/README.md) |
| Find a potion effect id, or a tipped arrow's data value | [Potion effects](reference/potion-effects.md) |
| Fix a problem | [Troubleshooting](troubleshooting.md) |
| Look up a term | [Glossary](glossary.md) |

## Contents

### Getting started

- [Installation](getting-started/installation.md) — the two ways to add the library to a pack,
  the shared ContainerUI packs, the manifest, and the startup call.
- [Your first menu](getting-started/first-menu.md) — a counter, in JSX and with `h()`, then a
  small shop, in JSX and with the fluent builder.
- [JSX and `h()`](getting-started/jsx-and-h.md) — how the two syntaxes map onto each other, and
  the TypeScript setup for JSX.

### Guides

- [Elements and layout](guides/elements-and-layout.md) — `slot`, `input`, `box`, `row`, `column`,
  `grid`, indices, flow, gaps, keys, overflow and collisions, and the layout helpers.
- [Components](guides/components.md) — function components, props, children, when a component
  renders again, identity and keys.
- [Reactivity](guides/reactivity.md) — signals, computeds, effects, batching, untracking, scopes
  and the scheduler.
- [Hooks](guides/hooks.md) — every hook, with its rules.
- [Interaction](guides/interaction.md) — buttons, sounds, inputs, `accept`, `takeBack` and
  `giveBack`, and how Bedrock clicks are detected.
- [Storage and mirroring](guides/storage-and-mirroring.md) — `SlotStorage`, `StorageSlots`,
  `StorageView`, player inventories and your own entity storages.
- [Persistence](guides/persistence.md) — `ChunkedStore`, `JsonStore`, migrations, world and entity
  backends.
- [Context](guides/context.md) — passing values down without props.
- [Navigation](guides/navigation.md) — the router, screens, layouts and route state.
- [Lists and quantities](guides/lists-and-quantities.md) — `usePagination`, `PagedList`,
  `QuantityPicker`.
- [Layers, modals and Confirm](guides/layers-and-modals.md) — content on top of the menu.
- [Async data and Suspense](guides/async-data.md) — `useResource` and `Suspense`.
- [Animation](guides/animation.md) — `useTicker`, `useReveal`, `useTween`, and the time source.
- [Outside state](guides/outside-state.md) — `useExternal`, `useScore`, `useDynamicProperty`.
- [The fluent builder](guides/fluent-builder.md) — `ContainerFormData` and `ContainerFormBuilder`.
- [Block containers](guides/block-containers.md) — custom blocks with an inventory, opened natively
  or as a menu.
- [Items](guides/items.md) — `ItemView`, tags, enchantments, durability, potions, block states,
  items only a loot table can build, real items, display copies and the anti-duplication guard.
- [Flat glass](guides/flat-glass.md) — the seventeen flat glass tiles in the shared packs, for
  seamless borders and backdrops.
- [Shulker reader](guides/shulker-reader.md) — reading a shulker box item's contents.
- [Errors, diagnostics and logging](guides/errors-and-diagnostics.md) — `ErrorBoundary`,
  diagnostics, `setLogger` and every log channel.
- [Testing](guides/testing.md) — the test host, the manual scheduler and time source.
- [The Bedrock runtime](guides/bedrock-runtime.md) — `openContainer`, sessions, `BedrockSurface`,
  sizes, scanning, closing and uninstalling.
- [Multiplayer](guides/multiplayer.md) — shared storages, one menu per player, conflicts.
- [Performance](guides/performance.md) — what costs tick time and how to spend less.
- [Custom hosts and schedulers](guides/custom-hosts.md) — the `HostAdapter` contract.

### Reference

- [API reference](reference/README.md) — every export, grouped by area.
- [Potion effects and arrow data values](reference/potion-effects.md) — every effect id, and the
  tipped arrow data value that carries it.
- [Diagnostics and log records](reference/records.md) — every diagnostic kind, block record, trace
  line and log source.
- [Constants](reference/constants.md) — sizes, timings and identifiers.

### Other

- [Troubleshooting](troubleshooting.md)
- [Glossary](glossary.md)

## Conventions used here

- Code samples are TypeScript with JSX unless a section says otherwise. Every sample that builds an
  element tree in JSX has a direct `h()` equivalent;
  [JSX and `h()`](getting-started/jsx-and-h.md) shows the mapping.
- Imports come from `"containerui"` in bundled projects. In a copied tree the same names come from
  `"./ContainerUI/ContainerFormData.js"`. The names are identical.
- An event parameter is named `vigenersl`, as in the library's own code: `onClick={(vigenersl) => …}`.
- "Slot" means a cell of the menu. "Index" is its number, counted from 0 at the top left, left to
  right, then down. A row has 9 slots.
- "Tick" is a Minecraft game tick, 1/20 of a second.
