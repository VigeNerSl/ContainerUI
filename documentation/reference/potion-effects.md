# Potion effects and arrow data values

Every potion effect the engine registers, and the data value of the tipped arrow that carries it.
Measured in a world on Bedrock 1.26 with diagnostics scenario 16
(`examples/diagnostics/scenarios/potions.js`), which lists
`Potions.getAllEffectTypes()` and rolls one loot table per arrow data value.

Use this page for two things:

- **`ItemView.potion`** takes an **effect id** from the middle column. See
  [Items → Potions](../guides/items.md#potions).
- **A tipped arrow** is built by a loot table whose `set_data` function takes the **data value** from
  the left column. See
  [Items → Items only a loot table can build](../guides/items.md#items-only-a-loot-table-can-build).

## The rule

An arrow's data value is **the effect's position in the engine's list, plus one**. Data value `0` is
a plain arrow. The list runs to 46, so arrows run to 47 — the vanilla
`crafting_item_catalog.json` stops at 43 and is out of date.

## The table

| Arrow `data` | Effect id | What it is |
| --- | --- | --- |
| 0 | — | Arrow |
| 1 | `water` | Arrow of Splashing (no effect) |
| 2 | `mundane` | Mundane (no effect) |
| 3 | `long_mundane` | Mundane, extended (no effect) |
| 4 | `thick` | Thick (no effect) |
| 5 | `awkward` | Awkward (no effect) |
| 6 | `nightvision` | Night Vision |
| 7 | `long_nightvision` | Night Vision, extended |
| 8 | `invisibility` | Invisibility |
| 9 | `long_invisibility` | Invisibility, extended |
| 10 | `leaping` | Leaping |
| 11 | `long_leaping` | Leaping, extended |
| 12 | `strong_leaping` | Leaping II |
| 13 | `fire_resistance` | Fire Resistance |
| 14 | `long_fire_resistance` | Fire Resistance, extended |
| 15 | `swiftness` | Swiftness |
| 16 | `long_swiftness` | Swiftness, extended |
| 17 | `strong_swiftness` | Swiftness II |
| 18 | `slowness` | Slowness |
| 19 | `long_slowness` | Slowness, extended |
| 20 | `water_breathing` | Water Breathing |
| 21 | `long_water_breathing` | Water Breathing, extended |
| 22 | `healing` | Healing |
| 23 | `strong_healing` | Healing II |
| 24 | `harming` | Harming |
| 25 | `strong_harming` | Harming II |
| 26 | `poison` | Poison |
| 27 | `long_poison` | Poison, extended |
| 28 | `strong_poison` | Poison II |
| 29 | `regeneration` | Regeneration |
| 30 | `long_regeneration` | Regeneration, extended |
| 31 | `strong_regeneration` | Regeneration II |
| 32 | `strength` | Strength |
| 33 | `long_strength` | Strength, extended |
| 34 | `strong_strength` | Strength II |
| 35 | `weakness` | Weakness |
| 36 | `long_weakness` | Weakness, extended |
| 37 | `wither` | Decay (Wither) |
| 38 | `turtle_master` | Turtle Master |
| 39 | `long_turtle_master` | Turtle Master, extended |
| 40 | `strong_turtle_master` | Turtle Master II |
| 41 | `slow_falling` | Slow Falling |
| 42 | `long_slow_falling` | Slow Falling, extended |
| 43 | `strong_slowness` | Slowness IV |
| 44 | `wind_charged` | Wind Charged |
| 45 | `weaving` | Weaving |
| 46 | `oozing` | Oozing |
| 47 | `infested` | Infested |

An effect id may be written with or without `minecraft:`; the library tries both.

## Building an arrow from the table

One loot table per arrow you need, in your own behaviour pack. For Fire Resistance, data `13`:

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
                    "functions": [{ "function": "set_data", "data": 13 }]
                }
            ]
        }
    ]
}
```

```ts
import { itemFromLootTable, type ItemView } from "containerui";

const fireArrow = itemFromLootTable("myaddon/fire_arrow", { amount: 16 });
```

`set_potion` in a loot table is accepted for an arrow but leaves it plain; `set_data` is what works.

## Building a bottle

A drinkable, splash or lingering bottle needs no data value and no loot table:

```ts
import { itemFromLootTable, type ItemView } from "containerui";

const bottle: ItemView = { typeId: "minecraft:potion", potion: { effect: "fire_resistance" } };
const splash: ItemView = { typeId: "minecraft:splash_potion", potion: { effect: "strong_healing" } };
```

## Re-measuring

The list belongs to the engine and may grow. To check it in your own world:

```ts
import { Potions } from "@minecraft/server";

Potions.getAllEffectTypes().forEach((effect, index) => console.warn(`${index + 1} ${effect.id}`));
```

The number printed beside each id is that effect's arrow data value.
