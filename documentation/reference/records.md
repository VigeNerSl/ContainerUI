# Diagnostics and log records

Everything the library reports, in one place: what each record means and what its fields say. How to
receive them is in [Errors, diagnostics and logging](../guides/errors-and-diagnostics.md).

## Diagnostics

Delivered to `onDiagnostic`. `openContainer` and `ContainerFormData.open` log them to source
`diagnostic` when no handler is given. A bare `mount()` without `onDiagnostic` drops `overflow`,
`collision` and `dev-warning`, and sends the failures (`render-error` that nothing caught,
`handler-error`, `write-failed`) to the error reporter.

| `kind` | Once per menu | When | `detail` |
| --- | --- | --- | --- |
| `overflow` | yes | Cells fell outside the menu. The message gives the count. | — |
| `collision` | yes | Several elements claimed one index (the last wins), or layer slots landed on inputs and were dropped. | the indices |
| `render-error` | no | A component, item function or the root threw while rendering. The message names what threw and what the player sees now: "its ErrorBoundary shows the fallback", "it renders nothing until it renders again", or "the last screen stays up". | the error |
| `handler-error` | no | `onClick`, `onPlace`, `onTake`, `onChange` or `accept` threw. | the error |
| `write-failed` | no | A slot write threw. The message names the slot and item. | the error |
| `platform-error` | no | The Bedrock surface failed: spawning, mounting, seating the player, reading, or an inventory that never reached its size (with a hint about the behaviour pack). | — |
| `dev-warning` | yes | See the table below. | — |

### Development warnings

| Message starts with | Cause |
| --- | --- |
| `X set its own state while rendering` | A state setter or `dispatch` was called during the component's own render. |
| `Duplicate key "k" among the children of X` | Two sibling components share a key. |
| `X passed an async function to useEffect` | The effect returned a promise. |
| `X called useEffect without dependencies first and with them later` (or the reverse) | The effect switched modes. |
| `Route "r" has a param named "route" or "router"` | A reserved param name. |

`X` is a component identity: `Name@id#key:k` for a keyed component, `Name@id#ord:n` for the `n`-th
unkeyed component of that type under its parent. `Anonymous` stands for an unnamed function.

## Log sources

