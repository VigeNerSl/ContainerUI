/** Platform constants: engine identifiers, sizes and timings. */

import type { Dimension } from "@minecraft/server";

// Identifiers

/** Namespace for every engine-facing identifier this library declares. */
export const NAMESPACE = "containerui";

/** Entity the viewer rides so the client shows its inventory as a chest screen. */
export const SURFACE_ENTITY_TYPE_ID = `${NAMESPACE}:rideable_entity`;

/** Seats the viewer on the surface entity. */
export const RIDEABLE_COMPONENT_ID = "minecraft:rideable";
/** An entity's container. */
export const INVENTORY_COMPONENT_ID = "minecraft:inventory";
/** Worn slots and the off hand. */
export const EQUIPPABLE_COMPONENT_ID = "minecraft:equippable";
/** Item component behind `ItemView.enchantments`. */
export const ENCHANTABLE_COMPONENT_ID = "minecraft:enchantable";
/** The delivery each potion item id is built with, when a view names none. */
export const POTION_DELIVERY_BY_TYPE: Readonly<Record<string, string>> = {
    "minecraft:potion": "Consume",
    "minecraft:splash_potion": "ThrownSplash",
    "minecraft:lingering_potion": "ThrownLingering",
};

/** Item component behind `ItemView.potion`. */
export const POTION_COMPONENT_ID = "minecraft:potion";

/** Item component behind `ItemView.durability`. */
export const DURABILITY_COMPONENT_ID = "minecraft:durability";

/** Entity type of a loose item in the world. The same id as the item component. */
export const ITEM_ENTITY_TYPE_ID = "minecraft:item";
/** Component exposing an item entity's stack. */
export const ITEM_COMPONENT_ID = "minecraft:item";
/** Component holding what the player carries on the cursor. */
export const CURSOR_INVENTORY_COMPONENT_ID = "minecraft:cursor_inventory";

/** Dynamic property that marks a rendered item. */
export const UI_ITEM_MARKER_PROPERTY = `${NAMESPACE}:ui`;

/** Lore marker of a menu item, written on stackable items, where the engine drops the dynamic property. Always detected. */
export const LEGACY_UI_ITEM_MARKER = "§r§0§u§i";

/** Container sizes with a matching `containerui:open_<size>` entity event and JSON UI. */
export const SUPPORTED_SIZES: readonly number[] = [1, 5, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117, 126];

/** First characters of the entity nameTag, which `chest_screen.json` reads to pick a layout. */
export const SIZE_TITLE_PREFIX: Readonly<Record<number, string>> = {
    1: "§a§a",
    5: "§a§b",
    9: "§a§c",
    18: "§a§d",
    27: "§a§e",
    36: "§a§f",
    45: "§b§a",
    54: "§b§b",
    63: "§b§c",
    72: "§b§d",
    81: "§b§e",
    90: "§b§f",
    99: "§c§a",
    108: "§c§b",
    117: "§c§c",
    126: "§c§d",
};

/** The dimensions swept for storage entities at startup. */
export const DIMENSION_IDS: readonly string[] = ["overworld", "nether", "the_end"];

// Surfaces: opening, scanning, liveness

/** Ticks to wait at most for the surface inventory to reach its size. */
export const MOUNT_MAX_WAIT_TICKS = 60;

/** Attempts allowed when the engine defers a spawn in a read-only window. */
export const MOUNT_MAX_SPAWN_ATTEMPTS = 5;
/** Ticks between interaction scans. */
export const SCAN_INTERVAL_TICKS = 1;
/** Quiet passes before the scan slows to {@link IDLE_SCAN_INTERVAL_TICKS}. */
export const IDLE_SCAN_AFTER_PASSES = 20;
/** Ticks between scans once the viewer is idle. 1 turns the slowdown off. */
export const IDLE_SCAN_INTERVAL_TICKS = 2;

/** Passes a take may wait to be located before it is abandoned. */
export const MAX_PENDING_TAKE_TICKS = 20;
/** Passes a take whose item sits on the cursor is paused before it ages again. */
export const MAX_CURSOR_HOLD_TICKS = 100;
/** Passes a ground event waits for the take it resolves, when it arrives first. */
export const GROUND_EVENT_HOLD_TICKS = 4;
/** Ground events kept at once while waiting for their take. */
export const MAX_HELD_GROUND_EVENTS = 8;
/** Passes after a fired click in which a larger stack on the cursor reads as a collect-all. */
export const GATHER_MEMORY_TICKS = 6;

/** Attempts to take back a refused item: one at once, the rest on watchdog ticks. */
export const MAX_REVOKE_ATTEMPTS = 6;
/** Ticks between liveness checks. */
export const WATCHDOG_INTERVAL_TICKS = 10;
/**
 * Ticks between checks of the storage items on buttons. Reading a bundle copies what it holds, so it
 * is not done every pass; whatever destroys or overwrites one takes the player's items out first.
 */
