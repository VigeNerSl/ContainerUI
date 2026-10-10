# Interaction

A Bedrock container screen has no click events. The player moves real items: picks one up, drops
one in, swaps, shift-clicks, drags. ContainerUI watches the slots, works out which gesture happened,
and turns it into one call of your handler. This page describes what each kind of slot does with
each gesture, and the events your handlers receive.

## The four kinds of slot

Every slot of a menu is one of these, decided on every commit by what you declared:

| Declared as | Kind | When the player takes the item | When the player puts an item in |
| --- | --- | --- | --- |
| `<slot item>` | decorative | The item is put back. Nothing is called. | The item goes back to the player. Nothing is called. |
| `<slot item onClick>` | button | `onClick` is called once, then the item is put back. | The item goes back to the player, and `onClick` is called. |
| `<input>` | input | The player keeps it. `onTake`, then `onChange`. | It stays. `onPlace` (or `accept` first), then `onChange`. |
| nothing | undeclared | — | The item goes back to the player, and the slot is cleared. |

A button whose item is `null` is decorative: there is nothing to press.

The player can never keep an item a menu drew. Every such item carries an invisible marker, and
marked items are taken back from the cursor, removed from the inventory, and destroyed on the
ground. See [Items](items.md#the-anti-duplication-guard).

## Buttons

```tsx
<slot
    index={22}
    item={{ typeId: "minecraft:emerald", name: "§aBuy" }}
    sound="random.orb"
    onClick={(vigenersl) => {
        buy(player);
        if (isLastPurchase) vigenersl.close();
    }}
/>
```

When the click completes, the library:

1. plays `sound` to the player, if set;
2. calls `onClick` with a `SlotEvent`;
3. puts the button back in its slot (as it is declared *now*, if your handler changed it).

A handler that throws is reported as a `handler-error` diagnostic; the button is still put back.
Handlers run inside a [batch](reactivity.md#batching-and-flushing), so any number of state changes
in one handler cause one render.

### `SlotEvent`

| Member | Meaning |
| --- | --- |
| `index` | The slot the click happened on. |
| `item` | The item the slot holds, as declared (the button). |
| `close()` | Closes the menu. |

### What counts as a click

On a computer, clicking a button picks it up onto the cursor. The library sees the item on the
cursor, takes the copy straight back, fires `onClick`, and repaints the button — all in one scan
pass, usually the same tick. The player sees one click.

With touch controls there is no cursor: a tap moves the item straight into the inventory. The
library finds the copy in the inventory, removes it, and fires.

In general, a button fires once the library has **found** the copy the player took: on the cursor,
in another slot of the menu, in the inventory, in an input, or on the ground if it was thrown. Until
then the gesture is still in progress (a drag, for instance), and firing early would run the handler
while a duplicate exists. The consequences:

- Dragging a button into the inventory, shift-clicking it, throwing it: each fires `onClick` once.
- Double-clicking to collect all of one item type counts once per button actually collected.
- If a take is never located (the engine destroyed the item), nothing fires, and the button is
  repainted after about a second.
- If the slot is repainted with something else while a take is in flight — the menu navigated, or
  a signal changed that slot — the gesture is dropped: the copy is still taken back, but nothing
  fires, because the button the player lifted no longer exists.

Dropping your own item onto a button counts as pressing it: the item returns to the exact
inventory slot it came from (or to the player's feet if the inventory is full), and `onClick` fires.
A swap — dropping your item on a button while it is on the cursor — is one gesture and fires once.

### Sounds

`sound` is a Bedrock sound id played to the viewer only: `random.click`, `random.orb`,
`note.pling`, `note.bass`, `random.pop`, `mob.villager.yes`, and so on. It plays for button clicks
only, before the handler runs.

## Inputs

An `input` is a slot the player owns. They may put items in, take them out and swap them, and the
items are real: nothing is marked, and what the player takes out, they keep.

There are two kinds of input.

### Uncontrolled inputs

```tsx
<input
    index={13}
    initialItem={null}
    accept={(item) => item.typeId !== "minecraft:bedrock"}
    onPlace={(vigenersl) => console.info(`[forge] placed ${vigenersl.next?.typeId}`)}
    onTake={(vigenersl) => console.info(`[forge] took ${vigenersl.previous?.typeId}`)}
/>
```

`initialItem` (optional) is written once, when the input first appears. From then on the slot holds
whatever the player put there, and the library never overwrites it — even when the component
renders again with a different `initialItem`.

**When the menu closes, an item left in an uncontrolled input is given back to the player** (into
their inventory, or dropped at their feet if it is full). You never lose a player's item by closing.

To consume the item from one of the input's own handlers, call `clear()` on the event: the slot is
emptied and the item is gone. A trash slot, or a furnace that eats fuel as it is placed:

```tsx
<input
    index={22}
    onPlace={(vigenersl) => {
        burn(vigenersl.next!);
        vigenersl.clear();
    }}
/>
```

To consume the item from somewhere else — a "sell" button next to the input — use a controlled input.

### Controlled inputs

```tsx
function SellSlot({ player }: { player: Player }) {
    const offered = useSignal<ItemView | null>(null);

    return (
        <>
            <input index={13} item={() => offered.value} onChange={(vigenersl) => (offered.value = vigenersl.next)} />
            <slot
                index={15}
                item={SELL}
                onClick={() => {
                    const item = offered.peek();
                    if (!item) return;
                    payFor(player, item);
                    offered.value = null; // the item is consumed
                }}
            />
        </>
    );
}
```

An input with an `item` prop is **controlled**: your source is the truth, and the declared item is
written on every commit. The player's edit reaches you through `onChange`; it is your job to store it.
If you do not, the slot snaps back to what your source says on the next commit. That is what makes
controlled inputs safe mirrors of real inventories: an edit that fails to reach the source cannot
leave the two disagreeing. [`StorageSlots`](storage-and-mirroring.md#storageslots) is built this way.

Setting the source to `null` empties the slot: the item is gone. That is how you consume an item.

**When the menu closes, a real item left in a controlled input is given back to the player**, as for
an uncontrolled one. In the example above, a player who closes the menu without selling gets their
item back.

The exception is a **mirror**: an input whose source is where the real item actually lives, such as a
chest. Its slot only shows a copy of what the source holds, so handing the copy out on close would
duplicate the item. Mark such inputs with `isMirror`:

```tsx
<input index={0} item={() => chest.get(0)} isMirror onChange={(vigenersl) => chest.set(0, vigenersl.next)} />
```

[`StorageSlots`](storage-and-mirroring.md#storageslots) marks its inputs this way. You only need
`isMirror` when you write a mirror of your own.

### Input events

`onPlace`, `onTake` and `onChange` receive an `InputEvent`:

| Member | Meaning |
| --- | --- |
| `index` | The slot. |
| `previous` | What the slot held before the edit, or `null`. |
| `next` | What it holds after the edit, or `null`. |
| `item` | The same as `next`. |
| `close()` | Closes the menu. |
| `takeBack(item)` | Takes an item like `item` back from the player. For an edit you refuse after the fact. |
| `giveBack(item)` | Gives `item` to the player: something they placed that you cannot keep. |
| `clear()` | Empties the slot: its item is consumed. On a controlled input the declared item comes back on the next commit, so set your source to `null` instead. |

Which handlers run:

| Edit | `onPlace` | `onTake` | `onChange` |
| --- | --- | --- | --- |
| Empty → item | ✓ | | ✓ |
| Item → empty | | ✓ | ✓ |
| Item → another item (swap), or a changed amount | | | ✓ |

The items in the event are real: a view read from the actual stack, carrying it in `native`, so
enchantments, durability and custom data survive when you store it and write it back later.

A partial take — the player lifts half a stack — is an edit from 64 to 32: `onChange` only, with
`previous.amount === 64` and `next.amount === 32`.

### `accept`

`accept(item)` is asked before an item enters the slot. Return `false` to refuse it:

- the refused item is **given back to the player** (inventory, or their feet if it is full);
- the slot is **left empty**;
- if the slot held an item before (the player swapped), that item is now on the player's cursor, so
  the edit is reported as a take: `onTake` and `onChange` run with `next: null`.

If `accept` throws, the error is reported and the item is accepted.

```tsx
<input index={13} accept={(item) => item.typeId.endsWith("_ore")} onPlace={smelt} />
```

### `takeBack` and `giveBack`

These let a handler undo an edit after it happened. `StorageSlots` uses them when two players edit
one chest slot in the same tick: the losing player's copy is taken back, and an item they placed
that no longer fits is given back.

- `takeBack(item)` looks for an item like `item` on the player's cursor, then in their inventory,
  and removes up to `item.amount` of it. Like means the same type, name, lore, enchantments,
  durability, potion, block states and tags; the stack size does not matter, and a drawn (marked)
  copy never counts. If it is not found at once, the library keeps looking for a few seconds (every
  half second), and sends a `conflict-unresolved` trace line to the menu's `onTrace` if it never
  finds it (silent by default).
- `giveBack(item)` puts `item` into the player's inventory, or at their feet if it is full.

Both are no-ops on a host that does not support them (the test host records them instead).

## Closing

A menu closes when:

| Reason (`CloseReason`) | When |
| --- | --- |
| `"player"` | The player closed the screen. |
| `"programmatic"` | Your code called `close()`: `SlotEvent.close()`, `ContainerSession.close()`, or opening another menu for the same player. |
| `"distance"` | The player moved more than 8 blocks from the menu entity (`maxViewDistance`). |
| `"invalidated"` | The player left the world, or the menu entity disappeared; or the menu could not open. |

On close, in this order:

1. Edits to inputs that the last scan had not seen yet are reported through your handlers, while
   the menu is still mounted, so a last-moment take from a chest mirror reaches the chest.
2. A marked copy still on the player's cursor is removed.
3. Real items left in decorative slots, buttons and inputs go back to the player (inventory, then
   feet). Mirror inputs (`isMirror`, `StorageSlots`) are skipped: their source keeps the item.
4. The menu entity is emptied and removed.
5. The player's inventory is swept for marked copies, now and again a few ticks later (the client
   applies some moves late).
6. Your components unmount: effect cleanups and `onUnmount` callbacks run.

## Timing

The library scans every tick while the player is active, and every other tick after about a second
of inactivity (see [Performance](performance.md#scan-pacing)). A click is usually handled in the tick
it happens; the first click after a pause may take one tick more. Handlers run synchronously inside
the scan, and their state changes are committed at the end of the tick.
