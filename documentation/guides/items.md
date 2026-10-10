# Items

Every slot shows an `ItemView`: a plain object describing an item. The library turns it into a real
Bedrock `ItemStack` when it writes a slot, and turns real stacks back into views when it reads one.

```ts
const sword: ItemView = {
    typeId: "minecraft:diamond_sword",
    name: "§bFrostbite",
    lore: ["§7Forged in ice", "§9+2 cold damage"],
    enchantments: [{ id: "sharpness", level: 5 }, { id: "unbreaking", level: 3 }],
    durability: 1200,
    tags: { "rpg:tier": 3, "rpg:bound": true },
};
```

## `ItemView`

| Field | Type | Meaning |
| --- | --- | --- |
| `typeId` | `string` | Item id, such as `"minecraft:diamond"` or `"myaddon:coin"`. Required. |
| `amount` | `number` | Stack size. Default `1`. Keep it within the item's stack size (`maxStackOf`). |
| `name` | `string` | Display name. Colour codes (`§a`) pass through. **Omit to keep the item's own name.** |
| `lore` | `readonly string[]` | Tooltip lines. **Omit to keep the item's own tooltip.** |
| `enchantments` | `readonly ItemEnchantment[]` | Enchantments to apply: `{ id, level }`. |
| `durability` | `number` | Remaining durability: maximum minus damage. Omit for an undamaged item. |
| `potion` | `{ effect, delivery? }` | Makes the item a potion, or a splash or lingering bottle. |
| `blockStates` | `Record<string, string \| number \| boolean>` | Block states for a block item that had data values, such as a dropper's facing or a mushroom block's variant. |
| `tags` | `Record<string, string \| number \| boolean>` | Invisible data stored on the stack. Non-stackable items only. |
| `native` | `unknown` | The real item this view describes. Set by the library when it reads a real stack. |

### Only what you ask for

The library writes no name and no lore you did not give. `{ typeId: "minecraft:diamond" }` renders as
an ordinary diamond with its vanilla name and tooltip. Give `name: " "` (a space) for a nameless-
looking filler such as a glass pane.

### Enchantments

```ts
const pickaxe: ItemView = { typeId: "minecraft:diamond_pickaxe", enchantments: [{ id: "efficiency", level: 5 }, { id: "fortune", level: 3 }] };
```

- `id` is the enchantment type id, with or without `minecraft:` (`"sharpness"`, `"minecraft:sharpness"`).
- Each enchantment is applied where the engine allows it. One it refuses — a type the item cannot
  take, a level out of range — is skipped with **one warning per item type**, and the rest still
  apply.
- An item that cannot be enchanted at all (a diamond, a pane) ignores `enchantments` with one
  warning per item type.
- Read back from real items as bare ids (`"sharpness"`), so the diff notices a swap between two
  differently enchanted swords.

An enchanted item shows the enchantment glint. Items that cannot take enchantments cannot show a glint
through this field; use a custom item of your own with a glint if you need one.

### Durability

```ts
const worn: ItemView = { typeId: "minecraft:iron_sword", durability: 10 }; // almost broken
```

`durability` is what remains: the item's maximum durability minus its damage. An item without
durability ignores it with one warning per item type. Read back from real items; an undamaged item
reads back without the field.

### Potions

Bedrock tells a potion of fire resistance from an ordinary one by a **data value**
(`/give @s potion 1 12`). The script API has no data values: it builds a potion from an **effect**
and a **delivery**.

```ts
const bottle: ItemView = { typeId: "minecraft:potion", potion: { effect: "fire_resistance" } };
const splash: ItemView = { typeId: "minecraft:splash_potion", potion: { effect: "strong_healing" } };
const lingering: ItemView = { typeId: "minecraft:lingering_potion", potion: { effect: "long_nightvision" } };
```

| Field | Meaning |
| --- | --- |
| `effect` | The potion effect id, with or without `minecraft:`. Strength and duration are part of it: `healing`, `strong_healing`, `nightvision`, `long_nightvision`. |
| `delivery` | How it is delivered. You rarely need it: it defaults to the delivery the item id implies. |