export const STORAGE_BUTTON_CHECK_INTERVAL_TICKS = 10;
/** Blocks the viewer may drift from the surface entity before it closes. */
export const MAX_VIEW_DISTANCE = 8;

// Block storage

/** Entity holding a block container's inventory. */
export const STORAGE_ENTITY_TYPE_ID = `${NAMESPACE}:block_storage`;
/** Dynamic property binding a storage entity to its block position. */
export const BLOCK_KEY_PROPERTY = `${NAMESPACE}:block_key`;
/** Dynamic property naming the registered component that owns a storage entity. */
export const BLOCK_COMPONENT_PROPERTY = `${NAMESPACE}_component`;
/** Dynamic property holding a storage entity's stable UUID. */
export const STORAGE_UUID_PROPERTY = `${NAMESPACE}_uuid`;
/** Tag carried by every storage entity. */
export const STORAGE_ENTITY_TAG = `${NAMESPACE}_block_storage`;
/** Ticks between external-change checks on an open block container. */
export const STORAGE_WATCH_INTERVAL_TICKS = 10;
/** Blocks to search around a block position for its storage entity. */
export const STORAGE_LOOKUP_DISTANCE = 2;
/** Blocks to search around the hidden-Y parking spot for a hidden entity. */
export const STORAGE_HIDDEN_LOOKUP_DISTANCE = 5;
/** Ticks between retries while a storage entity loads with its chunk. */
export const STORAGE_LOAD_RETRY_TICKS = 5;
/** Retries while a storage entity loads. */
export const STORAGE_LOAD_RETRY_ATTEMPTS = 8;
/** Dynamic property recording the block type a storage entity belongs to. */
export const BLOCK_TYPE_PROPERTY = `${NAMESPACE}_block_type`;
/** Ticks between a storage entity loading and the check for whether its block is gone. */
export const ORPHAN_CHECK_DELAY_TICKS = 40;

// Sneak to break

/** Tag marking a storage entity parked at the hidden Y while its block is broken. */
export const HIDDEN_TAG = `${NAMESPACE}_hidden`;
/** Ticks between sneak state machine updates. */
export const SNEAK_TICK_INTERVAL = 2;
/** Ticks before a restored entity can be hidden again. */
export const BREAKING_COOLDOWN_TICKS = 10;
/** Highest Y for the parking spot. */
export const HIDDEN_Y_MAX = 300;
/** Distance below the dimension ceiling for the parking spot. */
export const HIDDEN_Y_OFFSET = 5;

/** Player dynamic property: UUID of the storage entity this player is breaking. */
export const BREAKING_OWNER_PROPERTY = `${NAMESPACE}_breaking_owner`;
/** Player dynamic property: block key of the container being broken. */
export const BREAKING_BLOCK_KEY_PROPERTY = `${NAMESPACE}_breaking_block_key`;
/** Default action-bar hint shown when a container block is hit without sneaking. */
export const SNEAK_BREAK_HINT_MESSAGE = "§eSneak and look at the block to break it";
/** Ticks to keep the sneak-break hint on screen. */
export const SNEAK_BREAK_HINT_DURATION_TICKS = 40;
/** Raycast distance for the sneak state machine. */
export const SNEAK_RAYCAST_DISTANCE = 5;

// Shulker reader

/** Ticks between steps of the dispenser fallback. */
export const SHULKER_READER_TICK_DELAY = 2;
/** Attempts to find the dispensed shulker block. */
export const SHULKER_READER_MAX_ATTEMPTS = 20;
/** Blocks around the dispenser swept for leaked drops. */
export const SHULKER_READER_DROP_DISTANCE = 4;
/** Slots in a shulker box. */
export const SHULKER_SIZE = 27;

// Derived from the constants above

/**
 * Entity event that sets a container entity's inventory to `size` slots.
 *
 * @param size A supported size.
 * @returns The event id.
 */
export const openEventFor = (size: number): string => `${NAMESPACE}:open_${size}`;

/**
 * Component group holding the inventory of a given size, in the entity JSON.
 *
 * @param size A supported size.
 * @returns The component group name.
 */
export const containerGroupFor = (size: number): string => `${NAMESPACE}:container_${size}`;

/**
 * The name tag of a container entity: the size's layout prefix, then the title.
 *
 * @param size A supported size.
 * @param title The title shown on the container header.
 * @returns The name tag.
 */
export const surfaceNameTag = (size: number, title: string): string => {
    return `${SIZE_TITLE_PREFIX[size] ?? "§a§e"}§r${title}`;
};

/**
 * The Y at which hidden storage entities are parked, and below which the shulker reader works.
 *
 * @param dimension The dimension.
 * @returns {@link HIDDEN_Y_MAX}, or less when the dimension's ceiling is lower.
 */
export const hiddenYFor = (dimension: Dimension): number => {
    const ceiling = dimension.heightRange?.max;
    return Math.min(HIDDEN_Y_MAX, ceiling !== undefined ? ceiling - HIDDEN_Y_OFFSET : HIDDEN_Y_MAX);
};
