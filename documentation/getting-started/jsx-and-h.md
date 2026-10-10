# JSX and `h()`

An element is a plain object `{ type, props, key }`. JSX is a syntax for writing those objects;
`h()` is a function that builds them. They produce identical trees, and everything else in the
library treats them the same.

## The mapping

| JSX | `h()` |
| --- | --- |
| `<slot index={4} item={apple} />` | `h("slot", { index: 4, item: apple })` |
| `<row gap={1}>{a}{b}</row>` | `h("row", { gap: 1 }, a, b)` |
| `<Shop player={player} />` | `h(Shop, { player })` |
| `<Shop key="main" />` | `h(Shop, { key: "main" })` |
| `<Card title="x">{child}</Card>` | `h(Card, { title: "x" }, child)` — `Card` receives `props.children` |
| `<>{a}{b}</>` | `h(Fragment, null, a, b)` or `fragment(a, b)` |
| `{list.map((x) => <Item key={x.id} {...x} />)}` | `list.map((x) => h(Item, { key: x.id, ...x }))` |
| `{isOpen && <Modal … />}` | `isOpen && h(Modal, { … })` |

Rules that hold for both:

- **Children** are passed after the props in `h()`. One child becomes `props.children` as it is;
  several become an array.
- **`key`** is taken out of the props and stored on the element. A component never sees its own
  `key` in `props`.
- **`null`, `undefined`, `true` and `false`** render nothing, so `cond && element` works.
- **Arrays** are spliced into the parent, in order. Nested arrays are fine.

## Built-in elements

There are six. Everything else is a component.

| Element | Makes |
| --- | --- |
| `slot` | One cell: a decorative item, or a button with `onClick`. |
| `input` | One cell the player owns: they may put items in and take them out. |
| `box` | A container that places children from its index, one cell after another. |
| `row` | Children left to right. |
| `column` | Children top to bottom. |
| `grid` | Children left to right, wrapping after `columns` cells. |

They are described in full in [Elements and layout](../guides/elements-and-layout.md).

## Using `h()` from plain JavaScript

```js
import { h, fragment } from "./ContainerUI/ContainerFormData.js";

const Header = ({ title }) => h("slot", { index: 4, item: { typeId: "minecraft:name_tag", name: title } });

const Screen = () =>
    fragment(
        h(Header, { title: "§6Shop" }),
        h("row", { index: 19, gap: 1 },
            h("slot", { item: { typeId: "minecraft:bread" } }),
            h("slot", { item: { typeId: "minecraft:apple" } }),
        ),
    );
```

A tree can also be a plain array: `[h(Header, …), h("row", …)]` renders the same as a fragment.

## Setting up JSX

JSX needs a compiler, so it needs the bundled channel described in
[Installation](installation.md#option-2-bundle-the-package). Configure the automatic runtime:

```jsonc
// tsconfig.json
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "containerui"
    }
}
```

With esbuild alone (no TypeScript config), pass the same settings on the command line:

```bash
npx esbuild src/main.jsx --bundle --jsx=automatic --jsx-import-source=containerui --outfile=BP/scripts/main.js --external:@minecraft/server
```

The compiler turns `<slot index={4} />` into `jsx("slot", { index: 4 })`, imported from
`containerui/jsx-runtime`. The runtime exports `jsx`, `jsxs`, `jsxDEV` and `Fragment`; all three
functions build the same element.

### Types

The JSX namespace types the built-in elements against `ElementPropsMap`, so props are checked:

```tsx
<slot index={4} item={{ typeId: "minecraft:apple" }} onClick={(vigenersl) => vigenersl.close()} />;
<slot index="4" />; // error: index is a number, and item is required
<grid columns={3} />; // ok
```

A component may return anything a child position accepts (`Child`): an element, `null`, a
boolean, or an array. That needs TypeScript 5.1 or later.

`ComponentType<P>` is the type of a function component taking props `P`:

```tsx
import type { Child, ComponentType } from "containerui";

const Card: ComponentType<{ title: string; children?: Child }> = ({ title, children }) => (
    <box>
        <slot item={{ typeId: "minecraft:name_tag", name: title }} />
        {children}
    </box>
);
```

## Checking values

Three helpers inspect elements; you rarely need them outside libraries built on ContainerUI.

| Function | Returns `true` when |
| --- | --- |
| `isVNode(value)` | `value` is an object with `type`, `key` and an object `props` — anything `h` or JSX made. |
| `isEmptyChild(child)` | `child` is `null`, `undefined` or a boolean: it renders nothing. |
| `isIntrinsicType(type)` | `type` is one of the six built-in element names. |
