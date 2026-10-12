# Installation

ContainerUI runs inside your behaviour pack. Bedrock gives every behaviour pack its own script
context, and nothing in one pack can be reached from another, so the library cannot be installed
as a separate add-on. It has to be copied into, or bundled into, the pack that uses it.

There are two ways to do that. Both give you exactly the same library. The npm package ships a built
`dist/`, so neither route needs a build of the library; building is only for working from a copy of
the repository.

| | Copy the folder | Bundle the package |
| --- | --- | --- |
| Tools you need | Node.js and npm, once, to fetch the package | Node.js, npm and a bundler (esbuild, rollup…) |
| How your code looks | Plain JavaScript with `h()` or the fluent builder | TypeScript or JavaScript, JSX allowed |
| Imports | `./ContainerUI/ContainerFormData.js` | `containerui` |
| Best for | Small add-ons, people who do not want a build step | Larger add-ons, TypeScript, JSX |

Whichever you choose, the world also needs the **shared ContainerUI packs**: an entity and some JSON
UI files the library renders through, installed once per world and used by every add-on built on
ContainerUI. They are covered [below](#pack-assets).

## Requirements

- Minecraft Bedrock with Script API module `@minecraft/server` **2.9.0 or later**. The library
  uses no pre-release (beta) API, so the world does not need the *Beta APIs* experiment.
- Your manifest declares `@minecraft/server`. The library does not import `@minecraft/server-ui`;
  declare it only if your own code uses it.
- A minimum engine version of 1.26.20 in the shared packs' manifests. `CUI_MIN_ENGINE` changes it
  when you generate the packs (see [Pack assets](#pack-assets)).

## Option 1: copy the folder

Install the package and copy its `dist` folder into your pack's `scripts` folder as
`ContainerUI`:

```bash
npm install containerui
```

Copy `node_modules/containerui/dist` to `YourBP/scripts/ContainerUI`. The `.d.ts` files in it are
for editors; the game ignores them and you can delete them. Keep the `LICENSE` file that sits next to
`ContainerFormData.js`: it carries the MIT notice that copies of the library must keep. Every import
inside the copied tree is relative and ends in `.js`, so the game loads it as it is.

From a copy of the repository, build and copy in one go instead:

```bash
npm install
npm run build
node tools/vendor.mjs path/to/YourBP/scripts/ContainerUI
```

`tools/vendor.mjs` deletes the destination, copies `dist/` into it, and prints how many modules it
copied.

Your pack now looks like this:

```
YourBP/
  manifest.json
  scripts/
    main.js
    ContainerUI/
      ContainerFormData.js     ← import everything from here
      LICENSE                  ← keep it
      logo/                    ← the ContainerUI logo, three SVG files
      jsx-runtime.js
      core/…
      platform/…
```

Import from the one entry file:

```js
// scripts/main.js
import { h, installBedrockRuntime, openContainer, useState } from "./ContainerUI/ContainerFormData.js";

installBedrockRuntime();
```

Without a build step you cannot use JSX, because JSX has to be compiled. Write elements with `h()`
instead (see [JSX and `h()`](jsx-and-h.md)), or use the [fluent builder](../guides/fluent-builder.md),
which needs neither:

```js
import { ContainerFormData } from "./ContainerUI/ContainerFormData.js";

new ContainerFormData(27)
    .title("§6Shop")
    .button(13, { typeId: "minecraft:diamond", name: "§bBuy" }, (vigenersl) => vigenersl.close())
    .open(player);
```

Code that runs outside the game, such as unit tests, imports `./ContainerUI/core/index.js`, which
never loads `@minecraft/server`.

## Option 2: bundle the package

Install the package and point the JSX transform at it:

```bash
npm install containerui
npm install --save-dev @minecraft/server
```

```jsonc
// tsconfig.json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "ES2022",
        "moduleResolution": "Bundler",
        "jsx": "react-jsx",
        "jsxImportSource": "containerui",
        "strict": true
    }
}
```

The package has three entry points:

| Import | What it contains |
| --- | --- |
| `containerui` | Everything, including the Bedrock adapter. |
| `containerui/core` | The platform-free core only. Loads without the game; use it in tests. |
| `containerui/jsx-runtime` | The JSX runtime. The compiler imports it; you do not. |

Bundle your entry point into `BP/scripts/main.js`, and mark every `@minecraft/*` module you import as
external so the game supplies it:

```bash
npx esbuild src/main.tsx --bundle --format=esm --outfile=BP/scripts/main.js \
    --external:@minecraft/server --external:@minecraft/server-ui
```

JSX only works in this channel: the compiler emits `import … from "containerui/jsx-runtime"`, and
only a bundler can resolve that for the game.

ContainerUI is MIT-licensed. When you bundle it, keep its licence with your add-on: esbuild keeps the
`/*! ContainerUI … */` comment of the library's entry files by default, and you can also copy
`node_modules/containerui/LICENSE` into your pack, for example as `scripts/ContainerUI-LICENSE`.

## Pack assets

The library draws a menu by spawning an invisible entity, giving its inventory the size you asked
for, and seating the player on it, so the client shows that inventory as a chest screen. That needs
an entity and some JSON UI files. They are not part of your add-on: they live in two **shared
packs** that contain no scripts, and every add-on built on ContainerUI uses the same two.

| Pack | File | Purpose |
| --- | --- | --- |
| ContainerUI BP | `entities/rideable_entity.json` | The menu entity (`containerui:rideable_entity`), with one inventory group per supported size. |
| ContainerUI BP | `entities/block_storage_entity.json` | The storage entity of [block containers](../guides/block-containers.md) (`containerui:block_storage`). |
| ContainerUI RP | `ui/chest_screen.json`, `ui/container.json`, `ui/pocket_containers.json`, `ui/_ui_defs.json` | The screen layouts. The layout is chosen by the first characters of the entity's name, which the library sets. |
| ContainerUI RP | `ui/ui_common.json` | Touch input reads slots the way a mouse does, in every container screen of the world, vanilla ones included: hovering a slot shows its hover text, and scrolling grids use the mouse scrollbar. |
| Both | `blocks/flat_glass*.json`, their model, textures and names | Seventeen flat glass blocks for seamless borders and backdrops; see [Flat glass](../guides/flat-glass.md). |

Entity ids and UI files are global to a world. If every add-on carried its own copy of these files,
the world would load the copy from the pack listed first and skip the others with a warning in the
log, so which version of the entity and the layouts runs would depend on the pack order, and an old
copy could win over a newer one. With one shared pair, the world loads them once, from one version,
and any number of add-ons use them.

### For the world: install the packs once

The npm package ships both packs, generated from the same build as its code, in
`node_modules/containerui/pack/BP` and `pack/RP`. Put them in the world's behaviour pack and
resource pack folders and activate them. ContainerUI BP lists ContainerUI RP as a dependency:
activating the BP activates the RP with it, and the RP cannot be switched off while the BP is active.
From a copy of the repository, generate them instead:

```bash
npm run build
npm run generate:pack          # writes pack/BP and pack/RP
```

### For your add-on: depend on them

Do not write a copy of the entities or the UI files of your own into your packs. Name the shared
behaviour pack in your behaviour pack's manifest, next to the script modules you use, with the pack
version you tested against. This is a fragment, not a whole manifest: your add-on keeps its own
`header` and generates its own UUIDs (the script module's `uuid` below is a placeholder for yours),
while the first dependency UUID is the shared pack's:

```jsonc
{
    "modules": [
        { "type": "script", "language": "javascript", "entry": "scripts/main.js", "uuid": "…", "version": [1, 0, 0] }
    ],
    "dependencies": [
        { "uuid": "2d2c35a3-017c-42cd-a910-9c64d55bcc25", "version": [1, 0, 0] },
        { "module_name": "@minecraft/server", "version": "2.9.0" }
    ]
}
```

The UUIDs of the shared packs never change:

| Pack | UUID |
| --- | --- |
| ContainerUI BP | `2d2c35a3-017c-42cd-a910-9c64d55bcc25` |
| ContainerUI RP | `5d3a0ae4-d90d-4d25-8a23-80bc25f83ad7` |

The pack version is the library's version without its pre-release tag: `1.0.0-beta.1` ships pack
`1.0.0`. Your add-on still carries the library's scripts itself, since scripts cannot be shared
between packs; only the entities and layouts are shared. Every pack's scripts run in a context of
their own, so any number of add-ons can carry the library side by side.

You may also ship the two shared packs unchanged inside your own download, with their UUIDs: a world
loads a pack with a given UUID once, and a second copy is skipped with a warning in the log.

### Generating them yourself

The generator reads two environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CUI_MIN_ENGINE` | `1.26.20` | `min_engine_version` of both manifests |
| `CUI_FORMAT_VERSION` | `1.26.20` | `format_version` of the entity files |

An optional output folder can be passed: `node tools/generate-pack.mjs out/packs`.

If you edit the generated entities, two things are easy to break:

- **A storage entity with `minecraft:interact` no longer opens natively.** The component takes the
  click, and the chest screen never opens.
- **A component that parsed under one `format_version` can be refused under the next.** Under
  `1.26.20` the entity schema rejects `minecraft:pushable` and a boolean `deals_damage` in
  `minecraft:damage_sensor` (it must be a string, such as `"no"`). An entity that fails to parse does
  not load at all, and only the [content log](../troubleshooting.md) says why. After changing
  `CUI_FORMAT_VERSION`, load a world, not just a build.

## Starting the runtime

Call `installBedrockRuntime()` once, at the top level of your entry script:

```js
import { installBedrockRuntime } from "./ContainerUI/ContainerFormData.js";

installBedrockRuntime();
```

It installs a scheduler that commits every change made in one tick together, at the end of that
tick, and a time source for animations and timers. `openContainer` calls it for you too, so a menu
works without it, but anything reactive that runs *before* the first menu opens — an `effect()` at
startup, a `computed` you read — would otherwise fall back to microtask scheduling and log a
warning. Calling it once at startup avoids that. The call is idempotent.

See [The Bedrock runtime](../guides/bedrock-runtime.md) for its option (`budgetMs`, applied only on
the first call) and for `uninstallBedrockRuntime()`.

## Checking the installation

Open a 27-slot menu with one item when a player uses a stick:

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

If nothing opens, see [Troubleshooting](../troubleshooting.md#the-menu-never-opens). The most common
causes are the shared ContainerUI packs not being active in the world; the library reports a missing
menu entity as a `platform-error` naming the pack.

## Next

[Your first menu](first-menu.md) builds a counter and a small shop step by step.
