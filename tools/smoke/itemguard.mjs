/**
 * Checks the anti-dupe rules of the built platform modules against a stub engine: a rendered item
 * is marked and destroyed once it reaches the world, a real item is never marked or touched.
 */

import { runSuite } from "./harness.mjs";

await runSuite({ label: "anti-dupe", passed: "anti-dupe smoke ok", crashed: "anti-dupe smoke failed", engine: "itemguard.js" }, async ({ check, load, loadEngine }) => {
    const { ItemStack, world } = await loadEngine();
    const { fromItemStack, isRenderedItem, toItemStack, toStorageStack } = await load("platform/items/itemConversion.js");
    const { getItemGuardStats, installItemGuard, setItemGuardLogger, onMarkedItemDestroyed } = await load("platform/items/itemGuard.js");
    const { UI_ITEM_MARKER_PROPERTY, LEGACY_UI_ITEM_MARKER, ITEM_ENTITY_TYPE_ID } = await load("platform/constants.js");

    // Pinned to the documented literal, not to the library's constant: a check that imports the
    // value it checks cannot catch a wrong one.
    check(
        "the guard filters on the vanilla loose-item entity",
        ITEM_ENTITY_TYPE_ID === "minecraft:item",
        `ITEM_ENTITY_TYPE_ID=${ITEM_ENTITY_TYPE_ID}`,
    );

    /** A loose item entity carrying `stack`. It carries the library's type id, so a wrong constant fails the checks below. */
    const itemEntity = (stack, typeId = ITEM_ENTITY_TYPE_ID) => ({
        typeId,
        isValid: true,
        removed: false,
        getComponent(id) {
            return id === "minecraft:item" ? { itemStack: stack } : undefined;
        },
        remove() {
            this.removed = true;
            this.isValid = false;
        },
    });

    console.log("\n  anti-dupe\n");

    // A rendered item is marked, and nothing about it is altered visually.
    const button = toItemStack({ typeId: "minecraft:diamond", name: "Buy" });
    check("conjured item carries the marker", button.getDynamicProperty(UI_ITEM_MARKER_PROPERTY) === true);
    check("conjured item is recognised as rendered", isRenderedItem(button));
    check("the marker adds no lore", button.getLore().length === 0, JSON.stringify(button.getLore()));

    // An item given only a typeId comes out as the vanilla item.
    {
        const plain = toItemStack({ typeId: "minecraft:diamond" });
        check("a bare typeId sets no name", plain.nameTag === undefined, String(plain.nameTag));
        check("a bare typeId sets no lore", plain.getLore().length === 0, JSON.stringify(plain.getLore()));
        check("a bare typeId is still marked", isRenderedItem(plain));

        const named = toItemStack({ typeId: "minecraft:diamond", name: "Buy", lore: ["line"] });
        check("declared name and lore still land", named.nameTag === "Buy" && named.getLore().length === 1);
    }

    // Invisible per-item metadata round-trips.
    {
        const listed = toStorageStack({
            typeId: "minecraft:diamond_sword",
            tags: { "containerui:seller": "Steve", "containerui:price": 250 },
        });
        check("tags are written as dynamic properties", listed.getDynamicProperty("containerui:seller") === "Steve");
        check("tags do not become lore", listed.getLore().length === 0, JSON.stringify(listed.getLore()));

        const back = fromItemStack(listed);
        check("tags survive the round trip", back.tags?.["containerui:price"] === 250, JSON.stringify(back.tags));
        check("a stored item stays unmarked", !isRenderedItem(listed));
        check("a stored item keeps its native payload", back.native !== undefined);
    }

    // A real item stays takeable.
    const realSword = new ItemStack("minecraft:diamond_sword", 1);
    const mirrored = toItemStack({ typeId: "minecraft:diamond_sword", amount: 1, native: realSword });
    check("native-backed item is NOT marked", !isRenderedItem(mirrored));

    const stored = toStorageStack({ typeId: "minecraft:emerald", amount: 3 });
    check("storage stack is never marked", !isRenderedItem(stored));

    // Items marked by lore alone (the lore marker) must still be recognised.
    const legacy = new ItemStack("minecraft:stone", 1);
    legacy.setLore([`${LEGACY_UI_ITEM_MARKER}§a§f`]);
    check("the legacy lore marker is still detected", isRenderedItem(legacy));
    const trailing = new ItemStack("minecraft:stone", 1);
    trailing.setLore([`§7Price 5${LEGACY_UI_ITEM_MARKER}`]);
    check("and still detected after other text on its line", isRenderedItem(trailing));

    const ordinary = new ItemStack("minecraft:stone", 1);
    ordinary.setLore(["A normal lore line", "Another"]);
    check("ordinary item is not mistaken for a rendered one", !isRenderedItem(ordinary));

    // Round trip: marker out, user lore intact.
    const decorated = toItemStack({ typeId: "minecraft:paper", lore: ["Line one"] });
    const view = fromItemStack(decorated);
    check("round trip exposes no marker in lore", !(view.lore ?? []).some((line) => line.includes(LEGACY_UI_ITEM_MARKER)));
    check("round trip exposes no marker in tags", view.tags?.[UI_ITEM_MARKER_PROPERTY] === undefined, JSON.stringify(view.tags));
    check("round trip keeps user lore", (view.lore ?? []).includes("Line one"));
    check("marked item does not carry a native payload", view.native === undefined);

    // A stackable item keeps its marker in lore, on the last line: that line may have been empty.
    for (const lore of [["§7Price 5", ""], ["§7Price 5"], []]) {
        const back = fromItemStack(toItemStack({ typeId: "minecraft:golden_apple", amount: 8, lore }));
        check(
            `a stackable item's lore reads back as written: ${JSON.stringify(lore)}`,
            JSON.stringify(back.lore ?? []) === JSON.stringify(lore),
            JSON.stringify(back.lore),
        );
    }

    // The world guard.
    const reported = [];
    setItemGuardLogger((detail) => reported.push(detail));
    installItemGuard();
    installItemGuard();
    check("guard subscribed exactly once to drops", world.afterEvents.entityItemDrop.handlers.length === 1);
    check("guard subscribed exactly once to spawns", world.afterEvents.entitySpawn.handlers.length === 1);

    const droppedButton = itemEntity(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }));
    world.afterEvents.entityItemDrop.emit({ entity: {}, items: [droppedButton] });
    check("a dropped UI item is destroyed", droppedButton.removed === true);

    const droppedReal = itemEntity(new ItemStack("minecraft:diamond", 1));
    world.afterEvents.entityItemDrop.emit({ entity: {}, items: [droppedReal] });
    check("a dropped real item is left alone", droppedReal.removed === false);

    // Death drops and spilled containers never raise entityItemDrop.
    const spawnedButton = itemEntity(toItemStack({ typeId: "minecraft:emerald" }));
    world.afterEvents.entitySpawn.emit({ entity: spawnedButton, cause: "Spawned" });
    check("a UI item spawned by any means is destroyed", spawnedButton.removed === true);

    const mob = itemEntity(toItemStack({ typeId: "minecraft:emerald" }), "minecraft:zombie");
    world.afterEvents.entitySpawn.emit({ entity: mob, cause: "Spawned" });
    check("a non-item entity is ignored", mob.removed === false);

    // entitySpawn fires for everything, so a non-item entity must cost no inspection.
    const inspectedBefore = getItemGuardStats().inspected;
    world.afterEvents.entitySpawn.emit({ entity: mob, cause: "Spawned" });
    check("non-item entities cost no inspection", getItemGuardStats().inspected === inspectedBefore);

    // A drop is routed to the player who threw it.
    {
        const claims = [];
        const stop1 = onMarkedItemDestroyed((probe, ownerId) => {
            claims.push(`A:${ownerId}`);
            return ownerId === "player-A";
        });
        const stop2 = onMarkedItemDestroyed((probe, ownerId) => {
            claims.push(`B:${ownerId}`);
            return ownerId === "player-B";
        });

        const thrown = itemEntity(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }));
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-B" }, items: [thrown] });

        check("the thrower's id reaches the listeners", claims.includes("A:player-B"));
        check("only the throwing player's surface claims it", claims[claims.length - 1] === "B:player-B", claims.join(","));
        stop1();
        stop2();
    }

    // A stackable item accepts a dynamic property and keeps nothing, so its marker rides the lore.
    {
        const pane = toItemStack({ typeId: "minecraft:glass_pane", name: " " });
        check("a stackable item is marked despite its dynamic property being dropped", isRenderedItem(pane));
        check("its marker is not the dynamic property", pane.getDynamicProperty(UI_ITEM_MARKER_PROPERTY) === undefined);
        check("a bare stackable item costs exactly one lore line", pane.getLore().length === 1, JSON.stringify(pane.getLore()));

        // The marker rides the last existing line, so an item with lore gains no row.
        const listing = toItemStack({ typeId: "minecraft:golden_apple", amount: 8, lore: ["§7Цена: §e40", "§7Продавец: §fSteve"] });
        check("a decorated stackable item is marked", isRenderedItem(listing));
        check("marking adds no row to an item that has lore", listing.getLore().length === 2, JSON.stringify(listing.getLore()));

        const restored = fromItemStack(listing);
        check("user lore round-trips without the marker", JSON.stringify(restored.lore) === JSON.stringify(["§7Цена: §e40", "§7Продавец: §fSteve"]), JSON.stringify(restored.lore));
        check("a marked stackable item carries no native payload", restored.native === undefined);

        const bare = fromItemStack(toItemStack({ typeId: "minecraft:glass_pane" }));
        check("a bare stackable item round-trips with no lore", bare.lore === undefined, JSON.stringify(bare.lore));

        // Tags have no lore fallback: moving them to lore would make them visible and copyable.
        const taggedStackable = toItemStack({ typeId: "minecraft:golden_apple", amount: 4, tags: { "shop:lot": "A7" } });
        check("tags do not survive on a stackable item", fromItemStack(taggedStackable).tags === undefined);
        check("losing tags does not cost the marker", isRenderedItem(taggedStackable));

        const taggedUnique = toItemStack({ typeId: "minecraft:diamond_sword", tags: { "shop:lot": "A7" } });
        check("tags survive on a non-stackable item", fromItemStack(taggedUnique).tags?.["shop:lot"] === "A7");

        const thrownPane = itemEntity(toItemStack({ typeId: "minecraft:glass_pane", name: " " }));
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-D" }, items: [thrownPane] });
        check("a thrown stackable UI item is destroyed", thrownPane.removed === true);
    }

    // A drop event whose `items` is not an array must not break the handler.
    {
        const before = getItemGuardStats();
        const reportsBefore = reported.length;

        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-C" }, items: undefined });
        check("an unreadable items field does not throw out of the handler", true);
        check("nothing is inspected when items cannot be read", getItemGuardStats().inspected === before.inspected);
        check("an unreadable items field is reported, not swallowed", reported.length > reportsBefore, reported.slice(reportsBefore).join(","));

        const iterableDrop = itemEntity(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }));
        world.afterEvents.entityItemDrop.emit({
            entity: { id: "player-C" },
            items: new Set([iterableDrop]),
        });
        check("a non-array iterable is still swept", iterableDrop.removed === true);

        const stop = onMarkedItemDestroyed(() => {
            throw new Error("listener exploded");
        });
        const afterThrow = itemEntity(toItemStack({ typeId: "minecraft:diamond", name: "Buy" }));
        world.afterEvents.entityItemDrop.emit({ entity: { id: "player-C" }, items: [afterThrow] });
        check("a throwing listener does not stop the destruction", afterThrow.removed === true);
        stop();
    }

    // A player who quit mid-menu is swept when they join again.
    {
        const slots = [toItemStack({ typeId: "minecraft:diamond", name: "Buy" }), new ItemStack("minecraft:dirt", 5), null];
        // A kit button equipped as the menu closed, beside real armour.
        const equipment = { Offhand: toItemStack({ typeId: "minecraft:shield", name: "Kit" }), Head: new ItemStack("minecraft:iron_helmet") };
        const player = {
            name: "Steve",
            getComponent: (id) => {
                if (id === "minecraft:equippable") {
                    return {
                        getEquipment: (slot) => equipment[slot],
                        setEquipment: (slot, stack) => {
                            equipment[slot] = stack;
                            return true;
                        },
                    };
                }
                if (id !== "minecraft:inventory") return undefined;
                return {
                    container: {
                        size: slots.length,
                        getItem: (index) => slots[index] ?? undefined,
                        setItem: (index, stack) => {
                            slots[index] = stack ?? null;
                        },
                    },
                };
            },
        };

        world.afterEvents.playerSpawn.emit({ player, initialSpawn: true });
        check("a leaked copy is swept on join", slots[0] === null, JSON.stringify(slots[0]));
        check("the player's own items survive the sweep", slots[1]?.typeId === "minecraft:dirt");
        check("a leaked copy in the off hand is swept too", equipment.Offhand === undefined, JSON.stringify(equipment.Offhand));
        check("worn armour of the player's own survives", equipment.Head?.typeId === "minecraft:iron_helmet");

        const survivor = toItemStack({ typeId: "minecraft:emerald" });
        slots[2] = survivor;
        world.afterEvents.playerSpawn.emit({ player, initialSpawn: false });
        check("a respawn does not sweep", slots[2] === survivor);
    }

    // A real item bound for a UI slot is marked; bound for an input it is not.
    {
        const view = fromItemStack(new ItemStack("minecraft:diamond_sword"));
        check("a real item written to a UI slot is marked", isRenderedItem(toItemStack(view, { isUiOwned: true })));
        check("the same item written to an input is not", !isRenderedItem(toItemStack(view)));

        const lot = new ItemStack("minecraft:golden_apple", 8);
        lot.setLore(["§7Lot 12"]);
        const shown = toItemStack(fromItemStack(lot), { isUiOwned: true });
        check("a stackable real item falls back to the lore marker", isRenderedItem(shown));
        check("and gains no line of its own", shown.getLore().length === 1, JSON.stringify(shown.getLore()));
    }

    // A copy that escapes still cannot be used: used on a block and mined back it would become
    // real, and a pearl is spent the moment it is thrown.
    {
        const use = (stack) => {
            const event = { itemStack: stack, source: { id: "player-A" }, cancel: false };
            world.beforeEvents.itemUse.emit(event);
            return event.cancel;
        };
        check("using a marked copy is refused", use(toItemStack({ typeId: "minecraft:ender_pearl", name: "Warp" })) === true);
        check("using a real item is not", use(new ItemStack("minecraft:ender_pearl")) === false);

        const onBlock = { itemStack: toItemStack({ typeId: "minecraft:diamond_block", name: "Buy" }), player: {}, isFirstEvent: true, cancel: false };
        world.beforeEvents.playerInteractWithBlock.emit(onBlock);
        check("using a marked copy on a block is refused", onBlock.cancel === true);
        const heldDown = { ...onBlock, isFirstEvent: false, cancel: false };
        world.beforeEvents.playerInteractWithBlock.emit(heldDown);
        check("a held interaction is refused without another report", heldDown.cancel === true);

        const onEntity = { itemStack: toItemStack({ typeId: "minecraft:name_tag", name: "Rename" }), player: {}, target: {}, cancel: false };
        world.beforeEvents.playerInteractWithEntity.emit(onEntity);
        check("using a marked copy on an entity is refused", onEntity.cancel === true);
    }

    // Opening a chest sweeps the opener first, before a copy can be moved into it.
    {
        const slots = [toItemStack({ typeId: "minecraft:diamond", name: "Buy" }), new ItemStack("minecraft:cobblestone", 12)];
        const opener = {
            typeId: "minecraft:player",
            getComponent: (id) =>
                id === "minecraft:inventory"
                    ? {
                          container: {
                              size: slots.length,
                              getItem: (index) => slots[index] ?? undefined,
                              setItem: (index, stack) => {
                                  slots[index] = stack ?? null;
                              },
                          },
                      }
                    : undefined,
        };
        world.afterEvents.blockContainerOpened.emit({ block: {}, dimension: {}, openSource: { entity: opener } });
        check("a copy is swept the moment a chest opens", slots[0] === null, JSON.stringify(slots[0]));
        check("the opener's own items stay", slots[1]?.typeId === "minecraft:cobblestone");

        let isMinecartSwept = false;
        const hopperMinecart = {
            typeId: "minecraft:hopper_minecart",
            getComponent: () => {
                isMinecartSwept = true;
                return undefined;
            },
        };
        world.afterEvents.blockContainerOpened.emit({ block: {}, dimension: {}, openSource: { entity: hopperMinecart } });
        check("a non-player opener is not swept", !isMinecartSwept);
    }

    // The container itself is swept too: a chest, a chest minecart, but never a menu.
    {
        /** A container over `slots`, counting full reads so an empty one can prove it was skipped. */
        const containerOf = (slots) => {
            const container = {
                reads: 0,
                size: slots.length,
                get emptySlotsCount() {
                    return slots.filter((slot) => !slot).length;
                },
                getItem: (index) => {
                    container.reads++;
                    return slots[index] ?? undefined;
                },
                setItem: (index, stack) => {
                    slots[index] = stack ?? null;
                },
            };
            return container;
        };
        const opener = { id: "player-chest", typeId: "minecraft:player", getComponent: () => undefined };
        const announced = [];
        const stopListening = onMarkedItemDestroyed((probe, ownerId) => {
            announced.push(`${probe.typeId}:${ownerId}`);
            return false;
        });
        const copy = () => toItemStack({ typeId: "minecraft:diamond", name: "Buy" });

        const chestSlots = [copy(), new ItemStack("minecraft:cobblestone", 12)];
        const chest = { getComponent: (id) => (id === "minecraft:inventory" ? { container: containerOf(chestSlots) } : undefined) };
        world.afterEvents.blockContainerOpened.emit({ block: chest, dimension: {}, openSource: { entity: opener } });
        check("a copy already in a chest is swept when it opens", chestSlots[0] === null && chestSlots[1]?.typeId === "minecraft:cobblestone", JSON.stringify(chestSlots));
        check("and announced as the opener's", announced.includes("minecraft:diamond:player-chest"), announced.join(","));

        chestSlots[0] = copy(); // put in while it was open
        world.afterEvents.blockContainerClosed.emit({ block: chest, dimension: {}, closeSource: { entity: opener } });
        check("a copy put in while it was open is swept when it closes", chestSlots[0] === null, JSON.stringify(chestSlots));

        const cartSlots = [null, copy()];
        const cart = { id: "cart", typeId: "minecraft:chest_minecart", isValid: true, getComponent: (id) => (id === "minecraft:inventory" ? { container: containerOf(cartSlots) } : undefined) };
        world.afterEvents.entityContainerOpened.emit({ entity: cart, openSource: { entity: opener } });
        check("an entity's container is swept too", cartSlots[1] === null, JSON.stringify(cartSlots));

        const menuSlots = [copy(), copy()];
        const menu = { id: "menu", typeId: "containerui:rideable_entity", isValid: true, getComponent: (id) => (id === "minecraft:inventory" ? { container: containerOf(menuSlots) } : undefined) };
        world.afterEvents.entityContainerOpened.emit({ entity: menu, openSource: { entity: opener } });
        world.afterEvents.entityContainerClosed.emit({ entity: menu, closeSource: { entity: opener } });
        check("a menu entity keeps its buttons", menuSlots.every((slot) => slot !== null), JSON.stringify(menuSlots));

        const emptyContainer = containerOf([null, null, null]);
        world.afterEvents.blockContainerOpened.emit({ block: { getComponent: () => ({ container: emptyContainer }) }, dimension: {}, openSource: { entity: opener } });
        check("an empty container is not read slot by slot", emptyContainer.reads === 0, `reads=${emptyContainer.reads}`);
        stopListening();
    }

    // Enchantments and durability: what was asked for, or one warning.
    {
        const { toDisplayView } = await load("core/index.js");
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (message) => warnings.push(String(message));
        try {
            const sword = toItemStack({ typeId: "minecraft:diamond_sword", enchantments: [{ id: "sharpness", level: 5 }], durability: 100 });
            const read = fromItemStack(sword);
            check(
                "a sword gets exactly the enchantment asked for",
                JSON.stringify(read?.enchantments) === JSON.stringify([{ id: "sharpness", level: 5 }]),
                JSON.stringify(read?.enchantments),
            );
            check("and exactly the durability asked for", read?.durability === 100, `durability=${read?.durability}`);
            check("an undamaged sword reads without durability", fromItemStack(new ItemStack("minecraft:diamond_sword"))?.durability === undefined);

            const partly = toItemStack({ typeId: "minecraft:diamond_sword", enchantments: [{ id: "protection", level: 4 }, { id: "unbreaking", level: 3 }] });
            const landed = fromItemStack(partly)?.enchantments ?? [];
            check("a refused enchantment is skipped and the rest still land", landed.length === 1 && landed[0]?.id === "unbreaking", JSON.stringify(landed));
            check("the refusal is reported", warnings.some((line) => line.includes("\"protection\"")), warnings.join(" | "));

            // Twice, to show the warnings are per type rather than per write.
            toItemStack({ typeId: "minecraft:diamond", enchantments: [{ id: "sharpness", level: 1 }], durability: 3 });
            toItemStack({ typeId: "minecraft:diamond", enchantments: [{ id: "sharpness", level: 1 }], durability: 3 });
            const diamondWarnings = warnings.filter((line) => line.includes("\"minecraft:diamond\""));
            check("an item that takes neither warns once for each field, not once per write", diamondWarnings.length === 2, warnings.join(" | "));

            const display = toItemStack(toDisplayView(fromItemStack(sword)), { isUiOwned: true });
            check("a display copy of a real enchanted sword keeps its enchantments", (fromItemStack(display)?.enchantments ?? []).length === 1);
            check("and is marked, like any display copy", isRenderedItem(display));
        } finally {
            console.warn = originalWarn;
        }
    }

    // Six destructions above: the plain drop, the spawn, the routed throw, the thrown pane, the
    // non-array iterable, and the drop whose listener threw. The join sweep counts separately.
    const stats = getItemGuardStats();
    check("stats counted every destruction", stats.destroyed === 6, `destroyed=${stats.destroyed}`);
    check("no removal failures", stats.removalFailed === 0);
    // One report per destruction, the unreadable-items report, the join sweep, the three
    // refused uses (pearl, first block interaction, entity), the opener's chest-open sweep, and
    // the three container sweeps (chest open, chest close, minecart); a menu and an empty
    // container report nothing.
    check("the guard reported each destruction, sweep and refusal", reported.length === 15, `reported=${reported.length}`);

    // A marked item lying in a chunk when it loads was never spawned: entityLoad is the only event it raises.
    {
        check("the guard subscribed exactly once to entity loads", world.afterEvents.entityLoad.handlers.length === 1, String(world.afterEvents.entityLoad.handlers.length));

        const lying = itemEntity(toItemStack({ typeId: "minecraft:emerald", name: "Buy" }));
        world.afterEvents.entityLoad.emit({ entity: lying });
        check("a marked item that loads with its chunk is destroyed", lying.removed === true);

        const legacyStack = new ItemStack("minecraft:stone", 1);
        legacyStack.setLore([`${LEGACY_UI_ITEM_MARKER}§a§f`]);
        const legacyLying = itemEntity(legacyStack);
        world.afterEvents.entityLoad.emit({ entity: legacyLying });
        check("and so is one carrying only the legacy lore marker", legacyLying.removed === true);

        const plainLying = itemEntity(new ItemStack("minecraft:diamond", 1));
        world.afterEvents.entityLoad.emit({ entity: plainLying });
        check("a real item that loads is left alone", plainLying.removed === false);

        const inspectedBeforeLoad = getItemGuardStats().inspected;
        world.afterEvents.entityLoad.emit({ entity: itemEntity(toItemStack({ typeId: "minecraft:emerald" }), "minecraft:cow") });
        check("a non-item entity that loads costs no inspection", getItemGuardStats().inspected === inspectedBeforeLoad);
    }

    // One slot that cannot be read does not hide the copies cleaned before it or found after it.
    {
        const equipment = { Head: toItemStack({ typeId: "minecraft:glass_pane", name: "Hat" }), Offhand: toItemStack({ typeId: "minecraft:shield", name: "Kit" }) };
        const player = {
            name: "Alex",
            getComponent: (id) =>
                id === "minecraft:equippable"
                    ? {
                          getEquipment: (slot) => {
                              if (slot === "Legs") throw new Error("slot unreadable");
                              return equipment[slot];
                          },
                          setEquipment: (slot, stack) => {
                              equipment[slot] = stack;
                          },
                      }
                    : undefined,
        };
        const { scrubInventoryOf } = await load("platform/items/itemGuard.js");
        const removed = scrubInventoryOf(player);
        check("the copies cleaned around an unreadable slot are counted", removed === 2, `removed=${removed}`);
        check("a copy after the unreadable slot is still swept", equipment.Offhand === undefined, JSON.stringify(equipment.Offhand));
    }

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

    // Uninstalling takes the new subscription away with the others.
    {
        const { uninstallBedrockRuntime } = await load("platform/lifecycle.js");
        uninstallBedrockRuntime();
        check("uninstalling unsubscribes from entity loads", world.afterEvents.entityLoad.handlers.length === 0, String(world.afterEvents.entityLoad.handlers.length));
    }
});
