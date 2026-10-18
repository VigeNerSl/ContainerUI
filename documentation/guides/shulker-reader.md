# Shulker reader

The stable Script API cannot read or change the items inside a shulker box **item**: the contents are
part of the item's data, and there is no component for them. `readShulkerContents` reads them anyway,
by placing a copy of the shulker box as a block, reading the block's inventory, and removing
everything again; `writeShulkerContents` makes a shulker box item holding the contents you give it.

```tsx
import type { Player } from "@minecraft/server";
import { inventoryContainerOf, openContainer, readShulkerContents, toDisplayView } from "containerui";

const showHeldShulker = async (player: Player) => {
    const held = inventoryContainerOf(player)?.getItem(player.selectedSlotIndex);
    if (!held?.typeId.includes("shulker_box")) return;
    const contents = await readShulkerContents(player, held);
    const occupied = contents.filter(Boolean).length;
    openContainer(player, () => contents.map((item, index) => <slot key={index} index={index} item={toDisplayView(item)} />), {
        size: 27,
        title: `§dShulker — ${occupied} stacks`,
    });
};
```

## `readShulkerContents(player, shulkerStack, options?)`

Returns a promise of 27 entries, one per shulker slot: an `ItemView`, or `null` for an empty slot.

- **It never throws.** Every failure is reported through `onEvent` and leaves the slots it could not
  read empty.
- The views are **real items** (they carry `native`, except a menu copy someone put in, which reads
  as a plain view). Show them with `toDisplayView`, or the player could take copies out of the menu.
- The shulker item you pass is not changed or consumed. Only a copy is placed.
- It takes a few ticks: about 0.4 s with the defaults.

## Writing a shulker box

`writeShulkerContents({ player, shulkerStack, contents, onEvent? })` makes a new shulker box item
holding `contents`: up to 27 `ItemView`s, `null` for an empty slot. A shulker box of the same type is
placed high above the player, filled, turned back into an item and removed, all in one tick, so unlike
reading it takes no waiting.

```ts
const result = writeShulkerContents({ player, shulkerStack: held, contents: [{ typeId: "minecraft:diamond", amount: 3 }] });
if (result) inventory.setItem(player.selectedSlotIndex, result.stack);
```

- **The item you pass is not changed.** The new one keeps its name, lore, dynamic properties, lock,
  keep-on-death and where it can be placed; what it held before is replaced.
- **It returns `{ stack, leftovers }`** (`ShulkerWriteResult`), or `null` when the shulker box could not
  be made (`onEvent` says why). `leftovers` lists what it could not hold, each with the index it had in
  `contents`: another shulker box (a shulker box holds none, as in the game), past the 27th slot, or an
  item no stack could be made from, such as one of an unknown type. Give them back to the player.
- **It never throws.** It reports `written` (`occupied=N leftovers=M`) or the failure through `onEvent`.
- It needs one air block in the player's column: the highest below the world's ceiling is used. A
  read needs more room, a 3×3×3 of air.

## How it works

1. A column of air is found high above the player (at most y 300, below the world's ceiling), with a
   3×3×3 air space around the spot.
2. A dispenser facing up is placed there, loaded with one copy of the shulker box, and powered with a
   redstone block beside it.
3. The dispenser places the copy as a block above itself. The reader waits for it, reads its 27 slots,
   and empties it.
4. The dispenser, the redstone block and the shulker block are turned back into air.
5. If the dispenser threw the copy out as an item instead of placing it, that item is removed.

Only a **new** loose item of the shulker's own type, near the dispenser, counts as the reader's copy.
Items that were there before the read, and any other items — a player's drops falling through the
space — are left alone.

Two reads close together at the same time would share blocks, or one read's redstone block would
fire the other's dispenser, so the second one stops at once with a `column-busy` event. "Close" is
within two columns on either axis in the same dimension.

Only a shulker box is read: `minecraft:shulker_box`, `minecraft:undyed_shulker_box` and
`minecraft:<colour>_shulker_box`. Another id that merely contains the words is `not-a-shulker`.

### A read cut short

Before the first block is placed, the positions of the dispenser, the redstone block and the placed
shulker box are written to a world dynamic property (`containerui_shulker_pending`), and removed
again once the cleanup reached every position. If the chunk unloads mid-read, or the script reloads,
the record stays and the next read removes what it names, but only a block that is still exactly a
dispenser, a redstone block or a shulker box at its recorded spot; a position in a chunk that is not
loaded keeps its record for a later run. The dispenser and the shulker box are emptied first. The
`cleanup` event ends with `pending=true` when a position could not be reached.

A reader used rarely can also sweep at world start. `sweepShulkerLeftovers()` returns how many blocks
it removed:

```ts
import { world } from "@minecraft/server";
import { sweepShulkerLeftovers } from "containerui";

world.afterEvents.worldLoad.subscribe(() => sweepShulkerLeftovers());
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `tickDelay` | `2` | Ticks between steps. |
| `maxAttempts` | `20` | Checks for the placed shulker before giving up. |
| `onEvent` | none | Observes every step. |

## Events

`onEvent` receives `{ kind, detail? }` (`ShulkerReadEvent`):

| `kind` | Meaning | `detail` |
| --- | --- | --- |
| `not-a-shulker` | The stack is not a shulker box. | its type id |
| `column-busy` | Another read is using this column. | `at=x,z` |
| `start` | A spot was found; the read begins. | `at=x,y,z` |
| `no-safe-space` | No air column was found. | |
| `dispensed` | The copy was placed as a block. | `at=x,y,z` |
| `dispense-timeout` | The copy never appeared as a block. | `attempts=N` |
| `read` | The contents were read. | `occupied=N` |
| `written` | `writeShulkerContents` made the item. | `occupied=N leftovers=M` |
| `cleanup` | The blocks were removed. | `swept=N kept=M sweptItems=… keptItems=…` — the copies removed and the other loose items left alone, each as `name×amount@yN`, the type without its namespace, such as `diamond×1@y70`, or `?` for a stack that could not be read |
| `error` | Something failed. | the error |

```ts
const contents = await readShulkerContents(player, held, {
    onEvent: ({ kind, detail }) => console.info(`[shulker] ${kind} ${detail ?? ""}`),
});
```

## Requirements and limits

- The reader places and removes blocks high in the player's column, so that space must be loaded and
  free. In a dimension with a low ceiling or a column built full up, it reports `no-safe-space`.
- It uses a dispenser, so it works with the stable API and no experiments.
- Do not read shulkers in a loop for many players at once: each read places blocks for a moment. Read
  on demand (a command, a click) and keep the result while the menu is open.
