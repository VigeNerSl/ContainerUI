/** Lots that look alike in type and name, told apart by lore. */

const lot = (price, amount = 2) => ({ typeId: "minecraft:golden_apple", amount, name: "Lot", lore: [`§7Price ${price}`] });

export const checkLots = async ({ check, makeWorld }) => {
    console.log("\n  lots of one kind\n");

    // Two lots of one type and name, the dearer on the cursor: that lot's handler fires.
    {
        const world = makeWorld({ surface: [lot(10), lot(99)], player: [null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.cursor = lot(99);
        world.tracker.runPass();
        check("the lot on the cursor fires, not the oldest of its kind", world.emitted.length === 1 && world.emitted[0]?.index === 1, JSON.stringify(world.emitted.map((interaction) => interaction.index)));
        check("the other lot keeps waiting", world.tracker.pendingCount === 1 && world.tracker.pending[0]?.surfaceSlot === 0, `pending=${world.tracker.pendingCount}`);
    }

    // The same, with the cheaper lot on the cursor.
    {
        const world = makeWorld({ surface: [lot(10), lot(99)], player: [null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.cursor = lot(10);
        world.tracker.runPass();
        check("the cheaper lot fires when it is the one lifted", world.emitted.length === 1 && world.emitted[0]?.index === 0, JSON.stringify(world.emitted.map((interaction) => interaction.index)));
    }

    // One pending lot needs no lore from the cursor.
    {
        const world = makeWorld({ surface: [lot(10)], player: [null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = lot(10);
        world.tracker.runPass();
        check("a single pending lot fires from the cursor", world.emitted.length === 1 && world.emitted[0]?.index === 0);
    }

    // A copy that reads as none of the pending lots still resolves one take, by kind.
    {
        const world = makeWorld({ surface: [lot(10), lot(99)], player: [null], reclaimsCursor: true });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.cursor = lot(55);
        world.tracker.runPass();
        check("an unmatched copy still resolves one take", world.emitted.length === 1, `emitted=${world.emitted.length}`);
    }

    // A lot thrown to the ground: the guard reads its lore, and that lot fires.
    {
        const world = makeWorld({ surface: [lot(10), lot(99)], player: [null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.tracker.runPass();
        world.tracker.resolveFromGround({ typeId: "minecraft:golden_apple", amount: 2, name: "Lot", lore: ["§7Price 99"] });
        check("a lot thrown to the ground fires its own handler", world.emitted.length === 1 && world.emitted[0]?.index === 1, JSON.stringify(world.emitted.map((interaction) => interaction.index)));
    }

    // A lot the sweep removed from the inventory: the sweep reads its lore, and that lot fires.
    {
        const world = makeWorld({ surface: [lot(10), lot(99)], player: [null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.tracker.runPass();
        world.swept.push({ typeId: "minecraft:golden_apple", amount: 2, name: "Lot", lore: ["§7Price 99"] });
        world.tracker.runPass();
        check("a lot the sweep removed fires its own handler", world.emitted.length === 1 && world.emitted[0]?.index === 1, JSON.stringify(world.emitted.map((interaction) => interaction.index)));
    }
};
