# ContainerUI diagnostic add-on

A test add-on for people who work on ContainerUI itself. It opens every kind of menu the library can
build, in a real world, and writes what the engine did to the content log. It is not a starting
point for your own add-on: for that, see the [documentation](../../documentation/README.md).

Use it to check a change in the game, which the automated checks cannot do, or to reproduce a problem.

## What is here

- `main.js` registers the chat commands and the stick interaction.
- `scenarios/` has one file per group of scenarios: clicks and restores, inputs, 126 slots, layouts,
  routing, animation, the fluent builder, enchantments, a modal and loading states, a shop with pages
  and quantities, selling, potions, block containers, the flat glass tiles, and timing probes.
- `support/` has the helpers that open a menu and write the log lines.

The menu titles and item names inside the scenarios are in Russian. The code and comments are in
English.

## Build and install

```bash
npm install
npm run build:testpack
```

This writes `testpack/` (ignored by git) with four folders:

| Folder | Copy to |
|---|---|
| `testpack/ContainerUI/BP` | `development_behavior_packs/ContainerUI_BP` |
| `testpack/ContainerUI/RP` | `development_resource_packs/ContainerUI_RP` |
| `testpack/BP` | `development_behavior_packs/ContainerUI_Diag_BP` |
| `testpack/RP` | `development_resource_packs/ContainerUI_Diag_RP` |

The first two are the shared ContainerUI packs; the last two are this add-on, which depends on them.
Delete the old copies before copying new ones: copying over them keeps files the new build no longer
has. Then activate the shared pair and the diagnostic pair in a world, and make sure no other active pack
carries a copy of the ContainerUI entities.

The `development_behavior_packs` and `development_resource_packs` folders are inside the game's data
folder, `com.mojang`. For the launcher (GDK) edition on Windows that folder is
`%AppData%\Minecraft Bedrock\Users\Shared\games\com.mojang`.

## Use

| Command | What it does |
|---|---|
| `/vigenersl:cui` | Opens the hub of scenarios. |
| `/vigenersl:cuiprobe` | Measures how long each container size takes to become ready. |
| `/vigenersl:cuicrate` | Gives the block-container crate and machine. |
| `/vigenersl:cuiform` | Opens the fluent builder demo. |
| `/vigenersl:cuiauction` | Opens the auction listing demo. |
| `/vigenersl:cuiinv` | Opens a live mirror of your own inventory. |
| `/vigenersl:cuishulker` | Reads the held shulker box. |
| `/vigenersl:cuidump` | Writes every storage entity's inventory to the log. |
| `/vigenersl:cuimarker` | Measures whether the anti-duplication marker survives becoming a world item. |

Right-click a block while holding a stick to open a menu from a `beforeEvents` handler.

Results go to the content log as one `key=value` line per record, and nothing goes to chat. Turn the
content log on in the game's settings, then read the lines that start with `[CUI]`; each one names its
`event=`.
