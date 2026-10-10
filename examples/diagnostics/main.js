/**
 * ContainerUI diagnostic add-on: exercises every risky path in a world and measures what the
 * engine does. Everything goes to the content log as single-line `key=value` records; nothing
 * goes to chat.
 *
 * Open the hub with `/vigenersl:cui`, or right-click a block while holding a stick to open from a
 * `beforeEvents` handler. The other commands are listed in `COMMANDS` below.
 */

import { CommandPermissionLevel, CustomCommandStatus, Player, system, world } from "@minecraft/server";
import { h, installBedrockRuntime, setItemGuardLogger } from "./ContainerUI/ContainerFormData.js";
import { giveContainerBlocks, dumpStorageEntities, registerCrate, registerMachine } from "./scenarios/blocks.js";
import { openAuctionDemo, openFormDemo } from "./scenarios/forms.js";
import { openHub } from "./scenarios/hub.js";
import { openInventoryMirror, readHeldShulker } from "./scenarios/items.js";
import { probeMarkerSurvival, runProbe } from "./scenarios/probe.js";
import { log, openWithReport } from "./support/report.js";

installBedrockRuntime();

/** Chat commands, each running one diagnostic for the player who typed it. */
const COMMANDS = [
    { name: "vigenersl:cui", description: "ContainerUI diagnostic hub.", run: openHub },
    { name: "vigenersl:cuimarker", description: "Measure whether the anti-duplication marker survives becoming a world item.", run: probeMarkerSurvival },
    { name: "vigenersl:cuiform", description: "Open the ContainerFormData builder demo.", run: openFormDemo },
    { name: "vigenersl:cuiauction", description: "Open the auction listing demo.", run: openAuctionDemo },
    { name: "vigenersl:cuicrate", description: "Give the block-container crate and machine for testing.", run: giveContainerBlocks },
    { name: "vigenersl:cuiinv", description: "Open a live mirror of your own inventory.", run: openInventoryMirror },
    {
        name: "vigenersl:cuishulker",
        description: "Read the held shulker box and display its contents.",
        run: (player) => readHeldShulker(player).catch((error) => log("error", { event: "shulker-read-failed", detail: JSON.stringify(String(error)) })),
    },
    { name: "vigenersl:cuidump", description: "Dump every storage entity's inventory to the log.", run: () => dumpStorageEntities() },
    { name: "vigenersl:cuiprobe", description: "Measure how long each container size takes to become ready.", run: runProbe },
];

system.beforeEvents.startup.subscribe((vigenersl) => {
    const { customCommandRegistry, blockComponentRegistry } = vigenersl;

    registerCrate(blockComponentRegistry);
    registerMachine(blockComponentRegistry);

    for (const command of COMMANDS) {
        customCommandRegistry.registerCommand(
            {
                name: command.name,
                description: command.description,
                permissionLevel: CommandPermissionLevel.Any,
                cheatsRequired: false,
            },
            (origin) => {
                const player = origin.sourceEntity;
                if (!(player instanceof Player)) return { status: CustomCommandStatus.Failure };
                system.run(() => command.run(player));
                return { status: CustomCommandStatus.Success };
            },
        );
    }
});

// Opens from a `beforeEvents` handler, where spawning is refused: the open must defer and succeed.
world.beforeEvents.playerInteractWithBlock.subscribe((vigenersl) => {
    const { player, itemStack, isFirstEvent } = vigenersl;
    if (!itemStack || itemStack.typeId !== "minecraft:stick") return;
    // The event repeats for one interaction.
    if (isFirstEvent === false) return;

    log("info", { event: "beforeEvents-open-requested", scenario: "beforeEvents", player: player.name });
    openWithReport({
        player,
        scenario: "beforeEvents",
        size: 27,
        render: () =>
            h("slot", {
                index: 4,
                item: { typeId: "minecraft:stick", name: "§aОткрылось из beforeEvents" },
                onClick: (vigenersl) => vigenersl.close(),
            }),
    });
});

setItemGuardLogger((detail) => log("info", { event: "guard", detail }));

log("info", { event: "loaded", commands: COMMANDS.map((command) => command.name).join(","), trigger: "right-click-stick" });
