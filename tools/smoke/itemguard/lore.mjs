/** The lore marker of a stackable item: it fits the engine's 20 lines of 50 characters, whatever lore the item already has. */

export const checkLoreMarker = async ({ check, ItemStack, toItemStack, toStorageStack, fromItemStack, isRenderedItem }) => {
    console.log("\n  lore marker\n");

    // The engine allows 20 lore lines of 50 characters: the fallback marker must fit in them.
    {
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (message) => warnings.push(String(message));
        try {
            const roundTrip = (lore, label) => {
                let stack;
                try {
                    stack = toItemStack({ typeId: "minecraft:golden_apple", amount: 8, lore });
                } catch (error) {
                    check(`a stackable item with ${label} is built`, false, String(error));
                    return;
                }
                check(`a stackable item with ${label} is marked`, isRenderedItem(stack));
                check(`${label}: no lore line passes 50 characters`, stack.getLore().every((line) => line.length <= 50), JSON.stringify(stack.getLore().map((line) => line.length)));
                check(`${label}: the lore reads back as written`, JSON.stringify(fromItemStack(stack).lore ?? []) === JSON.stringify(lore), JSON.stringify(fromItemStack(stack).lore));
            };
            for (const length of [41, 42, 43, 49, 50]) {
                roundTrip(["§7short", "x".repeat(length)], `a ${length}-character last line`);
            }
            roundTrip(["y".repeat(45), ""], "a long line before an empty one");
            roundTrip(Array.from({ length: 18 }, () => "line").concat("z".repeat(50)), "19 lines and a full last line");

            // Twenty lines have no room for another: the last gives up its tail, and the item is still marked.
            const full = Array.from({ length: 19 }, () => "line").concat("w".repeat(50));
            let crowded;
            try {
                crowded = toItemStack({ typeId: "minecraft:golden_apple", amount: 8, lore: full });
            } catch (error) {
                check("a full 20-line lore is built", false, String(error));
            }
            check("a full 20-line lore is marked", crowded !== undefined && isRenderedItem(crowded));
            check("and stays at 20 lines", crowded?.getLore().length === 20, String(crowded?.getLore().length));
            check("only its last line was cut", JSON.stringify(fromItemStack(crowded)?.lore?.slice(0, 19)) === JSON.stringify(full.slice(0, 19)));

            // A real stackable item shown on a button.
            const lot = new ItemStack("minecraft:golden_apple", 8);
            lot.setLore(["§7Lot 12", "§7Seller: §fSomebodyWithALongNameThatIsLong1234"]);
            check("the lot's last line is long enough to matter", lot.getLore()[1].length >= 43, String(lot.getLore()[1].length));
            let shown;
            try {
                shown = toItemStack(fromItemStack(lot), { isUiOwned: true });
            } catch (error) {
                check("a real stackable item with a long last line is built", false, String(error));
            }
            check("a real stackable item with a long last line is marked", shown !== undefined && isRenderedItem(shown));
            check("and reads back with its lore", JSON.stringify(fromItemStack(shown)?.lore) === JSON.stringify(lot.getLore()), JSON.stringify(fromItemStack(shown)?.lore));

            // A consumer lore the engine would refuse is cut and reported, not thrown.
            let overlong;
            try {
                overlong = toItemStack({ typeId: "minecraft:golden_apple", lore: ["q".repeat(80)] });
            } catch (error) {
                check("a lore line over 50 characters does not fail the write", false, String(error));
            }
            check("an overlong lore line is cut and still marked", overlong !== undefined && isRenderedItem(overlong));
            check("and reported once", warnings.filter((line) => line.includes("exceeds the engine")).length === 1, warnings.join(" | "));

            // The engine throws on an amount outside 1 to 255.
            warnings.length = 0;
            let heaped;
            try {
                heaped = toItemStack({ typeId: "minecraft:diamond", amount: 300 });
                toItemStack({ typeId: "minecraft:diamond", amount: 300 });
            } catch (error) {
                check("an amount the engine refuses does not fail the write", false, String(error));
            }
            check("an amount the engine refuses still yields a marked stack", heaped !== undefined && isRenderedItem(heaped));
            check("and is reported once", warnings.filter((line) => line.includes("refused the amount")).length === 1, warnings.join(" | "));

            const heapedReal = new ItemStack("minecraft:diamond", 5);
            let heapedClone;
            try {
                heapedClone = toStorageStack({ ...fromItemStack(heapedReal), amount: 999 });
            } catch (error) {
                check("a real item with a refused amount does not fail the write", false, String(error));
            }
            check("a real item with a refused amount keeps its own", heapedClone?.amount === 5, String(heapedClone?.amount));
        } finally {
            console.warn = originalWarn;
        }
    }
};
