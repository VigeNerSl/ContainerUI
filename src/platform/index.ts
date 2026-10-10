/**
 * The Minecraft Bedrock adapter: surfaces, block containers, storages and item conversion.
 *
 * @packageDocumentation
 */

export { uninstallBedrockRuntime } from "./lifecycle.js";
export { openContainer, installBedrockRuntime, type ContainerSession, type OpenContainerOptions } from "./surface/openContainer.js";
export { ContainerFormData, type ContainerFormOpenOptions } from "./surface/openForm.js";
export { runMountSequence, classifySpawnError, type MountEvent, type MountSequenceOptions, type SpawnOutcome } from "./surface/mountSequence.js";
export { BedrockSurface, type BedrockSurfaceOptions } from "./surface/surface.js";
export { fromItemStack, toItemStack, toStorageStack, isRenderedItem, maxStackOf } from "./items/itemConversion.js";
export {
    installItemGuard,
    getItemGuardStats,
    setItemGuardLogger,
    onMarkedItemDestroyed,
    type ItemGuardStats,
    type MarkedItemListener,
} from "./items/itemGuard.js";
export {
    InteractionTracker,
    ExpectedSlots,
    isSameItemKind,
    type SlotProbe,
    type PendingTake,
    type TakeResolution,
    type TrackerIO,
    type ScanPassResult,
} from "./scan/scanPass.js";
export { BlockStorage } from "./block/blockStorage.js";
export {
    registerBlockContainer,
    findBlockStorageEntity,
    claimBlockStorageEntity,
    setBlockContainerLogger,
    type BlockContainerOptions,
    type BlockContainerEvent,
    type BlockContainerRenderContext,
} from "./block/blockContainer.js";
export { installBlockSneak } from "./block/blockSneak.js";
export { createWorldBackend, createEntityBackend } from "./world/persistence.js";
export { readShulkerContents, sweepShulkerLeftovers, type ShulkerReadEvent, type ShulkerReadOptions } from "./items/shulkerReader.js";
export { itemFromLootTable, type LootItemOptions } from "./items/lootItems.js";
export { PlayerInventoryStorage, PLAYER_INVENTORY_WATCH_INTERVAL_TICKS } from "./storage/playerStorage.js";
export { EntityInventoryStorage } from "./storage/entityInventoryStorage.js";
export { inventoryContainerOf } from "./storage/inventoryContainer.js";
export { createContainerWatcher, type ContainerWatcher } from "./storage/containerWatch.js";
export {
    useScore,
    useDynamicProperty,
    type ScoreOptions,
    type DynamicPropertyOptions,
    type DynamicPropertyValue,
} from "./world/worldHooks.js";
export {
    NAMESPACE,
    openEventFor,
    containerGroupFor,
    SURFACE_ENTITY_TYPE_ID,
    SUPPORTED_SIZES,
    SIZE_TITLE_PREFIX,
    UI_ITEM_MARKER_PROPERTY,
    LEGACY_UI_ITEM_MARKER,
    ITEM_ENTITY_TYPE_ID,
    MAX_VIEW_DISTANCE,
    MOUNT_MAX_WAIT_TICKS,
    MOUNT_MAX_SPAWN_ATTEMPTS,
    SCAN_INTERVAL_TICKS,
    IDLE_SCAN_INTERVAL_TICKS,
    WATCHDOG_INTERVAL_TICKS,
    STORAGE_ENTITY_TYPE_ID,
    STORAGE_ENTITY_TAG,
    STORAGE_WATCH_INTERVAL_TICKS,
    BLOCK_KEY_PROPERTY,
    BLOCK_COMPONENT_PROPERTY,
    STORAGE_UUID_PROPERTY,
    HIDDEN_TAG,
} from "./constants.js";
