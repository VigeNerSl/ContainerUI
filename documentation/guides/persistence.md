# Persistence

Signals live in memory and are gone when the world reloads. To keep data — balances, settings,
listings, a bank — store it in **dynamic properties**, which Bedrock saves with the world. ContainerUI
provides three layers for that:

| Layer | Stores | Use it for |
| --- | --- | --- |
| `KeyValueBackend` | strings under keys | where the data physically goes |
| `ChunkedStore` | strings of any length | long text, over size-limited backends |
| `JsonStore` | any JSON value, cached, versioned | application data |

You will almost always use `JsonStore` over a world or entity backend.

```ts
import { JsonStore, createWorldBackend } from "containerui";

const store = new JsonStore(createWorldBackend(), { namespace: "shop" });

const coins = store.get("coins:" + player.id, 0);
store.set("coins:" + player.id, coins + 10);
```

Items inside block containers need none of this: the storage entity's inventory is saved by the
game, enchantments and custom data included. See [Block containers](block-containers.md).

## Backends

A `KeyValueBackend` is three functions:

```ts
interface KeyValueBackend {
    get(key: string): string | undefined;           // undefined when absent
    set(key: string, value: string | undefined): void; // undefined deletes
    keys(): string[];
}
```

| Backend | Stores in | Notes |
| --- | --- | --- |
| `createWorldBackend()` | the world's dynamic properties | Lives as long as the world. |
| `createEntityBackend(entity)` | one entity's dynamic properties | Goes with the entity. Every call **throws** once the entity is gone, so a `JsonStore` reports the loss through `onCorrupt` instead of reading empty data. |
| `createMemoryBackend()` | a `Map` | For tests. Records every write in `writes`; `clearHistory()` forgets them. |

