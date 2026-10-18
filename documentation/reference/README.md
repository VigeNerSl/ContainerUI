# API reference

Every export of the library, grouped by area, with its signature and a link to the page that explains
it. All names are exported from the main entry (`containerui`, or `ContainerFormData.js` in a copied
tree). Names marked **core** are also exported from `containerui/core` (`core/index.js`), which loads
without the game.

Types are listed with the functions that use them.

## Elements

| Export | Signature | |
| --- | --- | --- |
| `h` **core** | `h(type, props?, ...children): VNode` | Creates an element. [→](../getting-started/jsx-and-h.md) |
| `createElement` **core** | same as `h` | `h` under the name the JSX compiler imports when a `key` follows a spread (`<Card {...props} key={id} />`). |
| `fragment` **core** | `fragment(...children): VNode` | Groups children without layout. |
| `Fragment` **core** | `symbol` | The fragment element type (`<>…</>`). |
| `isVNode` **core** | `(value: unknown) => value is VNode` | Whether a value is an element. |
| `isEmptyChild` **core** | `(child: Child) => boolean` | Whether a child renders nothing. |
| `isIntrinsicType` **core** | `(type: ElementType) => boolean` | Whether a type is a built-in element name. |

Types: `VNode<P>` (`{ type, props, key }`), `Child`, `Key` (`string | number`), `ElementType`,
`IntrinsicType` (`"slot" | "input" | "box" | "row" | "column" | "grid"`), `ComponentType<P>`,
`ElementPropsMap`, `SlotProps`, `InputProps`, `LayoutProps`, `GridProps`, `LayerProps`, `ItemSource`
(`ItemView | null | (() => ItemView | null)`), `SlotEvent`, `InputEvent`.
[Elements and layout](../guides/elements-and-layout.md) · [Interaction](../guides/interaction.md)

### JSX runtime (`containerui/jsx-runtime`)

| Export | |
| --- | --- |
| `jsx(type, props, key?)`, `jsxs`, `jsxDEV` | Called by the compiler; all build the same element. |
| `Fragment` | The fragment type. |
| `JSX` namespace | Types built-in elements against `ElementPropsMap`. |

## Rendering

