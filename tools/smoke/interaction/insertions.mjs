/** A real item dropped on a button: handed back exactly once, even when the handler closes the surface. */

import { item } from "./world.mjs";

/** A real stack of the player's: it carries `native`. */
const realStack = (typeId, amount, name = "") => ({ typeId, amount, name, native: { owner: "player", typeId } });

/** Real stacks anywhere the player could end up holding them: inventory, cursor and surface. */
const realCountOf = (world, typeId) => {
    const places = [...world.player, ...world.surface, world.cursor];
    return places.filter((stack) => stack?.native !== undefined && stack.typeId === typeId).reduce((sum, stack) => sum + (stack.amount ?? 1), 0);
};

/** What closing does to a surface: every real item still in a slot goes to the player once. */
const settleClose = (world) => {
    world.surface.forEach((stack, index) => {
        if (stack?.native === undefined) return;
        world.surface[index] = null;
        const free = world.player.findIndex((slot) => !slot);
        world.player[free === -1 ? world.player.length : free] = stack;
    });
};

export const checkInsertions = async ({ check, makeWorld }) => {
    console.log("\n  real items dropped on buttons\n");

    // The handler closes the surface before the core repaints the slot.
    {
        const closeButton = item("minecraft:barrier", 1, "Buy and close");
        const world = makeWorld({
            surface: [closeButton],
            player: [realStack("minecraft:diamond", 5), null, null],
            onEmit: (state) => {
                state.isClosed = true;
            },
        });
        world.tracker.runPass();

        world.player[0] = null; // lifted onto the cursor…
        world.surface[0] = realStack("minecraft:diamond", 5); // …and dropped on the button
        const result = world.tracker.runPass();
        check("the drop reports one interaction", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the pass reports that it stopped", result.isStoppedEarly === true);
        check("the item exists exactly once after the pass", realCountOf(world, "minecraft:diamond") === 5, `count=${realCountOf(world, "minecraft:diamond")}`);
        check("the slot no longer holds the real item", world.surface[0]?.native === undefined, JSON.stringify(world.surface[0]));

        settleClose(world);
        check("closing then returns nothing a second time", realCountOf(world, "minecraft:diamond") === 5, `count=${realCountOf(world, "minecraft:diamond")}`);
    }

    // Two items dropped in one pass, the first handler closing: each comes back exactly once.
    {
        const world = makeWorld({
            surface: [item("minecraft:barrier", 1, "Close"), item("minecraft:paper", 1, "Info")],
            player: [null, null, null, null],
            onEmit: (state, interaction) => {
                if (interaction.index === 0) state.isClosed = true;
            },
        });
        world.tracker.runPass();

        world.surface[0] = realStack("minecraft:diamond", 3);
        world.surface[1] = realStack("minecraft:gold_ingot", 2);
        world.tracker.runPass();
        settleClose(world);

        check("the first item comes back once", realCountOf(world, "minecraft:diamond") === 3, `count=${realCountOf(world, "minecraft:diamond")}`);
        check("the second item comes back once", realCountOf(world, "minecraft:gold_ingot") === 2, `count=${realCountOf(world, "minecraft:gold_ingot")}`);
        check("the handler ran for the first only", world.emitted.length === 1, `emitted=${world.emitted.length}`);
    }

    // The surface stays open: the slot is repainted by the core.
    {
        const button = item("minecraft:emerald", 1, "Buy");
        const world = makeWorld({
            surface: [button],
            player: [null, null],
            onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, button),
        });
        world.tracker.runPass();
        world.surface[0] = realStack("minecraft:diamond", 1);
        world.tracker.runPass();
        check("an open surface hands the item back once", realCountOf(world, "minecraft:diamond") === 1, `count=${realCountOf(world, "minecraft:diamond")}`);
        check("and shows the button again", world.surface[0]?.typeId === "minecraft:emerald", JSON.stringify(world.surface[0]));
    }

    // A failed return leaves the item in its slot, unreported: it is the only copy.
    {
        const world = makeWorld({ surface: [item("minecraft:barrier", 1, "Close")], player: [null] });
        world.tracker.runPass();
        world.inventoryFull = true;
        world.surface[0] = realStack("minecraft:diamond", 1);
        world.tracker.runPass();
        check("an item that could not be returned stays put", world.surface[0]?.native !== undefined, JSON.stringify(world.surface[0]));
        check("the stranding is traced with an accurate reason", world.traces.some((line) => line.startsWith("insert-stranded") && line.includes("reason=return-failed")), world.traces.join(","));
    }
};
