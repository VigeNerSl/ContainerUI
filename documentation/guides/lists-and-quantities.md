# Lists and quantities

Two problems come up in almost every shop or storage menu: a list longer than the cells you have,
and choosing how many of something. ContainerUI has a hook and two components for them.

## `usePagination`

The page of a list to show, and the moves between pages. It draws nothing; you decide where items
and arrows go.

```tsx
function Goods({ goods }: { goods: Good[] }) {
    const pages = usePagination({ items: goods, pageSize: 7 });

    return (
        <>
            <row index={10}>
                {pages.items.map((good) => (
                    <slot key={good.id} item={good.icon} onClick={() => buy(good)} />
                ))}
            </row>
            {pages.hasPrevious && <slot index={18} item={PREVIOUS} onClick={pages.previous} />}
            <slot index={22} item={{ typeId: "minecraft:paper", name: `§fPage ${pages.page + 1}/${pages.pageCount}` }} />
            {pages.hasNext && <slot index={26} item={NEXT} onClick={pages.next} />}
        </>
    );
}
```

Options (`PaginationOptions<T>`):

| Option | Meaning |
| --- | --- |
| `items` | The whole list. |
| `pageSize` | Items per page; at least 1 (smaller values count as 1, fractions are floored). |
| `state` | Where the page index lives: a `[page, setPage]` pair. Default: the hook's own state. |
| `initialPage` | First page (0-based) when the hook keeps its own state. |

Result (`Pagination<T>`):

| Member | Meaning |
| --- | --- |
| `items` | The current page's items. |
| `page` | The current page, 0-based. |
| `pageCount` | How many pages; at least 1, even for an empty list. |
| `offset` | Position of the page's first item in the whole list. |
| `hasPrevious`, `hasNext` | Whether a page exists before / after this one. |
| `previous()`, `next()` | Move one page. At the ends they do nothing. |
| `goTo(page)` | Jump to a page, clamped to the pages that exist. |

**The page follows the list.** When the list shrinks under the current page (a lot sold, a filter
applied), the menu shows the new last page instead of an empty one, and the stored page is moved
there too. A list that grows again does not bring the old page back. A `NaN` `pageSize` counts as 1
and a `NaN` `initialPage` as 0.

**Keeping the page across navigation.** Pass `useRouteState` as the state, and the page survives
opening an item and coming back:

```tsx
const pages = usePagination({ items: goods, pageSize: 14, state: useRouteState("page", 0) });
```

`PageState` is the type of that pair: `readonly [number, (next: number) => void]`.

## `PagedList`

A complete paged list: items laid out in cells you choose, arrows, and a page indicator.

