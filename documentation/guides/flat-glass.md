# Flat glass

A glass pane in a menu slot is drawn as a thin 3D pane, and a glass block as a cube, so a border or a
backdrop made of them looks uneven. The shared ContainerUI packs include seventeen *flat* glass
blocks: each fills its slot edge to edge as a single square tile, with no seam to its neighbours.
Vanilla Bedrock has no such block.

Nothing extra is installed: they come with the packs every ContainerUI world already has. Use them
or not; the library does not need them.

## The blocks

| `typeId` | Looks like |
| --- | --- |
| `containerui:flat_glass` | Clear glass: a pale frame and two glints, nothing inside |
| `containerui:flat_glass_<colour>` | A tinted, translucent tile for each dye colour |

The sixteen colours are `white`, `orange`, `magenta`, `light_blue`, `yellow`, `lime`, `pink`, `gray`,
`light_gray`, `cyan`, `purple`, `blue`, `brown`, `green`, `red` and `black`.

The textures are 16×16 PNGs that ship with the project, and the blocks are hidden from the creative
inventory. `/give @s containerui:flat_glass_gray` still works.

## Why blocks, not items

An item's texture has no alpha channel in a slot, so a translucent tile cannot be an item. A block can:
its material is drawn with `render_method: "blend"`. The tile is therefore a block with a flat model,
a zero-thickness square that the slot shows as a 2D image, although the block itself is still 3D.

## Using them

They are ordinary item ids, so they go into an `ItemView` like any other item:

```tsx
const BACKDROP: ItemView = { typeId: "containerui:flat_glass_gray", name: " " };

function Frame() {
    return <>{borderIndices(27).map((index) => <slot key={index} index={index} item={BACKDROP} />)}</>;
}
```

Give every tile a blank `name` of one space, as above, so hovering it shows no tooltip. Without a
name the slot shows the block's own name, such as `Flat gray glass`.

## Installing them

They are part of the shared ContainerUI behaviour pack (the blocks) and resource pack (the model and
textures), so a world that has the [shared packs](../getting-started/installation.md#pack-assets)
has the tiles. An add-on gets them the same way it gets menus: it
[depends on the shared behaviour pack](../getting-started/installation.md#for-your-add-on-depend-on-them),
and nothing else is needed for the tiles.

## If a tile looks wrong

- **A cube, a thin pane or a purple-and-black square instead of a tile.** The shared ContainerUI
  packs are not active in the world, or the add-on's manifest does not depend on the behaviour pack.
- **The tile is there but its name reads `tile.containerui:flat_glass.name`.** Give the slot a
  `name`; the pack's names only load with the resource pack.
- **A tile can be placed as a block.** That takes a tile in a player's hands, which only `/give`
  provides: the library removes menu copies from inventories. A placed tile has no collision.
