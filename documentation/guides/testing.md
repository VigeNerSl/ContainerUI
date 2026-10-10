# Testing

Everything above the Bedrock adapter runs without the game. Components, hooks, layout, routing,
storages and the diff can be tested in Node with any test runner, in milliseconds, using an in-memory
host that records every write.

Import from the core entry point, which never loads `@minecraft/server`:

```ts
import { createManualSchedulerHost, configureRuntime, createTestHost, h, mount } from "containerui/core";
// If the library was copied into the add-on (see installation), import from
// "./ContainerUI/core/index.js" instead.
```

Components that import Bedrock-only helpers (`useScore`, `BlockStorage`, …) cannot load outside the
game; keep them at the edges and pass their values in as props or context.

## A first test

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureRuntime, createManualSchedulerHost, createTestHost, h, mount, useState } from "containerui/core";

const Counter = () => {
    const [count, setCount] = useState(0);
    return h(
        "row",
        { index: 0 },
        h("slot", { item: { typeId: "minecraft:paper", name: `count:${count}` } }),
        h("slot", { item: { typeId: "minecraft:emerald" }, sound: "random.orb", onClick: () => setCount((n) => n + 1) }),
    );
};

test("a click increments the counter and writes one slot", () => {
    configureRuntime(createManualSchedulerHost());
    const host = createTestHost({ slotCount: 9 });
    const app = mount(() => h(Counter), host);

    assert.equal(host.readSlot(0)?.name, "count:0");
    host.clearHistory();

    host.simulateTake(1); // the player grabs the button
    app.flush();

    assert.equal(host.readSlot(0)?.name, "count:1");
    assert.deepEqual(host.sounds, ["random.orb"]);
    assert.equal(host.writes.length, 2); // the button put back, the paper renamed

    app.unmount();
});
```

`host.writes` is the number to watch: physical writes are what cost tick time in the game, and a test
can pin exactly how many a change causes.

## The test host

`createTestHost({ slotCount?, rejectWrite? })` returns a `TestHost`: a `HostAdapter` kept in memory.

| Option | Default | Meaning |
| --- | --- | --- |
| `slotCount` | `27` | Number of slots. |
| `rejectWrite` | none | `(index, item) => boolean`: make `writeSlot` throw for these writes, to test `write-failed`. |

| Member | Meaning |
| --- | --- |
| `simulateTake(index)` | The player empties a slot. |
| `simulatePlace(index, item)` | The player puts `item` into a slot. |
| `simulateSwap(index, item)` | The player swaps the slot's contents for `item`. |
| `readSlot(index)` | What a slot holds now. |
| `snapshot()` | Every slot, by index. |
| `writes` | Every `{ index, item }` written, in order. |
| `sounds` | Every sound played, in order. |
| `takenBack` | Items `takeBack` took from the player, in order. |
| `givenBack` | Items `giveBack` (or a refused `accept`) gave the player, in order. |
| `isClosed`, `closeReason` | Whether `close` was called, and why. |
| `close(reason?)` | Closes it, as the player would. |
| `clearHistory()` | Forgets `writes`, `sounds`, `takenBack` and `givenBack`. |

Slot indices outside `0..slotCount-1` throw `RangeError`.

The test host reports every gesture at once: a `simulateTake` on a button fires `onClick`
immediately. The Bedrock-specific parts — waiting until a take is located, reclaiming copies from the
cursor, returning an item inserted into a button or an undeclared slot to the player — are the
adapter's job and are not simulated. The core's side of them is: the slot is restored or cleared.

## Flushing

State changes are committed at the next flush. In a test you decide when that is:

- `mount` flushes before it returns (unless `syncMount: false`), so the first screen is complete.
- `app.flush()` runs everything pending, now.
- With `configureRuntime(createManualSchedulerHost())`, nothing runs until you call
  `app.flush()`, `flushSync()` or the host's `runPending()`. That makes tests deterministic.

```ts
const schedulerHost = createManualSchedulerHost();
configureRuntime(schedulerHost);
// …
coins.value = 50;
assert.equal(host.readSlot(4)?.name, "100 coins"); // not committed yet
schedulerHost.runPending();
assert.equal(host.readSlot(4)?.name, "50 coins");
```

`createManualSchedulerHost()` returns a host with `runPending()`, `advance(ms)` (its clock, for time
slicing) and `pendingFlushCount`. `runPending()` throws if flushes keep requesting flushes more than
1,000 times.

Install a fresh scheduler for each test, and `resetRuntime()` afterwards if your runner shares module
state between tests.

## Time

`useTicker`, `useReveal` and `useTween` need a time source. Install a manual one and move it by hand:

```ts
import { configureTimeSource, createManualTimeSource, resetTimeSource } from "containerui/core";

