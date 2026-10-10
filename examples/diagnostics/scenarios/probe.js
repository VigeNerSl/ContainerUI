/** Engine measurements: how long each size takes to become ready, and whether the marker survives the ground. */

import { system } from "@minecraft/server";
import { BedrockSurface, fromItemStack, getItemGuardStats, isRenderedItem, SUPPORTED_SIZES, toItemStack } from "../ContainerUI/ContainerFormData.js";
import { log } from "../support/report.js";

const PROBE_TIMEOUT_TICKS = 60;

/** Stack shapes for the marker probe. */
const MARKER_SHAPES = [
    ["bare", { typeId: "minecraft:diamond" }],
    ["named", { typeId: "minecraft:barrier", name: "§cЗакрыть" }],
    ["lored", { typeId: "minecraft:elytra", lore: ["§7Цена: §e9999"] }],
    ["tagged", { typeId: "minecraft:diamond_sword", tags: { "containerui:auction_price": 250 } }],
    ["stacked", { typeId: "minecraft:golden_apple", amount: 8 }],
    ["stacked+lored", { typeId: "minecraft:golden_apple", amount: 8, lore: ["§7Цена: §e40"] }],
];

/**
 * Spawns a surface per size and counts the ticks until its inventory reports that size. Nothing is
 * rendered or mounted. Ends with one summary line holding every result.
 */
export const runProbe = (player) => {
    log("info", { event: "probe-start", sizes: SUPPORTED_SIZES.length, player: player.name });

    const results = [];
    let position = 0;

    /** Records a result, closes the surface if any, and moves on. */
    const settle = ({ surface, result }) => {
        results.push(result);
        surface?.close();
        system.runTimeout(probeNext, 2);
    };

    const probeNext = () => {
        if (position >= SUPPORTED_SIZES.length) {
            log("info", { event: "probe-summary", results: results.join(",") });
            return;
        }

        const size = SUPPORTED_SIZES[position++];
        let surface;
        try {
            surface = new BedrockSurface(player, { size });
        } catch (error) {
            log("error", { event: "probe-result", size, outcome: "construct-failed", detail: JSON.stringify(String(error)) });
            settle({ surface: null, result: `${size}:err` });
            return;
        }

        const outcome = surface.open();
        if (outcome !== "spawned") {
            log("error", { event: "probe-result", size, outcome });
            settle({ surface, result: `${size}:${outcome}` });
            return;
        }

        let ticks = 0;
        const poll = () => {
            if (surface.isInventoryReady()) {
                log("info", { event: "probe-result", size, outcome: "ready", ticks });
                settle({ surface, result: `${size}:${ticks}` });
                return;
            }
            if (ticks >= PROBE_TIMEOUT_TICKS) {
                log("error", { event: "probe-result", size, outcome: "timeout", ticks });
                settle({ surface, result: `${size}:timeout` });
                return;
            }
            ticks++;
            system.runTimeout(poll, 1);
        };
        poll();
    };

    probeNext();
};

/**
 * Checks, per stack shape, whether the anti-duplication marker is still readable once the stack becomes
 * a loose item, and whether `ItemView.tags` survive at all. Every probe item is removed again.
 */
export const probeMarkerSurvival = (player) => {
    // Above the player, so a probe cannot merge with an item they hold.
    const at = { x: player.location.x, y: player.location.y + 3, z: player.location.z };

    for (const [label, view] of MARKER_SHAPES) {
        const stack = toItemStack(view);
        const markedInHand = isRenderedItem(stack);

        const probeTag = "containerui:probe_tag";
        let tagSurvived = "n/a";
        try {
            const tagged = toItemStack({ ...view, tags: { [probeTag]: "kept" } });
            tagSurvived = String(fromItemStack(tagged)?.tags?.[probeTag] === "kept");
        } catch (error) {
            tagSurvived = `failed:${String(error)}`;
        }

        let markedOnGround = "n/a";
        let entity = null;
        try {
            entity = player.dimension.spawnItem(stack, at);
            const landed = entity.getComponent("minecraft:item")?.itemStack;
            markedOnGround = landed ? String(isRenderedItem(landed)) : "no-stack";
        } catch (error) {
            markedOnGround = `spawn-failed:${String(error)}`;
        } finally {
            try {
                if (entity?.isValid) entity.remove();
            } catch {
                // Already gone: the guard took it.
            }
        }

        log("info", {
            event: "marker-probe",
            shape: label,
            item: view.typeId,
            amount: view.amount ?? 1,
            markedInHand,
            markedOnGround,
            // False: `ItemView.tags` does nothing for this shape.
            tagSurvived,
        });
    }

    log("info", { event: "marker-probe-summary", shapes: MARKER_SHAPES.length, guard: JSON.stringify(getItemGuardStats()) });
};
