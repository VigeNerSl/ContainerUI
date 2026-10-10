# The fluent builder

`ContainerFormData` builds a menu slot by slot, with chained method calls. It needs no JSX and no
`h()`, which makes it the easiest way to write menus in plain JavaScript without a build step.

```js
import { ContainerFormData, signal } from "./ContainerUI/ContainerFormData.js";

const coins = signal(100);
const PANE = { typeId: "minecraft:gray_stained_glass_pane", name: " " };

export const openShop = (player) =>
    new ContainerFormData(27)
        .title("§6Shop")
        .border(PANE)
        .slot(4, () => ({ typeId: "minecraft:gold_ingot", name: `§6${coins.value} coins` }))
        .button(11, { typeId: "minecraft:bread", name: "§aBread — 3" }, () => buy(player, "bread", 3), "random.orb")
        .button(15, { typeId: "minecraft:diamond", name: "§bDiamond — 40" }, () => buy(player, "diamond", 40), "random.orb")
        .button(22, { typeId: "minecraft:barrier", name: "§cClose" }, (vigenersl) => vigenersl.close())
        .onClose(() => console.info(`[shop] ${player.name} left`))
        .open(player);
```

The import path above is for a copied (vendored) tree. In a bundled project the same names come from
`"containerui"`.

It is a facade, not a second rendering path: `build()` produces an ordinary element tree, and
`open()` renders it with `openContainer`. So everything the rest of this documentation says —
minimal writes, restores, the anti-duplication guard, function items repainting one slot — applies.

## Two classes

| Class | Where | What it adds |
| --- | --- | --- |
| `ContainerFormBuilder` | core | Every building method, and `build()`. Platform-free: usable in tests. |
| `ContainerFormData` | Bedrock | Extends the builder with `onClose(handler)` and `open(player, options?)`. |

## Creating one

```js
new ContainerFormData(size, width = 9);
```

