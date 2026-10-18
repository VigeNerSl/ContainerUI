# Storage and mirroring

Menus often show items that live somewhere else: a chest, a block's inventory, a player's
inventory, a list of auction lots. ContainerUI models all of them as a **`SlotStorage`** — a row of
slots you can read and write, with a signal that announces changes — and gives you two components
to put one on screen:

| Component | The player… | Use it for |
| --- | --- | --- |
| [`StorageSlots`](#storageslots) | takes and places **real items** | chests, backpacks, block inventories |
| [`StorageView`](#storageview) | sees **display copies** and can click them | auction lots, inspecting someone's inventory, pickers |

## `SlotStorage`

```ts
interface SlotStorage {
    readonly size: number;
    get(index: number): ItemView | null;          // tracked
    set(index: number, item: ItemView | null): void;
    readonly version: ReadonlySignal<number>;     // bumped on every change
}
```

- `get` subscribes whatever is running, so a slot rendered from `storage.get(i)` repaints when the
  storage changes.
- `set` writes a slot and bumps `version`. It may throw when the underlying store is gone (a broken
  block, a player who left).
- `version` changes on every change, including changes made outside the storage (for storages that
  watch for them).

A storage returning real items (views with `native`) must return **the same view object** for a
slot on every read until that slot changes. The library relies on that identity to tell "the
player took the item I showed" from "someone swapped in a look-alike". The built-in storages do
this for you.

The library ships these storages:

| Storage | Holds | Created with |
| --- | --- | --- |
| `MemoryStorage` | plain views in memory | `createMemoryStorage(size, initial?)` |
| `BlockStorage` | a block container's storage entity | `BlockStorage.forEntity(entity)` (usually through [block containers](block-containers.md)) |
| `PlayerInventoryStorage` | a player's 36 inventory slots | `PlayerInventoryStorage.forPlayer(player)` |
| `PlayerEnderStorage` | a player's 27 ender chest slots | `PlayerEnderStorage.forPlayer(player)` |
| `EntityInventoryStorage` | any entity's inventory | subclass it, see [below](#your-own-entity-storage) |

## `StorageSlots`

Mirrors a range of a storage as [controlled inputs](interaction.md#controlled-inputs) marked
`isMirror`. The storage holds the items; the menu shows them; a player's edit is written to the
storage; and closing the menu leaves the items in the storage.

```tsx
import { BlockStorage, StorageSlots } from "containerui";

function ChestMenu({ entity }: { entity: Entity }) {
    const storage = BlockStorage.forEntity(entity);
    return <StorageSlots storage={storage} index={0} count={27} onEdit={(vigenersl) => log(vigenersl)} />;
}
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `storage` | `SlotStorage` | The storage to mirror. |
| `from` | `number` | First storage slot shown. Default `0`. |
| `count` | `number` | How many slots. Default: the rest of the storage. |
| `index` | `number` | Menu slot of the first one. Omit to place them in the parent's layout flow. |
| `accept` | `(item) => boolean` | Refuse an incoming item: it goes back to the player. |
| `onEdit` | `(event: InputEvent) => void` | Called after an edit has been written to the storage. |
| `onConflict` | `(event: InputEvent) => void` | Called when an edit was refused because the slot changed under it. |

Storage slot `from + n` appears at menu slot `index + n` (or the `n`-th cell of the flow). With a
`grid` parent you can lay a storage out in any shape:

```tsx
<grid index={10} columns={7}>
    <StorageSlots storage={backpack} count={21} />
</grid>
```

### How an edit reaches the storage

When the player edits slot `i`, `StorageSlots` compares the storage's current item with the item
the player saw (`event.previous`):

- **They match** — the usual case. The new item is written to the storage, and `onEdit` runs.
- **They differ** — someone else changed that slot in the same tick, usually another player viewing
  the same chest. The storage keeps what it holds, and the player's side is undone:
  - what they took is taken back from them (`takeBack`);
  - what they placed is given back if the slot is now occupied, or stored if it is empty;
  - `onConflict` runs.

This is what keeps two players sharing a chest from duplicating an item. See
[Multiplayer](multiplayer.md#two-players-one-chest).

If writing to the storage throws (the block was broken), the error is reported and the slot snaps
back to what the storage holds.

## `StorageView`

Shows a storage without handing its items over. Every slot is decorative and shows a display copy:
the player can click, but can never take the item.

```tsx
<StorageView
    storage={lots}
    index={10}
    count={21}
    sound="random.click"
    onSlotClick={(storageIndex, item) => openLot(storageIndex)}
    decorate={(item, storageIndex) =>
        item && { ...item, lore: [...(item.lore ?? []), `§7Price: §e${priceOf(storageIndex)}`] }
    }
/>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `storage`, `from`, `count`, `index` | | As for `StorageSlots`. |
| `onSlotClick` | `(storageIndex, item) => void` | Makes every slot a button. Receives the **storage** index and the item as shown. |
| `sound` | `string` | Played on click; needs `onSlotClick`. |
| `decorate` | `(item, storageIndex) => ItemView \| null` | Changes how an item is **shown**, never what is stored. Return `null` to hide the slot. |

`decorate` receives a copy without the real stack (`native` is stripped before it is called), so
nothing it adds can end up on the stored item. The auction pattern follows from that: the storage
keeps the seller's original item; the view adds price and seller lines; the buyer receives the
original, which never had those lines, so nothing has to be stripped.

```ts
// On purchase: take the clean original from the storage.
const original = lots.get(index);
lots.set(index, null);
give(buyer, original);
```

## The in-memory storage

`createMemoryStorage(size, initial?)` is a `SlotStorage` held in memory. Use it for virtual
inventories (a bank that lives in a `JsonStore`), for listings, and in tests.

```ts
const bank = createMemoryStorage(27, [{ typeId: "minecraft:diamond", amount: 3 }]);
bank.get(0);          // { typeId: "minecraft:diamond", amount: 3 }
bank.set(1, APPLE);
bank.snapshot();      // copies of all 27 slots
```

Besides `SlotStorage`, a `MemoryStorage` has:

| Member | Meaning |
| --- | --- |
| `silentSet(index, item)` | Writes without bumping `version`, like a change made behind the storage's back. |
| `notifyExternalChange()` | Bumps `version`, after `silentSet`. |
| `snapshot()` | Copies of every slot, as an array. |

An index outside `0..size-1` throws `RangeError`. Items are copied on the way in, so later changes to
the object you passed do not leak into the storage.

## A player's inventory

`PlayerInventoryStorage.forPlayer(player)` is the player's inventory as a storage: slots 0–8 are the
hotbar, 9–35 the main grid. There is one instance per player; every call returns the same one.

```tsx
function InventoryMirror({ player }: { player: Player }) {
    const storage = PlayerInventoryStorage.forPlayer(player);

    useEffect(() => {
        storage.startWatching();
        return () => storage.stopWatching();
    }, []);

    return <StorageView storage={storage} index={9} onSlotClick={(slot, item) => pick(slot, item)} />;
}
```

- **Show a player's own inventory with `StorageView`, not `StorageSlots`.** The player already sees
  their inventory under the chest screen; mirroring it as inputs would put the same items in two
  places at once. `StorageSlots` over *another* player's inventory (an admin "invsee") is fine.
- **Changes the player makes themselves** (moving items in their own inventory) are not writes
  through the storage. `get` always reads what the slot holds now, but nothing re-renders on such a
  change unless the storage is **watching**. `startWatching()` checks every 2 ticks; call
  `stopWatching()` when you are done. Watching is reference-counted: several menus may watch one
  storage.
- The storage is dropped when the player leaves, and on `uninstallBedrockRuntime()`.
  `PlayerInventoryStorage.evict(playerId)` drops it yourself.
- `playerId` and `player` (the `Player`, or `null` once gone) are available on the instance.

`PLAYER_INVENTORY_WATCH_INTERVAL_TICKS` (2) is the default watch interval.

## A player's ender chest

`PlayerEnderStorage.forPlayer(player)` is the player's ender chest as a storage: the 27 slots every
ender chest shows them. Unlike their inventory it is not on screen under a menu, so `StorageSlots`
over it is the usual way to show it; what the menu writes is what every ender chest then shows them.

```tsx
function EnderChest({ player }: { player: Player }) {
    const storage = PlayerEnderStorage.forPlayer(player);

    useEffect(() => {
        storage.startWatching();
        return () => storage.stopWatching();
    }, []);

    return <StorageSlots storage={storage} />;
}
```

It works like the inventory storage: one instance per player, watching is reference-counted, it is
dropped when the player leaves, and `PlayerEnderStorage.evict(playerId)` drops it yourself.
`enderContainerOf(player)` returns the ender chest's `Container`, or `null` when the game has not given
the player one yet.

## Block storages

`BlockStorage.forEntity(entity)` wraps the storage entity of a [block container](block-containers.md).
One instance per entity, shared by every menu over that block, so a change by one viewer repaints
every other viewer's menu.

Besides the members every entity storage has (below), it has:

| Member | Meaning |
| --- | --- |
| `entity` | The storage entity, or `null` once gone. |
| `inventorySummary()` | The contents as `slot:typeIdxamount` pairs, or `empty`. For logs. |
| `onInvalidated(handler)` | Called once when a watch pass finds the entity gone. |
| `BlockStorage.evict(entityId)` | Drops an entity's storage. |

Every write through a block storage is logged as a `storage-write` [block record](../reference/records.md#block-container-records).

## Entity storages

`BlockStorage`, `PlayerInventoryStorage` and `PlayerEnderStorage` share a base class, `EntityInventoryStorage`, which you
can extend for any entity with an inventory (a backpack entity, a mount, a custom NPC).

Every entity storage has:

| Member | Meaning |
| --- | --- |
| `entityId` | The entity's id. |
| `isValid` | Whether its inventory can be read now. |
| `size` | Slot count (tracked, so a render against a late inventory runs again). |
| `version` | Bumped on every change. |
| `get(index)` | The slot's view. The same object until the slot changes; a slot changed behind the storage's back — through a chest's own screen, a dropped item, a command — is read again, watched or not. A failed read returns `null` and is reported once per outage. |
| `set(index, item)` | Writes the slot. Throws when the entity is gone. **Skipped** when the slot already holds this item: an empty slot written empty, or a slot written back the exact view `get` returned while it still holds that item. |
| `notifyExternalChange()` | Tell the storage its inventory changed behind its back: every view is re-read and dependents re-render. |
| `startWatching(intervalTicks?)` | Start (or join) a timer that notices changes made outside the storage. Reference-counted. |
| `stopWatching()` | Leave the watch; the timer stops with the last watcher. |
| `watchStats` | `{ passes, totalMs }` spent watching so far. |

The entity is found again by id if it reloads (a chunk unloads and loads), so a storage survives
that.

### Your own entity storage

Subclass `EntityInventoryStorage`, give it a constructor that passes the entity and a default watch
interval, and say what error a write to a gone entity throws. The other hooks are optional.

```ts
import { EntityInventoryStorage, type ItemView } from "containerui";
import type { Entity } from "@minecraft/server";

export class BackpackStorage extends EntityInventoryStorage {
    static readonly #byId = new Map<string, BackpackStorage>();

    static forEntity(entity: Entity): BackpackStorage {
        let storage = BackpackStorage.#byId.get(entity.id);
        if (!storage) {
            storage = new BackpackStorage(entity);
            BackpackStorage.#byId.set(entity.id, storage);
        }
        return storage;
    }

    private constructor(entity: Entity) {
        super(entity, 10); // default watch interval, in ticks
    }

    protected override _containerGone(index: number): Error {
        return new Error(`[backpack] The backpack is gone; slot ${index} was not written.`);
    }

    protected override _onWritten(index: number, item: ItemView | null): void {
        console.info(`[backpack] slot ${index} = ${item?.typeId ?? "empty"}`);
    }
}
```

| Protected member | Meaning |
| --- | --- |
| `constructor(entity, defaultWatchIntervalTicks)` | Call it from yours. |
| `_containerGone(index)` | **Required.** The error `set` throws when the entity is gone. |
| `_onWritten(index, item)` | After a write reaches the inventory, before dependents hear of it. |
| `_onExternalChange(slotCount)` | When the watch finds slots changed from outside; receives how many. |
| `_onInvalid()` | Once, when the watch finds the entity gone. |
| `_onReadFailure(detail)` | Once per outage, when a read fails. |
| `_entity()` | The entity, or `null` once gone (re-resolved by id). |
| `_container()` | Its inventory container, or `null`. |
| `_containerOf(entity)` | Which of the entity's containers is the storage. Defaults to its `minecraft:inventory`; override it to store elsewhere, such as `enderContainerOf(entity)` for a player's ender chest, which also turns an invalid container or a failed read into `null`. |
| `_dispose()` | Stops the watch for good and forgets every view. Call it when you drop the storage. |

Keep one instance per entity, as above. Two instances over one entity would each have their own
version signal and view cache, and menus over them would not see each other's writes.

## Watching a container yourself

`createContainerWatcher` is the watch the storages use, exposed for your own containers:

```ts
import type { Entity } from "@minecraft/server";
import { createContainerWatcher, inventoryContainerOf } from "containerui";

declare const entity: Entity;

const watcher = createContainerWatcher({
    resolveContainer: () => inventoryContainerOf(entity),
    onExternalChange: (slotsChanged) => console.info(`[shop] ${slotsChanged.length} slot(s) changed`),
    onInvalid: () => console.info("[shop] container gone"),
});
watcher.start(10);   // check every 10 ticks
watcher.record(3, { typeId: "minecraft:apple", amount: 4, name: "" }); // your own write: not reported
watcher.stop();
```

| Member | Meaning |
| --- | --- |
| `start(intervalTicks)` | Starts or joins the watch. |
| `stop()` | Leaves; the timer stops with the last watcher. |
| `dispose()` | Stops regardless of watchers. |
| `record(index, written)` | Records a write of your own so it does not read as an outside change. `written` is what the slot now holds as a `SlotProbe`, `{ typeId, amount, name }` (`name` is `""` for no name tag), or `null` for an empty slot. |
| `reset()` | Re-reads every slot as the new baseline. |
| `stats` | `{ passes, totalMs }`. |

`inventoryContainerOf(entity)` returns an entity's inventory `Container`, or `null` when it has none,
is no longer valid, or the read failed.
