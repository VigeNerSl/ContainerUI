# Block containers

A block container is a custom block with an inventory — a crate, a backpack block, a machine with
input slots. ContainerUI pairs the block with an invisible **storage entity** that fills it; the
entity's inventory holds the items, and the game saves it with the world, enchantments and custom
data included. There is no serialisation code anywhere.

The block opens in one of two ways:

| Mode | The player sees | Use it for |
| --- | --- | --- |
| `"native"` | The storage's own inventory, exactly like a chest. | Plain storage: crates, barrels, lockers. |
| `"menu"` | A ContainerUI menu you render, mirroring the storage. | Anything with buttons, layout or logic: machines, sorted chests, shops. |

## Quick start

**1. The block.** List your custom component in the block's JSON:

```json
{
    "format_version": "1.21.100",
    "minecraft:block": {
        "description": { "identifier": "myaddon:crate", "menu_category": { "category": "items" } },
        "components": {
            "minecraft:geometry": "minecraft:geometry.full_block",
            "minecraft:material_instances": { "*": { "texture": "myaddon_crate", "render_method": "opaque" } },
            "minecraft:destructible_by_mining": { "seconds_to_destroy": 0.8 },
            "myaddon:crate": {}
        }
    }
}
```

**2. The storage entity.** It comes with the shared ContainerUI behaviour pack, which the world has
active (see [Installation](../getting-started/installation.md#pack-assets)). Do not copy
`block_storage_entity.json` into your own pack.

**3. Register the component** during startup:

```ts
import { system } from "@minecraft/server";
import { registerBlockContainer } from "containerui";

system.beforeEvents.startup.subscribe((vigenersl) => {
    registerBlockContainer(vigenersl.blockComponentRegistry, "myaddon:crate", {
        size: 27,
        title: "§6Crate",
    });
});
```

That is a working crate: place it, right-click it to open its inventory, break it to drop the items.

## A menu block

Give the block a `render` function and it opens a menu instead. The render context carries the
block's `storage`; mirror it with `StorageSlots` and add whatever else the block needs:

```tsx
import { h, registerBlockContainer, StorageSlots, type BlockContainerRenderContext } from "containerui";

function Machine({ storage, player, close }: BlockContainerRenderContext) {
    const sort = () => {
        const items = Array.from({ length: 9 }, (_unused, index) => storage.get(index)).filter((item) => item !== null);
        items.sort((first, second) => first.typeId.localeCompare(second.typeId));
        for (let index = 0; index < 9; index++) storage.set(index, items[index] ?? null);
    };

    return (
        <>
            <StorageSlots storage={storage} index={9} count={9} />
            <slot index={21} item={{ typeId: "minecraft:hopper", name: "§aSort" }} sound="random.click" onClick={sort} />
            <slot index={23} item={{ typeId: "minecraft:barrier", name: "§cClose" }} onClick={close} />
        </>
    );
}

system.beforeEvents.startup.subscribe((vigenersl) => {
    registerBlockContainer(vigenersl.blockComponentRegistry, "myaddon:machine", {
        size: 27,
        title: ({ player }) => `§8Machine — ${player.name}`,
        render: (context) => <Machine {...context} />,
    });
});
```

The storage and the menu can differ in size: here a 27-slot menu shows 9 storage slots. The storage
always has `size` slots; `StorageSlots`' `from` and `count` pick which ones appear, and `index` is the
menu slot of the first one. In the example, storage slots 0–8 appear at menu slots 9–17.

Without `render`, a menu block (`open: "menu"`) mirrors the whole storage, and logs every edit as an
`edit` [record](../reference/records.md#block-container-records).

## `registerBlockContainer`

```ts
registerBlockContainer(registry, componentName, options);
```

| Argument | Meaning |
| --- | --- |
| `registry` | `blockComponentRegistry` from `system.beforeEvents.startup`. |
| `componentName` | The custom component name, as listed in the block JSON. |
| `options` | `BlockContainerOptions`, below. |

Call it inside `system.beforeEvents.startup`, once per component. It throws `RangeError` for an
unsupported size, or for a `render` function with `open: "native"`.

### Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `size` | `number` | required | Storage slot count, and the menu's size. One of the [supported sizes](bedrock-runtime.md#sizes). |
| `title` | `string \| (context) => string` | `"Container"` | The container title. A function is called on every menu open; native blocks use only a string title. |
| `open` | `"native" \| "menu"` | `"menu"` with `render`, else `"native"` | How the block opens. |
| `render` | `(context) => Child` | a mirror of the whole storage | The menu tree. Requires `open: "menu"`. |
| `sneakHintMessage` | `string \| null` | an English hint | Action-bar text shown when the block is hit without sneaking. `null` shows none. |
| `dropOnBreak` | `boolean` | `true` | Drop the stored items when the block is broken. |
| `watchIntervalTicks` | `number \| null` | `10` | Menus: ticks between checks for changes made outside the menu. `null` disables the check. |
| `hintMessage` | `string` | none | Menus: action-bar text shown when the menu opens. |
| `scanIntervalTicks` | `number` | `1` | Menus: ticks between interaction scans. |
| `onDiagnostic` | `(diagnostic) => void` | the logger | Menus: receives the menu's diagnostics. |
| `onTrace` | `(message) => void` | none | Menus: receives interaction-tracking lines. |
| `onEvent` | `(event) => void` | the block logger | Receives this component's [lifecycle records](#records). |

### The render context

`render` and a `title` function receive a `BlockContainerRenderContext`:

| Field | Meaning |
| --- | --- |
| `storage` | The block's [`BlockStorage`](storage-and-mirroring.md#block-storages): a `SlotStorage` over the storage entity. |
| `player` | The player opening it. |
| `entity` | The storage entity. |
| `close` | Closes this player's menu. |

## What happens when

### Placing

When the block is placed, a storage entity is spawned in it on the next tick (the placement hook runs
where spawning is not allowed). It records the block's position, the component name, the block type,
and a stable UUID in dynamic properties, and gets the tag `containerui_block_storage`. Placing a block
where a storage entity already exists reuses that entity only when it is this component's own and has
the same size. Any other — a crate that a machine replaced with `/setblock`, say — is settled like an
orphan: its items drop where the block stands (unless that entity's component says `dropOnBreak: false`),
it is removed, and a fresh one is spawned (`orphan-removed`, with `replacedBy=`).

### Opening

The storage entity fills the block, so a right-click reaches the entity:

- **native**: the game opens the entity's inventory itself, with the block's title.
- **menu**: the click is cancelled and the menu opens instead. A second click while the same player
  already has this block's menu open does nothing (`menu: already open, kept`). If the storage entity
  has not loaded yet (a chunk just loaded), the library retries every 5 ticks, 8 times, and then gives
  up with a `storage-missing` record. It never spawns a replacement, which would lose the items.

Several players may open the same block at once. They share one `BlockStorage`, so a change by one is
seen by the others immediately. See [Multiplayer](multiplayer.md#two-players-one-chest).

### Changes from outside

While a menu is open, a watch checks the storage every `watchIntervalTicks` for changes the menu did
not make — a hopper, a command, a native viewer — and repaints. If the storage entity disappears, every
menu over it closes (`storage-invalidated`).

### Breaking

The storage entity fills the block, so it would take the hits meant for the block. **Sneak-to-break**
solves that:

- A player hitting the block without sneaking sees the `sneakHintMessage` on their action bar.
- A player who **sneaks and looks at the block** makes the library park the storage entity out of the
  way (at a high Y, `containerui_hidden` tag), so their hits reach the block.
- When they stop sneaking, look away, or leave, the entity is put back.

When the block breaks — by a player, an explosion, a command, a piston — every menu over it closes, the
stored items drop at the block (unless `dropOnBreak: false`), and the storage entity is removed.

### Orphans

If a storage entity outlives its block (the block was replaced while its chunk was unloaded, say), the
library notices when the entity loads, at world start, and when anyone opens or clicks it, and removes
it, dropping its items. (A block replaced with `/setblock` raises no break event, so an entity of a
chunk that stays loaded is found out the first time someone touches it.) It compares the block at the
recorded position with the recorded block type; it leaves the entity alone when it cannot tell (the
block has not loaded yet) and while anyone else has it open.

## Records

Every step above is logged as a `BlockContainerEvent`:

```ts
interface BlockContainerEvent {
    kind: "storage-spawned" | "opened" | "closed" | "broken" | "dropped" | "edit" /* and more, see the reference */;
    component: string; // the component name
    blockKey?: string; // "minecraft:overworld:12:64:-3"
    player?: string;
    detail?: string;   // key=value text
}
```

They go, in order of preference, to:

1. the component's `onEvent`, if it has one;
2. the handler set with `setBlockContainerLogger(handler)`;
3. the [logger](errors-and-diagnostics.md#logging), as `info` (or `warn` for `error`), source `block`.

The default console logger drops `info`, so records are silent until you ask for them:

```ts
setBlockContainerLogger((vigenersl) => console.info(`[blocks] ${vigenersl.kind} ${vigenersl.blockKey ?? ""} ${vigenersl.detail ?? ""}`));
```

Every kind is listed in [Diagnostics and log records](../reference/records.md#block-container-records).

## Lower-level functions

| Function | Meaning |
| --- | --- |
| `findBlockStorageEntity(dimension, location)` | The storage entity of the block at `location` (also one parked while being broken), or `null`. With duplicates, the one holding the most items. Removes nothing. |
| `claimBlockStorageEntity(dimension, location)` | The same, but removes empty duplicates. Placing, opening and breaking use it. |
| `installBlockSneak()` | Starts sneak-to-break. `registerBlockContainer` calls it; idempotent. |
| `setBlockContainerLogger(handler \| null)` | Sends block records to `handler`; `null` sends them to the logger again. |

Open a block's menu from your own code (a remote terminal, a command) by finding its entity and
rendering the storage yourself:

```tsx
const entity = findBlockStorageEntity(player.dimension, { x: 12, y: 64, z: -3 });
if (entity) {
    const storage = BlockStorage.forEntity(entity);
    openContainer(player, () => <StorageSlots storage={storage} />, { size: 27, title: "§6Remote crate" });
}
```

## Limits

- `size` must be a supported surface size; the storage entity has one inventory group per size.
- `tags` on stackable items are not kept (a Bedrock limit); see [Items](items.md#tags).
- A block container stores items only. Keep other per-block data in the storage entity's dynamic
  properties with [`createEntityBackend(entity)`](persistence.md#backends), so it goes with the block.
- Cleaning up after a non-player break relies on the block's `onBreak` hook and the orphan check.
