/**
 * Storage items: a copy inside a bundle is swept, in the inventory, the off hand and a thrown bundle;
 * a real bundle on a button holds only marked copies; and a removed bundle copy gives up what the
 * player put in it.
 */

export const checkBundles = async ({ check, load, ItemStack, toItemStack, world, onMarkedItemDestroyed, itemEntity }) => {
    console.log("\n  bundles\n");

    /** A bundle holding `contents`, one per slot. */
    const bundleOf = (...contents) => {
        const bundle = new ItemStack("minecraft:bundle");
        const { container } = bundle.getComponent("minecraft:inventory");
        contents.forEach((stored, index) => container.setItem(index, stored));
        return bundle;
    };
    /** The type ids in a bundle's slots, `null` for an empty one. */
    const contentsOf = (bundle) => {
        const { container } = bundle.getComponent("minecraft:inventory");
        return Array.from({ length: container.size }, (_, index) => container.getItem(index)?.typeId ?? null);
    };

    // A button put in a bundle leaves no trace in any slot: the sweep opens storage items.
    {
        const { scrubInventoryOf } = await load("platform/items/itemSweeps.js");
        // Reads hand out copies, as the engine's do.
        const playerWith = ({ slots, equipment = {} }) => ({
            name: "Alex",
            getComponent: (id) => {
                if (id === "minecraft:equippable") {
                    return {
                        getEquipment: (slot) => equipment[slot]?.clone(),
                        setEquipment: (slot, stack) => {
                            equipment[slot] = stack;
                        },
                    };
                }
                if (id !== "minecraft:inventory") return undefined;
                return {
                    container: {
                        size: slots.length,
                        getItem: (index) => slots[index]?.clone(),
                        setItem: (index, stack) => {
                            slots[index] = stack ?? null;
                        },
                    },
                };
            },
        });

        const slots = [bundleOf(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }), new ItemStack("minecraft:diamond", 3)), new ItemStack("minecraft:dirt", 5)];
        const swept = [];
        const removed = scrubInventoryOf(playerWith({ slots }), (probe) => swept.push(probe));
        check("a copy inside a bundle is swept", removed === 1, `removed=${removed}`);
        check("the cleaned bundle is written back to its slot", JSON.stringify(contentsOf(slots[0])) === JSON.stringify([null, "minecraft:diamond", null, null]), JSON.stringify(contentsOf(slots[0])));
        check("the copy is announced for the take it ends", swept.length === 1 && swept[0].typeId === "minecraft:diamond", JSON.stringify(swept));

        const nested = [bundleOf(bundleOf(toItemStack({ typeId: "minecraft:emerald", name: "Sell" })))];
        check("a copy in a bundle inside a bundle is swept", scrubInventoryOf(playerWith({ slots: nested })) === 1);
        const inner = nested[0].getComponent("minecraft:inventory").container.getItem(0);
        check("and the inner bundle stays, emptied", inner?.typeId === "minecraft:bundle" && contentsOf(inner).every((typeId) => typeId === null), JSON.stringify(inner && contentsOf(inner)));

        const equipment = { Offhand: bundleOf(toItemStack({ typeId: "minecraft:gold_ingot", name: "Pay" })) };
        check("a copy in a bundle in the off hand is swept", scrubInventoryOf(playerWith({ slots: [], equipment })) === 1);
        check("and the bundle is written back to the off hand", equipment.Offhand?.typeId === "minecraft:bundle" && contentsOf(equipment.Offhand)[0] === null);

        const stuck = bundleOf(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }));
        const refusing = playerWith({ slots: [stuck] });
        const refusingContainer = refusing.getComponent("minecraft:inventory").container;
        refusingContainer.setItem = () => {
            throw new Error("read-only window");
        };
        const unannounced = [];
        const notRemoved = scrubInventoryOf({ ...refusing, getComponent: (id) => (id === "minecraft:inventory" ? { container: refusingContainer } : undefined) }, (probe) => unannounced.push(probe));
        check("a bundle that cannot be written back counts nothing as removed", notRemoved === 0 && unannounced.length === 0, `removed=${notRemoved} announced=${unannounced.length}`);
        check("and keeps the copy for the next sweep", contentsOf(stuck)[0] === "minecraft:diamond");

        const ownBundle = bundleOf(new ItemStack("minecraft:diamond", 3));
        const untouched = [ownBundle];
        check("a bundle of the player's own items is left alone", scrubInventoryOf(playerWith({ slots: untouched })) === 0 && untouched[0] === ownBundle);
    }

    // A bundle thrown with a copy inside is replaced by a clean one, which keeps the player's items.
    {
        const spawned = [];
        const thrown = itemEntity(bundleOf(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }), new ItemStack("minecraft:diamond", 3)));
        thrown.location = { x: 1, y: 64, z: 2 };
        thrown.dimension = { spawnItem: (stack, location) => spawned.push({ stack, location }) };
        const claimed = [];
        const stopListening = onMarkedItemDestroyed((probe, ownerId) => {
            claimed.push({ typeId: probe.typeId, ownerId });
            return true;
        });
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-B" }, items: [thrown] });
        check("a thrown bundle holding a copy is replaced", thrown.removed === true && spawned.length === 1);
        check("by a bundle without the copy, with the player's items", JSON.stringify(spawned[0] ? contentsOf(spawned[0].stack) : null) === JSON.stringify([null, "minecraft:diamond", null, null]), JSON.stringify(spawned[0] && contentsOf(spawned[0].stack)));
        check("where the old one lay", spawned[0]?.location === thrown.location);
        check("and the copy is announced as the thrower's", claimed.length === 1 && claimed[0].ownerId === "player-B", JSON.stringify(claimed));

        const refused = itemEntity(bundleOf(toItemStack({ typeId: "minecraft:diamond", name: "Buy" })));
        refused.location = { x: 0, y: 64, z: 0 };
        refused.dimension = {
            spawnItem: () => {
                throw new Error("spawn refused");
            },
        };
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-B" }, items: [refused] });
        check("a bundle whose clean copy cannot spawn stays where it is", refused.removed === false);

        const own = itemEntity(bundleOf(new ItemStack("minecraft:diamond", 3)));
        own.dimension = { spawnItem: () => spawned.push("unexpected") };
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-B" }, items: [own] });
        check("a thrown bundle of the player's own items is left alone", own.removed === false && spawned.length === 1);
        stopListening();
    }

    const { fromItemStack, isRenderedItem, toStorageStack } = await load("platform/items/itemConversion.js");
    /** The stacks in a bundle, empty slots left out. */
    const storedIn = (bundle) => {
        const { container } = bundle.getComponent("minecraft:inventory");
        return Array.from({ length: container.size }, (_unused, index) => container.getItem(index)).filter(Boolean);
    };

    // A real bundle on a button keeps what it holds for the tooltip, every item of it marked: what a
    // player takes out of it in the slot is a copy.
    {
        const real = bundleOf(new ItemStack("minecraft:diamond", 3), new ItemStack("minecraft:golden_apple", 8), bundleOf(new ItemStack("minecraft:emerald", 5)));
        const view = fromItemStack(real);
        const button = toItemStack({ ...view, name: "Lot" }, { isUiOwned: true });
        check("a bundle on a button keeps what it holds", JSON.stringify(contentsOf(button)) === JSON.stringify(["minecraft:diamond", "minecraft:golden_apple", "minecraft:bundle", null]), JSON.stringify(contentsOf(button)));
        check("every item in it is marked", storedIn(button).every(isRenderedItem));
        check("a stackable one through its lore", isRenderedItem(storedIn(button)[1]) && storedIn(button)[1].getLore().length > 0);
        check("and so is what a bundle inside it holds", storedIn(storedIn(button)[2]).every(isRenderedItem));
        check("the real bundle is left as it was", storedIn(real).every((stored) => !isRenderedItem(stored)));
        const stored = toStorageStack(view);
        check("the same bundle written to storage is not marked", storedIn(stored).length === 3 && storedIn(stored).every((item) => !isRenderedItem(item)));
    }

    /** A bundle button as the menu writes it, with an item of the player's own put in it. */
    const buttonWithOwnItem = () => {
        const button = toItemStack(fromItemStack(bundleOf(new ItemStack("minecraft:diamond", 3))), { isUiOwned: true });
        button.getComponent("minecraft:inventory").container.setItem(1, new ItemStack("minecraft:wind_charge", 4));
        return button;
    };

    // A sweep that removes a bundle copy keeps what the player put in it.
    {
        const { scrubInventoryOf } = await load("platform/items/itemSweeps.js");
        const slots = [buttonWithOwnItem(), null];
        const container = {
            size: slots.length,
            getItem: (index) => slots[index]?.clone(),
            setItem: (index, stack) => {
                slots[index] = stack ?? null;
            },
            addItem: (stack) => {
                const free = slots.indexOf(null);
                if (free === -1) return stack;
                slots[free] = stack;
                return undefined;
            },
        };
        const removed = scrubInventoryOf({ name: "Alex", getComponent: (id) => (id === "minecraft:inventory" ? { container } : undefined) });
        check("a sweep removes a bundle copy", removed === 1 && !slots.some((stack) => stack?.typeId === "minecraft:bundle"), `removed=${removed}`);
        check("and keeps the item the player put in it", slots.some((stack) => stack?.typeId === "minecraft:wind_charge" && stack.amount === 4 && !isRenderedItem(stack)), JSON.stringify(slots.map((stack) => stack?.typeId ?? null)));
        check("but none of the copies it held", !slots.some((stack) => stack?.typeId === "minecraft:diamond"));
    }

    // A loose bundle copy is destroyed, and the player's item in it is left where it lay.
    {
        const spawned = [];
        const lying = itemEntity(buttonWithOwnItem());
        lying.location = { x: 4, y: 64, z: 4 };
        lying.dimension = { spawnItem: (stack, location) => spawned.push({ stack, location }) };
        world.afterEvents.entitySpawn.emit({ entity: lying });
        check("a loose bundle copy is destroyed", lying.removed === true);
        check("and the player's item in it is left on the ground", spawned.length === 1 && spawned[0].stack.typeId === "minecraft:wind_charge" && !isRenderedItem(spawned[0].stack), JSON.stringify(spawned.map((entry) => entry.stack.typeId)));
        check("where the copy lay", spawned[0]?.location === lying.location);
    }

    // A bundle copy swept from a full inventory: what the player put in it and does not fit drops at their feet.
    {
        const { scrubInventoryOf } = await load("platform/items/itemSweeps.js");
        const button = buttonWithOwnItem();
        button.getComponent("minecraft:inventory").container.setItem(2, new ItemStack("minecraft:arrow", 16));
        const slots = [button];
        const container = {
            size: slots.length,
            getItem: (index) => slots[index]?.clone(),
            setItem: (index, stack) => {
                slots[index] = stack ?? null;
            },
            addItem: (stack) => {
                const free = slots.indexOf(null);
                if (free === -1) return stack;
                slots[free] = stack;
                return undefined;
            },
        };
        const dropped = [];
        const player = {
            name: "Alex",
            location: { x: 3, y: 64, z: 3 },
            dimension: { spawnItem: (stack, location) => dropped.push({ stack, location }) },
            getComponent: (id) => (id === "minecraft:inventory" ? { container } : undefined),
        };
        scrubInventoryOf(player);
        const kept = [...slots.filter(Boolean).map((stack) => stack.typeId), ...dropped.map(({ stack }) => stack.typeId)].sort();
        check("own items that do not fit back are not lost", JSON.stringify(kept) === JSON.stringify(["minecraft:arrow", "minecraft:wind_charge"]), JSON.stringify(kept));
        check("the one that did not fit drops at the player's feet", dropped.length === 1 && dropped[0].location === player.location, JSON.stringify(dropped.map(({ stack }) => stack.typeId)));
    }

    // A thrown bundle that cannot be removed: the clean copy goes back, so two never lie there.
    {
        const clean = [];
        const thrown = itemEntity(bundleOf(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }), new ItemStack("minecraft:diamond", 3)));
        thrown.location = { x: 1, y: 64, z: 2 };
        thrown.dimension = {
            spawnItem: (stack) => {
                const copy = { stack, isValid: true, remove: () => (copy.isValid = false) };
                clean.push(copy);
                return copy;
            },
        };
        thrown.remove = () => {
            throw new Error("the entity cannot be removed");
        };
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-B" }, items: [thrown] });
        check("a thrown bundle that cannot be removed leaves no second one", clean.length === 1 && clean[0].isValid === false, JSON.stringify(clean.map((copy) => copy.isValid)));
    }
};
