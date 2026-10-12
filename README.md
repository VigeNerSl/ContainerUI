<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="ContainerUI" width="420">
  </picture>
</h1>

<p align="center">
  Reactive chest-style menus for Minecraft Bedrock add-ons.<br>
  <a href="README.ru.md">Русская версия</a>
</p>

**NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

## What it is

ContainerUI lets you build menus for Minecraft Bedrock add-ons the way you build a UI with React.
You describe what the menu should show, and the library draws it, notices what the player does and
calls your handlers. It takes care of the awkward parts: telling a click from a drag, putting back the
buttons the player moves, keeping menu items out of the player's inventory, and writing only the slots
that changed so the server keeps its tick budget.

```tsx
import { openContainer, useState } from "containerui";

function Counter() {
    const [count, setCount] = useState(0);

    return (
        <row index={10}>
            <slot item={{ typeId: "minecraft:paper", name: `Clicked ${count} times` }} />
            <slot
                item={{ typeId: "minecraft:emerald", name: "§aClick me" }}
                sound="random.orb"
                onClick={() => setCount((value) => value + 1)}
            />
        </row>
    );
}

openContainer(player, () => <Counter />, { size: 27, title: "§dCounter" });
```

## Quick start

You need two things: the **ContainerUI packs** in the world, installed once, and the **library** inside
your add-on.

Requirements:

- Minecraft Bedrock 1.26.20 or later.
- Script API module `@minecraft/server` 2.9.0 or later. The library uses no beta API, so the world does
  not need the *Beta APIs* experiment.

### 1. Install the packs

The packs hold the menu entity, the block storage entity, the screen layouts and the 17 flat glass
blocks, and contain no scripts. The resource pack also shows hover text on touch in every container
screen of the world, vanilla ones included. Get the package and copy them into your game:

```bash
npm install containerui
```

- `node_modules/containerui/pack/BP` → `development_behavior_packs/ContainerUI_BP`
- `node_modules/containerui/pack/RP` → `development_resource_packs/ContainerUI_RP`

The `development_behavior_packs` and `development_resource_packs` folders are inside the game's data
folder, `com.mojang`. For the launcher (GDK) edition on Windows that folder is
`%AppData%\Minecraft Bedrock\Users\Shared\games\com.mojang`. Then activate
**ContainerUI BP** in the world: it brings **ContainerUI RP** with it.

### 2. Add the library to your add-on

Pick one:

- **No bundler.** Copy `node_modules/containerui/dist` to `YourBP/scripts/ContainerUI`. Keep the
  `LICENSE` file that is in it. You write plain JavaScript with `h()` or the fluent builder.