```tsx
import { PagedList, rectIndices } from "containerui";

<PagedList
    items={goods}
    cells={rectIndices({ startColumn: 1, startRow: 1, endColumn: 7, endRow: 3, size: 54 })}
    renderItem={(good, position) => ({
        item: { ...good.icon, lore: [`§7Price: §e${good.price}`] },
        sound: "random.orb",
        onClick: () => buy(good),
    })}
    keyOf={(good) => good.id}
    previous={{ index: 45 }}
    next={{ index: 53, disabledItem: { typeId: "minecraft:gray_dye", name: "§7No more" } }}
    indicator={{ index: 49 }}
    filler={{ typeId: "minecraft:light_gray_stained_glass_pane", name: " " }}
/>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `items` | `readonly T[]` | The whole list. |
| `cells` | `readonly number[]` | Menu slots a page fills, in order. Their count is the page size. With no cells nothing is drawn, arrows included. |
| `renderItem` | `(item, position) => slot props` | One cell's slot props, without `index` and `key`: `item`, and optionally `onClick` and `sound`. `position` is the item's place in the whole list. |
| `keyOf` | `(item, position) => Key` | A stable key per item. Default: the position. |
| `previous` | `PageControl` | The previous-page arrow. |
| `next` | `PageControl` | The next-page arrow. |
| `indicator` | `{ index, item? }` | A cell showing the page. `item(page, pageCount)` receives the **1-based** page. Default: paper named `Page 2/5`. |
| `filler` | `ItemView` | Shown in cells the last page leaves empty. Default: empty. |
| `state` | `PageState` | Where the page index lives, as for `usePagination`. |

A `PageControl` is:

| Field | Meaning |
| --- | --- |
| `index` | Menu slot of the arrow. |
| `item` | What it shows. Default: an arrow named "Previous page" / "Next page". |
| `disabledItem` | What it shows where there is no page to go to. Omitted, the cell is empty there. |

The arrows are buttons, so a taken arrow is restored like any other button. Page changes rewrite only
the cells whose items differ.

`PagedListProps<T>` is the props type.

## `QuantityPicker`

A row of buttons that picks a quantity: `−10 −1 [item] +1 +10`.

```tsx
function BuyDiamonds() {
    const [count, setCount] = useState(1);

    return (
        <QuantityPicker
            index={20}
            value={count}
            onChange={setCount}
            max={64}
            item={(value) => ({ typeId: "minecraft:diamond", amount: value, name: `§bBuy ${value}` })}
            onPick={(value) => buy("minecraft:diamond", value)}
            sound="random.click"
        />
    );
}
```

With the default steps `[1, 10]`, it lays out five cells from `index`: −10, −1, the item, +1, +10.

| Prop | Type | Meaning |
| --- | --- | --- |
| `value` | `number` | The quantity shown. It is clamped into `min..max` for display; `NaN` shows as `min`. |
| `onChange` | `(value) => void` | Called with the new quantity when a step is pressed. |
| `item` | `(value) => ItemView` | The middle cell. Give it `amount: value` to show the quantity as the stack size. |
| `index` | `number` | Slot of the leftmost step. Omit to use the parent's flow. |
| `min` | `number` | Smallest quantity. Default `1`. |
| `max` | `number` | Largest quantity. Default `64` (never below `min`). A `min` or `max` that is not finite counts as the default. |
| `steps` | `readonly number[]` | Step sizes. Each makes a minus button on the left and a plus button on the right. Default `[1, 10]`. Duplicates and non-positive values are ignored. |
| `onPick` | `(value) => void` | Makes the middle cell a button that receives the quantity. |
| `sound` | `string` | Played by every step and by the pick. |
| `stepItem` | `(step: QuantityStep) => ItemView` | Draws a step button. |
| `stackLimit` | `number` | How many of the item fit in one stack. Below `max`, the middle cell shows `counter` instead. |
| `counter` | `(value) => ItemView` | The middle cell when `stackLimit < max`. |

### Steps at the bounds

A step that would overshoot stops at the bound: at 60 of 64, "+10" goes to 64. A step that would
change nothing — "+1" at 64 — is **disabled**: drawn gray and inert (not a button).

The default step items are lime dye (plus) and red dye (minus), gray dye when disabled, named
`§a+10`, `§c−1` and so on. Draw your own with `stepItem`, which receives a `QuantityStep`:

| Field | Meaning |
| --- | --- |
| `delta` | What the button adds: `-10`, `-1`, `1`, `10`… |
| `isEnabled` | Whether pressing it would change the quantity. |

```tsx
const arrowSteps = ({ delta, isEnabled }: QuantityStep): ItemView => ({
    typeId: isEnabled ? "minecraft:arrow" : "minecraft:barrier",
    name: `${delta > 0 ? "+" : ""}${delta}`,
});

<QuantityPicker value={count} onChange={setCount} item={(value) => ({ typeId: "minecraft:arrow", amount: value })} stepItem={arrowSteps} />;
```

### Items that stack to fewer than `max`

A stack shows its amount only up to its own stack size: 16 ender pearls, 1 sword. Past that, an
`amount` in the middle cell cannot show the quantity. Pass `stackLimit` and the picker switches to a
counter item for every quantity:

```tsx
import { maxStackOf } from "containerui";

<QuantityPicker
    value={count}
    onChange={setCount}
    max={64}
    stackLimit={maxStackOf("minecraft:ender_pearl")} // 16
    item={(value) => ({ typeId: "minecraft:ender_pearl", amount: value, name: `§bBuy ${value}` })}
/>
```

The default counter is a gold nugget showing the quantity as its amount (up to 64), with the item's
name and lore. Give `counter` to draw your own. `maxStackOf(typeId)` (Bedrock) returns the engine's
stack limit, or `undefined` for an unknown item; the result is cached per type.

`QuantityPickerProps` is the props type.