| `source` | Level | Records |
| --- | --- | --- |
| `runtime` | `warn` | `Uncaught error in an effect, render or cleanup: …`; `No scheduler installed; falling back to microtask scheduling…` |
| `scheduler` | `error` | `A reactive task ran 100 times without the queue settling and was abandoned…`; `A flush ran 10000 tasks and abandoned the rest…` |
| `diagnostic` | `error` / `warn` | `<kind>: <message>` for menus without `onDiagnostic`. Failures (`render-error`, `handler-error`, `write-failed`, `platform-error`) are errors. |
| `surface` | `info` / `warn` | Platform failures of a `BedrockSurface` created without `onError`, as warnings; `orphan-surface-removed entityId=… viewer=… returned=N` (`info`, a menu entity a restart left, emptied and removed, its real items back with the viewer) and `orphan-surface-remove-failed error=…` (`warn`). |
| `block` | `info` / `warn` | [Block container records](#block-container-records), one line each. |
| `storage` | `info` / `warn` | `player-inventory invalidated player=… playerId=…` and `player-ender invalidated player=… playerId=…`; for [storages opened by click](../guides/held-storage.md#events), at `info`: `held-storage-discarded entityId=…` (a copy a restart left, thrown away) and `held-storage-resumed kind=… entityId=… refused=N` (a screen written on its player's return); as warnings: `held-write-failed kind=… error=…` (at `info` when the storage went with its owner's death), `held-release-failed kind=… error=…`, `held-resume-failed kind=… error=…` (or `player=… error=a kept screen never loaded`), `held-pending-failed kind=… error=…` (or `player=…`), `held-key-failed kind=… error=…` (a source's `key()` threw: its screen is not kept), `held-unmark-failed error=…` (a shulker box dropped on its owner's death could not be unmarked), `held-source-failed error=…` and `held-storage-discard-failed error=…`. |
| `item-guard` | `info` | [Guard lines](#item-guard-lines). |
| `items` | `warn` | What an item cannot take, once per item type or combination: an enchantment, durability, tags, a potion effect or delivery, block states, or a loot table that is missing or produced nothing. |

## Block container records

`BlockContainerEvent`: `kind`, `component`, and optionally `blockKey` (`dimension:x:y:z`), `player`
(name) and `detail` (`key=value` text). As a log line: `kind=… component=… blockKey=… player=… detail`.

| `kind` | When | `detail` |
| --- | --- | --- |
| `storage-spawned` | A placed block got its storage entity. | `entityId=… uuid=…` |
| `storage-loaded` | A storage entity loaded with its chunk. | `entityId=… hidden=true\|false` |
| `storage-wait` | A menu is waiting for the storage entity to load. | `retriesLeft=N` |
| `storage-missing` | No storage entity was found: when breaking (`at break`), or after the open retries (`gave up after 8 retries — break and re-place the block`). | as described |
| `storage-duplicate` | Several storage entities in one block; the empty ones were removed. | `found=N keptOccupied=N removedEmpty=N keptExtra=N` |
| `storage-invalidated` | The storage entity disappeared while a menu was open; the menus close. | — |
| `interact` | A player clicked the block or its entity. | `menu: through its storage entity`, `menu: already open, kept`, or `native: reached the block, not its storage entity` (a native block's click missed the entity) |
| `opened` | A player opened it. | menu: `entityId=… viewers=N size=N`; native: `native entityId=… viewers=N` |
| `closed` | A player closed it. | menu: `watchPasses=N watchMs=N`; native: `native entityId=… viewers=N` |
| `inventory` | Contents at open and at close. | `at=open\|close entityId=… items=slot:typeIdxamount,…` or `items=empty` |
| `storage-write` | A write through the block's storage. | `entityId=… slot=N item=typeIdxamount` |
| `storage-read-failed` | A slot could not be read; once per outage. | `entityId=… slot N: error` |
| `edit` | A player's edit in a default (mirror-everything) menu. | `slot=N action=take\|place\|swap from=… to=…` |
| `conflict` | An edit refused because the slot changed in the same tick. | `slot=N` |
| `external-change` | The watch found slots changed outside the menu. | `entityId=… slotsChanged=N` |
| `hit-entity` | A player hit the storage entity. | `sneaking=true\|false` |
| `hit-block` | A player hit a container block itself. | `block=typeId sneaking=true\|false` |
| `sneak-hide` | The storage entity was parked for a sneaking player. | `uuid=…` |
| `sneak-restore` | A parked storage entity was put back. | `reason=…` |
| `broken` | The block was broken. | `cause=…` for breaks without a player |
| `dropped` | The stored items dropped. | `items=N` stacks |
| `orphan-removed` | A storage entity without its block was removed. | `entityId=… found=… expected=… dropped=N`, or `entityId=… replacedBy=… dropped=N` when another block was placed over it |
| `error` | Something failed (logged as `warn`). | the failure |

Items in records are written without the `minecraft:` prefix: `diamondx3`, `red_concretex57`.

## Trace lines

A surface's `onTrace` receives one line per step of gesture tracking. They are for debugging; the
format may change between versions.

| Line | Meaning |
| --- | --- |
| `take-resolved slot=N item=… via=… outcome=fired` | A button's take was located and its handler fired. |
| `take-resolved … outcome=reclaimed` | A copy was taken back without firing (a swap's displaced button, or a take the screen replaced). |
| `take-resolved … outcome=gathered` | Collected by a double-click collect-all. |
| `take-held slot=N item=… reason=on-cursor` | The item is on the cursor; waiting for the gesture to finish. |
| `take-gathered slot=N item=…` | A collect-all picked up this button. |
| `take-abandoned slot=N item=… waited=N` | A take was never located; the slot was repainted and nothing fired. |
| `take-invalidated slot=N item=… reason=slot-repainted` | The slot was repainted while the take was in flight. |
| `insert-returned slot=N item=… to=N\|anywhere` | An item put into a button or decorative slot went back to the player, to inventory slot `N` (where it came from) or wherever it fit. |
| `insert-dropped item=… reason=inventory-full` | A returned item did not fit and was dropped at the player's feet. |
| `insert-stranded slot=N item=… reason=return-failed` | A returned item could not be placed anywhere and was left in the slot. |
| `insert-copy-restored slot=N item=…` | A menu copy was put into a button or decorative slot; the slot was repainted instead of handing the copy back. |
| `lookalike-found slot=N item=…` | A player's stack that reads exactly like a button (same type, count and name) was found swapped onto it; it is handled as an insertion. |
| `click-open-timeout ticks=N` | A menu opened with `openBy: "click"` was never clicked and closed. |
| `close-deferred reason=restricted-execution` | The menu was closed from a `beforeEvents` handler, where the world is read-only; the hand-back and removal run on the next tick. |
| `input-copy-removed slot=N item=… reason=no-pending-take` | A menu copy dragged into an input was removed. |
| `stack-grew slot=N item=… by=N` | A button's stack grew: another menu copy was stacked onto it. The extra is taken back. |
| `inventory-drift slots=N reason=unreported-change` | A periodic resync found the player's inventory changed without a change event. Harmless; counted in `scanStats.inventoryDrift`. |
| `cursor-discarded item=…` | A menu copy on the cursor was removed on close. |
| `scrub-swept stacks=N total=N` | Marked copies removed from the player's inventory. |
| `close-returned slot=N item=… to=player\|ground\|player+ground\|lost` | A real item left in the menu at close went into the player's inventory, onto the ground (a full inventory drops it at the player's feet), partly both, or could not be returned. |
| `conflict-taken-back item=… amount=N` | A refused take was recovered from the player. |
| `conflict-given-back item=… amount=N ok=true\|false` | A refused placement was given back. |
| `conflict-unresolved item=… missing=N` | A refused take could not be fully recovered. |

`via` says where a take was located:

| `via` | Located |
| --- | --- |
| `cursor` | On the player's cursor (mouse). |
| `player-inventory` | In the player's inventory (touch, shift-click, drag). |
| `surface` | In another slot of the menu. |
| `input` | Dragged into an input. |
| `ground` | Thrown; destroyed by the item guard. |
| `swept` | Removed by an inventory sweep before the scan got to it. |
| `returned` | Put back into its own slot. |

## Item guard lines

With `setItemGuardLogger`, or at `info` level with source `item-guard`:

| Line | Meaning |
| --- | --- |
| `reason=drop item=… destroyed=N` | A thrown menu copy was destroyed. |
| `reason=spawn item=… destroyed=N` | A menu copy that appeared as a loose item was destroyed. |
| `reason=… removal-failed error=…` | The engine refused to remove one. |
| `reason=use-refused item=…` | Using a menu copy was cancelled. |
| `reason=interact-refused item=…` | Using a menu copy on a block was cancelled. |
| `reason=entity-interact-refused item=…` | Using a menu copy on an entity was cancelled. |
| `reason=load item=… destroyed=N` | A menu copy that loaded as a loose item was destroyed. |
| `reason=join player=… swept=N` | Copies removed from a joining player. |
| `reason=install player=… swept=N` | Copies removed from a player already in the world when the guard was installed, such as after a script reload. |
| `reason=install sweep-failed error=…` | That sweep failed. |
| `reason=drop item=… swept=N` | Copies removed from inside a thrown storage item, such as a bundle, which was replaced by a clean one. |
| `reason=drop storage-respawn-failed item=… error=…` | The clean one could not be spawned; the thrown one stays as it was. |
| `reason=drop storage-removal-failed item=… error=…` | The thrown one could not be removed; the clean one was taken back. |
| `reason=sweep own-item-lost item=… amount=N` | One of the player's own items, taken out with a copy, could neither go back nor be dropped. |
| `reason=container-opened swept=N` | Copies removed from a player opening a block container. |
| `reason=container-closed swept=N` | Copies removed from a player closing a block container. |
| `reason=entity-container-opened swept=N` | Copies removed from a player opening an entity's container. |
| `reason=entity-container-closed swept=N` | Copies removed from a player closing an entity's container. |
| `reason=drop items-unreadable owner=…` | A drop event whose items could not be read. |
| `handler=… failed error=…` | A guard handler threw. |

## Shulker reader events

See [Shulker reader → Events](../guides/shulker-reader.md#events).
