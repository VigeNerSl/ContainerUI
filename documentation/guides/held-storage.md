# Storages opened by click

A storage opened by click shows something the player carries, such as a shulker box in their hand,
their ender chest, or a backpack of your add-on, as an ordinary chest screen, with no inventory key and
no menu drawn by you. An entity appears in the player's head holding a copy of the storage's contents;
the player's next click lands on it wherever they look, and the game opens its inventory. Every change
the player makes there is written into the storage in the tick it happens.

```js
import { enderChestSource, installHeldItem, shulkerBoxSource } from "./ContainerUI/ContainerFormData.js";

// Sneaking with a shulker box in hand shows it; a click opens it.
installHeldItem({
    matches: (item) => item.typeId.endsWith("shulker_box"),
    source: () => shulkerBoxSource(),
    title: "Shulker box",
});

// The same with an ender chest in hand: the player's own ender chest.
installHeldItem({
    matches: (item) => item.typeId === "minecraft:ender_chest",
    source: () => enderChestSource(),
    title: "Ender chest",
});
```

The screen is the game's own chest: there are no buttons, no layout and no scan. For a menu of your
own that opens on a click, use [`openBy: "click"`](bedrock-runtime.md#opening-by-click) instead.

## The storage keeps the items

The items never leave the storage. The entity only shows a copy, and the library writes each change
the player makes into the storage, so the two agree from one tick to the next. The copy is never
handed out: when the screen closes, or the server restarts or crashes, the entity is thrown away with
whatever it held.

This matters because the game saves the two places apart. A player's data (their inventory, ender
chest and the shulker box in their hand) and the world's chunks (where the entity lives) reach the disk
at different moments, so after a crash each comes back as it was at its own last save. Had the items
moved into the entity, a crash could hand them out twice. With the storage as the only owner, a crash
copies nothing: the player and the storage come back together as the game last saved them, which can
cost the last seconds before the crash, as it does anywhere in the game.

