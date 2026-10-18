# Your first menu

This page builds two menus: a counter, to show the moving parts, and a small shop, to show the
patterns you will use most. The counter is shown in JSX and in plain JavaScript with `h()`; the shop
is shown in JSX and, in a smaller form, with the fluent builder, which needs no JSX.
[Installation](installation.md) must be done first.

## 1. A counter

```tsx
import { openContainer, useState } from "containerui";
import type { Player } from "@minecraft/server";

function Counter() {
    const [count, setCount] = useState(0);

    return (
        <row index={11}>
            <slot item={{ typeId: "minecraft:paper", name: `§fClicked ${count} times` }} />
            <slot
                item={{ typeId: "minecraft:emerald", name: "§aClick me" }}
                sound="random.orb"
                onClick={() => setCount((value) => value + 1)}
            />
        </row>
    );
}

export const openCounter = (player: Player) => {
    openContainer(player, () => <Counter />, { size: 27, title: "§dCounter" });
};
```

The same in plain JavaScript:

```js
import { h, openContainer, useState } from "./ContainerUI/ContainerFormData.js";

const Counter = () => {
    const [count, setCount] = useState(0);

    return h(
        "row",
        { index: 11 },
        h("slot", { item: { typeId: "minecraft:paper", name: `§fClicked ${count} times` } }),
        h("slot", {
            item: { typeId: "minecraft:emerald", name: "§aClick me" },
            sound: "random.orb",
            onClick: () => setCount((value) => value + 1),
        }),
    );
};

export const openCounter = (player) => {
    openContainer(player, () => h(Counter), { size: 27, title: "§dCounter" });
};
```

What happens:

1. **`openContainer`** spawns the menu entity, waits until its inventory has 27 slots (usually the
   same tick), renders `Counter`, writes the slots, and only then seats the player. The player
   opens the screen with the inventory key (E, or the inventory button on a phone), and it is
   already full.
2. **`<row index={11}>`** places its children left to right from slot 11: the paper lands on 11,
   the emerald on 12. See [Elements and layout](../guides/elements-and-layout.md).
3. **The paper is decorative.** If the player takes it, the library puts it back.
4. **The emerald is a button**, because it has `onClick`. When the player clicks it, the library
   plays `random.orb`, calls the handler, and puts the emerald back.
5. **`setCount`** changes state. At the end of the tick `Counter` renders again, and the library
   compares the new slots with what it wrote. Only the paper's name changed, so exactly **one
   slot is written**.
6. **When the player closes the screen**, the component is unmounted, the menu entity is
   removed, and the player's inventory is swept for any copy of a menu item that ended up there.

The player cannot keep the emerald or the paper: every item a menu draws carries an invisible
marker, and the library takes back any copy within moments, wherever it turns up. See
[Items](../guides/items.md).

## 2. Opening the menu

Call your open function from any event: a chat command, an item use, a block interaction. It is
safe to call from `beforeEvents` handlers too, where the game refuses to spawn entities: the
library retries on the following ticks, up to 5 attempts in all.

```ts
import { world } from "@minecraft/server";
import { installBedrockRuntime } from "containerui";

installBedrockRuntime();

world.afterEvents.itemUse.subscribe((vigenersl) => {
    if (vigenersl.itemStack.typeId === "minecraft:compass") openCounter(vigenersl.source);
});
```

## 3. A small shop

A shop needs a balance that outlives the menu, goods laid out in a grid, a way to close, and a
confirmation of what happened. The balance lives in a **signal** outside any component, so it is
shared and survives closing the menu.

