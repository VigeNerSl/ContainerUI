# Elements and layout

A menu is a grid of slots, 9 per row. Slot 0 is the top left; indices run left to right, then
down. A 27-slot menu has rows 0–8, 9–17 and 18–26.

```
 0  1  2  3  4  5  6  7  8
 9 10 11 12 13 14 15 16 17
18 19 20 21 22 23 24 25 26
```

You describe what each slot holds with six built-in elements. Two of them fill a slot (`slot`,
`input`); four arrange other elements (`box`, `row`, `column`, `grid`).

## `slot`

One cell showing an item. Without `onClick` it is decorative; with `onClick` it is a button.

```tsx
<>
    <slot index={4} item={{ typeId: "minecraft:diamond", name: "§bA diamond" }} />
    <slot index={22} item={CLOSE} sound="random.click" onClick={(vigenersl) => vigenersl.close()} />
</>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `item` | `ItemSource` (required) | The item: an `ItemView`, `null` for an empty slot, or a function returning either. |
| `index` | `number` | Absolute slot index. Omit it to take the next cell of the parent layout. |
| `onClick` | `(event: SlotEvent) => void` | Makes the slot a button. Called once the player's click has finished. |
| `sound` | `string` | Sound id played to the player on click, e.g. `"random.click"`. Needs `onClick`. |
| `key` | `string \| number` | Identity among siblings; see [Keys](#keys). |

What the player can do to a slot, and what happens, is in [Interaction](interaction.md). In short:
a taken item is always put back, and a button fires once.

**An empty button does nothing.** A slot whose item is `null` has nothing to click, so it neither
plays its sound nor calls `onClick`, even if the prop is set. This lets a shop cell that sold out
keep its declaration and simply show nothing.

### Item sources

`item` accepts three forms:

```tsx
const fixed = <slot item={{ typeId: "minecraft:apple" }} />;
const empty = <slot item={null} />;
const live = <slot item={() => ({ typeId: "minecraft:paper", name: `${coins.value}` })} />;
```

A function is called on every commit. Signals it reads are tracked by the commit, not by the
component, so a change repaints that slot **without rendering the component again**. Use it for
values that change often: balances, timers, animations.

If the function throws, only that slot is emptied, and the error is reported as a `render-error`
(and sent to the nearest [`ErrorBoundary`](errors-and-diagnostics.md#errorboundary)).

The shape of an item, `ItemView`, is described in [Items](items.md). The short version:

```ts
const blade: ItemView = { typeId: "minecraft:diamond_sword", amount: 1, name: "§bBlade", lore: ["§7Sharp"], enchantments: [{ id: "sharpness", level: 5 }] };
```

An `ItemView` is treated as immutable: to change an item, render a copy (`{ ...blade, name: "§bDull" }`) rather than changing the one already shown.

## `input`

A cell the player owns: they may put items into it and take them out. It is how a menu accepts
items (a sell slot, an anvil-like input) and how it mirrors a real inventory.

```tsx
<input index={13} onChange={(vigenersl) => console.info(`now ${vigenersl.next?.typeId ?? "empty"}`)} />
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Absolute slot index, or the next cell of the parent layout. |
| `initialItem` | `ItemSource` | Written once, when the input first appears. From then on the player owns the slot. |
| `item` | `ItemSource` | Makes the input **controlled**: this item is written on every commit, and the player's edits reach `onChange`. |
| `isMirror` | `boolean` | Controlled inputs only: the source holds the real item (a chest), so closing the menu leaves it there instead of giving it to the player. |
| `accept` | `(item: ItemView) => boolean` | Return `false` to refuse an incoming item. It is given back to the player. |
| `onPlace` | `(event: InputEvent) => void` | The slot went from empty to holding an item. |
| `onTake` | `(event: InputEvent) => void` | The slot went from holding an item to empty. |
| `onChange` | `(event: InputEvent) => void` | Any edit, including a swap. Runs after `onPlace` / `onTake`. |
| `key` | `string \| number` | Identity among siblings. |

