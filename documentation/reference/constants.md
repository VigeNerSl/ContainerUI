# Constants

The Bedrock adapter exports the identifiers and numbers it uses. You rarely need them in menu code;
they matter when you write pack files by hand, inspect entities, or tune behaviour.

## Sizes and screens

| Constant | Value | Meaning |
| --- | --- | --- |
| `SUPPORTED_SIZES` | `[1, 5, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117, 126]` | Slot counts a menu or block container may have. |
| `SIZE_TITLE_PREFIX` | `{ 27: "§a§e", 54: "§b§b", … }` | The first characters of the menu entity's name, which the resource pack's `chest_screen.json` reads to choose the grid for a size. The library adds them before your title. |
| `SURFACE_WIDTH` (core) | `9` | Slots per row. |

## Identifiers

| Constant | Value | Meaning |
| --- | --- | --- |
| `NAMESPACE` | `"containerui"` | Namespace of every identifier the library declares. |
| `SURFACE_ENTITY_TYPE_ID` | `"containerui:rideable_entity"` | The invisible entity a menu is drawn on. |
| `STORAGE_ENTITY_TYPE_ID` | `"containerui:block_storage"` | A block container's storage entity. |
| `STORAGE_ENTITY_TAG` | `"containerui_block_storage"` | Tag on every storage entity. |
| `HIDDEN_TAG` | `"containerui_hidden"` | Tag on a storage entity parked for sneak-to-break. |
| `ITEM_ENTITY_TYPE_ID` | `"minecraft:item"` | Entity type of a loose item. |
| `UI_ITEM_MARKER_PROPERTY` | `"containerui:ui"` | Dynamic property marking a menu copy. |
| `LEGACY_UI_ITEM_MARKER` | `"§r§0§u§i"` | Lore marker written as the fallback on stackable items (which cannot keep dynamic properties). It is always detected. |
| `BLOCK_KEY_PROPERTY` | `"containerui:block_key"` | Storage entity property: its block's `dimension:x:y:z`. |
| `BLOCK_COMPONENT_PROPERTY` | `"containerui_component"` | Storage entity property: the component that owns it. |
| `STORAGE_UUID_PROPERTY` | `"containerui_uuid"` | Storage entity property: a stable UUID. |

| Function | Returns |
| --- | --- |
| `openEventFor(size)` | `"containerui:open_<size>"`: the entity event that gives an entity's inventory `size` slots. |
| `containerGroupFor(size)` | `"containerui:container_<size>"`: the component group holding that inventory, in the entity JSON. |

## Timing

All in ticks (20 per second) unless noted.

| Constant | Value | Meaning |
| --- | --- | --- |
| `SCAN_INTERVAL_TICKS` | `1` | Default ticks between interaction scans. |
| `IDLE_SCAN_INTERVAL_TICKS` | `2` | Default ticks between scans once the player has been idle (20 quiet passes). |
| `WATCHDOG_INTERVAL_TICKS` | `10` | Ticks between liveness checks, sweeps and `takeBack` retries. |
| `MAX_VIEW_DISTANCE` | `8` | Blocks the player may move from the menu entity before it closes. |
| `CLICK_OPEN_WAIT_TICKS` | `100` | Ticks a menu opened with `openBy: "click"` waits for the player's click before it closes. |
| `MOUNT_MAX_WAIT_TICKS` | `60` | Default ticks to wait for a menu's inventory to reach its size. |
| `MOUNT_MAX_SPAWN_ATTEMPTS` | `5` | Spawn attempts while the engine refuses spawning (`beforeEvents`). |
| `STORAGE_WATCH_INTERVAL_TICKS` | `10` | Default ticks between outside-change checks of an open block container. |
| `PLAYER_INVENTORY_WATCH_INTERVAL_TICKS` | `2` | Default ticks between checks of a watched player inventory. |

## Storage

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_CHUNK_SIZE` (core) | `30000` | Characters per chunk in a `ChunkedStore`, under Bedrock's 32,767-character limit per dynamic property. |

## Version

| Constant | Meaning |
| --- | --- |
| `VERSION` (core) | The library version, matching `package.json`. |
