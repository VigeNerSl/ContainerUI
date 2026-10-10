# Glossary

**Batch** — A group of writes whose dependent work runs once, after the group. Menu handlers run in
one. See [Reactivity](guides/reactivity.md#batching-and-flushing).

**Block container** — A custom block paired with a storage entity whose inventory holds the block's
items. See [Block containers](guides/block-containers.md).

**Button** — A `slot` with `onClick` and a non-null item. Clicking it fires the handler once and puts
the item back.

**Commit** — Writing the result of a render to the host, slot by slot, skipping slots whose item did
not change. At most once per flush.

**Component** — A function from props to elements. It may keep state with hooks.

**Controlled input** — An `input` with an `item` prop: your source decides what it shows on every
commit, and edits reach you through `onChange`.

**Data value** — The number Bedrock uses to tell variants of one item apart (`/give @s potion 1 12` is a
Fire Resistance potion). The script API has none: a potion comes from `ItemView.potion`, a block variant
from `ItemView.blockStates`, and everything else from a loot table through `itemFromLootTable`.

**Decorative slot** — A `slot` without `onClick`, or with a `null` item. Whatever the player does, it is
restored.

**Delivery** — How a potion is used: `Consume`, `ThrownSplash` or `ThrownLingering`. Together with a
potion effect id, it selects the item the engine builds (`ItemView.potion`).

**Diagnostic** — A structured report from a mounted menu: `overflow`, `collision`, `render-error`,
`handler-error`, `write-failed`, `platform-error`, `dev-warning`.

**Display copy** — An `ItemView` without `native`: only the look of an item. Writing it builds a new,
marked stack. `toDisplayView` makes one.

**Effect** — Code that runs when values it read change. `effect()` outside components, `useEffect()`
inside.

**Element** — A plain object `{ type, props, key }` describing part of a menu. Built with JSX or `h()`.

**Flush** — The scheduler running every piece of pending reactive work. On Bedrock, once per tick.

**Host** — What a tree renders onto: slots it can write and read, and user actions it reports. The
Bedrock surface and the test host are hosts. See [Custom hosts](guides/custom-hosts.md).

**Index** — A slot's number, from 0 at the top left, left to right, then down; 9 per row.

**Input** — A slot the player owns: they may place and take real items.

**Item function** — A function passed as a slot's `item`. It is evaluated at commit time, so a change
to what it reads repaints that one slot without re-rendering the component.

**`ItemView`** — The plain description of an item: `typeId`, `amount`, `name`, `lore`, `enchantments`,
`durability`, `potion`, `blockStates`, `tags`, `native`. See [Items](guides/items.md).

**Key** — An element's identity among its siblings, so a component keeps its state as a list changes.

**Layer** — Content stacked over the menu, laid out from slot 0. A layer with a backdrop is modal.

**Layout** — `box`, `row`, `column` or `grid`: an element that places its children one cell after
another.

**Marker** — The invisible mark on every item a menu draws: a dynamic property, or on stackable items
an invisible lore suffix. Marked items are removed wherever they escape to.

**Menu** — A chest-style screen drawn by ContainerUI; technically a surface with a mounted tree.

**Mirror** — Showing a storage's slots in a menu: `StorageSlots` (real access) or `StorageView` (display
copies).

**`native`** — The real `ItemStack` a view was read from, carried opaquely so writing the view writes
the same item.

**Overflow** — A cell that fell outside the menu; the element is not rendered.

**Render** — Calling a component to get its elements. Happens when it mounts, when signals it read
change, or when its props change.

**Scan** — The per-tick comparison of a menu's slots with what was written, which is how gestures are
detected on Bedrock.

**Scope** — An owner of effects, computeds and cleanups; disposing it disposes them. Every component
has one.

**Signal** — A reactive value. Reading it subscribes; writing it notifies subscribers.

**Slot** — One cell of a menu. Also the `slot` element, which fills one.

**Storage** — A `SlotStorage`: slots of items held outside the menu, with a version signal.

**Storage entity** — The invisible entity inside a block container's block, whose inventory is the
container.

**Surface** — The Bedrock host of a menu: an invisible rideable entity whose inventory the player sees
as a chest screen.

**Take** — A gesture removing an item from a slot. For buttons, it is held until the item is located,
then fires once.

**Tick** — A Minecraft game tick: 1/20 of a second, 50 ms.

**Time source** — The timers animation hooks use: `after` and `every`, counted in ticks.