**A player who leaves with the screen open.** A take in their last moment, after the last write, is
saved on them while the storage still has it. So their entity stays, holding the screen as they left
it, and when they come back that is written into the storage first; then the entity goes. See
[When an open is cut short](#when-an-open-is-cut-short).

**What is compared.** A stackable item is compared by the game itself. A non-stackable one, such as a
tool or a potion, by everything a script can read of it: name, lore, enchantments, durability, dynamic
properties, a bundle's contents and more. Data no script reads, such as an armour trim, can still
differ between two such items, so closing the screen writes every slot once more while one is in.

## `installHeldItem(options)`

Makes an item open a storage. A player who starts sneaking with a matching item in their selected
slot gets the entity in their head; their click opens it; standing up before the click closes it.
Call it once per kind of item, at startup. When several rules match, the first one registered opens.

| Option | Default | Meaning |
| --- | --- | --- |
| `matches` | required | `(item: ItemStack, player: Player) => boolean`: whether an item in hand opens for this player, such as only for players with a tag. A rule that throws counts as no. |
| `source` | required | `(player, item) => HeldSource`: the storage for this open. Make a new source every call. |
| `title` | `"Storage"` | Title of the screen. |
| `clickWaitTicks` | `CLICK_OPEN_WAIT_TICKS` (100) | Ticks to wait for the click before the entity goes. |
| `onEvent` | none | Observes every step; see [Events](#events). |

It throws a `RangeError` for a `clickWaitTicks` that is not a positive whole number, when you call it,
not when a player sneaks.

## `openHeldStorage(player, options)`

Opens a storage from your own code: a command, an item use, a block click. Takes the options above
without `matches`, with `source` as the source itself, plus `whileSneaking` (close when the player
stops sneaking before the click).

```js
world.afterEvents.itemUse.subscribe((vigenersl) => {
    const { source: player, itemStack } = vigenersl;
    if (itemStack.typeId === "minecraft:ender_chest") void openHeldStorage(player, { source: enderChestSource(), title: "Ender chest" });
});
```

It returns a promise of whether the entity is ready for the click: `false` when the player has a
storage open already, or the source could not be read or held. It throws a `RangeError` for a
`clickWaitTicks` that is not a positive whole number when you call it, before the promise. Open it from
an `afterEvents` signal or a command, as with menus opened by click.

## The sources

### `shulkerBoxSource()`

The shulker box in the player's selected slot. Its contents are read through a dispensed copy, as the
[shulker reader](shulker-reader.md) does, which takes about 0.4 s. The shulker box stays in the hand
with everything in it, and while the screen is open it is **locked in its slot** (`ItemLockMode.slot`):
the player cannot move it, drop it, or put it inside itself. Each change rewrites it with the new
contents; its name, lore, dynamic properties, keep-on-death and where it can be placed stay. A shulker box the player
puts inside goes back to them, as in the game: a shulker box holds none. When the screen closes, the
lock it had before comes back.

### `enderChestSource()`

The player's own ender chest, the one every ender chest shows them. Each change is written into it
slot for slot. Copies of menu buttons the ender chest may hold are not shown.

### A source of your own

Anything with slots can be a source: an item of your add-on that keeps its contents, a chest
somewhere in the world, a record in a store. A `HeldSource` is:

| Member | Meaning |
| --- | --- |
| `kind` | What it is, for the observer and for `registerHeldSource`. |
| `read(player, report)` | The contents by slot, up to 27, `undefined` for an empty slot. May return a promise. Returns `undefined` when it cannot be opened. Moves nothing. |
| `prepare?(player)` | Called after `read`, before the entity appears: checks the storage is still there and holds it for the open, say by locking an item. Returns why the open cannot go on, or `undefined`; a throw counts as a reason. Either way nothing is spawned. |
| `write({ player, stacks, changed, report })` | Called in every tick the player changed something: `stacks` are the entity's slots, `changed` the slots that differ from the last write. Writes them into the storage and returns `{ refused }`, the slots it cannot hold; their items go back to the player. Returns `undefined` when the storage is there but cannot take it now: the same change comes again next tick, and a close waits for it. Throws when the storage is gone. |
| `release?(player)` | Called once the open ends while the player is in the world: undoes what `prepare` did. For a player who left, the kind's `release` does it when they join. |
| `key?()` | Names this open's storage for the kind's `resume`, should the player leave with the screen open. |

```js
import { world } from "@minecraft/server";

/** A chest somewhere in the world, opened from anywhere. */
const remoteChest = (dimension, location) => {
    const containerOf = () => dimension.getBlock(location)?.getComponent("minecraft:inventory")?.container;
    return {
        kind: "remote-chest",
        read() {
            const container = containerOf();
            if (!container || container.size > 27) return undefined;
            return Array.from({ length: container.size }, (unused, index) => container.getItem(index));
        },
        write({ stacks, changed }) {
            const container = containerOf();
            if (!container) throw new Error("the chest is gone");
            changed.forEach((index) => container.setItem(index, stacks[index]));
            return { refused: [] };
        },
    };
};

world.afterEvents.itemUse.subscribe((vigenersl) => {
    const { source: player, itemStack } = vigenersl;
    if (itemStack.typeId !== "minecraft:gold_ingot") return;
    void openHeldStorage(player, { source: remoteChest(world.getDimension("overworld"), { x: 0, y: 64, z: 0 }), title: "Bank" });
});
```

- **Write what you are given.** `stacks` is the truth of the screen; the player may have taken out,
  put in, split or swapped anything.
- **Return `undefined` when the storage cannot take a write now**, and the change comes again next
  tick. Nothing goes back to the player meanwhile: what they took out is theirs, and the storage gets
  it once it can.
- **Throw when the storage is gone.** The open then ends: what the player put in since the last write
  goes back to them, only the part a stack gained when it was topped up, and the rest of the copy is
  thrown away.
- **Changes made elsewhere while the screen is open are overwritten** by the next write. Keep other
  code off a storage while a player has it open.

## When an open is cut short

**The player leaves with the screen open.** Their entity stays where they were, marked with the kind
and the source's `key()`, holding the screen as they left it; a click on it by anyone is refused, and
the world remembers it is theirs. From the tick after they join again, the kind's `resume` writes that
into the storage, what it cannot hold goes to them, and the entity goes. Until then nothing else opens
for them by click, not even an ender chest block, and nothing an open left on them is undone. A screen
whose chunk has not loaded yet, or a storage that cannot be reached yet, is tried again for about 5
seconds; after that, or for a kind with no `resume`, the storage keeps what was last written, and a
screen that loads later is thrown away unwritten. The library's shulker box and ender chest resume,
after a restart too. Other writers to the storage are not held back meanwhile: a menu over
`PlayerEnderStorage`, or your own script, that changes the ender chest in that window is written over.

**The storage refuses the last write for 5 seconds after the close**, or the runtime is uninstalled
mid-close: the entity is kept the same way, and written as above, at once for a player still here,
else when they next join or the runtime is installed again. A kind with no `resume` keeps what was
last written, and is released. A shulker box an earlier open left marked does not open until that is
settled.

**A restart, a crash or a script reload.** The entity, with a copy of the items, is thrown away when it
loads, or when a player clicks it, and nothing in it is handed out. Only this pack's entities are
touched: another add-on carrying the library decides about its own.

**What `prepare` left on the player**, such as a shulker box still locked in its slot, is undone when
they join, after any screen they left open is written: the kind's `release` runs for every player who
joins, so make it cheap and safe to run when nothing is left.

`registerHeldSource(kind, { release, resume? })` registers both for a kind of your own:

| Member | Meaning |
| --- | --- |
| `release(player)` | Undoes what an open left on the player. |
| `resume({ player, key, stacks })` | Writes `stacks`, the screen as the player left it, into the storage `key` names. Returns `{ refused }`, `undefined` when the storage cannot be reached yet, or throws when it is gone. |

```js
registerHeldSource("backpack", {
    release: (player) => unlockBackpacks(player),
    resume: ({ player, key, stacks }) => writeBackpack({ player, backpackId: key, stacks }),
});
```

## Events

`onEvent` receives `{ kind, step?, detail? }` (`HeldOpenEvent`):

| `kind` | Meaning |
| --- | --- |
| `step` | The source reports a step; `step` says which, such as the shulker reader's `start`, `read` or `written`. |
| `ready` | The entity is in the player's head, showing the contents (`detail`: `occupied=N`). |
| `opened` | The player has the screen. |
| `refused` | Items the source cannot hold went back to the player (`detail`: `slots=…`). |
| `closed` | The open ended; the storage holds what the player left in it. `detail` gives the reason as `reason=…`: `closed` (the player closed the screen), `timeout` (no click in time), `stood-up` (stopped sneaking), `owner-left`, `uninstalled`, `entity-gone` (the copy was removed without a close), or `source-lost error=…`; ` kept-for-return` follows when the screen waits for the player's return. |
| `aborted` | Nothing was opened: the source could not be read or held, or the player stood up or left during the read (`detail` says why). |

Records from source `storage`: `held-storage-discarded` for a copy thrown away and
`held-storage-resumed` for a screen written on its player's return, both `info`; and the failures, as
`warn`: `held-write-failed` (the storage was gone), `held-release-failed`, `held-resume-failed`,
`held-pending-failed`, `held-source-failed` (a rule's `source` threw) and `held-storage-discard-failed`.
See [records](../reference/records.md#log-sources).

## Requirements

- The shared ContainerUI packs 1.0.2 or newer: they hold the `containerui:held_storage` entity.
- `installBedrockRuntime()` installs the world hooks; `installHeldItem` and `openHeldStorage` do so
  too when called first.
- A player has one storage open by click at a time.