| `typeId` | Default `delivery` |
| --- | --- |
| `minecraft:potion` | `Consume` |
| `minecraft:splash_potion` | `ThrownSplash` |
| `minecraft:lingering_potion` | `ThrownLingering` |

- The stack is built by the engine, so its name, colour and tooltip are the vanilla ones.
- An effect the engine does not know is skipped with **one warning per combination**, and the plain
  item is shown instead.
- Read back from real items — a lingering bottle of wither reads as
  `{ effect: "minecraft:wither", delivery: "ThrownLingering" }` — so a menu that mirrors a chest shows
  each potion as itself, and the diff notices a swap between two potions of the same item type.

**Tipped arrows are outside this API, in both directions.** The engine registers deliveries for
drinking, throwing and lingering only — none of them builds an arrow — so
`{ typeId: "minecraft:arrow", potion: … }` shows a plain arrow and warns once. Nor does it expose the
effect of a real tipped arrow: an arrow of fire resistance read from a chest comes back as a plain
`minecraft:arrow` with no `potion` (measured on 1.26). A real tipped arrow still **looks** right
wherever you show it, because the view carries the stack itself in `native`; only its effect is
invisible to your code.

To see what your world registers, list them:

```ts
import { Potions } from "@minecraft/server";

Potions.getAllEffectTypes().map((vigenersl) => vigenersl.id);   // "minecraft:healing", "minecraft:long_leaping", …
Potions.getAllDeliveryTypes().map((vigenersl) => vigenersl.id); // "Consume", "ThrownSplash", "ThrownLingering"
```

On Bedrock 1.26 there are 47 effect ids. Every one of them, with the tipped arrow data value that
carries it, is in [Potion effects and arrow data values](../reference/potion-effects.md).

### Block items with states

Vanilla files still list block items by data value — `minecraft:brown_mushroom_block:14`,
`minecraft:dropper:3` — but the script API has no `data` there either. Such an item is a **block with
states**, and the engine builds its item form from them:

```ts
const mushroomSide: ItemView = { typeId: "minecraft:brown_mushroom_block", blockStates: { huge_mushroom_bits: 14 } };
const dropper: ItemView = { typeId: "minecraft:dropper", blockStates: { facing_direction: 3 } };
```

- The stack comes from the block, so it places as that block.
- A block or a state the engine does not know is skipped with **one warning per block**, and the
  plain item is shown.
- `blockStates` is **not read back** from real items: the engine exposes no states on an item stack.
  It is compared by the diff, so a menu can show two variants side by side.

The states a block accepts are in the vanilla block documentation, or from a placed block:

```ts
world.getDimension("overworld").getBlock(location)?.permutation.getAllStates();
```

**Not every data value is a block state.** A bed's colour, for instance, lives in the block's entity
data, not in a state, so `minecraft:bed` with `{ color: … }` is refused: the engine cannot resolve
that block. Show a coloured bed with a real item, or with a custom item of your own.

Other former data values — wool colours, stone types, dyes — are separate item ids in modern
Bedrock (`minecraft:red_wool`, `minecraft:blue_dye`), so a `typeId` is all they need.

### Items only a loot table can build

What is left — a tipped arrow, a map variant, anything the script API has no field for — can still
be built, by a **loot table** your pack ships. A loot table may set an item's aux value, which is the
old data value, and a script may roll that table and take the item out.

**1. Ship one table per variant**, `BP/loot_tables/myaddon/fire_arrow.json`:

```json
{
    "pools": [
        {
            "rolls": 1,
            "entries": [
                {
                    "type": "item",
                    "name": "minecraft:arrow",
                    "weight": 1,
                    "functions": [{ "function": "set_data", "data": 14 }]
                }
            ]
        }
    ]
}
```

**2. Ask for the item by the table's path** — under `loot_tables/`, without that folder and without
`.json`:

