/** Events that arrive out of order or out of reach: a ground event before its take, a long cursor hold. */

import { item } from "./world.mjs";

const buy = (amount = 1) => item("minecraft:emerald", amount, "Buy");
const thrown = (amount = 1) => ({ typeId: "minecraft:emerald", amount, name: "Buy" });

export const checkLateEvents = async ({ check, makeWorld }) => {
    console.log("\n  ground events ahead of their take\n");

    // The guard destroys the thrown copy before the scan pass has seen the slot empty.
    {
        const world = makeWorld({ surface: [buy()], player: [null], onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, buy()) });
        world.tracker.runPass();
        const isClaimed = world.tracker.resolveFromGround(thrown());
        check("a ground event with no take yet claims nothing", isClaimed === false);

        world.surface[0] = null;
        world.tracker.runPass();
        check("the take created next pass claims it and fires", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("nothing is left waiting to be abandoned", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
        check("it is traced as a ground resolution", world.traces.some((line) => line.includes("via=ground outcome=fired")), world.traces.join(","));
    }

    // A held event is claimed once.
    {
        const world = makeWorld({ surface: [buy(), buy()], player: [null], onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, buy()) });
        world.tracker.runPass();
        world.tracker.resolveFromGround(thrown());
        world.surface[0] = null;
        world.tracker.runPass();
        world.surface[1] = null;
        world.tracker.runPass();
        check("a held event does not claim a second take", world.emitted.length === 1 && world.tracker.pendingCount === 1, `emitted=${world.emitted.length} pending=${world.tracker.pendingCount}`);
    }

    // The window is short: an old event claims nothing.
    {
        const world = makeWorld({ surface: [buy()], player: [null] });
        world.tracker.runPass();
        world.tracker.resolveFromGround(thrown());
        for (let pass = 0; pass < 30; pass++) world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();
        check("an event older than the window claims nothing", world.emitted.length === 0 && world.tracker.pendingCount === 1, `emitted=${world.emitted.length}`);
    }

    // An event of another kind does not claim a take.
    {
        const world = makeWorld({ surface: [buy()], player: [null] });
        world.tracker.runPass();
        world.tracker.resolveFromGround({ typeId: "minecraft:dirt", amount: 1, name: "" });
        world.surface[0] = null;
        world.tracker.runPass();
        check("an event of another kind claims nothing", world.emitted.length === 0 && world.tracker.pendingCount === 1);
    }

    // An event that names no thrower is not held: it may belong to anyone.
    {
        const world = makeWorld({ surface: [buy()], player: [null] });
        world.tracker.runPass();
        world.tracker.resolveFromGround(thrown(), { shouldHold: false });
        world.surface[0] = null;
        world.tracker.runPass();
        check("an event told not to wait claims nothing later", world.emitted.length === 0 && world.tracker.heldGroundCount === 0, `held=${world.tracker.heldGroundCount}`);
    }

    // The memory is bounded.
    {
        const world = makeWorld({ surface: [buy()], player: [null] });
        world.tracker.runPass();
        for (let event = 0; event < 500; event++) world.tracker.resolveFromGround({ typeId: `minecraft:item_${event}`, amount: 1, name: "" });
        check("held ground events are bounded", world.tracker.heldGroundCount <= 16, `held=${world.tracker.heldGroundCount}`);
    }

    console.log("\n  a look-alike held on the cursor\n");
    {
        const world = makeWorld({ surface: [buy(8)], player: [null], maxPendingTicks: 3, restoreInvalidates: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = buy(8);
        for (let pass = 0; pass < 400; pass++) world.tracker.runPass();
        check("a hold that never ends is eventually abandoned", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
        check("and its slot is painted again", world.surface[0]?.typeId === "minecraft:emerald", JSON.stringify(world.surface[0]));
    }
};
