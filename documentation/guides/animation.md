# Animation

An animation in ContainerUI is state that changes over ticks. A timer moves a signal; slots that read
the signal repaint; the commit writes only the slots whose items actually changed. There is no
separate animation path, so an animated menu behaves exactly like a static one: clicks, restores and
the anti-duplication guard work throughout.

| Hook | Animates |
| --- | --- |
| [`useTicker`](#useticker) | Anything: calls a function every N ticks. |
| [`useReveal`](#usereveal) | Slots appearing one after another, in an order. |
| [`useTween`](#usetween) | A number moving from one value to another. |

All three need a time source, which `installBedrockRuntime()` installs (`system.runTimeout` and
`system.runInterval`). Without one they throw `No time source is installed`. Their timers stop when
the component unmounts.

## `useTicker`

```ts
const ticker = useTicker(intervalTicks, callback);
```

Calls `callback` every `intervalTicks` ticks (at least 1) while the component is mounted. The latest
`callback` is always the one called, so it can read current props.

```tsx
function Countdown({ seconds, onDone }: { seconds: number; onDone: () => void }) {
    const left = useSignal(seconds);
    const ticker = useTicker(20, () => {
        left.value -= 1;
        if (left.value <= 0) {
            ticker.stop();
            onDone();
        }
    });

    return <slot index={4} item={() => ({ typeId: "minecraft:clock", amount: Math.max(1, left.value), name: `§e${left.value}s` })} />;
}
```

The returned `Ticker`:

| Member | Meaning |
| --- | --- |
| `stop()` | Stops the timer. Safe to call more than once. |
| `start()` | Restarts a stopped timer. |
| `isRunning` | Whether it is running. |

Changing `intervalTicks` between renders takes effect at once if the timer is running (it restarts),
or at the next `start()`.

## `useReveal`

A staggered reveal: slots appear one step at a time, in a chosen order. The whole animation is a
single integer — how many steps have elapsed — and each slot asks whether its turn has come.

```tsx
function Gallery({ items }: { items: ItemView[] }) {
    const reveal = useReveal({ size: 54, order: "wave", stepTicks: 1 });

    return items.map((item, index) => (
        // Read isVisible inside the item function: the component never re-renders,
        // and each step writes exactly the slots that appear.
        <slot key={index} index={index} item={() => (reveal.isVisible(index) ? item : null)} />
    ));
}
```

A 54-slot reveal costs 54 slot writes in total, one per slot as it appears.

### Options (`RevealOptions`)

| Option | Default | Meaning |
| --- | --- | --- |
| `size` | required | Slot count covered by the reveal. |
| `order` | `"sweep"` | Order of appearance; see below. |
| `width` | `9` | Slots per row: a positive integer. |
| `stepTicks` | `1` | Ticks between steps. |
| `stepsPerTick` | `1` | Steps advanced each time the timer fires. |
| `seed` | `1` | Seed for `"random"`. |
| `startComplete` | `false` | Start with everything visible. |

### Orders (`RevealOrder`)

| Order | Appearance |
| --- | --- |
| `"sweep"` | One slot at a time, left to right, top to bottom. |
| `"sweep-reverse"` | One slot at a time, from the bottom right back to the top left. |
| `"rows"` | A whole row per step, top to bottom. |
| `"columns"` | A whole column per step, left to right. |
| `"wave"` | Diagonals from the top-left corner. |
| `"center-out"` | Square rings growing from the middle. |
| `"center-in"` | Square rings closing toward the middle. |
| `"spiral"` | One slot at a time along a square spiral from the middle. |
| `"random"` | One slot at a time in a shuffled order — the same order for the same seed. |

### The `Reveal`

| Member | Meaning |
| --- | --- |
| `isVisible(index)` | Whether this slot's turn has come. Tracked. |
| `isComplete` | `ReadonlySignal<boolean>`: whether every slot is visible. |
| `step` | `ReadonlySignal<number>`: the current step (−1 before the first). |
| `restart()` | Plays it again from the start. |
| `finish()` | Shows everything at once. |

The timer stops by itself once the reveal is complete. Changing `order`, `size`, `width` or `seed`
between renders rebuilds the steps and plays again.

### Revealing on open, skipping on click

```tsx
const reveal = useReveal({ size: 27, order: "center-out", stepTicks: 2 });

<slot index={26} item={SKIP} onClick={() => reveal.finish()} />
```

### Without a component

`createReveal(options)` builds the same state without a timer. You move it with `advance(steps)`:

```ts
const reveal = createReveal({ size: 27, order: "rows" });
reveal.advance(1);    // first row visible
reveal.maxStep;       // 2: the step at which the last slot appears
```

A `RevealState` is a `Reveal` plus `advance(steps)` (at least 1) and `maxStep`.

`revealSteps(order, size, width = 9, seed = 1)` returns the raw table: for each slot index, the step
at which it appears. It throws `RangeError` for a `size` that is not a non-negative integer, a `width`
that is not a positive integer, or a `seed` that is not finite; `createReveal` and `useReveal` do the
same, since they build on it. A tick count that is not a finite number (`stepTicks`, `stepsPerTick`,
`useTicker`'s interval, `useTween`'s duration) counts as 1.

```ts
revealSteps("rows", 18); // [0,0,0,0,0,0,0,0,0, 1,1,1,1,1,1,1,1,1]
```

## `useTween`

Animates a number from `from` to `to` over `durationTicks` ticks.

```tsx
function Progress({ percent }: { percent: number }) {
    // A stack whose amount fills up: a progress bar in one slot.
    const filled = useTween({ from: 1, to: Math.max(1, Math.round((percent / 100) * 64)), durationTicks: 20, round: true });
    return <slot item={() => ({ typeId: "minecraft:emerald", amount: filled.value })} />;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `from` | required | Start value. |
| `to` | required | End value. |
| `durationTicks` | required | Ticks the transition takes (at least 1). |
| `ease` | linear | Maps progress 0–1 to eased progress, e.g. `(t) => t * t`. |
| `round` | `false` | Round the output, for item amounts. |

It returns a `ReadonlySignal<number>`. Read it in an item function to repaint one slot per tick
without re-rendering the component. The timer stops when the value arrives.

A new `from`, `to` or `durationTicks` on a later render starts the transition again from `from`.
`TweenOptions` is the options type.

Some easing functions:

```ts
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
```

## The time source

Tick-based features wait through a `TimeSource`:

```ts
interface TimeSource {
    after(ticks: number, callback: () => void): () => void; // once; returns a cancel
    every(ticks: number, callback: () => void): () => void; // repeating; returns a stop
}
```

| Function | Meaning |
| --- | --- |
| `configureTimeSource(source)` | Installs a time source. `installBedrockRuntime()` does this on Bedrock. |
| `getTimeSource()` | The installed one. Throws when there is none. |
| `hasTimeSource()` | Whether one is installed. |
| `resetTimeSource()` | Removes it. For tests. |
| `createManualTimeSource()` | A time source that moves only when you call `advance(ticks)`. For tests. |

There is deliberately no fallback: a microtask is not a tick, and animations driven by one would
run at the wrong speed while appearing to work. See [Testing](testing.md#time) for the manual time
source.

## Animation tips

- **Read animated values in item functions**, not in the component body, so a tick repaints slots
  instead of rendering components.
- **Many slots, one clock.** One `useTicker` moving one signal, read by many slots, is cheaper than
  one timer per slot.
- **Stop what you do not need.** A finished animation should stop its timer; `useReveal` and
  `useTween` do this by themselves, `useTicker` does not.
- **Keep an eye on writes.** Every changed slot is a physical write. An animation changing 50 slots
  every tick costs 50 writes per tick; see [Performance](performance.md).