```tsx
import { itemFromLootTable } from "containerui";

const fireArrow = itemFromLootTable("myaddon/fire_arrow", { amount: 16 });

<slot index={13} item={fireArrow} onClick={() => give(player, fireArrow)} />;
```

| Option | Meaning |
| --- | --- |
| `index` | Which of the produced stacks to take. Default: the first. |
| `amount` | Stack size of the returned view. Default: what the table produced. |
| `reroll` | Roll the table again instead of reusing the kept item. Default: `false`. |

- The view carries the real stack in `native`, so it shows exactly as the item is, and can be given
  to a player with `toStorageStack`.
- **A table is rolled once and its item kept**, so give each variant its own single-entry table.
  Pass `reroll` for a table that is meant to be random.
- An unknown path, or a table that produced nothing, returns `null` and warns once.
- `set_data` is what works for these items. `set_potion` on an arrow is accepted but leaves a plain
  arrow (measured on 1.26).

The data value of every tipped arrow is in
[Potion effects and arrow data values](../reference/potion-effects.md) — Fire Resistance is 13, the
list runs to 47.

This is also the way to make the items nothing else can: map variants (`minecraft:empty_map:2`) and
banner patterns.

### Tags

`tags` store facts **about** an item without showing them: a listing id, the player who deposited it,
a soulbound flag. They are Bedrock dynamic properties on the stack, so they travel with the item
through inventories and chests, and a player can neither see nor copy them.

```ts
const lot: ItemView = { typeId: "minecraft:diamond_sword", tags: { "auction:lot": "a91f", "auction:seller": player.id } };
```

- **Only non-stackable items keep tags** (swords, tools, armour, elytra — anything with a stack size
  of 1). Bedrock discards dynamic properties on stackable items. The library warns once per item type
  and the tags are lost; there is no fallback. For stackable items keep the data in your own store,
  keyed by slot or listing.
