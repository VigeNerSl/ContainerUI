# Custom hosts and schedulers

The core of ContainerUI knows nothing about Minecraft. It renders onto a **host** — anything that has
numbered slots, can write and read them, and reports what the user did to them — and it schedules work
through a **scheduler host**. The Bedrock adapter is one host; the test host is another. You can write
your own: a debugging view, a web preview of your menus, another game's inventory.

## The `HostAdapter` contract

```ts
interface HostAdapter {
    readonly slotCount: number;
    writeSlot(index: number, item: ItemView | null): void;
    readSlot(index: number): ItemView | null;
    onInteraction(handler: (interaction: HostInteraction) => void): Dispose;
    onClose(handler: (reason: CloseReason) => void): Dispose;
    close(reason?: CloseReason): void;

    // Optional
    playSound?(soundId: string): void;
    setPlayerWritableSlots?(indices: ReadonlySet<number>, mirrored?: ReadonlySet<number>): void;
    takeBackFromViewer?(item: ItemView): void;
    giveToViewer?(item: ItemView): void;
}
```

| Member | Contract |
| --- | --- |
| `slotCount` | Fixed for the host's life. |
| `writeSlot(index, item)` | Make the slot show `item` (`null` clears). May throw; the core reports `write-failed` and does not retry the same item. |
| `readSlot(index)` | The slot's current contents. |
| `onInteraction(handler)` | Call `handler` for each user action on a slot, **after** the slot has changed. Returns an unsubscribe. |
| `onClose(handler)` | Call `handler` exactly once when the host closes. Returns an unsubscribe. The core unmounts on close. |
| `close(reason?)` | Close the host. Idempotent. |
| `playSound(soundId)` | Play a sound to the viewer. Without it, sounds are skipped. |
| `setPlayerWritableSlots(indices, mirrored)` | Called on every commit, **before** its writes: which slots are inputs, and which of those are mirrors (`isMirror`: their source keeps the real item, so closing must not hand the slot's contents out). A host that marks or protects drawn items uses it to leave the player's own items alone. |
| `takeBackFromViewer(item)` | Take an item like `item` (and `item.amount` of it) back from the user. Without it, `InputEvent.takeBack` does nothing. |
| `giveToViewer(item)` | Give `item` to the user. Without it, `giveBack` and a refused `accept` do nothing — the item is lost, so implement it if your host has a user inventory. |

### Interactions

```ts
interface HostInteraction {
    index: number;
    kind: "take" | "place" | "swap";
    previous: ItemView | null; // before the action
    next: ItemView | null;     // after it
}
```

Report **finished** gestures. The core runs a button's handler as soon as it hears of the take, so a
host that reports a drag in progress would fire the handler mid-drag. The Bedrock adapter holds a take
until it has located the item; a host with real click events can report clicks directly.

After an interaction on a button or decorative slot, the core writes the declared item back. After one
on an input, it writes nothing (the user already moved the item) unless the input is controlled and
its source disagrees.

### Mounting

```ts
const app = mount(element, host, { width?, scheduler?, syncMount?, onDiagnostic? });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `width` | `9` | Slots per row, for layouts. |
| `scheduler` | the runtime scheduler | The scheduler that drives this tree's updates. |
| `syncMount` | `true` | Flush before returning, so the first screen is complete. |
| `onDiagnostic` | none | Receives [diagnostics](errors-and-diagnostics.md#diagnostics). Without it, uncaught failures go to the [error reporter](reactivity.md#errors) and the rest is dropped. |

The `App`:

| Member | Meaning |
| --- | --- |
| `host` | The host. |
| `slots` | The resolved slots of the last commit, by index (`ResolvedSlot`: `index`, `kind`, `item`, handlers). |
| `writeCount` | Slot writes since mount. |
| `flush()` | Runs pending work now. |
| `unmount()` | Tears the tree down and stops writing. Idempotent. |

### A minimal host

A host that prints the grid, for a debugging tool:

```ts
import { h, mount, type CloseReason, type HostAdapter, type HostInteraction, type ItemView } from "containerui/core";

export const createConsoleHost = (slotCount: number) => {
    const slots = new Array<ItemView | null>(slotCount).fill(null);
    const interactionHandlers = new Set<(interaction: HostInteraction) => void>();
    const closeHandlers = new Set<(reason: CloseReason) => void>();
    let isClosed = false;

    const host: HostAdapter & { click(index: number): void; print(): void } = {
        slotCount,
        writeSlot: (index, item) => {
            slots[index] = item;
        },
        readSlot: (index) => slots[index] ?? null,
        onInteraction: (handler) => {
            interactionHandlers.add(handler);
            return () => interactionHandlers.delete(handler);
        },
        onClose: (handler) => {
            closeHandlers.add(handler);
            return () => closeHandlers.delete(handler);
        },
        close: (reason = "programmatic") => {
            if (isClosed) return;
            isClosed = true;
            closeHandlers.forEach((handler) => handler(reason));
        },
        click: (index) => {
            const previous = slots[index] ?? null;
            slots[index] = null;
            interactionHandlers.forEach((handler) => handler({ index, kind: "take", previous, next: null }));
        },
        print: () => {
            for (let row = 0; row < slotCount / 9; row++) {
                console.log(slots.slice(row * 9, row * 9 + 9).map((item) => (item ? item.typeId.split(":")[1]!.slice(0, 6).padEnd(6) : "  ·   ")).join(" "));
            }
        },
    };
    return host;
};

const host = createConsoleHost(27);
const app = mount(h("slot", { index: 4, item: { typeId: "minecraft:apple", name: "Apple" } }), host);
host.print();   // the apple is in the first row, fifth cell
app.unmount();
```

## Scheduler hosts

A `SchedulerHost` tells the scheduler when it may flush and what time it is:

```ts
interface SchedulerHost {
    requestFlush(callback: () => void): void; // call back at the next safe point
    now(): number;                            // milliseconds, for time slicing only
}
```

Install one with `configureRuntime(host, options?)`; see [Reactivity → The scheduler](reactivity.md#the-scheduler).
Ready-made hosts:

| Host | Flushes |
| --- | --- |
| Bedrock (`installBedrockRuntime`) | through `system.run`, once per tick |
| `createMicrotaskSchedulerHost()` | on the microtask queue |
| `createManualSchedulerHost()` | only when you call `runPending()` |

Pick the flush point to match your host's "frame": the end of a game tick, an animation frame, an
event loop turn. Flushing more often than the host can show changes wastes renders; less often adds
latency.

## Time sources

A `TimeSource` (`after`, `every`, counted in ticks) drives the animation hooks. Install one with
`configureTimeSource`; see [Animation → The time source](animation.md#the-time-source). Map "tick" to
whatever your host's natural step is.

## The render pass, directly

`runRenderPass(element, { size, width?, scheduler, root })` turns an element tree into a `SlotMap`
without a host; `resolveItemSource(source)` evaluates an item source. They are what `mount` uses and
are exported for tooling. `RenderPassResult` holds `slots`, `overflowCount`, `collisions` and
`coveredInputs`. The `root` argument is an internal structure; prefer `mount` with a test host unless
you are building tooling around the renderer.
