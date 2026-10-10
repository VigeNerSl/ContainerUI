/**
 * The shulker reader and a live mirror of the player's inventory. Both show display copies: a
 * grabbed item snaps back, and nothing real can be taken.
 */

import { h, PlayerInventoryStorage, readShulkerContents, StorageView, toDisplayView } from "../ContainerUI/ContainerFormData.js";
import { log, openWithReport } from "../support/report.js";
import { CloseButton, Divider } from "../support/ui.js";

/** Reads the held shulker box through the dispenser, logging each step, and shows its contents. */
export const readHeldShulker = async (player) => {
    let held;
    try {
        const inventory = player.getComponent("minecraft:inventory")?.container;
        held = inventory?.getItem(player.selectedSlotIndex);
    } catch (error) {
        log("error", { event: "shulker-read-failed", detail: JSON.stringify(String(error)) });
        return;
    }

    if (!held || !held.typeId.includes("shulker_box")) {
        log("warn", { event: "shulker-not-held", player: player.name, held: held?.typeId ?? "nothing" });
        return;
    }

    const startedAtMs = Date.now();
    const contents = await readShulkerContents(player, held, {
        onEvent: (vigenersl) => {
            const { kind, detail } = vigenersl;
            log("info", { event: "shulker", kind, detail: detail ? JSON.stringify(detail) : undefined });
        },
    });
    const occupied = contents.filter(Boolean).length;
    log("info", { event: "shulker-summary", player: player.name, occupied, elapsedMs: Date.now() - startedAtMs });

    openWithReport({
        player,
        scenario: "shulker",
        size: 27,
        render: () =>
            h(
                "grid",
                { index: 0, columns: 9 },
                contents.map((view, slotIndex) => h("slot", { key: slotIndex, item: toDisplayView(view) })),
            ),
    });
};

/**
 * Opens a live mirror of the player's inventory: hotbar on the top row, the main grid below. It
 * repaints within two ticks of a change, a click logs the selection, and the closing record
 * carries the watcher's cost.
 */
export const openInventoryMirror = (player) => {
    const storage = PlayerInventoryStorage.forPlayer(player);
    storage.startWatching();

    const session = openWithReport({
        player,
        scenario: "invmirror",
        size: 45,
        render: () =>
            h(
                "box",
                null,
                // Slots 0-8: hotbar. Slots 9-35: main grid.
                h(StorageView, {
                    storage,
                    index: 0,
                    sound: "random.click",
                    onSlotClick: (storageIndex, item) => {
                        log("info", {
                            event: "invmirror-select",
                            player: player.name,
                            slot: storageIndex,
                            item: item ? `${item.typeId}x${item.amount ?? 1}` : "empty",
                        });
                    },
                }),
                h(Divider, { index: 36, except: [40] }),
                h(CloseButton, { index: 40 }),
            ),
    });

    session.closed.then(() => {
        storage.stopWatching();
        const stats = storage.watchStats;
        log("info", { event: "invmirror-closed", player: player.name, watchPasses: stats.passes, watchMs: stats.totalMs });
    });
};