| Export | Signature | |
| --- | --- | --- |
| `mount` **core** | `mount(element: Child \| (() => Child), host: HostAdapter, options?: MountOptions): App` | Renders a tree onto a host. [→](../guides/custom-hosts.md#mounting) |
| `runRenderPass` **core** | `runRenderPass(element, options: RenderPassOptions): RenderPassResult` | One render pass, without a host. For tooling. |
| `resolveItemSource` **core** | `(source: ItemSource \| undefined) => ItemView \| null` | Evaluates an item source. |

Types: `App` (`host`, `slots`, `writeCount`, `flush()`, `unmount()`), `MountOptions` (`width`,
`scheduler`, `syncMount`, `onDiagnostic`), `Diagnostic` (`kind`, `message`, `detail?`),
`ResolvedSlot`, `SlotMap`, `SlotKind` (`"display" | "button" | "input"`), `RenderPassOptions`,
`RenderPassResult`.

## Layout

| Export | Signature | |
| --- | --- | --- |
| `SURFACE_WIDTH` **core** | `9` | Slots per row. |
| `toIndex` **core** | `(row, column, width = 9) => number` | Index of a row and column. |
| `toCoordinates` **core** | `(index, width = 9) => { row, column }` | Row and column of an index. |
| `borderIndices` **core** | `(size, width = 9) => number[]` | Indices on the edge. |
| `rectIndices` **core** | `(options: RectOptions) => number[]` | Indices in an inclusive rectangle. |
| `LayoutFrame` **core** | `new LayoutFrame(options: LayoutFrameOptions)` | Hands out cells: `takeIndex()`, `skip(n)`, `overflowCount`. |

Types: `LayoutKind`, `LayoutFrameOptions`, `RectOptions`.
[Elements and layout → Layout helpers](../guides/elements-and-layout.md#layout-helpers)

## Reactivity

| Export | Signature | |
| --- | --- | --- |
| `signal` **core** | `signal<T>(initial: T, equals?: Equals<T>): Signal<T>` | A writable value. [→](../guides/reactivity.md#signals) |
| `readonlySignal` **core** | `(source: Signal<T>) => ReadonlySignal<T>` | A read-only view. |
| `computed` **core** | `computed<T>(compute: () => T, equals?): Computed<T>` | A derived value. [→](../guides/reactivity.md#computed-values) |
| `effect` **core** | `effect(body: EffectBody): Dispose` | Runs now and when what it read changes. [→](../guides/reactivity.md#effects) |
| `batch` **core** | `batch<T>(body: () => T): T` | Defers the flush until `body` returns. |
| `flushSync` **core** | `flushSync(): void` | Runs pending work now. |
| `untrack` **core** | `untrack<T>(body: () => T): T` | Runs without tracking reads. |
| `createRoot` **core** | `createRoot<T>(body: (dispose) => T): T` | A detached scope. [→](../guides/reactivity.md#scopes) |
| `createScope` **core** | `createScope(parent?: Scope \| null): Scope` | A scope. |
| `runWithScope` **core** | `runWithScope<T>(scope, body: () => T): T` | Runs with a scope active. |
| `disposeScope` **core** | `disposeScope(scope): void` | Disposes a scope. |
| `getActiveScope` **core** | `(): Scope \| null` | The active scope. |
| `onCleanup` **core** | `onCleanup(fn: Dispose): void` | Registers a cleanup on the active scope. |
| `setErrorReporter` **core** | `(reporter: ((error) => void) \| null) => void` | Where uncaught errors go. [→](../guides/reactivity.md#errors) |

Types: `Signal<T>` (`value`, `peek()`, `set()`, `update()`), `ReadonlySignal<T>` (`value`, `peek()`),
`Computed<T>` (adds `dispose()`), `Equals<T>`, `EffectBody`, `Dispose`, `Scope`.

## Scheduling

| Export | Signature | |
| --- | --- | --- |
| `Scheduler` **core** | `new Scheduler(host: SchedulerHost, options?: SchedulerOptions)` | Runs reactive work. `schedule`, `batch`, `flush`, `flushSync`, `pendingCount`, `isFlushing`. |
| `configureRuntime` **core** | `(host, options?) => Scheduler` | Creates and installs the runtime scheduler. |
| `setRuntimeScheduler` **core** | `(scheduler) => void` | Installs a scheduler. |
| `getRuntimeScheduler` **core** | `() => Scheduler` | The installed one (a microtask fallback with a warning if none). |
| `hasRuntimeScheduler` **core** | `() => boolean` | Whether one is installed. |
| `resetRuntime` **core** | `() => void` | Removes it. For tests. |
| `createMicrotaskSchedulerHost` **core** | `() => SchedulerHost` | Flushes on microtasks. |
| `createManualSchedulerHost` **core** | `() => ManualSchedulerHost` | Flushes on `runPending()`; clock via `advance(ms)`. |

Types: `SchedulerHost` (`requestFlush`, `now`), `SchedulerOptions` (`budgetMs`, `maxPassesPerFlush`,
`maxRunsPerTask`, `onError`), `SchedulerTask`, `ManualSchedulerHost`.
[Reactivity → The scheduler](../guides/reactivity.md#the-scheduler)

## Hooks

| Export | Signature | |
| --- | --- | --- |
| `useState` **core** | `useState<T>(initial: T \| (() => T)): [T, setter]` | [→](../guides/hooks.md#usestate) |
| `useSignal` **core** | `useSignal<T>(initial): Signal<T>` | [→](../guides/hooks.md#usesignal) |
| `useReducer` **core** | `useReducer<S, A>(reducer, initialState): [S, dispatch]` | [→](../guides/hooks.md#usereducer) |
| `useMemo` **core** | `useMemo<T>(factory, dependencies?): T` | [→](../guides/hooks.md#usememo) |
| `useComputed` **core** | `useComputed<T>(compute): ReadonlySignal<T>` | [→](../guides/hooks.md#usecomputed) |
| `useEffect` **core** | `useEffect(body: EffectBody, dependencies?): void` | [→](../guides/hooks.md#useeffect) |
| `onUnmount` **core** | `onUnmount(cleanup: Dispose): void` | [→](../guides/hooks.md#onunmount) |
| `useRef` **core** | `useRef<T>(initial: T): { current: T }`; `useRef<T>(): { current: T \| undefined }` | [→](../guides/hooks.md#useref) |
| `useCallback` **core** | `useCallback<F>(callback: F, dependencies?): F` | [→](../guides/hooks.md#usecallback) |
| `useId` **core** | `useId(): string` | [→](../guides/hooks.md#useid) |
| `useExternal` **core** | `useExternal<T>({ subscribe, read, equals? }): T` | [→](../guides/outside-state.md#useexternal) |
| `useTicker` **core** | `useTicker(intervalTicks, callback): Ticker` | [→](../guides/animation.md#useticker) |
| `useReveal` **core** | `useReveal(options: RevealOptions): Reveal` | [→](../guides/animation.md#usereveal) |
| `useTween` **core** | `useTween(options: TweenOptions): ReadonlySignal<number>` | [→](../guides/animation.md#usetween) |
| `useResource` **core** | `useResource<T>(load, dependencies?): Resource<T>` | [→](../guides/async-data.md#useresource) |
| `usePagination` **core** | `usePagination<T>(options: PaginationOptions<T>): Pagination<T>` | [→](../guides/lists-and-quantities.md#usepagination) |
| `useContext`, `useContextSelector`, `useRequiredContext` **core** | see Context | |
| `useRouter`, `useRouteState` **core** | see Navigation | |
| `useScore` | `useScore({ participant, objective, intervalTicks? }): number \| undefined` | Bedrock. [→](../guides/outside-state.md#usescore) |
| `useDynamicProperty` | `useDynamicProperty({ key, owner?, intervalTicks? }): DynamicPropertyValue` | Bedrock. [→](../guides/outside-state.md#usedynamicproperty) |

Types: `Ticker`, `TweenOptions`, `ExternalOptions<T>`, `ExternalSubscribe`, `ScoreOptions`,
`DynamicPropertyOptions`, `DynamicPropertyValue`.

## Context

| Export | Signature | |
| --- | --- | --- |
| `createContext` **core** | `createContext<T>(defaultValue: T, name?): Context<T>` | [→](../guides/context.md) |
| `provideContext` **core** | `provideContext<T>(context, value): void` | |
| `useContext` **core** | `useContext<T>(context): T` | |
| `useContextSelector` **core** | `useContextSelector<T, R>(context, select: (value: T) => R): R` | |
| `useRequiredContext` **core** | `useRequiredContext<T>(context): NonNullable<T>` | Throws when not provided. |

Types: `Context<T>` (`id`, `defaultValue`, `name`).

## Navigation

| Export | Signature | |
| --- | --- | --- |
| `createRouter` **core** | `createRouter(initialName, initialParams?): Router` | [→](../guides/navigation.md) |
| `Routes` **core** | component: `{ router, screens, layout?, fallback? }` | |
| `useRouter` **core** | `useRouter(): Router` | Throws outside `Routes`. |
| `useRouteState` **core** | `useRouteState<T>(key, initial): [T, setter]` | State per stack entry. |

Types: `Router` (`current`, `stack`, `push`, `replace`, `back`, `reset`, `canGoBack`), `RouteMatch`
(`name`, `params`), `RouteConfig` (`screen`, `layout?`), `RouteTable`, `RouteProps` (`route`, `router`),
`RoutesProps`.

## Components

| Export | Props | |
| --- | --- | --- |
| `ErrorBoundary` **core** | `fallback`, `onError?`, `children` | [→](../guides/errors-and-diagnostics.md#errorboundary) |
| `Layer` **core** | `z?`, `backdrop?`, `onBackdropClick?`, `children` | [→](../guides/layers-and-modals.md#layer) |
| `Modal` **core** | `open`, `backdrop?`, `onDismiss?`, `z?`, `children` | [→](../guides/layers-and-modals.md#modal) |
| `Confirm` **core** | `open`, `watch?`, `confirm`, `cancel`, `onConfirm`, `onCancel`, `onChanged?`, `backdrop?`, `z?`, `children` | [→](../guides/layers-and-modals.md#confirm) |
| `Suspense` **core** | `fallback`, `children` | [→](../guides/async-data.md#suspense) |
| `PagedList` **core** | `items`, `cells`, `renderItem`, `keyOf?`, `previous?`, `next?`, `indicator?`, `filler?`, `state?` | [→](../guides/lists-and-quantities.md#pagedlist) |
| `QuantityPicker` **core** | `value`, `onChange`, `item`, `index?`, `min?`, `max?`, `steps?`, `onPick?`, `sound?`, `stepItem?`, `stackLimit?`, `counter?` | [→](../guides/lists-and-quantities.md#quantitypicker) |
| `StorageSlots` **core** | `storage`, `from?`, `count?`, `index?`, `accept?`, `onEdit?`, `onConflict?` | [→](../guides/storage-and-mirroring.md#storageslots) |
| `StorageView` **core** | `storage`, `from?`, `count?`, `index?`, `onSlotClick?`, `sound?`, `decorate?` | [→](../guides/storage-and-mirroring.md#storageview) |

Types: `ErrorBoundaryProps`, `RenderFailure` (`error`, `component`, `reset()`), `ModalProps`,
`ConfirmProps`, `ConfirmButton`, `Watched`, `SuspenseProps`, `Resource<T>`, `PagedListProps<T>`,
`PageControl`, `Pagination<T>`, `PaginationOptions<T>`, `PageState`, `QuantityPickerProps`,
`QuantityStep`, `StorageSlotsProps`, `StorageViewProps`, `StorageRangeProps`.

## Animation and time

| Export | Signature | |
| --- | --- | --- |
| `createReveal` **core** | `createReveal(options: RevealOptions): RevealState` | A reveal moved by hand. [→](../guides/animation.md#without-a-component) |
| `revealSteps` **core** | `revealSteps(order, size, width = 9, seed = 1): number[]` | The step of each slot. |
| `configureTimeSource` **core** | `(source: TimeSource) => void` | Installs timers. [→](../guides/animation.md#the-time-source) |
| `getTimeSource` **core** | `() => TimeSource` | Throws when none is installed. |
| `hasTimeSource` **core** | `() => boolean` | |
| `resetTimeSource` **core** | `() => void` | For tests. |
| `createManualTimeSource` **core** | `() => ManualTimeSource` | `advance(ticks)`, `timerCount`. |

Types: `Reveal`, `RevealState`, `RevealOptions`, `RevealOrder`, `TimeSource`, `ManualTimeSource`.

## Fluent builder

| Export | | |
| --- | --- | --- |
| `ContainerFormBuilder` **core** | `new ContainerFormBuilder(size, width = 9)` | `title`, `slot`, `button`, `input`, `reserve`, `component`, `border`, `fill`, `rect`, `pattern`, `storage`, `build`, `resolvedTitle`, `claimedIndices`. [→](../guides/fluent-builder.md) |
| `ContainerFormData` | `new ContainerFormData(size, width = 9)` | Bedrock: adds `onClose(handler)` and `open(player, options?)`. |

Types: `InputOptions`, `Area`, `StorageOptions`, `ContainerFormOpenOptions`.

## Storage

| Export | Signature | |
| --- | --- | --- |
| `createMemoryStorage` **core** | `createMemoryStorage(size, initial?): MemoryStorage` | [→](../guides/storage-and-mirroring.md#the-in-memory-storage) |
| `EntityInventoryStorage` | abstract class | Base for entity storages. [→](../guides/storage-and-mirroring.md#entity-storages) |
| `BlockStorage` | `BlockStorage.forEntity(entity)`, `BlockStorage.evict(entityId)` | A block's storage entity. |
| `PlayerInventoryStorage` | `PlayerInventoryStorage.forPlayer(player)`, `.evict(playerId)` | A player's inventory. [→](../guides/storage-and-mirroring.md#a-players-inventory) |
| `PlayerEnderStorage` | `PlayerEnderStorage.forPlayer(player)`, `.evict(playerId)` | A player's ender chest. [→](../guides/storage-and-mirroring.md#a-players-ender-chest) |
| `PLAYER_INVENTORY_WATCH_INTERVAL_TICKS` | `2` | Default player-inventory watch interval. |
| `createContainerWatcher` | `({ resolveContainer, onExternalChange, onInvalid }) => ContainerWatcher` | Watches a container for outside changes. [→](../guides/storage-and-mirroring.md#watching-a-container-yourself) |
| `inventoryContainerOf` | `(entity: Entity) => Container \| null` | An entity's inventory. |
| `enderContainerOf` | `(entity: Entity) => Container \| null` | A player's ender chest. |

Types: `SlotStorage` (`size`, `get`, `set`, `version`), `MemoryStorage` (adds `silentSet`,
`notifyExternalChange`, `snapshot`), `ContainerWatcher`.

## Persistence

| Export | Signature | |
| --- | --- | --- |
| `JsonStore` **core** | `new JsonStore(backend, options?: JsonStoreOptions)` | `get`, `set`, `delete`, `has`, `keys`, `clear`, `forget`, `version`. [→](../guides/persistence.md#jsonstore) |
| `ChunkedStore` **core** | `new ChunkedStore(backend, options?: ChunkedStoreOptions)` | `get`, `set`, `delete`, `has`, `keys`, `clear`. [→](../guides/persistence.md#chunkedstore) |
| `createMemoryBackend` **core** | `() => MemoryBackend` | For tests; records `writes`. |
| `DEFAULT_CHUNK_SIZE` **core** | `30000` | |
| `createWorldBackend` | `() => KeyValueBackend` | World dynamic properties. |
| `createEntityBackend` | `(entity) => KeyValueBackend` | An entity's dynamic properties. |

Types: `KeyValueBackend`, `MemoryBackend`, `BackendWrite`, `ChunkedStoreOptions`, `JsonStoreOptions`,
`JsonMigration`.

## Items

| Export | Signature | |
| --- | --- | --- |
| `areItemsEqual` **core** | `(a, b) => boolean` | Same look. [→](../guides/items.md#copying-and-comparing) |
| `isSameItem` **core** | `(a, b) => boolean` | Same look and same real item. |
| `areEnchantmentsEqual` **core** | `(a, b) => boolean` | Same enchantments, any order. |
| `cloneItemView` **core** | `(item) => ItemView \| null` | Deep copy. |
| `toDisplayView` **core** | `(item) => ItemView \| null` | Copy without `native`. |
| `fromItemStack` | `(stack: ItemStack \| undefined) => ItemView \| null` | Bedrock. [→](../guides/items.md#bedrock-conversions) |
| `toItemStack` | `(view, { isUiOwned? }) => ItemStack \| undefined` | A described item, marked; a real item, cloned and marked only in a UI-owned slot. |
| `toStorageStack` | `(view) => ItemStack \| undefined` | An unmarked stack. |
| `isRenderedItem` | `(stack) => boolean` | Whether a stack is marked. |
| `maxStackOf` | `(typeId) => number \| undefined` | Stack size of an item type. |
| `installItemGuard` | `() => void` | [→](../guides/items.md#guard-api) |
| `getItemGuardStats` | `() => ItemGuardStats` | |
| `setItemGuardLogger` | `(reporter \| null) => void` | |
| `onMarkedItemDestroyed` | `(listener: MarkedItemListener) => () => void` | |
| `itemFromLootTable` | `(path, options?: LootItemOptions) => ItemView \| null` | An item a loot table builds, such as a tipped arrow. [→](../guides/items.md#items-only-a-loot-table-can-build) |
| `readShulkerContents` | `(player, shulkerStack, options?) => Promise<(ItemView \| null)[]>` | Never throws; failures arrive through `onEvent`. [→](../guides/shulker-reader.md) |
| `writeShulkerContents` | `({ player, shulkerStack, contents, onEvent? }) => ShulkerWriteResult \| null` | A shulker box item holding `contents`, made in one tick. [→](../guides/shulker-reader.md#writing-a-shulker-box) |
| `sweepShulkerLeftovers` | `() => number` | Removes what a cut-short read left behind and returns how many blocks it removed. [→](../guides/shulker-reader.md#a-read-cut-short) |

Types: `ItemView`, `ItemEnchantment`, `ItemPotion`, `ItemGuardStats`, `MarkedItemListener`,
`LootItemOptions`, `ShulkerReadEvent`, `ShulkerReadOptions`, `ShulkerWriteResult`.

## Storages opened by click

| Export | Signature | |
| --- | --- | --- |
| `installHeldItem` | `(options: HeldItemOptions) => void` | An item that opens a storage when the player sneaks with it. [→](../guides/held-storage.md#installhelditemoptions) |
| `openHeldStorage` | `(player, options: HeldStorageOptions) => Promise<boolean>` | [→](../guides/held-storage.md#openheldstorageplayer-options) |
| `shulkerBoxSource` | `() => HeldSource` | The shulker box in hand. [→](../guides/held-storage.md#shulkerboxsource) |
| `enderChestSource` | `() => HeldSource` | The player's ender chest. [→](../guides/held-storage.md#enderchestsource) |
| `registerHeldSource` | `(kind, handling: HeldKind) => void` | How a kind cleans up after opens cut short: `release`, and `resume` for a player who left with the screen open. [→](../guides/held-storage.md#when-an-open-is-cut-short) |

Types: `HeldSource`, `HeldWriteResult`, `HeldKind`, `HeldRelease`, `HeldResume`, `HeldReport`,
`HeldItemOptions`, `HeldStorageOptions`, `HeldOpenOptions`, `HeldOpenEvent`.

## Host boundary

| Export | Signature | |
| --- | --- | --- |
| `createTestHost` **core** | `createTestHost(options?: TestHostOptions): TestHost` | [→](../guides/testing.md#the-test-host) |

Types: `HostAdapter`, `HostInteraction`, `InteractionKind` (`"take" | "place" | "swap"`), `CloseReason`
(`"player" | "programmatic" | "invalidated" | "distance" | "timeout"`), `TestHost`, `TestHostOptions`,
`WriteRecord`. [Custom hosts](../guides/custom-hosts.md)

## Bedrock runtime

| Export | Signature | |
| --- | --- | --- |
| `installBedrockRuntime` | `({ budgetMs? }?) => Scheduler` | [→](../guides/bedrock-runtime.md#installbedrockruntime) |
| `uninstallBedrockRuntime` | `() => void` | [→](../guides/bedrock-runtime.md#uninstalling) |
| `openContainer` | `(player, element, options: OpenContainerOptions) => ContainerSession` | [→](../guides/bedrock-runtime.md#opencontainer) |
| `BedrockSurface` | `new BedrockSurface(player, options: BedrockSurfaceOptions)` | [→](../guides/bedrock-runtime.md#bedrocksurface) |
| `runMountSequence` | `(options: MountSequenceOptions) => void` | The open sequence. |
| `classifySpawnError` | `(error) => SpawnOutcome` | `"deferred"` for a refusal in the engine's read-only window (retried next tick); `"failed"` otherwise. |

Types: `OpenContainerOptions`, `ContainerSession`, `BedrockSurfaceOptions`, `SurfaceOpenMode`
(`"seat" | "click"`), `SurfaceClickPoint` (`"head" | Vector3`), `MountEvent`, `MountSequenceOptions`,
`SpawnOutcome`.

## Block containers

| Export | Signature | |
| --- | --- | --- |
| `registerBlockContainer` | `(registry, componentName, options: BlockContainerOptions) => void` | [→](../guides/block-containers.md#registerblockcontainer) |
| `findBlockStorageEntity` | `(dimension, location) => Entity \| null` | [→](../guides/block-containers.md#lower-level-functions) |
| `claimBlockStorageEntity` | `(dimension, location) => Entity \| null` | Also removes empty duplicates. |
| `setBlockContainerLogger` | `(logger \| null) => void` | [→](../guides/block-containers.md#records) |
| `installBlockSneak` | `() => void` | Sneak-to-break; installed by `registerBlockContainer`. |

Types: `BlockContainerOptions`, `BlockContainerRenderContext`, `BlockContainerEvent`.

## Logging

| Export | Signature | |
| --- | --- | --- |
| `setLogger` **core** | `(logger: Logger \| null) => void` | [→](../guides/errors-and-diagnostics.md#logging) |
| `consoleLogger` **core** | `Logger` | The default. |

Types: `Logger`, `LogRecord`, `LogLevel`, `LogSource`.

## Interaction tracking (advanced)

The Bedrock adapter's gesture tracker, exported for tools and tests that drive it with their own
reads and writes. You do not need these to build menus.

| Export | |
| --- | --- |
| `InteractionTracker` | Works out what a slot change means (take, place, swap, located or pending). |
| `ExpectedSlots` | What each slot is expected to hold. |
| `isSameItemKind` | Whether two slot probes are the same kind of item. |

Types: `SlotProbe`, `PendingTake`, `TakeResolution`, `TrackerIO`, `ScanPassResult`.

## Other reference pages

- [Potion effects and arrow data values](potion-effects.md) — every effect id, and the data value of
  the tipped arrow that carries it.
- [Diagnostics and log records](records.md) — every diagnostic, block record and trace line.
- [Constants](constants.md) — sizes, timings and identifiers.

## Constants

`NAMESPACE`, `SUPPORTED_SIZES`, `SIZE_TITLE_PREFIX`, `SURFACE_ENTITY_TYPE_ID`, `STORAGE_ENTITY_TYPE_ID`,
`STORAGE_ENTITY_TAG`, `ITEM_ENTITY_TYPE_ID`, `UI_ITEM_MARKER_PROPERTY`, `LEGACY_UI_ITEM_MARKER`,
`BLOCK_KEY_PROPERTY`, `BLOCK_COMPONENT_PROPERTY`, `STORAGE_UUID_PROPERTY`, `HIDDEN_TAG`,
`MAX_VIEW_DISTANCE`, `MOUNT_MAX_WAIT_TICKS`, `MOUNT_MAX_SPAWN_ATTEMPTS`, `SCAN_INTERVAL_TICKS`,
`IDLE_SCAN_INTERVAL_TICKS`, `WATCHDOG_INTERVAL_TICKS`, `CLICK_OPEN_WAIT_TICKS`, `STORAGE_WATCH_INTERVAL_TICKS`, `PLAYER_INVENTORY_WATCH_INTERVAL_TICKS`, `openEventFor`,
`containerGroupFor`. [Constants](constants.md)

## Version

| Export | |
| --- | --- |
| `VERSION` **core** | The library version string, such as `"1.0.0-beta.5"`. |