- Tags are **not compared** by the diff: changing only tags does not rewrite the slot.
- Read back from real items (every dynamic property except the library's own marker).

### `native`: real items

When the library reads a real stack — from a storage, an input, a player's inventory — the view
carries a clone of that stack in `native`. Writing such a view writes the clone, so everything about
the item survives, including data `ItemView` has no field for (book contents, custom components,
shulker contents).

`native` is opaque: do not create or change it. Spread a view to change its look, and the real item
comes along:

```ts
const shown = { ...storage.get(0), name: "§7Back", lore: ["§7Price: 10"] }; // still the real item underneath
```

The copy that is written wears what the view names — `name`, `lore`, `enchantments`, `durability`,
`tags` — and keeps the real item's own for every field the view leaves out. That matters beyond
looks: the scan compares a slot with what was written, so a name the write dropped would read back
as if the player had touched the slot.

Where a real item is written decides what it becomes:

- into an `input` (a slot the player owns): written as it is, unmarked, a real item;
- into any other slot (decorative or button): **marked** like every drawn item, because an item that
  is only *shown* must not be takeable.

## Display copies

`toDisplayView(item)` returns a copy without `native`: just the look. Use it to show real items the
player must not get, such as another player's inventory or auction lots:

```tsx
<slot item={toDisplayView(storage.get(0))} />
```

`StorageView` does this for every slot. A display copy keeps the look — name, lore, enchantment glint,
durability bar — but writing it builds a new stack from those fields.

## Copying and comparing

| Function | Meaning |
| --- | --- |
| `cloneItemView(item)` | A deep copy (lore, enchantments and tags copied; `native` shared). `null` stays `null`. Missing `amount` becomes `1`. |
| `toDisplayView(item)` | A copy without `native`. |
| `areItemsEqual(a, b)` | Whether two items **look** the same: type, amount, name, lore, enchantments (in any order), durability, potion, block states. `tags` and `native` are ignored. Missing fields equal their defaults. |
| `isSameItem(a, b)` | `areItemsEqual` **and** the same `native` payload. Used by the diff and `Confirm`. |
| `areEnchantmentsEqual(a, b)` | Whether two enchantment lists hold the same enchantments at the same levels, as many times each, in any order. |

## Bedrock conversions

| Function | Meaning |
| --- | --- |
| `fromItemStack(stack)` | A view of a stack, or `null` for `undefined`. Unmarked stacks keep a clone in `native`; the marker is never part of the view. |
| `toItemStack(view, { isUiOwned? })` | A **marked** stack for a drawn item. A real item is marked only with `isUiOwned: true`. `undefined` for `null`. |
| `toStorageStack(view)` | An **unmarked** stack, for putting a view into a real inventory. `undefined` for `null`. |
| `isRenderedItem(stack)` | Whether a stack carries the marker. |
| `maxStackOf(typeId)` | The engine's stack size for an item type, or `undefined` for an unknown type. Cached. |

To give a player an item described by a view, convert it with `toStorageStack`:

```ts
const stack = toStorageStack({ typeId: "minecraft:diamond", amount: 3, name: "§bPrize" });
if (stack) inventoryContainerOf(player)?.addItem(stack);
```

Never give the player a stack from `toItemStack`: it is marked, and the guard destroys it.

## The anti-duplication guard

Every item a menu draws is a real `ItemStack` in a real container, and a quick player can get one out:
grab it as the scan runs, drop it, move it into a chest. Left alone, that is a duplication exploit —
the menu repaints the button, and the copy is free. ContainerUI closes that in three layers.

**1. The marker.** Every drawn item carries an invisible marker. On non-stackable items it is a
dynamic property (`containerui:ui`) and shows nothing. Stackable items cannot keep dynamic properties,
so on them the marker is a few invisible colour codes appended to the last lore line; an item that
has lore shows nothing extra, and a stackable item **without** lore shows one empty tooltip row. The
engine caps lore at 20 lines of 50 characters: when the last line has no room left, the marker takes a
line of its own (one more empty row), and a lore already 20 lines long has its last line shortened to
make room. Lore beyond those limits is cut, with one warning per item type.

**2. Sweeps.** Marked items are removed wherever they turn up:

- on the player's cursor and in their inventory, when the scan locates a taken button;
- from the viewer's inventory, worn slots and off hand, every half second while a menu is open and
  several times on close;
- from a container someone opens or closes — a chest, a furnace, a hopper, a chest minecart, a
  donkey — and from the player who did: on open, because a hopper may have filled it unopened; on
  close, for a copy put in while it was open. A menu's own entity is never swept, whichever pack
  spawned it, and an empty container costs no slot reads;
- from a player joining the world.

A few paths have no script event to close them. All of them need a copy to leave the menu first,
which the scan and the sweeps above keep to a window of a tick or two.

**3. The world guard.** Installed with the first menu, it destroys marked items the moment they exist
as loose items — thrown, dropped on death, spilled from a container — and cancels using a marked item,
using it on a block, and using it on an entity.

Marked stacks are deliberately not *locked* in the inventory: the engine draws a lock badge on locked
stacks, which would put a badge on every button of every menu.

### Guard API

| Function | Meaning |
| --- | --- |
| `installItemGuard()` | Installs the world guard. Every menu calls it; idempotent. |
| `getItemGuardStats()` | `{ inspected, destroyed, removalFailed }`: loose items examined, marked items destroyed, and removals the engine refused, since the world loaded (or the last uninstall). |
| `setItemGuardLogger(reporter \| null)` | Sends guard activity lines to `reporter` instead of the logger. |
| `onMarkedItemDestroyed(listener)` | Subscribes to destroyed marked items. `listener(probe, ownerId?)` returns `true` to claim the item. Returns an unsubscribe. |

`inspected` counts every loose item that appeared in the world while the guard ran — every drop,
every item from a broken block, every `/give` with a full inventory — not only menu items. A high
number is normal on a busy server; `destroyed` is the one that counts menu copies.

## Items that hold other items

A shulker box item's contents cannot be read from the item in the stable API. See the
[Shulker reader](shulker-reader.md).
