/** A real stack that reads exactly like a button (same type, count and name) swapped onto it. */

import { item } from "./world.mjs";

/** The player's own stack, named and counted like the button: a real item, so it carries `native`. */
const lookalike = () => ({ ...item("minecraft:emerald", 1, "Buy"), native: { owner: "player" } });
const button = () => item("minecraft:emerald", 1, "Buy");

/** Real stacks anywhere the player could end up holding them: inventory, cursor and surface. */
const realCountOf = (world) => [...world.player, ...world.surface, world.cursor].filter((stack) => stack?.native !== undefined).length;
const copyCountOf = (world) => [...world.player, ...world.surface, world.cursor].filter((stack) => stack && stack.native === undefined && stack.typeId === "minecraft:emerald").length;

export const checkSameProbe = async ({ check, makeWorld }) => {
    console.log("\n  a look-alike swapped onto a button\n");

    // With a mouse: the player lifts their own stack, then clicks it onto the button.
    {
        const world = makeWorld({ surface: [button()], player: [null, lookalike()], reclaimsCursor: true });
        world.tracker.runPass();

        world.player[1] = null;
        world.cursor = lookalike(); // lifted from the inventory
        world.tracker.runPass();
        check("holding a look-alike fires nothing", world.emitted.length === 0, `emitted=${world.emitted.length}`);

        world.surface[0] = lookalike(); // swapped in: the slot reads as before…
        world.cursor = button(); // …and the button is in hand
        world.tracker.runPass();
        check("the player's stack does not stay in the button's slot", world.surface[0]?.native === undefined, JSON.stringify(world.surface[0]));
        check("the button is painted back", world.surface[0]?.typeId === "minecraft:emerald" && world.surface[0]?.name === "Buy");
        check("the player has their stack back, once", realCountOf(world) === 1, `real=${realCountOf(world)}`);
        check("the button copy is out of the hand", world.cursor === null, JSON.stringify(world.cursor));
        check("the swap is one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("no copy of the button is left anywhere", copyCountOf(world) === 1, `copies=${copyCountOf(world)}`);
    }

    // With touch: the stacks swap in place and no cursor is involved.
    {
        const world = makeWorld({ surface: [button()], player: [null, lookalike()], changeEvents: true });
        world.tracker.runPass();

        world.player[1] = button(); // the button copy lands where the stack was
        world.surface[0] = lookalike();
        world.inventoryChanged = true;
        world.tracker.runPass();
        world.tracker.runPass();
        world.tracker.runPass();
        check("the player's stack does not stay in the button's slot (touch)", world.surface[0]?.native === undefined, JSON.stringify(world.surface[0]));
        check("the player has their stack back, once (touch)", realCountOf(world) === 1, `real=${realCountOf(world)}`);
        check("the button copy is reclaimed from the inventory (touch)", copyCountOf(world) === 1, `copies=${copyCountOf(world)}`);
        check("the swap is one trigger (touch)", world.emitted.length === 1, `emitted=${world.emitted.length}`);
    }

    // Nothing extra is read while nobody holds a look-alike.
    {
        const world = makeWorld({ surface: [button(), null], player: [null, null], changeEvents: true });
        world.tracker.runPass();
        world.cursorProbes = 0;
        world.player[0] = item("minecraft:dirt", 3);
        world.inventoryChanged = true;
        for (let pass = 0; pass < 10; pass++) world.tracker.runPass();
        check("idle passes and unrelated inventory changes never read the cursor", world.cursorProbes === 0, `cursorProbes=${world.cursorProbes}`);
    }

    // The player's look-alike held and put away again changes nothing.
    {
        const world = makeWorld({ surface: [button()], player: [null, lookalike()], reclaimsCursor: true });
        world.tracker.runPass();
        world.player[1] = null;
        world.cursor = lookalike();
        world.tracker.runPass();
        world.cursor = null;
        world.player[1] = lookalike();
        for (let pass = 0; pass < 3; pass++) world.tracker.runPass();
        check("putting a held look-alike back fires nothing", world.emitted.length === 0, `emitted=${world.emitted.length}`);
        check("and leaves the button alone", world.surface[0]?.native === undefined && world.surface[0]?.name === "Buy");
        const probesAfterRelease = world.cursorProbes;
        for (let pass = 0; pass < 5; pass++) world.tracker.runPass();
        check("the cursor is no longer watched once it is empty", world.cursorProbes === probesAfterRelease, `extra=${world.cursorProbes - probesAfterRelease}`);
    }
};
