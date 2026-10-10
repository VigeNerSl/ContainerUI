# Outside state

Not all state lives in signals. Scoreboards, dynamic properties, another add-on's API, your own event
emitter — they change without telling the reactive system. `useExternal` bridges them into a
component, and `useScore` / `useDynamicProperty` do it for the two most common Bedrock sources.

## `useExternal`

```ts
const value = useExternal({ subscribe, read, equals? });
```

The current value of outside state, like React's `useSyncExternalStore`. The component re-renders
when a notification finds the value changed.

| Option | Type | Meaning |
| --- | --- | --- |
| `subscribe` | `(notify) => unsubscribe \| void` | Called once on mount. Call `notify()` whenever the value *may* have changed; return a function that unsubscribes. |
| `read` | `() => T` | Reads the current value. Called on mount, on every render and on every notification. |
| `equals` | `(previous, next) => boolean` | Whether two readings are the same. Default `Object.is`. |

```tsx
// An emitter of your own.
const balance = useExternal({
    subscribe: (vigenersl) => bank.onChange(vigenersl), // returns an unsubscribe
    read: () => bank.balanceOf(player.id),
});
```

- `read` runs once more right before subscribing, to catch a change made between the first read and
  the subscription.
- A notification that reads an equal value does nothing.
- The latest `read` and `equals` are used on every notification.
- `read` runs on every render too, so a `read` that depends on props (`bank.balanceOf(props.id)`)
  shows the new value as soon as the prop changes, without waiting for the next notification.
  Keep it cheap and free of side effects. `subscribe` still runs once, at mount.
- The subscription ends when the component unmounts.

`ExternalSubscribe` and `ExternalOptions<T>` are the types.

### Polling

Many Bedrock sources have no change event. Subscribe with a timer instead; `notify` is cheap when
nothing changed:

```ts
const timeOfDay = useExternal({
    subscribe: (vigenersl) => {
        const runId = system.runInterval(vigenersl, 20);
        return () => system.clearRun(runId);
    },
    read: () => world.getTimeOfDay(),
});
```

### Events

When the game does have an event, subscribe to it:

```ts
const health = useExternal({
    subscribe: (vigenersl) => {
        const handler = world.afterEvents.entityHealthChanged.subscribe(vigenersl, { entities: [player] });
        return () => world.afterEvents.entityHealthChanged.unsubscribe(handler);
    },
    read: () => player.getComponent("minecraft:health")?.currentValue ?? 0,
});
```

## `useScore`

A participant's score on a scoreboard objective, polled every 10 ticks.

```tsx
function Coins({ player }: { player: Player }) {
    const coins = useScore({ participant: player, objective: "coins" }) ?? 0;
    return <slot index={4} item={{ typeId: "minecraft:gold_ingot", name: `§6${coins} coins` }} />;
}
```

| Option | Type | Meaning |
| --- | --- | --- |
| `participant` | `Entity \| string` | An entity, or a fake player's name. |
| `objective` | `string` | The objective's id. |
| `intervalTicks` | `number` | Ticks between reads. Default `10`. |

It returns the score, or `undefined` when the objective does not exist, the participant has no score,
the entity is gone, or the read failed. A change made by a command, another add-on, or your own code
shows within `intervalTicks`.

If your own code changes the score, update the UI at once by also keeping the value in a signal, or
lower `intervalTicks` for that menu.

## `useDynamicProperty`

A dynamic property of the world or of an entity, polled every 10 ticks.

```tsx
const motd = useDynamicProperty({ key: "server:motd" });
const pet = useDynamicProperty({ key: "pets:name", owner: player });
```

| Option | Type | Meaning |
| --- | --- | --- |
| `key` | `string` | The property id. |
| `owner` | `Entity` | The entity holding it. Default: the world. |
| `intervalTicks` | `number` | Ticks between reads. Default `10`. |

It returns the value — `boolean`, `number`, `string` or `Vector3` — or `undefined` when unset or
unreadable. Vectors compare by their coordinates, so a vector rewritten with the same values does not
re-render. `DynamicPropertyValue` is the value type.

For data you own and write yourself, a [`JsonStore`](persistence.md) plus a signal is usually a better
fit than polling a raw property.

## Choosing

| Source | Use |
| --- | --- |
| Your own state | a signal — no bridge needed |
| An object with a change event or emitter | `useExternal` with `subscribe` |
| A scoreboard | `useScore` |
| A dynamic property | `useDynamicProperty`, or `JsonStore` + signal for your own data |
| Anything else in the world | `useExternal` with a polling `subscribe` |
