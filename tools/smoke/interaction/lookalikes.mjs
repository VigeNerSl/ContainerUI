/** Takes that must be told apart from look-alikes: a button coming home, lore, cursor holds, real items. */

import { item } from "./world.mjs";

/** The player's own golden apples: a real stack, which carries `native`. */
const realApples = (amount) => ({ typeId: "minecraft:golden_apple", amount, name: "", native: { owner: "player", amount } });

export const checkLookalikes = async ({ check, makeWorld }) => {
    // A lifted button put straight back into its own slot.
    {
        const button = item("minecraft:barrier", 1, "Close");
        const world = makeWorld({ surface: [button], player: [null, null] });
        world.tracker.runPass();

        world.surface[0] = null;
        world.cursor = button;
        world.tracker.runPass();
        check("lifting the button defers a take", world.tracker.pendingCount === 1);

        world.cursor = null;
        world.surface[0] = button;
        world.tracker.runPass();

        check("returning it home fires exactly one trigger", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the button is still in its slot", world.surface[0]?.typeId === "minecraft:barrier", JSON.stringify(world.surface[0]));
        check("the player is not handed a copy", world.player.every((slot) => !slot), JSON.stringify(world.player));
        check("nothing is left pending", world.tracker.pendingCount === 0, `pending=${world.tracker.pendingCount}`);
    }

    // Eight lot apples swapped onto the player's own forty: the swap resolves the take, and the
    // forty put down later lose nothing.
    {
        const lot = { typeId: "minecraft:golden_apple", amount: 8, name: "", lore: ["§7Цена: §e40"] };
        const world = makeWorld({ surface: [lot], player: [null, null, null] });
        world.tracker.runPass();

        world.surface[0] = null;
        world.cursor = lot;
        world.tracker.runPass();
        check("the lot take is pending", world.tracker.pendingCount === 1);

        // Ours in the slot, theirs on the cursor.
        const ownApples = { typeId: "minecraft:golden_apple", amount: 40, name: "" };
        world.player[1] = lot;
        world.cursor = ownApples;
        world.tracker.runPass();
        check("ours is found even though the slot count fell", world.player[1] === null, JSON.stringify(world.player[1]));
        check("the swap-in resolves the take", world.tracker.pendingCount === 0);

        world.cursor = null;
        world.player[2] = ownApples;
        world.tracker.runPass();
        check("the player's own stack is untouched", world.player[2]?.amount === 40, JSON.stringify(world.player[2]));
    }

    // With a lored take outstanding, a plain stack of the same type is not it.
    {
        const lot = { typeId: "minecraft:golden_apple", amount: 8, name: "", lore: ["§7Цена: §e40"] };
        const world = makeWorld({ surface: [lot], player: [null, null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();
        check("a take is outstanding", world.tracker.pendingCount === 1);

        world.player[0] = { typeId: "minecraft:golden_apple", amount: 40, name: "" };
        world.tracker.runPass();
        check("a plain stack does not resolve a lored take", world.tracker.pendingCount === 1);
        check("and is not docked", world.player[0]?.amount === 40, JSON.stringify(world.player[0]));
        check("no trigger fired for it", world.emitted.length === 0);

        world.player[1] = lot;
        world.tracker.runPass();
        check("the real copy still resolves", world.tracker.pendingCount === 0);
        check("the real copy is reclaimed", world.player[1] === null);
        check("the player's stack survived that too", world.player[0]?.amount === 40);
    }

    // Two takes of one type, told apart by lore.
    {
        const cheap = { typeId: "minecraft:golden_apple", amount: 2, name: "", lore: ["§7Цена: §e10"] };
        const dear = { typeId: "minecraft:golden_apple", amount: 3, name: "", lore: ["§7Цена: §e99"] };
        const world = makeWorld({ surface: [cheap, dear], player: [null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.surface[1] = null;
        world.tracker.runPass();
        check("both lots are pending", world.tracker.pendingCount === 2);

        world.player[0] = dear;
        world.tracker.runPass();
        check("only the matching lot resolves", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("it is the right slot", world.emitted[0]?.index === 1, `index=${world.emitted[0]?.index}`);
        check("the other lot is still waiting", world.tracker.pendingCount === 1);
    }

    // Full reads stay rare: with nothing in flight there are no candidates to confirm.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy")],
            player: [item("minecraft:golden_apple", 40), item("minecraft:dirt", 5), null],
        });
        world.tracker.runPass();
        world.player[0] = item("minecraft:golden_apple", 64);
        world.player[1] = item("minecraft:dirt", 9);
        const before = world.playerReads;
        world.tracker.runPass();
        check("inventory churn costs no full reads while nothing is pending", world.playerReads === before, `reads=${world.playerReads - before}`);
    }

    // The player's forty apples dropped onto a listing of eight: the full views differ by lore,
    // so this is a swap, not the stack growing.
    {
        const listing = { typeId: "minecraft:golden_apple", amount: 8, name: "", lore: ["§7Цена: §e40"] };
        const world = makeWorld({ surface: [listing], player: [null, null] });
        world.tracker.runPass();

        const playerApples = realApples(40);
        world.surface[0] = playerApples;
        world.tracker.runPass();

        check("the player's stack is handed back whole, not overwritten by the listing nor left in the slot as a second copy", world.player.some((slot) => slot?.amount === 40) && world.surface[0]?.native === undefined, JSON.stringify([world.player, world.surface[0]]));
        check("it is not misread as the stack growing", !world.traces.some((line) => line.startsWith("stack-grew")), world.traces.join(","));
        check("the player's apples are handed back", world.player.some((slot) => slot?.amount === 40), JSON.stringify(world.player));
    }

    // Identical lore means one stack changing size: a split is still a partial take.
    {
        const button = { typeId: "minecraft:golden_apple", amount: 16, name: "", lore: ["§7Лот"] };
        const world = makeWorld({ surface: [button], player: [null, null] });
        world.tracker.runPass();

        world.surface[0] = { typeId: "minecraft:golden_apple", amount: 8, name: "", lore: ["§7Лот"] };
        world.tracker.runPass();
        check("a same-lore shrink is a partial take", world.tracker.pendingCount === 1);
        check("the split take carries the difference", world.tracker.pending[0]?.amount === 8, `amount=${world.tracker.pending[0]?.amount}`);

        // A same-lore grow is another copy merging in, which goes back.
        world.surface[0] = { typeId: "minecraft:golden_apple", amount: 24, name: "", lore: ["§7Лот"] };
        world.tracker.runPass();
        check("a same-lore grow is restored, not handed over", world.traces.some((line) => line.startsWith("stack-grew")), world.traces.join(","));
    }

    // An item held on the cursor is not abandoned: repainting the slot would duplicate it.
    {
        const button = item("minecraft:golden_apple", 8, "Lot");
        const world = makeWorld({ surface: [button], player: [null, null], maxPendingTicks: 2 });
        world.tracker.runPass();

        world.surface[0] = null;
        world.cursor = button;
        world.tracker.runPass();
        check("lifting onto the cursor defers the take", world.tracker.pendingCount === 1);

        for (let pass = 0; pass < 6; pass++) world.tracker.runPass();
        check("a take is not abandoned while the item is on the cursor", world.tracker.pendingCount === 1);
        check("the slot stays empty rather than minting a copy", world.surface[0] === null, JSON.stringify(world.surface[0]));
        check("nothing was abandoned", !world.traces.some((line) => line.startsWith("take-abandoned")), world.traces.join(","));
        check("no trigger fired while the gesture was unfinished", world.emitted.length === 0);
        const holds = world.traces.filter((line) => line.startsWith("take-held"));
        check("the hold is reported exactly once", holds.length === 1, `holds=${holds.length}`);

        world.cursor = null;
        world.player[0] = button;
        world.tracker.runPass();
        check("putting it down resolves the take", world.emitted.length === 1, `emitted=${world.emitted.length}`);
        check("the copy is reclaimed from the inventory", world.player[0] === null, JSON.stringify(world.player[0]));
        check("nothing is left pending", world.tracker.pendingCount === 0);
    }

    // The hold keys on the item, not on an occupied cursor.
    {
        const world = makeWorld({
            surface: [item("minecraft:diamond", 1, "Buy")],
            player: [null],
            maxPendingTicks: 2,
        });
        world.tracker.runPass();
        world.surface[0] = null;
        world.cursor = item("minecraft:dirt", 3);
        world.tracker.runPass();

        for (let pass = 0; pass < 4; pass++) world.tracker.runPass();
        check("an unrelated cursor item does not defer abandonment", world.tracker.pendingCount === 0);
        check("the abandoned slot is restored", world.surface[0]?.typeId === "minecraft:diamond");
    }

    // A real stack that looks like a plain button is still the player's: ownership (`native`)
    // tells them apart where every visible field matches.
    {
        const button = item("minecraft:golden_apple", 8);
        const world = makeWorld({ surface: [button], player: [null, null] });
        world.tracker.runPass();

        world.surface[0] = realApples(40);
        world.cursor = button;
        world.tracker.runPass();
        check("a swap onto a plain button is not read as the stack growing", !world.traces.some((line) => line.startsWith("stack-grew")), world.traces.join(","));
        check("the player's forty are handed back", world.player.some((slot) => slot?.amount === 40), JSON.stringify(world.player));
    }
    {
        const button = item("minecraft:golden_apple", 8);
        const world = makeWorld({ surface: [button], player: [null, null] });
        world.tracker.runPass();

        world.surface[0] = realApples(5);
        world.cursor = button;
        world.tracker.runPass();
        check("a smaller real stack is not read as a partial take", !world.tracker.pending.some((take) => take.amount === 3), JSON.stringify(world.tracker.pending));
        check("the player's five are handed back", world.player.some((slot) => slot?.amount === 5), JSON.stringify(world.player));
    }
    {
        const button = item("minecraft:golden_apple", 8);
        const world = makeWorld({ surface: [button], player: [null, realApples(40)] });
        world.tracker.runPass();

        world.surface[0] = null;
        world.cursor = button;
        world.player[1] = realApples(41);
        world.tracker.runPass();
        check("a pending take never reclaims from the player's own stack", world.player[1]?.amount === 41, JSON.stringify(world.player[1]));
        check("the take stays pending on the cursor", world.tracker.pendingCount === 1);
    }
    {
        const button = item("minecraft:golden_apple", 8);
        const world = makeWorld({ surface: [button], player: [null, null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();

        world.surface[0] = realApples(8);
        world.tracker.runPass();
        check("a real item in the emptied slot is not the button returning", !world.traces.some((line) => line.includes("via=returned")), world.traces.join(","));
        check("it is handed back to the player", world.player.some((slot) => slot?.native?.owner === "player"), JSON.stringify(world.player));
    }
    {
        const world = makeWorld({ surface: [item("minecraft:golden_apple", 8), item("minecraft:paper", 1, "Info")], player: [null, null] });
        world.tracker.runPass();
        world.surface[0] = null;
        world.tracker.runPass();

        world.surface[1] = realApples(8);
        world.tracker.runPass();
        check("a real item on another button is not a sideways drag", !world.traces.some((line) => line.includes("via=surface")), world.traces.join(","));
        check("and is handed back rather than painted over", world.player.some((slot) => slot?.native?.owner === "player"), JSON.stringify(world.player));
    }

    // One of our copies that no longer reads as what was written — here a split whose lore came back
    // without its empty last line — is never handed to the player: it would come back a real item.
    {
        const button = { typeId: "minecraft:gold_nugget", amount: 16, name: "Buy", lore: ["§7Price 5", ""] };
        const world = makeWorld({ surface: [button], player: [null, null, null] });
        world.tracker.runPass();
        world.surface[0] = { typeId: "minecraft:gold_nugget", amount: 8, name: "Buy", lore: ["§7Price 5"] };
        world.tracker.runPass();

        check("a copy that reads differently is not handed to the player", world.player.every((slot) => !slot), JSON.stringify(world.player));
        check("and fires nothing", world.emitted.length === 0, `emitted=${world.emitted.length}`);
        check("its slot is painted back", world.surface[0]?.amount === 16 && world.traces.some((line) => line.startsWith("insert-copy-restored")), world.traces.join(","));
    }
};
