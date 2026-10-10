# Multiplayer

A Bedrock server runs one script context for everyone, so every player's menus live in the same
JavaScript world. That makes sharing easy and accidental sharing easy too. This page covers who sees
what, and what happens when players act on the same thing at the same time.

## Each player has their own menu

A menu belongs to one player. Opening one creates a separate entity, a separate mounted tree, and
separate component state. Two players with the same shop open do not share `useState` values.

A player has at most one menu open: opening another closes the first.

## Shared state is explicit

Whatever you create **outside** a component is shared by every menu that reads it:

```ts
// Shared by every player: one balance for the whole server — probably a bug.
const coins = signal(100);
```

Key per-player state by player id:

```ts
const coinsById = new Map<string, Signal<number>>();

const coinsOf = (player: Player): Signal<number> => {
    let coins = coinsById.get(player.id);
    if (!coins) {
        coins = signal(100);
        coinsById.set(player.id, coins);
    }
    return coins;
};

world.afterEvents.playerLeave.subscribe((vigenersl) => coinsById.delete(vigenersl.playerId));
```

And share deliberately what should be shared: an auction house, a server-wide counter, a global
event timer. Every menu reading a shared signal repaints when it changes, for every player, with no
extra code — that *is* the multiplayer sync.

## Two players, one chest

Block containers, and any storage you mirror with `StorageSlots`, can be open for several players at
once. They share one storage object (`BlockStorage.forEntity` returns the same instance for the same
entity), so:

- an edit by one player is written to the storage and repaints the other players' menus in the same
  tick;
- a storage changed from outside (a hopper, a command) is noticed by the watch while a menu is open;
- a native viewer of a block (`open: "native"`) and a menu viewer see the same inventory.

The hard case is two players changing **the same slot in the same tick**, for example both grabbing
the one diamond in slot 4. Both clients showed the diamond, so both believe they took it. Without a
guard, the diamond would be duplicated.

`StorageSlots` checks each edit against the storage before writing it. The first edit processed
wins. For the second, the slot no longer holds what that player saw, so:

1. the item they took is **taken back** from their cursor or inventory;
2. an item they placed is **given back** if the slot is occupied, or stored if it is free;
3. `onConflict` is called, and block menus log a `conflict` record.

If the item cannot be found to take back at once (the player moved it quickly), the library keeps
looking for a few seconds. If it never finds it, a `conflict-unresolved` line goes to the menu's
`onTrace` option; without `onTrace` this is silent.

Same-tick conflicts are rare in practice — a tick is 50 ms, less than most players' ping — but the
guard makes them safe rather than rare.

If you write your own mirror, follow the same rules: mark its inputs `isMirror`, and before writing
an edit to shared storage, check that the storage still holds `event.previous`; if not, undo the
player's side with `takeBack` and `giveBack`.

## Players leaving

- A player's menu closes when they leave (`"invalidated"`), and their items in it are handled as on
  any close.
- A `PlayerInventoryStorage` is dropped when its player leaves.
- If a player leaves while sneaking at a container block, its storage entity is put back at once.
  If its chunk is not loaded at that moment, it is put back when the chunk loads or at the next world
  start. Breaking the block meanwhile still finds the parked entity and drops its items.

Clean up your own per-player maps in `world.afterEvents.playerLeave`.

## Many menus at once

Each open menu costs a scan per tick (about half a millisecond for a full 27-slot menu, less when the
player is idle). Twenty players with menus open is a modest cost; a hundred deserves a look at
[Performance](performance.md). Menus that nobody is touching slow down to every other tick by
themselves.