const TILE = { typeId: "minecraft:white_stained_glass_pane", name: " " };

const RowReveal = () => {
    const reveal = useReveal({ size: 27, order: "rows" });
    return Array.from({ length: 27 }, (_unused, index) =>
        h("slot", { key: index, index, item: () => (reveal.isVisible(index) ? TILE : null) }),
    );
};

test("the reveal shows one row per tick", () => {
    configureRuntime(createManualSchedulerHost());
    const time = createManualTimeSource();
    configureTimeSource(time);

    const host = createTestHost({ slotCount: 27 });
    const app = mount(() => h(RowReveal), host);

    time.advance(1);
    app.flush();
    assert.ok(host.readSlot(0));
    assert.equal(host.readSlot(9), null);

    app.unmount();
    assert.equal(time.timerCount, 0); // timers stopped on unmount
    resetTimeSource();
});
```

`createManualTimeSource()` returns a `ManualTimeSource`: `advance(ticks)` moves the clock one tick at a
time, firing what comes due; `timerCount` counts live timers.

## Storages and persistence

- `createMemoryStorage(size, initial?)` stands in for a chest or block. `silentSet` plus
  `notifyExternalChange()` simulate a change made behind the menu's back.
- `createMemoryBackend()` stands in for dynamic properties; its `writes` list shows exactly what a
  `JsonStore` or `ChunkedStore` wrote.

```ts
test("an edit reaches the storage", () => {
    configureRuntime(createManualSchedulerHost());
    const chest = createMemoryStorage(9);
    const host = createTestHost({ slotCount: 9 });
    const app = mount(() => h(StorageSlots, { storage: chest, index: 0 }), host);

    host.simulatePlace(3, { typeId: "minecraft:diamond", amount: 2 });
    app.flush();

    assert.equal(chest.get(3)?.typeId, "minecraft:diamond");
    app.unmount();
});
```

## Diagnostics in tests

Collect diagnostics and assert on them, so layout mistakes fail the test:

```ts
const diagnostics: Diagnostic[] = [];
mount(() => h(Shop), host, { onDiagnostic: (vigenersl) => diagnostics.push(vigenersl) });
assert.deepEqual(diagnostics.filter((vigenersl) => vigenersl.kind !== "dev-warning"), []);
```

## Context and props

Provide fakes through a small wrapper component:

```ts
const WithShop = ({ shop, children }) => {
    provideContext(ShopContext, shop);
    return children;
};

mount(() => h(WithShop, { shop: fakeShop }, h(CartView)), host);
```

## The fluent builder

`ContainerFormBuilder` is the platform-free half of `ContainerFormData`. Build a form and mount its
tree:

```ts
const form = new ContainerFormBuilder(27).button(13, BUY, onBuy).fill(PANE);
const app = mount(() => form.build(), host);
```

## What cannot be tested off-game

The Bedrock adapter itself: spawning the menu entity, the scan, the cursor, touch controls, the item
guard, block containers and the shulker reader. The library tests those with engine stubs in its own
smoke suites (`npm run smoke:interaction`, `smoke:itemguard`, `smoke:core`); for your add-on, test
them in a world.
