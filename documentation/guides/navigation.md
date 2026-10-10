# Navigation

A menu with several screens — a hub, a category, an item page, settings — does not need a new menu
per screen. The router keeps a stack of routes in a signal; `Routes` renders the screen for the
current route. Navigating is an ordinary state change: the menu stays open, and only the slots that
differ between the two screens are rewritten. No flicker, no new entity.

```tsx
import { createRouter, openContainer, Routes, useRouter } from "containerui";

function Home() {
    const router = useRouter();
    return <slot index={13} item={SHOP_ICON} onClick={() => router.push("shop", { category: "tools" })} />;
}

function Shop({ category }: { category: string }) {
    const router = useRouter();
    return (
        <>
            <slot index={4} item={{ typeId: "minecraft:book", name: `§6${category}` }} />
            <slot index={18} item={BACK} onClick={() => router.back()} />
        </>
    );
}

export const openHub = (player: Player) => {
    const router = createRouter("home");
    openContainer(player, () => <Routes router={router} screens={{ home: Home, shop: Shop }} />, {
        size: 27,
        title: "§dHub",
    });
};
```

## Creating a router

`createRouter(initialName, initialParams?)` returns a `Router` whose stack holds one route.

Create one router **per open menu** — in the function that opens it, as above, or inside the root
component with `useMemo(() => createRouter("home"), [])`. A router created at module level would be
shared by every player.

## The `Router`

| Member | Meaning |
| --- | --- |
| `current` | `ReadonlySignal<RouteMatch>`: the route on top of the stack. Reading `current.value` in a render subscribes to navigation. |
| `stack` | `ReadonlySignal<readonly RouteMatch[]>`: the whole stack, oldest first. |
| `push(name, params?)` | Goes forward, keeping the current route on the stack. |
| `replace(name, params?)` | Replaces the current route. |
| `back()` | Returns to the previous route. Returns `false` (and does nothing) at the root. |
| `reset(name, params?)` | Empties the stack and starts again at `name`. |
| `canGoBack()` | Whether there is a route to go back to. Reactive when called during a render. |

A `RouteMatch` is `{ name, params }`. `params` defaults to an empty object.

Navigation can happen anywhere: in a handler, an effect, a timer, or from outside the menu entirely
(for example, an event that sends every open menu to a "maintenance" screen).

## `Routes`

```tsx
<Routes
    router={router}
    screens={{
        home: Home,
        shop: { screen: Shop, layout: WideChrome },
        item: ItemPage,
    }}
    layout={Chrome}
    fallback={NotFound}
/>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `router` | `Router` | The router to follow. |
| `screens` | `RouteTable` | Screens by route name: a component, or `{ screen, layout? }`. |
| `layout` | component | Wraps every screen that does not name its own layout. |
| `fallback` | component | Rendered when the current route is not in `screens`. Without one, nothing renders and a `dev-warning` names the route. Only the table's own keys match a route; inherited names such as `toString` do not. |

`Routes` also provides the router to everything below it, so `useRouter()` works in any screen,
layout, or component inside them.

### Screen props

A screen receives the route's params spread into its props, plus two more:

| Prop | Value |
| --- | --- |
| `route` | The `RouteMatch` being shown. |
| `router` | The router. |
| ...params | Each entry of `params`. |

```tsx
router.push("item", { typeId: "minecraft:diamond", price: 40 });

function ItemPage({ typeId, price, router }: { typeId: string; price: number } & RouteProps) {
    return <slot index={13} item={{ typeId, name: `§bBuy for ${price}` }} onClick={() => router.back()} />;
}
```

`route` and `router` are reserved: a param with one of those names is replaced by the router's own
prop, and reported as a `dev-warning`.

`RouteProps` is the type of `{ route, router }`.

### Layouts

A layout is a component that receives `{ route, router, children }` and draws the parts shared by
several screens — a frame, a title, a back button — around `children`, the screen:

```tsx
function Chrome({ children, router }: { children?: Child } & RouteProps) {
    return (
        <>
            {borderIndices(54).map((index) => <slot key={index} index={index} item={PANE} />)}
            {router.canGoBack() && <slot index={45} item={BACK} onClick={() => router.back()} />}
            {children}
        </>
    );
}
```

A layout **stays mounted across navigation** as long as the next screen uses the same layout
component: its state survives, and its slots are not rewritten. A screen with a different layout
(`{ screen, layout }`) swaps the layout.

## Screen state

Each screen is identified by its route name. So:

- **Leaving a screen and coming back gives it fresh state.** `push("shop")`, `back()`, `push("shop")`:
  the second `Shop` starts over. Two routes that use the same component do not share state either.
- **Navigating from a route to the same route name keeps the component**, with new props:
  `push("item", { id: 2 })` from `item` with `{ id: 1 }` re-renders the same `ItemPage` instance,
  and its `useState` values carry over. If each visit must start fresh, keep the state with
  `useRouteState`, or render the screen's content in an inner component keyed by the param:

  ```tsx
  const ItemPage = ({ id }: { id: string }) => <ItemDetails key={id} id={id} />;
  ```

### `useRouteState`

State that belongs to a **visit** of a screen rather than to the screen component: going *back* to
the visit restores it; a new visit (`push`, `replace`, `reset`) starts from `initial`.

```tsx
function Catalog() {
    const [page, setPage] = useRouteState("page", 0);
    const router = useRouter();
    // Open an item, press back: the catalog is on the same page.
    return <PagedList items={GOODS} cells={CELLS} state={[page, setPage]} renderItem={(good) => ({
        item: good.icon,
        onClick: () => router.push("item", { id: good.id }),
    })} />;
}
```

- `key` names the value. Components on the same screen that use the same key share it.
- The setter takes a value or an updater, like `useState`'s. It does nothing for an equal value, and
  keeps its identity across renders.
- It works in any descendant of the screen, not only in the screen itself: a component deep inside,
  with no props of its own, follows the stack entry too, so `push("item", { id: 2 })` from `item`
  starts it from `initial`, and `back()` gives it the older visit's value.
- It throws outside `Routes`.
- The values are kept with the stack entry and disappear when the entry leaves the stack.

## Patterns

**Back or close.** One button that goes back when it can and closes at the root:

```tsx
function BackButton() {
    const router = useRouter();
    return (
        <slot
            index={18}
            item={router.canGoBack() ? BACK : CLOSE}
            onClick={(vigenersl) => {
                if (!router.back()) vigenersl.close();
            }}
        />
    );
}
```

**Deep links.** Open a menu directly on an inner screen with a prepared stack:

```tsx
const router = createRouter("home");
router.push("shop", { category: "tools" });
router.push("item", { id: "pickaxe" });
openContainer(player, () => <Routes router={router} screens={SCREENS} />, { size: 54 });
```

**Reacting to navigation.** Read `router.current.value` in an effect to log or play a sound on every
screen change:

```ts
useEffect(() => {
    const { name } = router.current.value;
    player.playSound("random.click");
    console.info(`[hub] ${player.name} → ${name}`);
});
```

**Routes in a routed screen.** A screen can contain its own `Routes` with a second router — tabs
inside a page, for example. `useRouter()` returns the nearest one.