`size` must be one of the [supported sizes](bedrock-runtime.md#sizes) when you open it: 1, 5, 9, 18,
27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117 or 126.

Methods return the builder, so they chain. Slot methods check the index and throw `RangeError` for
one outside `0..size-1`.

## Methods

### `title(text)`

The title shown on the container header. Default `"Container"`. `resolvedTitle` returns it.

### `slot(index, item)`

A decorative slot. `item` is an `ItemView`, `null`, or a function returning one — a function is
re-read on every commit, so it repaints this one slot when the signals it reads change.

### `button(index, item, onClick?, sound?)`

A button. `onClick(event)` runs once the click completes, with a
[`SlotEvent`](interaction.md#slotevent); `sound` plays on click.

### `input(index, options?)`

A slot the player owns. `options` takes the same fields as the `<input>` element: `initialItem`,
`item` (controlled), `isMirror`, `accept`, `onPlace`, `onTake`, `onChange` (`InputOptions`). See
[Inputs](interaction.md#inputs).

### `reserve(index)`

Leaves a slot empty and claimed, so `fill`, `border`, `rect` and `pattern` skip it.

### `component(index, Component, props?)`

Places a component at a slot: its output is laid out from `index` (inside a `box`). This is the bridge
to [components](components.md) when part of a builder screen needs state:

```js
import { ContainerFormData, h, useState } from "./ContainerUI/ContainerFormData.js";

const Counter = () => {
    const [count, setCount] = useState(0);
    return h("slot", { item: { typeId: "minecraft:paper", name: `${count}` }, onClick: () => setCount((n) => n + 1) });
};

new ContainerFormData(27).component(13, Counter).open(player);
```

Only `index` itself is claimed. If the component draws several slots, `reserve` the others so fills do
not cover them.

### `border(item)`

Fills every slot on the edge of the menu, skipping claimed ones.

### `fill(item)`

Fills every unclaimed slot. Call it **last**: it fills only slots nothing has claimed yet. A later
`slot`, `button`, `input`, `reserve` or `component` call on one of them replaces the fill.

### `rect(area, item)`

Fills an inclusive rectangle, skipping claimed slots. `area` is `{ from: [column, row], to: [column, row] }`
(`Area`):

```js
form.rect({ from: [1, 1], to: [7, 3] }, { typeId: "minecraft:light_gray_stained_glass_pane", name: " " });
```

### `pattern(rows, mapping)`

Lays slots out from rows of characters. Each character maps to an item; a space leaves the slot
alone. Claimed slots are skipped.

```js
form.pattern(
    [
        "#########",
        "#       #",
        "#   D   #",
        "#########",
    ],
    { "#": PANE, D: { typeId: "minecraft:diamond" } },
);
```

It throws `RangeError` for a row wider than the menu, a character missing from the mapping, or a row
past the last slot.

### `storage(storage, options?)`

Mirrors a [`SlotStorage`](storage-and-mirroring.md) from the **next free slot**:

```js
new ContainerFormData(54)
    .title("§6Backpack")
    .button(49, CLOSE, (vigenersl) => vigenersl.close())
    .storage(BlockStorage.forEntity(entity), { count: 45 })
    .open(player);
```

| Option | Meaning |
| --- | --- |
| `from` | First storage slot. Default `0`. |
| `count` | How many slots. Default: the rest of the storage. |
| `readOnly` | `true`: show display copies (`StorageView`) the player cannot take. Default `false`: real access (`StorageSlots`). |
| `accept` | Refuse incoming items (real access). |
| `onEdit` | Called after each edit reaches the storage (real access). |
| `onConflict` | Called for an edit refused because the slot changed under it (real access). |
| `onSlotClick` | `(storageIndex, item) => void` for read-only mirrors. |

The mirrored range is claimed, so `fill` and `border` skip it. It throws `RangeError` when every slot
is already claimed, when the range would run past the last slot, or when it would run over a slot
already claimed: the range is contiguous from the first free slot, so a button inside it would be
replaced by a storage slot. The other way round throws too: `slot`, `button`, `input`, `reserve` and
`component` refuse an index inside a mirror that was already added. It also throws when `from` or
`count` is not a whole number from 0, or when the range runs past the storage's own `size`.
`StorageOptions` is the type.

### `build()`

Returns the element tree. `open()` calls it for you. Changes made to the builder **after** opening
still take effect: the tree is rebuilt on every commit, and every builder method bumps a signal the
commit reads.

```js
const form = new ContainerFormData(27).title("Loading…");
const session = form.open(player);
// later
form.button(13, READY, () => start());
```

`claimedIndices` lists the claimed slot indices, in order.

### `onClose(handler)` — Bedrock

Runs `handler()` once the menu closes, however it closed. A second call replaces the handler.

### `open(player, options?)` — Bedrock

Opens the menu for `player` and returns a [`ContainerSession`](bedrock-runtime.md#containersession).
`options` takes everything [`openContainer`](bedrock-runtime.md#opencontainer) does except `size`, plus
`title` to override the one set with `.title()` (`ContainerFormOpenOptions`).

```js
form.open(player, { title: `§6Shop — ${player.name}`, onDiagnostic: (vigenersl) => console.warn(vigenersl.message) });
```

## Order of calls

Specific slots first, fills last:

```js
new ContainerFormData(54)
    .title("§6Shop")
    .button(49, CLOSE, close)          // 1. specific slots
    .storage(listings, { readOnly: true, count: 28, onSlotClick: buyLot })
    .border(DARK_PANE)                 // 2. border
    .fill(LIGHT_PANE);                 // 3. everything else
```

`storage` takes the next free slot, so put it after the slots it must avoid, and before fills.

## When to use components instead

The builder suits menus whose **structure** is fixed and whose **content** changes through signals
and function items. When a screen needs local state, lists that change length, navigation, dialogs
or reuse, write it as components — and use `.component()` to embed one in a builder menu when only a
part needs it.
