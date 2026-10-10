# Context

Context passes a value to every component below a point in the tree without threading it through
each component's props. Typical uses: the viewing player, a shop's state, a theme, the router.

```tsx
import { createContext, provideContext, useContext } from "containerui";

const PlayerContext = createContext<Player | null>(null, "PlayerContext");

function Menu({ player }: { player: Player }) {
    provideContext(PlayerContext, player);
    return <Toolbar />;
}

function Toolbar() {
    const player = useContext(PlayerContext);
    return <slot index={8} item={{ typeId: "minecraft:player_head", name: player?.name ?? "?" }} />;
}
```

## API

| Function | Meaning |
| --- | --- |
| `createContext(defaultValue, name?)` | Creates a context. `defaultValue` is read where no ancestor provides one. `name` appears in error messages. |
| `provideContext(context, value)` | Called while a component renders: provides `value` to everything rendered **beneath** that component. |
| `useContext(context)` | The value from the nearest ancestor that provides it, or the default. |
| `useRequiredContext(context)` | Like `useContext`, but throws when the value is `null` or `undefined`. |
| `useContextSelector(context, select)` | Part of the value, re-rendering only when that part changes. |

A `Context<T>` object has `id` (a symbol), `defaultValue` and `name`.

`provideContext` is not a component and does not wrap anything: call it in the body of the
component whose subtree should see the value. Its descendants see it; so does the providing
component itself, if it calls `useContext` after `provideContext` (from its second render on, it
sees its own value even before that call). A nearer provider of the same context overrides a
farther one.

## Context is not a subscription

`useContext` returns the value provided **at the moment the consumer renders**. If the provider
later provides a different plain value, a consumer that does not render again for another reason
keeps the old one — for example because its props did not change, so it was skipped.

**Put signals in context for values that change.** The context value then never changes (it is the
same signal), and consumers subscribe by reading it:

```tsx
interface Shop {
    coins: Signal<number>;
    cart: Signal<string[]>;
}

const ShopContext = createContext<Shop | null>(null, "ShopContext");

function ShopMenu() {
    const shop = useMemo(() => ({ coins: signal(100), cart: signal<string[]>([]) }), []);
    provideContext(ShopContext, shop);
    return (
        <>
            <Balance />
            <Goods />
        </>
    );
}

function Balance() {
    const { coins } = useRequiredContext(ShopContext);
    return <slot index={4} item={() => ({ typeId: "minecraft:gold_ingot", name: `${coins.value}` })} />;
}
```

Values that never change during the menu's life — the player, a configuration object, a store —
are fine in context as they are.

## `useContextSelector`

When a context holds a large state object in one signal, most consumers need only part of it.
`useContextSelector` runs `select` in a computed and re-renders the component only when the selected
part changes:

```tsx
const ShopContext = createContext<{ state: Signal<ShopState> } | null>(null);

function CoinCount() {
    // Renders again only when state.coins changes, not on every cart edit.
    const coins = useContextSelector(ShopContext, (shop) => shop!.state.value.coins);
    return <slot item={{ typeId: "minecraft:gold_ingot", amount: Math.max(1, Math.min(64, coins)) }} />;
}
```

- `select` should return a primitive or a stable reference; a new object on every call counts as a
  change every time.
- The latest `select` is used on every render.
- Comparison is `Object.is`.

## `useRequiredContext`

For contexts that must be provided — a missing provider is a bug — create them with a `null` default
and read them with `useRequiredContext`. The error names the context:

```
[ContainerUI] No value provided for ShopContext. Call provideContext(ShopContext, …) in an ancestor component.
```

The router is read this way: `useRouter()` is `useRequiredContext` over the router's context.

## Patterns

**Per-menu state shared by many components.** Create it once in the menu's root component with
`useMemo(…, [])`, put signals in it, provide it. Every component below reads what it needs.

**Services.** Provide objects with methods (`{ buy(item), sell(item) }`) rather than raw state, so
components call intentions instead of editing state directly.

**Testing.** Wrap the component under test in a small component that provides a fake value; see
[Testing](testing.md).
