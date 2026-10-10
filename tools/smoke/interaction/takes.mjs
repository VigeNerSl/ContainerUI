/** Deferred takes: where an item goes, drags, abandonment, inputs, swaps, stacks and closing. */

import { item } from "./world.mjs";

/** The player's own sword: a real stack, which carries `native`. */
const playerSword = () => ({ ...item("minecraft:iron_sword", 1, "Excalibur"), native: { owner: "player" } });

export const checkTakes = async ({ check, makeWorld }) => {
    console.log("\n  deferred interaction\n");

    // A take does not fire until the item is found somewhere.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null] });
        world.tracker.runPass(); // primes the inventory snapshot
        world.surface[0] = null; // player lifted it onto the cursor
        world.tracker.runPass();

        check("a lifted item fires nothing yet", world.emitted.length === 0, `emitted=${world.emitted.length}`);
        check("the take is held pending", world.tracker.pendingCount === 1);
        check("the slot is left empty while in transit", world.surface[0] === null);
    }

    // Resolves when it lands in the player's inventory.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.player[1] = item("minecraft:diamond", 1, "Buy");
        world.tracker.runPass();

        check("landing in the inventory fires exactly one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the trigger names the slot it came from", world.emitted[0]?.index === 0);
        check("the trigger reads as a take", world.emitted[0]?.kind === "take");
        check("the copy is reclaimed from the inventory", world.player[1] === null);
        check("nothing is left pending", world.tracker.pendingCount === 0);
    }

    // Resolves when thrown on the ground.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();
        check("still pending before it lands", world.emitted.length === 0);

        const claimed = world.tracker.resolveFromGround({ typeId: "minecraft:diamond", amount: 1, name: "Buy" });
        check("the ground drop is claimed", claimed === true);
        check("throwing it fires the trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("nothing is left pending after the throw", world.tracker.pendingCount === 0);
    }

    // A sideways drag inside the surface is one trigger, not two.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), item("minecraft:paper", 1, "Info")],
            player: [null],
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = item("minecraft:diamond", 1, "Buy"); // dragged onto the other button
        world.tracker.runPass();

        check("a sideways drag fires exactly one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the trigger belongs to the slot it left", world.emitted[0]?.index === 0);
        check("the destination button is put back", world.surface[1]?.typeId === "minecraft:paper");
        check("the player was not handed a copy", world.player.every((slot) => !slot));
    }

    // Never located: abandoned, not fired.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null], maxPendingTicks: 3 });
        world.tracker.runPass();
        world.surface[0] = null;
        for (let pass = 0; pass < 6; pass++) world.tracker.runPass();

        check("an unfinished gesture never fires", world.emitted.length === 0, `emitted=${world.emitted.length}`);
        check("the abandoned slot is repainted", world.surface[0]?.typeId === "minecraft:diamond");
        check("the abandoned take is dropped", world.tracker.pendingCount === 0);
        check("the abandonment is reported", world.traces.some((line) => line.startsWith("take-abandoned")));
    }

    // Player-owned input slots stay immediate.
    {
        const world = makeWorld({ surface: [item("minecraft:emerald", 5)], player: [null], writable: [0] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();

        check("an input slot fires immediately", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("an input take is never deferred", world.tracker.pendingCount === 0);
    }

    // An item pushed onto a button goes back to its origin slot.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), null],
            player: [null, null, playerSword()],
        });
        world.tracker.runPass();
        world.player[2] = null; // taken out of inventory slot 2…
        world.surface[1] = playerSword(); // …and dropped on a UI slot
        world.tracker.runPass();

        check("pushing an item onto a UI slot is a trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the trigger names the UI slot", world.emitted[0]?.index === 1);
        check("the item goes back to the exact origin slot", world.player[2]?.typeId === "minecraft:iron_sword");
        check("it is not duplicated elsewhere", world.player.filter((slot) => slot?.typeId === "minecraft:iron_sword").length === 1);
        check("the return is reported with its destination", world.traces.some((line) => line.includes("insert-returned") && line.includes("to=2")));
    }

    // A full inventory strands the item and never destroys it.
    {
        const world = makeWorld({ surface: [null], player: [playerSword()] });
        world.tracker.runPass();
        world.player[0] = null;
        world.surface[0] = playerSword();
        world.inventoryFull = true;
        world.tracker.runPass();

        check("an unreturnable item is not reported", world.emitted.length === 0, `emitted=${world.emitted.length}`);
        check("an unreturnable item is left where it is", world.surface[0]?.typeId === "minecraft:iron_sword");
        check("stranding is reported", world.traces.some((line) => line.startsWith("insert-stranded")));
    }

    // Swapping the player's item onto a button, over two ticks: one gesture, one trigger, and the
    // displaced button reclaimed without a second trigger.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy")],
            player: [null, null, playerSword(), null],
        });
        world.tracker.runPass();

        world.player[2] = null; // tick A: lifted onto the cursor
        world.tracker.runPass();
        check("lifting from the inventory alone fires nothing", world.emitted.length === 0, `emitted=${world.emitted.length}`);

        world.surface[0] = playerSword(); // tick B: swapped in
        world.tracker.runPass();

        check("a swap onto a button fires exactly one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the swap trigger names the button slot", world.emitted[0]?.index === 0);
        check("the swapped-in item returns to its original slot", world.player[2]?.typeId === "minecraft:iron_sword");

        // The button, now on the cursor, lands in the inventory a tick later.
        const emittedBefore = world.emitted.length;
        world.player[3] = item("minecraft:diamond", 1, "Buy");
        world.tracker.runPass();

        check("the displaced button is reclaimed", world.player[3] === null, JSON.stringify(world.player[3]));
        check("reclaiming it does not fire a second trigger", world.emitted.length === emittedBefore, `emitted=${world.emitted.length}`);
    }

    // A repaint under a held button (navigation) leaves the gesture no target: the copy is still
    // reclaimed, but the new screen's handler must not fire.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null, null] });
        world.tracker.runPass();
        world.surface[0] = null; // lifted onto the cursor
        world.tracker.runPass();
        check("the lifted button is pending before navigation", world.tracker.pendingCount === 1);

        world.applyCoreRepaint(0, item("minecraft:emerald", 1, "Sell"));

        world.player[1] = item("minecraft:diamond", 1, "Buy"); // the old button lands
        world.tracker.runPass();

        check("the stale gesture fires nothing", world.emitted.length === 0, `emitted=${JSON.stringify(world.emitted)}`);
        check("the stray copy is still reclaimed", world.player[1] === null);
        check("the new screen's slot is untouched", world.surface[0]?.typeId === "minecraft:emerald");
    }

    // A stacked button is reclaimed whole.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 16, "Buy")], player: [null, null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.player[1] = item("minecraft:diamond", 16, "Buy");
        world.tracker.runPass();

        check("a stacked button fires one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the whole stack is reclaimed", world.player[1] === null, `left=${JSON.stringify(world.player[1])}`);
    }

    // A right-click split leaves the same button, smaller: not a swap.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 16, "Buy")], player: [null, null, null] });
        world.tracker.runPass();
        world.surface[0] = item("minecraft:diamond", 8, "Buy"); // 8 lifted onto the cursor
        world.tracker.runPass();

        check("a split stack hands the player nothing", world.player.every((slot) => !slot), JSON.stringify(world.player));
        check("a split stack fires nothing yet", world.emitted.length === 0, `emitted=${world.emitted.length}`);

        world.player[0] = item("minecraft:diamond", 8, "Buy"); // the half lands
        world.tracker.runPass();
        check("the split half resolves as one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the split half is reclaimed whole", world.player[0] === null, `left=${JSON.stringify(world.player[0])}`);
    }

    // Two identical buttons taken together stack in the inventory.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), item("minecraft:diamond", 1, "Buy")],
            player: [null, null],
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.player[0] = item("minecraft:diamond", 2, "Buy"); // both landed, merged
        world.tracker.runPass();

        check("both identical takes resolve", world.emitted.length === 2, `emitted=${world.emitted.length}`);
        check("the merged stack is fully reclaimed", world.player[0] === null, `left=${JSON.stringify(world.player[0])}`);
        check("nothing is left pending", world.tracker.pendingCount === 0);
    }

    // The player vanishing mid-gesture does not throw.
    {
        const world = makeWorld({ surface: [item("minecraft:diamond", 1, "Buy")], player: [null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();
        world.playerGone = true;

        let threw = null;
        try {
            world.tracker.runPass();
            world.tracker.runPass();
        } catch (error) {
            threw = error;
        }
        check("a vanished player does not crash the pass", threw === null, String(threw));
    }

    // A handler that closes the surface stops the pass.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), item("minecraft:paper", 1, "Info")],
            player: [null, null],
            onEmit: (state) => {
                state.isClosed = true; // the handler closed the surface
            },
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.player[0] = item("minecraft:diamond", 1, "Buy");

        let threw = null;
        try {
            world.tracker.runPass();
            world.probes = 0;
            world.tracker.runPass();
        } catch (error) {
            threw = error;
        }
        check("closing from a handler does not crash", threw === null, String(threw));
        check("a closed surface is not probed again", world.probes === 0, `probes=${world.probes}`);
    }

    // A deposit into an input is kept, never returned: that is what keeps mirrored chests working.
    {
        const world = makeWorld({
            surface: [null],
            // The player's own, so it carries `native`: an input refuses a copy.
            player: [{ ...item("minecraft:iron_sword", 1, "Excalibur"), native: { owner: "player" } }],
            writable: [0],
        });
        world.tracker.runPass();
        world.surface[0] = world.player[0];
        world.player[0] = null;
        world.tracker.runPass();

        check("a deposit into an input reports immediately", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("a deposit is not bounced back to the player", world.player[0] === null, JSON.stringify(world.player[0]));
        check("a deposit stays in the slot", world.surface[0]?.typeId === "minecraft:iron_sword");
    }

    // Closing from a handler does not bring back cleared state.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), item("minecraft:paper", 1, "Info")],
            player: [null, null],
            maxPendingTicks: 1,
            onEmit: (state) => {
                state.isClosed = true;
                state.tracker.clear(); // what BedrockSurface.close() does
            },
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.player[0] = item("minecraft:diamond", 1, "Buy");

        let threw = null;
        try {
            world.tracker.runPass();
        } catch (error) {
            threw = error;
        }
        check("closing mid-resolution does not crash", threw === null, String(threw));
        check("cleared state is not resurrected", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
    }

    // Two different pending takes do not resolve each other.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy"), item("minecraft:paper", 1, "Info")],
            player: [null, null],
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.tracker.runPass();
        check("both takes are pending", world.tracker.pendingCount === 2);

        world.player[0] = item("minecraft:paper", 1, "Info");
        world.tracker.runPass();
        check("only the matching take resolves", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the resolved trigger is the right slot", world.emitted[0]?.index === 1);
        check("the other take is still waiting", world.tracker.pendingCount === 1);
    }
};
