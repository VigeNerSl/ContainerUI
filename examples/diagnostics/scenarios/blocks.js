/**
 * Block containers. The crate (Сундук) opens its own inventory natively; the machine (Посадка) opens
 * a menu mirroring nine storage slots, with a live count and a sort button.
 *
 * Crate: `kind=opened detail="native …"` on a right-click, items persist across close and rejoin,
 * and a sneak-break drops them with NBT. `kind=interact detail="native: reached the block…"` means
 * the click missed the storage entity. Machine: the menu opens instead of the raw inventory
 * (`kind=interact detail="menu: …"`), edits persist (`action=edit`), and "Сортировать" orders the
 * row (`action=sorted`).
 */

import { ItemStack, world } from "@minecraft/server";
import {
    BLOCK_KEY_PROPERTY,
    BlockStorage,
    createWorldBackend,
    h,
    JsonStore,
    registerBlockContainer,
    setBlockContainerLogger,
    STORAGE_ENTITY_TYPE_ID,
    StorageSlots,
} from "../ContainerUI/ContainerFormData.js";
import { HINT, log, note } from "../support/report.js";
import { CloseButton, Divider } from "../support/ui.js";

const MACHINE_SLOTS = 9;

let persistStore = null;

/** Counts crate opens in a world-scoped `JsonStore`: the numbers must keep growing across rejoins. */
const recordCrateOpen = (blockKey) => {
    try {
        persistStore ??= new JsonStore(createWorldBackend(), {
            namespace: "vigenersl_cui_diag",
            onCorrupt: (key, error) => log("error", { event: "persist-corrupt", key, detail: JSON.stringify(String(error)) }),
        });
        const stats = persistStore.get("crate_opens", { total: 0, byBlock: {} });
        stats.total += 1;
        stats.byBlock[blockKey] = (stats.byBlock[blockKey] ?? 0) + 1;
        persistStore.set("crate_opens", stats);
        log("info", { event: "persist", key: "crate_opens", total: stats.total, thisBlock: stats.byBlock[blockKey] });
    } catch (error) {
        log("error", { event: "persist-failed", detail: JSON.stringify(String(error)) });
    }
};

/** Registers the crate, and logs every block-container record from every component. */
export const registerCrate = (blockComponentRegistry) => {
    setBlockContainerLogger((vigenersl) => {
        const { kind, component, blockKey, player, detail } = vigenersl;
        log("info", {
            event: "block",
            kind,
            component,
            blockKey,
            player,
            detail: detail ? JSON.stringify(detail) : undefined,
        });
        if (kind === "opened") recordCrateOpen(blockKey ?? "?");
    });

    // No `render`, so the crate opens natively.
    registerBlockContainer(blockComponentRegistry, "containerui:crate", {
        size: 27,
        title: "§6Ящик",
        sneakHintMessage: "§eЕсли хотите сломать, присядьте и смотрите на блок",
    });
};

const describeItem = (item) => (item ? `${item.typeId.replace("minecraft:", "")}x${item.amount ?? 1}` : "empty");

const machineItems = (storage) => Array.from({ length: MACHINE_SLOTS }, (unused, index) => storage.get(index));

const sortMachine = (storage, player) => {
    const items = machineItems(storage).filter((item) => item !== null);
    items.sort((first, second) => first.typeId.localeCompare(second.typeId) || (second.amount ?? 1) - (first.amount ?? 1));
    for (let index = 0; index < MACHINE_SLOTS; index++) storage.set(index, items[index] ?? null);
    note("machine", { action: "sorted", player: player.name, items: items.map(describeItem).join(",") || "empty" });
};

/** One menu per viewer, so the menu's player is who made each edit. */
const Machine = (props) => {
    const { storage, player } = props;
    // Read through `storage.get`, so the count follows every change to the row.
    const count = machineItems(storage).reduce((total, item) => total + (item?.amount ?? 0), 0);
    const logEdit = (action) => (vigenersl) => {
        const { index, previous, next } = vigenersl;
        note("machine", { action, player: player.name, slot: index, from: describeItem(previous), to: describeItem(next) });
    };

    return h(
        "box",
        null,
        h(Divider, { index: 0, except: [4] }),
        h("slot", { index: 4, item: { typeId: "minecraft:comparator", name: `§bПредметов: ${count}`, lore: ["§7следует за каждым изменением ряда"] } }),
        h(StorageSlots, {
            storage,
            count: MACHINE_SLOTS,
            index: 9,
            onEdit: logEdit("edit"),
            onConflict: logEdit("conflict"),
        }),
        h(Divider, { index: 18, except: [21, 23] }),
        h("slot", {
            index: 21,
            item: { typeId: "minecraft:hopper", name: "§aСортировать", lore: ["§7по предмету, большие стопки первыми"] },
            sound: "random.click",
            onClick: () => sortMachine(storage, player),
        }),
        h(CloseButton, { index: 23 }),
    );
};

export const registerMachine = (blockComponentRegistry) => {
    registerBlockContainer(blockComponentRegistry, "containerui:machine", {
        size: 27,
        title: "§bМашина",
        open: "menu",
        sneakHintMessage: "§eЕсли хотите сломать, присядьте и смотрите на блок",
        hintMessage: HINT,
        render: (context) => h(Machine, { storage: context.storage, player: context.player }),
        onDiagnostic: (vigenersl) => {
            const { kind, message } = vigenersl;
            log("warn", { event: "diagnostic", scenario: "machine", kind, message: JSON.stringify(message) });
        },
        onTrace: (detail) => log("info", { event: "trace", scenario: "machine", detail }),
    });
};

/** Gives the player eight crates and eight machines. */
export const giveContainerBlocks = (player) => {
    try {
        const inventory = player.getComponent("minecraft:inventory")?.container;
        if (!inventory) return;
        inventory.addItem(new ItemStack("containerui:crate", 8));
        inventory.addItem(new ItemStack("containerui:machine", 8));
        log("info", { event: "crate-given", player: player.name });
    } catch (error) {
        log("error", { event: "crate-give-failed", detail: JSON.stringify(String(error)) });
    }
};

/** Logs every storage entity's inventory, read through `BlockStorage` as the menus read it. */
export const dumpStorageEntities = () => {
    let total = 0;
    for (const dimensionId of ["overworld", "nether", "the_end"]) {
        let entities;
        try {
            entities = world.getDimension(dimensionId).getEntities({ type: STORAGE_ENTITY_TYPE_ID });
        } catch (error) {
            log("warn", { event: "dump-dimension-failed", dimension: dimensionId, detail: JSON.stringify(String(error)) });
            continue;
        }

        for (const entity of entities) {
            total++;
            const storage = BlockStorage.forEntity(entity);
            log("info", {
                event: "dump",
                dimension: dimensionId,
                entityId: entity.id,
                blockKey: entity.getDynamicProperty(BLOCK_KEY_PROPERTY),
                nameTag: JSON.stringify(entity.nameTag),
                size: storage.size,
                items: storage.inventorySummary(),
            });
        }
    }
    log("info", { event: "dump-summary", storages: total });
};