Inputs are covered in depth in [Interaction](interaction.md#inputs).

## Layouts: `box`, `row`, `column`, `grid`

A layout places its children one cell after another, starting from its own position, so a
component can emit any number of slots without its parent counting them.

| Prop | Type | Applies to | Meaning |
| --- | --- | --- | --- |
| `index` | `number` | all | Where the layout starts. Omit it to start at the next cell of the parent. |
| `gap` | `number` | all | Empty cells left between children. Default 0. |
| `columns` | `number` | `grid` | Cells per row before wrapping. Default 9. |
| `children` | `Child` | all | What to place. |
| `key` | `string \| number` | all | Identity among siblings. |

### `row` and `box`

Children go left to right from the start index. Each child takes the next cell; with a gap, the
next cell after the gap.

```tsx
<row index={10} gap={1}>
    <slot item={A} />   {/* 10 */}
    <slot item={B} />   {/* 12 */}
    <slot item={C} />   {/* 14 */}
</row>
```

A row is a straight run of indices: a child that passes the right edge continues at the start of
the next row (index 17 is followed by 18). Use `grid` when you want explicit wrapping.

`box` places children exactly like `row`. Use it to give a group of children one anchor, or to
wrap a component at a fixed position, when "row" would say something you do not mean.

### `column`

Children go top to bottom, one row apart (or `1 + gap` rows apart).

```tsx
<column index={0}>
    <slot item={A} />   {/* 0 */}
    <slot item={B} />   {/* 9 */}
    <slot item={C} />   {/* 18 */}
</column>
```

### `grid`

Children go left to right and wrap after `columns` cells. A gap applies both between columns and
between rows.

```tsx
<grid index={10} columns={3}>
    {items.map((item) => <slot key={item.typeId} item={item} />)}
</grid>
// 10 11 12
// 19 20 21
// 28 29 30 …
```

With `gap={1}`, the same grid uses 10, 12, 14, then 28, 30, 32.

A grid whose columns would pass the right edge of the menu does **not** wrap early: those cells
are dropped and reported as overflow. `<grid index={7} columns={3}>` has room for two columns.

### Nesting

A layout without an `index` takes one cell of its parent as its start, and lays out its own
children from there:

```tsx
<column index={10} gap={1}>
    <row>{/* starts at 10 */}
        <slot item={A} />  {/* 10 */}
        <slot item={B} />  {/* 11 */}
    </row>
    <row>{/* starts at 28 */}
        <slot item={C} />  {/* 28 */}
    </row>
</column>
```

The nested row takes **one** cell of the column, however many children it has. Plan the parent's
spacing accordingly.

### Pinned indices inside a layout

A child with an explicit `index` goes exactly there and **does not take a cell** from the layout it
is in. The next unpinned child continues where the flow left off:

```tsx
<row index={9}>
    <slot item={A} />              {/* 9 */}
    <slot index={0} item={LOGO} /> {/* 0, outside the flow */}
    <slot item={B} />              {/* 10 */}
</row>
```

### Components in a layout

A component adds no layout of its own. Whatever it returns flows into the layout it is placed in,
as if written there:

```tsx
const Pair = () => [<slot item={A} />, <slot item={B} />];

<row index={0}>
    <Pair />               {/* 0 and 1 */}
    <slot item={C} />      {/* 2 */}
</row>
```

Wrap a component's output in a `box` if you want it to occupy a single cell of the parent.

### Fragments and arrays

A fragment (`<>…</>`, `fragment(…)`) and a plain array both splice their children into the
parent's flow. Neither adds layout.

## The root

The element tree you pass to `openContainer` or `mount` is placed as if in a `box` at index 0. So
top-level children without an index fill 0, 1, 2, … in order.

## Slots nobody declares

Every commit covers the whole menu. A slot that no element claims is **cleared**. If the player
puts an item into an undeclared slot, it is taken back out (and given back to them).

## Overflow and collisions

Two layout mistakes are detected on every render and reported once per menu through
`onDiagnostic` (or the logger):

- **`overflow`** — a cell fell outside the menu: a layout ran past the last slot, a grid ran
  past the right edge, or an `index` was pinned off the surface. The element is not rendered.
- **`collision`** — two elements claimed the same index. The one rendered **last wins**. A layer
  that tries to cover an input is also reported as a `collision`; see
  [Layers](layers-and-modals.md#layers-never-cover-inputs).

See [Errors, diagnostics and logging](errors-and-diagnostics.md#diagnostics).

## Keys

A `key` identifies an element among its siblings from one render to the next. It matters for
**components**: a component keeps its state (hooks) for as long as it keeps its identity.

Without a key, a component's identity is its type plus its position among siblings of the same
type. Adding or removing an item at the start of a list shifts every position, so each component
would receive its neighbour's state. With a key, identity follows the key:

```tsx
{players.map((player) => <PlayerCard key={player.id} player={player} />)}
```

Rules:

- Keys must be unique among siblings. Two siblings with the same key share one instance, which is
  reported as a `dev-warning`.
- A key only has to be unique within its parent, not across the whole menu.
- A new key is a new component: changing a key throws the old state away. This is a clean way to
  reset a component.
- Keys on `slot` and `input` are accepted but have no effect on state: built-in elements keep no
  state of their own.

See [Components](components.md#identity).

## Surface width

A menu is 9 slots wide, and so is every layout calculation by default. `mount` accepts a `width`
option for hosts of another shape; Bedrock menus are always 9 wide.

## Layout helpers

The library exports the functions its own layout and builder use. They are plain functions and
work anywhere.

| Function | Returns |
| --- | --- |
| `toIndex(row, column, width = 9)` | The index of a row and column. `toIndex(2, 4)` → `22`. |
| `toCoordinates(index, width = 9)` | `{ row, column }` of an index. `toCoordinates(22)` → `{ row: 2, column: 4 }`. |
| `borderIndices(size, width = 9)` | Every index on the edge, ascending. `borderIndices(27)` → 0–8, 9, 17, 18–26. |
| `rectIndices({ startColumn, startRow, endColumn, endRow, size, width? })` | Every index inside an inclusive rectangle, row by row. Corners may be given in either order; cells past `size` are dropped. |
| `SURFACE_WIDTH` | `9`. |

```tsx
// A frame of panes around the edge, and a 7×3 area inside for goods.
<>
    {borderIndices(54).map((index) => <slot key={index} index={index} item={PANE} />)}
    <PagedList
        items={goods}
        cells={rectIndices({ startColumn: 1, startRow: 1, endColumn: 7, endRow: 3, size: 54 })}
        renderItem={(good) => ({ item: good.icon })}
    />
</>
```

`LayoutFrame` is the class that hands out cells; the render pass uses it, and you can too, for a
layout of your own:

```ts
const frame = new LayoutFrame({ kind: "grid", anchor: 10, columns: 3, size: 27 });
frame.takeIndex(); // 10
frame.takeIndex(); // 11
frame.skip(1);     // leave 12 empty
frame.takeIndex(); // 19
frame.overflowCount; // cells that fell outside
```

| Member | Meaning |
| --- | --- |
| `new LayoutFrame({ kind, anchor, gap?, columns?, width?, size })` | `kind` is `"box"`, `"row"`, `"column"` or `"grid"`. |
| `takeIndex()` | The next cell's index, or `null` when it falls outside (counted in `overflowCount`). |
| `skip(count)` | Skips `count` cells. |
| `overflowCount` | Cells that fell outside so far. |
| `kind`, `anchor`, `gap`, `columns`, `width`, `size` | The options, resolved. |