Implement the interface yourself to store elsewhere (a scoreboard, an item's properties).

## `ChunkedStore`

A single dynamic property holds at most 32,767 characters. `ChunkedStore` splits longer strings into
chunks and joins them back on read, and writes only the chunks that changed.

```ts
const chunks = new ChunkedStore(createWorldBackend(), { namespace: "mail", chunkSize: 30000 });
chunks.set("inbox:" + player.id, longText);
chunks.get("inbox:" + player.id);
```

| Option | Default | Meaning |
| --- | --- | --- |
| `namespace` | none | Prefix separating this store's keys from everything else in the backend. May not be empty or contain `|` (either throws `RangeError`), since `|` separates the namespace from the key. A store **without** one sees only keys that contain no `|`, so its `keys()` and `clear()` never reach a namespace's data, and `set` refuses a key containing `|`. |
| `chunkSize` | `30000` (`DEFAULT_CHUNK_SIZE`) | Characters per chunk: a positive integer, or the constructor throws `RangeError`. A surrogate pair (an emoji) is never split between chunks; with a chunk size of 1, a surrogate pair still goes into one chunk. |

| Method | Meaning |
| --- | --- |
| `get(key)` | The value, or `undefined` when it is missing or a chunk is missing. |
| `set(key, value)` | Writes the value; `undefined` deletes it. Unchanged chunks are not rewritten. |
| `delete(key)` | Deletes the value and all its chunks. |
| `has(key)` | Whether a value is stored. |
| `keys()` | The keys in this namespace. |
| `clear()` | Deletes every value in this namespace. |

Under key `k` in namespace `n`, the backend holds `n|k#n` (the chunk count) and `n|k#0`, `n|k#1`, …
Use a namespace per feature so that `keys()` and `clear()` never touch another feature's data.

A write is ordered so that one cut short reads as **absent** rather than as part of the value: a
value that grows announces its new chunk count first, so the chunks not yet written read as missing;
a value that shrinks deletes its tail first and updates the count last. If the count of a key is
lost or unusable, `set` and `delete` still remove the chunks the key left behind, and a namespaced
store's `clear()` removes every chunk in the namespace. One case stays open: a write cut short
while it rewrites a multi-chunk value that keeps its chunk count can leave a mixture of old and new
chunks, since checking for that would cost one extra write per `set`.

## `JsonStore`

Typed JSON over a `ChunkedStore`, with a read cache and migrations.

```ts
interface Settings {
    sound: boolean;
    theme: "dark" | "light";
}

const settings = new JsonStore(createWorldBackend(), {
    namespace: "settings",
    onCorrupt: (key, error) => console.warn(`[settings] ${key}: ${String(error)}`),
});

const mine = settings.get<Settings>(player.id, { sound: true, theme: "dark" });
settings.set(player.id, { ...mine, sound: false });
```

| Method | Meaning |
| --- | --- |
| `get(key, fallback)` | The stored value, or `fallback` when it is missing or unusable. Returns a **copy**, of the fallback too (when it is plain data). |
| `set(key, value)` | Stores anything `JSON.stringify` keeps, and reads back exactly that: `NaN` comes back as `null`. A value it cannot keep, such as `undefined` or a function, deletes the key. |
| `delete(key)` | Deletes the value. |
| `has(key)` | Whether a value is stored. |
| `keys()` | The keys in this store's namespace. |
| `clear()` | Deletes every value in the namespace. |
| `forget(key)` | Drops the cached copy, so the next `get` reads the backend. |
| `version` | How many migrations the store has (see below). |

Options: everything `ChunkedStore` takes, plus `onCorrupt` and `migrations`.

### Copies and the cache

`get` returns a deep copy, so changing the returned object does not change the store; call `set`
to save. Reads are cached per instance: the second `get` of a key does not touch the backend.

The cache belongs to the instance. So:

- keep **one `JsonStore` per namespace**, shared by all your code;
- if something else writes the same keys (another store instance, a command, a raw
  `world.setDynamicProperty`), call `forget(key)` before reading.

### Unusable records

`get` returns `fallback` and calls `onCorrupt(key, error)` when:

- the backend refused the read (for example, an entity backend whose entity is gone);
- the stored text is not valid JSON;
- a migration threw;
- the record was written by a newer version of the store (more migrations than this one has). It is
  neither read nor overwritten. A store with no migrations at all recognises this too: it reads the
  envelope `{"$v": 1, "$d": …}` of a newer add-on as a newer version, not as data.

Without `onCorrupt` these cases return the fallback silently.

### Migrations

When the shape of your data changes, give the store a list of upgrade functions. `migrations[0]`
turns version 0 into version 1, `migrations[1]` turns 1 into 2, and so on. The store's version is the
number of migrations.

```ts
// v0: a number of coins.  v1: { coins, gems }.  v2: adds lastSeen.
const wallets = new JsonStore(createWorldBackend(), {
    namespace: "wallet",
    migrations: [
        (value) => ({ coins: value as number, gems: 0 }),
        (value) => ({ ...(value as object), lastSeen: 0 }),
    ],
});

wallets.get(player.id, { coins: 0, gems: 0, lastSeen: 0 });
```

- Records written before you added migrations are version 0.
- A record is upgraded on its **first read**, then written back at the current version.
- With migrations, records are stored in an envelope: `{"$v": 2, "$d": …}`. Without migrations they
  are stored bare, except a value that itself has the shape of an envelope, which is wrapped as
  `{"$v": 0, "$d": value}` so that it is never mistaken for one.
- **Only ever append.** Never edit or remove a migration that has shipped: records in players' worlds
  may still need it.
- A migration receives the value and its key: `(value, key) => next`.

## Patterns

**Per-player data**: key by player id, not name — names can change.

```ts
const balances = new JsonStore(createWorldBackend(), { namespace: "bank" });
const balanceOf = (player: Player) => balances.get(player.id, 0);
```

**Reactive persisted state**: keep a signal for the UI and write through to the store. The effect
is created in its own root: created inside whatever scope is active, such as a component's render,
it would be disposed with that scope and stop saving.

```ts
import type { Player } from "@minecraft/server";
import { JsonStore, createRoot, createWorldBackend, effect, signal, type Signal } from "containerui";

const balances = new JsonStore(createWorldBackend(), { namespace: "bank" });
const coinsById = new Map<string, Signal<number>>();

export const coinsOf = (player: Player): Signal<number> => {
    let coins = coinsById.get(player.id);
    if (!coins) {
        coins = signal(balances.get(player.id, 0));
        const saved = coins;
        createRoot(() => effect(() => balances.set(player.id, saved.value)));
        coinsById.set(player.id, coins);
    }
    return coins;
};
```

**Data on an entity** (a pet's name, a backpack's owner): `createEntityBackend(entity)`. It dies with
the entity, which is usually what you want.

**Large collections**: one key per record (`"lot:" + id`) scales better than one giant array, since
only changed records are rewritten. `keys()` lists them.