```tsx
import { openContainer, signal, type SlotEvent } from "containerui";
import type { Player } from "@minecraft/server";

const coins = signal(100);

const GOODS = [
    { typeId: "minecraft:bread", price: 3 },
    { typeId: "minecraft:iron_ingot", price: 8 },
    { typeId: "minecraft:diamond", price: 40 },
];

function Balance() {
    // A function item: this slot updates when `coins` changes,
    // without rendering Balance again.
    return <slot index={4} item={() => ({ typeId: "minecraft:gold_ingot", name: `§6${coins.value} coins` })} />;
}

function Good({ typeId, price }: { typeId: string; price: number }) {
    const canAfford = coins.value >= price;
    const buy = () => {
        if (coins.peek() < price) return;
        coins.value -= price;
        // Give the real item here, e.g. with a container of the player.
    };

    return (
        <slot
            item={{
                typeId,
                name: canAfford ? `§aBuy for ${price}` : `§cNeeds ${price} coins`,
                lore: [`§7You have ${coins.value}`],
            }}
            sound={canAfford ? "random.orb" : "note.bass"}
            onClick={buy}
        />
    );
}

function Shop() {
    return (
        <>
            <Balance />
            <grid index={19} columns={3} gap={1}>
                {GOODS.map((good) => (
                    <Good key={good.typeId} {...good} />
                ))}
            </grid>
            <slot index={26} item={{ typeId: "minecraft:barrier", name: "§cClose" }} onClick={(vigenersl: SlotEvent) => vigenersl.close()} />
        </>
    );
}

export const openShop = (player: Player) => {
    openContainer(player, () => <Shop />, { size: 27, title: "§6Shop" });
};
```

What to notice:

- **`coins` is a plain signal.** `Good` reads `coins.value` while rendering, so it renders again
  whenever the balance changes. `Balance` reads it only inside the item function, so only slot 4
  is re-evaluated. Both are correct; the function form is cheaper when a component is large.
- **`coins.peek()`** reads without subscribing. Inside a handler it makes no difference (handlers
  are not tracked), but it states the intent: "check the current value".
- **`<grid index={19} columns={3} gap={1}>`** places the goods on 19, 21 and 23: three columns with
  one empty cell between them. More goods would continue on the next row, 37…
  (after a gap row). See [Elements and layout](../guides/elements-and-layout.md#grid).
- **`key={good.typeId}`** keeps each `Good` matched to its own state if the list changes order.
- **`vigenersl.close()`** closes the menu from a handler. `SlotEvent` also carries `index` and `item`.
- **The fragment `<>…</>`** groups children without adding layout.

## 4. A one-item shop with the fluent builder

Menus that need no component state read well with the builder, and it needs no JSX. This version is
smaller than the shop above: it sells one item, shows no per-item state, and fills the empty cells
with panes.

```js
import { ContainerFormData, signal } from "./ContainerUI/ContainerFormData.js";

const coins = signal(100);

export const openShop = (player) =>
    new ContainerFormData(27)
        .title("§6Shop")
        .slot(4, () => ({ typeId: "minecraft:gold_ingot", name: `§6${coins.value} coins` }))
        .button(19, { typeId: "minecraft:bread", name: "§aBuy for 3" }, () => {
            if (coins.peek() >= 3) coins.value -= 3;
        }, "random.orb")
        .button(26, { typeId: "minecraft:barrier", name: "§cClose" }, (vigenersl) => vigenersl.close())
        .fill({ typeId: "minecraft:gray_stained_glass_pane", name: " " })
        .onClose(() => console.info("[shop] closed"))
        .open(player);
```

The builder produces the same element tree JSX does, so what this documentation says about slots,
layers and state applies to it. See [The fluent builder](../guides/fluent-builder.md).

## 5. Where to go next

- Let the player put items in: [Interaction](../guides/interaction.md#inputs).
- Show a chest's real contents: [Storage and mirroring](../guides/storage-and-mirroring.md).
- Several screens in one menu: [Navigation](../guides/navigation.md).
- More goods than cells: [Lists and quantities](../guides/lists-and-quantities.md).
- Ask "are you sure?": [Layers, modals and Confirm](../guides/layers-and-modals.md).
- A block that opens a menu: [Block containers](../guides/block-containers.md).
