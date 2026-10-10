# Layers, modals and Confirm

Some content belongs **on top of** the menu: a dialog, a toast, a tooltip-like hint. A layer draws
its children over everything declared beneath it, without disturbing the menu underneath — when the
layer goes away, the covered slots come back exactly as they were, and the components underneath
kept their state the whole time.

| Component | Use it for |
| --- | --- |
| [`Layer`](#layer) | Anything drawn over the menu. |
| [`Modal`](#modal) | A dialog that blocks the menu below while it is open. |
| [`Confirm`](#confirm) | A yes/no dialog that refuses to confirm if what it asked about changed. |

## How layers are placed

- A layer's children are laid out **from slot 0**, wherever the layer is declared in the tree. Use
  absolute `index` props, or layouts with an `index`, inside a layer.
- Layers are stacked over the base menu by **`z`**, lowest first; equal `z` is broken by declaration
  order, later on top.
- A layer declared inside a component unmounts with it, like any other element.

### Layers never cover inputs

A layer is not allowed to cover an `input` of the menu below. Player items in inputs stay put, stay
visible, and stay usable while a dialog is open. A layer slot that lands on an input is dropped and
reported as a `collision` diagnostic.

Because inputs stay live, a dialog's "yes" handler must read the input **when it runs**, not when the
dialog opened — the player may have swapped the item meanwhile. `Confirm` does this check for you.

## `Layer`

```tsx
<Layer z={1}>
    <slot index={4} item={{ typeId: "minecraft:paper", name: "§aSaved!" }} />
</Layer>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `z` | `number` | Stacking order. Default `0`. Higher is on top. |
| `backdrop` | `ItemSource` | Makes the layer **modal**: every cell it does not use shows this item (`null` for empty cells). |
| `onBackdropClick` | `(event: SlotEvent) => void` | Makes the backdrop cells buttons. Needs a non-empty backdrop. |
| `children` | `Child` | The content. |

Without a `backdrop`, a layer is an **overlay**: it covers only its own cells; the rest of the menu
stays visible and clickable.

With a `backdrop`, every other cell (except inputs) is covered, so nothing below can be clicked:

```tsx
<Layer z={1} backdrop={{ typeId: "minecraft:black_stained_glass_pane", name: " " }}>
    <slot index={13} item={NOTICE} />
</Layer>
```

`LayerProps` is the props type.

### A toast

A layer that shows for a few seconds:

```tsx
function Toast({ message }: { message: Signal<string | null> }) {
    useEffect(() => {
        if (!message.value) return;
        const runId = system.runTimeout(() => (message.value = null), 60);
        return () => system.clearRun(runId);
    });

    if (!message.value) return null;
    return (
        <Layer z={10}>
            <slot index={4} item={{ typeId: "minecraft:paper", name: message.value }} />
        </Layer>
    );
}
```

## `Modal`

A modal layer shown while `open` is true.

```tsx
function DeleteButton({ onDelete }: { onDelete: () => void }) {
    const [isAsking, setAsking] = useState(false);

    return (
        <>
            <slot index={26} item={TRASH} onClick={() => setAsking(true)} />
            <Modal open={isAsking} backdrop={PANE} onDismiss={() => setAsking(false)}>
                <slot index={4} item={{ typeId: "minecraft:paper", name: "§cDelete everything?" }} />
                <slot index={11} item={YES} onClick={() => { onDelete(); setAsking(false); }} />
                <slot index={15} item={NO} onClick={() => setAsking(false)} />
            </Modal>
        </>
    );
}
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `open` | `boolean` | Whether it shows. |
| `backdrop` | `ItemSource` | Fills the cells the modal does not use. Default: empty cells. |
| `onDismiss` | `() => void` | Called when a backdrop cell is clicked. Needs a non-empty backdrop. |
| `z` | `number` | Stacking order. Default `0`. |
| `children` | `Child` | The dialog's content. |

A modal is always modal, even without a `backdrop`: its unused cells are then empty, and nothing
below shows or can be clicked (except inputs).

While a modal is open, the menu underneath keeps rendering: its components keep their state, timers
keep running, and when the modal closes the covered slots are written back — only those.

`ModalProps` is the props type.

## `Confirm`

A modal yes/no dialog that **refuses to act if what it guards changed while it was open**.

The problem it solves: a "sell this item?" dialog opens with a diamond sword in the input. While it
is open, the player swaps the sword for a wooden one (inputs stay live under dialogs). A naive "yes"
handler sells whatever is in the input *now*. `Confirm` takes a snapshot when it opens and compares
on "yes"; if the item differs — down to a same-looking swap of a different real item — it calls
`onChanged` instead of `onConfirm`.

```tsx
function SellDialog({ offered, isSelling, onSold }: {
    offered: Signal<ItemView | null>;
    isSelling: Signal<boolean>;
    onSold: (item: ItemView) => void;
}) {
    return (
        <Confirm
            open={isSelling.value}
            watch={() => offered.value}
            confirm={{ index: 11, item: YES, sound: "random.orb" }}
            cancel={{ index: 15, item: NO }}
            backdrop={PANE}
            onConfirm={() => {
                isSelling.value = false;
                onSold(offered.peek()!);
            }}
            onCancel={() => (isSelling.value = false)}
            onChanged={() => {
                isSelling.value = false;
                warn("The item changed; nothing was sold.");
            }}
        >
            <slot index={4} item={() => ({ typeId: "minecraft:gold_nugget", name: `§fSell ${offered.value?.typeId}?` })} />
        </Confirm>
    );
}
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `open` | `boolean` | Whether it shows. The snapshot is taken when this turns `true`. |
| `watch` | `() => Watched` | Reads what must not change while open: one item, `null`, or an array of items. |
| `confirm` | `ConfirmButton` | The "yes" button: `{ index, item, sound? }`. |
| `cancel` | `ConfirmButton` | The "no" button. |
| `onConfirm` | `(event: SlotEvent) => void` | "Yes" was pressed and `watch` returns the same as at opening. |
| `onCancel` | `() => void` | "No", or a non-empty backdrop cell, was pressed. |
| `onChanged` | `() => void` | "Yes" was pressed but `watch` changed. Default: `onCancel`. |
| `backdrop` | `ItemSource` | Fills the unused cells; clicking one cancels, when it shows an item. Default: empty. |
| `z` | `number` | Stacking order. |
| `children` | `Child` | The rest of the dialog, such as the question. |

Comparison uses `isSameItem`: the same look (type, amount, name, lore, enchantments, durability,
potion, block states) **and** the same real item (`native`). Swapping a sword for an identical-looking
other sword is a change. For an array, every position is compared.

`Confirm` does not close itself: set your `open` state to `false` in the handlers.

`ConfirmProps`, `ConfirmButton` and `Watched` are the types.

## Several layers

Layers compose. A toast (`z={10}`) shows over an open modal (`z={0}`); a second modal opened from a
first one (`z={1}`) sits over it, and closing it reveals the first one again, unchanged.
