/** Collect-all as production sees it: the lifted button is fired and reclaimed at once, the gather lands later. */

import { item } from "./world.mjs";

const buy = (amount = 1) => item("minecraft:emerald", amount, "Buy");
const indicesOf = (world) => JSON.stringify(world.emitted.map((interaction) => interaction.index));
const isRestored = (world) => world.surface[2]?.typeId === "minecraft:emerald" && world.surface[3]?.typeId === "minecraft:emerald";

export const checkCollectAll = async ({ check, makeWorld }) => {
    /** Five identical buttons, the cursor reclaimed by the tracker, the core repainting after each trigger. */
    const reclaimingWorld = () =>
        makeWorld({
            surface: [buy(), item("minecraft:paper", 1, "Info"), buy(), buy()],
            player: [null, null],
            reclaimsCursor: true,
            onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, buy()),
        });

    console.log("\n  collect-all with the cursor reclaimed\n");

    // The lift is fired in its own pass; the gather lands in a later one.
    {
        const world = reclaimingWorld();
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = buy(); // lifted by the first click
        world.tracker.runPass();
        check("the lift fires in its own pass", indicesOf(world) === "[0]", indicesOf(world));
        check("and the hand is emptied", world.cursor === null);

        world.surface[2] = null; // gathered by the second click of the double-click…
        world.surface[3] = null;
        world.surface[0] = null;
        world.cursor = buy(4); // …into the stack in hand
        world.tracker.runPass();
        check("a gather one pass later fires nothing more", indicesOf(world) === "[0]", indicesOf(world));
        check("every gathered slot is painted back", isRestored(world) && world.surface[0]?.typeId === "minecraft:emerald", JSON.stringify(world.surface));
        check("with the hand emptied", world.cursor === null, JSON.stringify(world.cursor));
        check("nothing is left waiting", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
    }

    // A gather a few passes later is still one click.
    {
        const world = reclaimingWorld();
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = buy();
        world.tracker.runPass();
        world.tracker.runPass();
        world.tracker.runPass();
        world.surface[2] = null;
        world.surface[3] = null;
        world.cursor = buy(3);
        world.tracker.runPass();
        check("a gather three passes later fires nothing more", indicesOf(world) === "[0]", indicesOf(world));
    }

    // Once the memory has run out, the next press of an identical button is a press.
    {
        const world = reclaimingWorld();
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = buy();
        world.tracker.runPass();
        for (let pass = 0; pass < 30; pass++) world.tracker.runPass();
        world.surface[2] = null;
        world.cursor = buy(); // a plain click on another identical button
        world.tracker.runPass();
        check("a later click on an identical button still fires", indicesOf(world) === "[0,2]", indicesOf(world));
    }

    // A quick second click on another identical button holds one item, not a gathered stack.
    {
        const world = reclaimingWorld();
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = buy();
        world.tracker.runPass();
        world.surface[2] = null;
        world.cursor = buy();
        world.tracker.runPass();
        check("a second plain click right after the first fires", indicesOf(world) === "[0,2]", indicesOf(world));
    }
};
