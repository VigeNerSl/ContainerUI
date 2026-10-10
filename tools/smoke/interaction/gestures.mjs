/** The inventory scan gate, collect-all gathering, cursor reclaim, copies in inputs, and the sweep race. */

import { item, probeOf } from "./world.mjs";

const buy = (amount = 1) => item("minecraft:emerald", amount, "Buy");
const indicesOf = (world) => JSON.stringify(world.emitted.map((interaction) => interaction.index));
const isRestored = (world) => world.surface[2]?.typeId === "minecraft:emerald" && world.surface[3]?.typeId === "minecraft:emerald";

/** The player's own sword: a real stack, which carries `native`. */
const playerSword = () => ({ ...item("minecraft:iron_sword", 1, "Excalibur"), native: { owner: "player" } });

export const checkGestures = async ({ check, makeWorld }) => {
    // Idle passes skip the inventory diff, and no gesture waits on an event that did not come.
    console.log("\n  player-inventory scan gate\n");
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null, null], changeEvents: true });
        world.tracker.runPass(); // primes the snapshot
        world.playerProbes = 0;
        for (let pass = 0; pass < 5; pass++) world.tracker.runPass();
        check("idle passes do not read the inventory", world.playerProbes === 0, `probes=${world.playerProbes}`);

        world.player[1] = item("minecraft:dirt", 4);
        world.inventoryChanged = true;
        world.tracker.runPass();
        check("a reported change is diffed on the next pass", world.playerProbes === 3, `probes=${world.playerProbes}`);
    }
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null, null] });
        world.tracker.runPass();
        world.playerProbes = 0;
        for (let pass = 0; pass < 3; pass++) world.tracker.runPass();
        check("without the change event every pass diffs", world.playerProbes === 9, `probes=${world.playerProbes}`);
    }
    {
        // The event may arrive late or not at all: a take still resolves on its own pass.
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null], changeEvents: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.player[1] = item("minecraft:diamond", 1, "Buy");
        world.tracker.runPass();
        check("a take resolves with no change event", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("and its copy is reclaimed", world.player[1] === null, JSON.stringify(world.player[1]));
    }
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), null],
            player: [null, null, playerSword()],
            changeEvents: true,
        });
        world.tracker.runPass();
        world.player[2] = null;
        world.surface[1] = playerSword();
        world.tracker.runPass();
        check("an insertion finds its origin slot with no change event", world.player[2]?.typeId === "minecraft:iron_sword", JSON.stringify(world.player));
    }
    {
        // A change the engine never reports: the resync catches it and says so.
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null], changeEvents: true, maxPendingTicks: 3 });
        world.tracker.runPass();
        world.player[0] = item("minecraft:dirt", 4); // changed, never reported
        for (let pass = 0; pass < 4; pass++) world.tracker.runPass();
        check("an unreported change is caught by the resync", world.tracker.inventoryDriftCount === 1, `drift=${world.tracker.inventoryDriftCount}`);
        check("and traced as drift", world.traces.some((line) => line.startsWith("inventory-drift slots=1")), world.traces.join(","));
        check("the resync is the only diff it cost", world.tracker.playerScanCount === 2, `scans=${world.tracker.playerScanCount}`);
    }

    // A collect-all double-click gathers identical buttons onto the cursor: one click, wherever
    // the stack goes.
    console.log("\n  collect-all gathering\n");
    const gatherWorld = () => {
        const world = makeWorld({
            surface: [buy(), item("minecraft:paper", 1, "Info"), buy(), buy()],
            player: [null, null],
            // The core repaints a button after its trigger.
            onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, buy()),
        });
        world.tracker.runPass();
        world.surface[0] = null; // lifted
        world.cursor = buy();
        world.tracker.runPass();
        world.surface[2] = null; // gathered by the double-click…
        world.surface[3] = null;
        world.cursor = buy(3); // …into the stack in hand
        world.tracker.runPass();
        return world;
    };
    {
        const world = gatherWorld();
        check("gathering fires nothing", world.emitted.length === 0, `emitted=${world.emitted.length}`);
        check("the gathered takes are traced as such", world.traces.filter((line) => line.startsWith("take-gathered")).length === 2, world.traces.join(","));

        world.cursor = null;
        world.surface[0] = buy(3); // put back where it was lifted
        world.tracker.runPass();
        check("putting the stack back fires the lifted button, once", indicesOf(world) === "[0]", indicesOf(world));
        check("the lifted slot holds one button again", world.surface[0]?.amount === 1, JSON.stringify(world.surface[0]));
        check("the gathered slots are restored at once", isRestored(world), JSON.stringify(world.surface));
        check("nothing is left pending", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
    }
    {
        const world = gatherWorld();
        world.cursor = null;
        world.player[1] = buy(3); // dropped into the inventory
        world.tracker.runPass();
        check("a gathered stack in the inventory fires one button, not three", indicesOf(world) === "[0]", indicesOf(world));
        check("the whole stack is reclaimed", world.player[1] === null, JSON.stringify(world.player[1]));
        check("and every gathered slot is restored", isRestored(world), JSON.stringify(world.surface));
    }
    {
        const world = gatherWorld();
        world.cursor = null;
        world.tracker.resolveFromGround({ typeId: "minecraft:emerald", amount: 3, name: "Buy" }); // thrown
        check("a thrown gathered stack fires one button", indicesOf(world) === "[0]", indicesOf(world));
        check("and restores the gathered slots", isRestored(world), JSON.stringify(world.surface));
    }
    {
        const world = gatherWorld();
        world.cursor = null;
        world.surface[0] = buy(3);
        world.tracker.runPass();
        // Once the gather has settled, the next press of an identical button is a press.
        world.surface[2] = null;
        world.cursor = buy();
        world.tracker.runPass();
        world.cursor = null;
        world.player[0] = buy();
        world.tracker.runPass();
        check("a later click on an identical button still fires", indicesOf(world) === "[0,2]", indicesOf(world));
    }

    // With a mouse a click lifts the button onto the cursor; it fires at once instead of waiting
    // for the item to be put down.
    console.log("\n  cursor reclaim\n");
    {
        const world = makeWorld({ surface: [buy()], player: [null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = buy(); // lifted by a click
        world.tracker.runPass();
        check("a button on the cursor fires in the pass that saw it", indicesOf(world) === "[0]", indicesOf(world));
        check("its copy is taken out of the hand", world.cursor === null, JSON.stringify(world.cursor));
        check("and nothing is left waiting", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
        check("it is traced as resolved from the cursor", world.traces.some((line) => line.includes("via=cursor outcome=fired")), world.traces.join(","));
    }
    {
        const world = makeWorld({ surface: [buy()], player: [null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = { ...buy(), native: { owner: "player" } }; // the player's own look-alike
        world.tracker.runPass();
        check("the player's own look-alike on the cursor is left alone", world.cursor?.native?.owner === "player", JSON.stringify(world.cursor));
        check("and the take keeps waiting", world.emitted.length === 0 && world.tracker.pendingCount === 1, `emitted=${world.emitted.length}`);
    }
    {
        // A collect-all seen within one pass: three buttons gathered, one click.
        const world = makeWorld({
            surface: [buy(), item("minecraft:paper", 1, "Info"), buy(), buy()],
            player: [null],
            reclaimsCursor: true,
            onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, buy()),
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[2] = null;
        world.surface[3] = null;
        world.cursor = buy(3);
        world.tracker.runPass();
        check("a gathered stack on the cursor fires one button", indicesOf(world) === "[0]", indicesOf(world));
        check("and restores the others", isRestored(world) && world.surface[0]?.typeId === "minecraft:emerald", JSON.stringify(world.surface));
        check("with the hand emptied", world.cursor === null, JSON.stringify(world.cursor));
    }
    {
        // An item already in hand clicked onto the button: the item swaps in, the button lands
        // on the cursor and is taken back.
        const sword = { ...item("minecraft:iron_sword", 1, "Excalibur"), native: { owner: "player" } };
        const world = makeWorld({ surface: [buy()], player: [null, null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = sword;
        world.cursor = buy();
        world.tracker.runPass();
        check("a held item swapped onto a button is one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the button that landed on the cursor is taken back", world.cursor === null, JSON.stringify(world.cursor));
        check("as a reclaim, not a second click", world.traces.some((line) => line.includes("via=cursor outcome=reclaimed")), world.traces.join(","));
        check("and the player's item goes back to the inventory", world.player.some((slot) => slot?.native?.owner === "player"), JSON.stringify(world.player));
    }

    // A copy dragged into an input is a click on its button, never a deposit.
    console.log("\n  copies dropped into inputs\n");
    {
        // Touch moves the button slot to slot in one step, never through the cursor.
        const world = makeWorld({ surface: [buy(), null], player: [null], writable: [1] });
        world.tracker.runPass();
        world.surface[1] = world.surface[0];
        world.surface[0] = null;
        world.tracker.runPass();
        check("a button dragged into an input fires once", indicesOf(world) === "[0]", indicesOf(world));
        check("the input never reports the copy", !world.emitted.some((interaction) => interaction.index === 1), JSON.stringify(world.emitted));
        check("the copy is taken out of the input", world.surface[1] === null, JSON.stringify(world.surface[1]));
        check("traced as resolved from an input", world.traces.some((line) => line.includes("via=input outcome=fired")), world.traces.join(","));
    }
    {
        // The input is scanned before the slot the button left, so its take is not queued yet.
        const world = makeWorld({ surface: [null, buy()], player: [null], writable: [0] });
        world.tracker.runPass();
        world.surface[0] = world.surface[1];
        world.surface[1] = null;
        world.tracker.runPass();
        check("it fires even when the input comes first", indicesOf(world) === "[1]", indicesOf(world));
        check("and leaves nothing waiting", world.surface[0] === null && world.tracker.pendingCount === 0, JSON.stringify(world.surface));
    }
    {
        // Dragged onto an occupied input, the button swaps with the player's item.
        const sword = { ...item("minecraft:iron_sword", 1, "Excalibur"), native: { owner: "player" } };
        const world = makeWorld({ surface: [buy(), sword], player: [null, null], writable: [1] });
        world.tracker.runPass();
        world.surface[0] = sword;
        world.surface[1] = buy();
        world.tracker.runPass();
        const inputEvents = world.emitted.filter((interaction) => interaction.index === 1);
        check(
            "the input reports the player's item as taken",
            inputEvents.length === 1 && inputEvents[0].next === null && inputEvents[0].previous?.native?.owner === "player",
            JSON.stringify(inputEvents),
        );
        check("and is left empty, not holding the copy", world.surface[1] === null, JSON.stringify(world.surface[1]));
        check("the player's item goes back to the inventory", world.player.some((slot) => slot?.native?.owner === "player"), JSON.stringify(world.player));
        check("and the swap is one click on the button", world.emitted.filter((interaction) => interaction.index === 0).length === 1, JSON.stringify(world.emitted));
    }
    {
        const world = makeWorld({ surface: [null], player: [null], writable: [0] });
        world.tracker.runPass();
        world.surface[0] = buy(); // a copy that leaked earlier
        world.tracker.runPass();
        check("a stray copy in an input is removed", world.surface[0] === null, JSON.stringify(world.surface[0]));
        check("without reporting anything", world.emitted.length === 0, JSON.stringify(world.emitted));
        check("and is traced", world.traces.some((line) => line.startsWith("input-copy-removed")), world.traces.join(","));
    }

    // A tap moves a button straight into the inventory, where the sweep can remove the copy
    // before the pass sees it.
    console.log("\n  sweep race\n");
    {
        const world = makeWorld({ surface: [buy()], player: [null], onEmit: (state, interaction) => state.applyCoreRepaint(interaction.index, buy()) });
        world.tracker.runPass();
        world.surface[0] = null; // tapped into the inventory…
        world.swept = [probeOf(buy())]; // …where the sweep got to it first
        world.tracker.runPass();
        check("a tap whose copy the sweep took still fires", indicesOf(world) === "[0]", indicesOf(world));
        check("in the same pass", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
        check("traced as swept", world.traces.some((line) => line.includes("via=swept outcome=fired")), world.traces.join(","));
    }
    {
        const world = makeWorld({ surface: [buy()], player: [null] });
        world.tracker.runPass();
        world.swept = [probeOf(buy())]; // a stray copy, with nothing in flight
        world.tracker.runPass();
        world.surface[0] = null; // a later click, still on its way
        world.tracker.runPass();
        check("a sweep with nothing in flight fires nothing", world.emitted.length === 0, JSON.stringify(world.emitted));
        check("and is not kept for a later take", world.tracker.pendingCount === 1, `pending=${world.tracker.pendingCount}`);
    }

    // An abandoned take is logged once.
    {
        const world = makeWorld({ surface: [buy()], player: [null], maxPendingTicks: 2, restoreInvalidates: true });
        world.tracker.runPass();
        world.surface[0] = null; // lifted, then lost
        for (let pass = 0; pass < 5; pass++) world.tracker.runPass();
        check("an abandoned take is restored", world.surface[0]?.typeId === "minecraft:emerald", JSON.stringify(world.surface[0]));
        check("and not also reported as invalidated", !world.traces.some((line) => line.startsWith("take-invalidated")), world.traces.join(","));
    }
};