- **With a bundler** (TypeScript, JSX). Import from `"containerui"` and bundle your entry point into
  `BP/scripts/main.js` with esbuild or rollup, marking `@minecraft/server` as external. For JSX, set
  `"jsx": "react-jsx"` and `"jsxImportSource": "containerui"` in `tsconfig.json`.
  [How to set it up](documentation/getting-started/installation.md#option-2-bundle-the-package).

### 3. Depend on the packs

In your behaviour pack's `manifest.json`:

```jsonc
"dependencies": [
    { "uuid": "2d2c35a3-017c-42cd-a910-9c64d55bcc25", "version": [1, 0, 0] },
    { "module_name": "@minecraft/server", "version": "2.9.0" }
]
```

That UUID identifies ContainerUI BP, and it never changes. The game loads the packs together with your
add-on.

### 4. Open a menu

```js
import { world } from "@minecraft/server";
import { h, installBedrockRuntime, openContainer } from "./ContainerUI/ContainerFormData.js";

installBedrockRuntime();

world.afterEvents.itemUse.subscribe((vigenersl) => {
    const { source, itemStack } = vigenersl;
    if (itemStack.typeId !== "minecraft:stick") return;
    openContainer(source, () => h("slot", { index: 13, item: { typeId: "minecraft:diamond", name: "§bIt works" } }), {
        size: 27,
        title: "Hello",
    });
});
```

Use the stick and a one-item menu opens. (`vigenersl` is the author's signature for event parameters in
these examples; name yours anything you like.) Next, [Your first menu](documentation/getting-started/first-menu.md)
builds a counter and a small shop step by step.

## What you get

- **Reactive menus.** State is signals and hooks (`useState`, `useMemo`, …). Only the slots that
  changed are written, at most once per tick; a large update may take several ticks.
  [Reactivity](documentation/guides/reactivity.md), [Hooks](documentation/guides/hooks.md)
- **JSX, plain JavaScript or a builder.** The same menu three ways.
  [Components](documentation/guides/components.md), [The fluent builder](documentation/guides/fluent-builder.md)
- **Layout.** `row`, `column`, `grid` and absolute indices.
  [Elements and layout](documentation/guides/elements-and-layout.md)
- **Clicks that work.** Buttons, slots the player fills, mouse and touch. Menu items cannot be taken out of
  the menu. [Interaction](documentation/guides/interaction.md), [Items](documentation/guides/items.md)
- **Screens, dialogs and loading.** A router, `Modal` and `Confirm`, `Suspense`, `ErrorBoundary`.
  [Navigation](documentation/guides/navigation.md), [Layers and modals](documentation/guides/layers-and-modals.md),
  [Async data](documentation/guides/async-data.md)
- **Shops and lists.** Pagination and a quantity picker.
  [Lists and quantities](documentation/guides/lists-and-quantities.md)
- **Real storage.** Chests and custom machine blocks, player inventories, a shulker reader, saved data.
  [Block containers](documentation/guides/block-containers.md),
  [Storage](documentation/guides/storage-and-mirroring.md), [Persistence](documentation/guides/persistence.md)
- **Real items.** Enchantments, durability, potions, block states and invisible tags.
- **Flat glass.** Seventeen seamless glass tiles for borders and backdrops.
  [Flat glass](documentation/guides/flat-glass.md)
- **Animation.** Staggered reveals and tweens as plain state.
  [Animation](documentation/guides/animation.md)
- **Tests without the game.** An in-memory host that counts every write. [Testing](documentation/guides/testing.md)
- **Diagnostics.** Every problem is reported with a name you can act on.
  [Errors, diagnostics and logging](documentation/guides/errors-and-diagnostics.md)

## Documentation

- **[documentation/](documentation/README.md)** is the user guide: installation, a first menu, a guide per
  feature, the API reference and troubleshooting. Start there.
- [Troubleshooting](documentation/troubleshooting.md) if a menu does not open.
- [ARCHITECTURE.md](ARCHITECTURE.md) explains how the library works inside, for the curious and for
  contributors.
- [CHANGELOG.md](CHANGELOG.md) lists what changed in each release.

## Status

`1.0.0-beta.2` is the current release; the first public one was `1.0.0-beta.1`. Menus, block containers,
modals, loading states, pages and quantities have been run in a live world on a computer and on a phone,
and the core and the interaction logic are covered by automated checks. It is a beta: the API may still
change before 1.0, and every breaking change will be listed in the changelog.

Known limitations:

- **Two players editing one storage slot in the same tick.** The first edit wins and the second is taken
  back; the rare case it cannot settle is reported as a `conflict-unresolved` trace line to the menu's
  `onTrace` option.
- **No enchantment glint or durability bar on items that cannot have them.** `enchantments` and
  `durability` apply where the engine allows and warn once per item type elsewhere; use a custom item of
  your own for the rest.

## Contributing

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © vigenersl: you may use, change, sell and redistribute ContainerUI in any add-on, free or paid. Keep
the copyright notice and the licence text with the library; the `LICENSE` file next to
`ContainerFormData.js` is there for that. The full text is in [LICENSE](LICENSE).

The name "ContainerUI" and the logo are not covered by the MIT licence: see [TRADEMARKS.md](TRADEMARKS.md).
In short, say your add-on is built with ContainerUI, but do not name your own project ContainerUI.

ContainerUI is an unofficial library. **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH
MOJANG OR MICROSOFT.** Minecraft's EULA and Usage Guidelines still apply to every add-on built with it.

Questions and bug reports: [GitHub Issues](https://github.com/VigeNerSl/ContainerUI/issues).
