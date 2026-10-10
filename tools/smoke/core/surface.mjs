/** Block storage views, and a Bedrock surface: closing, take-backs, scan passes and idle pacing. */

import { storageEntity } from "./fixtures.mjs";

/** A container like the engine's: copies on read, and live slot handles that count their fetches. */
const makeContainer = (size) => {
    const slots = new Array(size).fill(undefined);
    // `typeId` and the rest throw on an empty slot, as the @minecraft/server API documents.
    const present = (index) => {
        const stack = slots[index];
        if (!stack) throw new Error("InvalidContainerSlotError");
        return stack;
    };
    const container = {
        slots,
        size,
        isValid: true,
        /** Slot handles fetched, to show they are kept across passes. */
        getSlotCalls: 0,
        getItem: (index) => slots[index]?.clone(),
        setItem: (index, stack) => {
            slots[index] = stack?.clone();
        },
        addItem: (stack) => {
            const free = slots.findIndex((slot) => !slot);
            if (free === -1) return stack;
            slots[free] = stack.clone();
            return undefined;
        },
        clearAll: () => slots.fill(undefined),
        getSlot: (index) => {
            container.getSlotCalls++;
            return {
                get isValid() {
                    return container.isValid;
                },
                hasItem: () => slots[index] !== undefined,
                get typeId() {
                    return present(index).typeId;
                },
                get amount() {
                    return present(index).amount;
                },
                get nameTag() {
                    return present(index).nameTag;
                },
            };
        },
    };
    return container;
};

export const checkSurface = async ({ check, load, loadEngine, core, freshRuntime }) => {
    const { h, mount, createTestHost, createMemoryStorage, signal, StorageSlots } = core;

    console.log("\n  BlockStorage views\n");
    {
        freshRuntime();
        const { ItemStack } = await loadEngine();
        const { BlockStorage } = await load("platform/block/blockStorage.js");
        const { fromItemStack, isRenderedItem } = await load("platform/items/itemConversion.js");

        const entity = storageEntity(ItemStack, 9);
        const enchanted = new ItemStack("minecraft:diamond_sword");
        enchanted.enchantment = "sharpness-5";
        entity.slots[0] = enchanted;
        const storage = BlockStorage.forEntity(entity);

        const first = storage.get(0);
        check("an unchanged slot reads as the same view", first !== null && storage.get(0) === first);

        const edit = fromItemStack(new ItemStack("minecraft:iron_sword"));
        storage.set(1, edit);
        check("a real item written by a mirror becomes the cached view", storage.get(1) === edit);

        storage.set(2, { typeId: "minecraft:diamond" });
        const described = storage.get(2);
        check(
            "a described item reads back as the real, unmarked item it became",
            described?.native instanceof ItemStack && !isRenderedItem(described.native),
        );

        storage.notifyExternalChange();
        const reread = storage.get(0);
        check("an external change drops the cache", reread !== first && reread?.native?.enchantment === "sharpness-5");

        // Two viewers over the platform storage, as a block container has them.
        const { clock } = freshRuntime();
        const viewer1 = createTestHost({ slotCount: 9 });
        const viewer2 = createTestHost({ slotCount: 9 });
        mount(h(StorageSlots, { storage }), viewer1);
        mount(h(StorageSlots, { storage }), viewer2);

        const plain = fromItemStack(new ItemStack("minecraft:diamond_sword"));
        viewer2.simulateSwap(0, plain);
        clock.runPending();
        check(
            "a swap by one viewer repaints the other with the stored item",
            viewer1.readSlot(0)?.native === storage.get(0)?.native && viewer1.readSlot(0)?.native?.enchantment === undefined,
        );

        viewer1.clearHistory();
        viewer1.simulatePlace(4, fromItemStack(new ItemStack("minecraft:gold_ingot", 3)));
        clock.runPending();
        check("a player's own deposit costs that viewer no repaint", viewer1.writes.length === 0, `writes=${viewer1.writes.length}`);
        check("and reaches the entity's inventory", entity.slots[4]?.typeId === "minecraft:gold_ingot");
    }

    console.log("\n  closing a surface\n");
    {
        freshRuntime();
        const { ItemStack } = await loadEngine();
        const { BedrockSurface } = await load("platform/surface/surface.js");
        const { fromItemStack, isRenderedItem } = await load("platform/items/itemConversion.js");

        const surfaceInventory = makeContainer(27);
        const playerInventory = makeContainer(36);
        const cursor = {
            item: undefined,
            clear() {
                this.item = undefined;
            },
        };
        const dimension = { id: "overworld", spawnItem: () => undefined };
        const surfaceEntity = {
            id: "surface-1",
            isValid: true,
            location: { x: 0, y: 64, z: 0 },
            nameTag: "",
            dimension,
            triggerEvent: () => undefined,
            getComponent: (id) => {
                if (id === "minecraft:inventory") return { container: surfaceInventory };
                if (id === "minecraft:rideable") return { addRider: () => true };
                return undefined;
            },
            remove() {
                this.isValid = false;
            },
        };
        dimension.spawnEntity = () => surfaceEntity;
        const player = {
            id: "player-1",
            name: "Steve",
            isValid: true,
            location: { x: 0, y: 64, z: 0 },
            dimension,
            playSound: () => undefined,
            getComponent: (id) => {
                if (id === "minecraft:inventory") return { container: playerInventory };
                if (id === "minecraft:cursor_inventory") return cursor;
                return undefined;
            },
        };

        const storage = createMemoryStorage(3, [fromItemStack(new ItemStack("minecraft:diamond")), fromItemStack(new ItemStack("minecraft:iron_ingot"))]);
        const traces = [];
        const surface = new BedrockSurface(player, { size: 27, onTrace: (line) => traces.push(line) });
        surface.open();
        const offered = signal(null);
        mount(
            () => [
                h("input", { index: 0 }),
                h("input", { index: 1, item: () => offered.value, onChange: (vigenersl) => (offered.value = vigenersl.next) }),
                h(StorageSlots, { storage, index: 9 }),
                h("slot", { index: 18, item: { typeId: "minecraft:paper", name: "Info" } }),
                h("slot", { index: 19, item: () => storage.get(1) }),
            ],
            surface,
        );
        surface.activate();

        check("a real item shown in a UI slot is written marked", isRenderedItem(surfaceInventory.slots[19]));
        check(
            "the same kind of real item in a mirrored input is not",
            surfaceInventory.slots[10] !== undefined && !isRenderedItem(surfaceInventory.slots[10]),
        );

        // Three edits in the tick the screen closes, none of them seen by a scan.
        surfaceInventory.slots[0] = new ItemStack("minecraft:emerald", 3); // a deposit
        surfaceInventory.slots[1] = new ItemStack("minecraft:gold_nugget", 5); // into an input a signal controls
        surfaceInventory.slots[9] = undefined; // the diamond taken out of the chest
        cursor.item = surfaceInventory.slots[18]; // the paper button, lifted…
        surfaceInventory.slots[18] = new ItemStack("minecraft:gold_ingot", 2); // …by swapping real gold onto it
        surface.close("player");

        const held = playerInventory.slots.filter(Boolean).map((stack) => `${stack.typeId}x${stack.amount}`);
        check("an unseen take from a mirrored slot reaches the storage", storage.get(0) === null, JSON.stringify(storage.get(0)));
        check("a deposit left in an input comes back", held.includes("minecraft:emeraldx3"), held.join(","));
        check("a real item left in a UI slot comes back", held.includes("minecraft:gold_ingotx2"), held.join(","));
        check("a real item in a controlled input that mirrors nothing comes back", held.includes("minecraft:gold_nuggetx5"), held.join(","));
        check("a mirrored copy is not handed out", !held.some((entry) => entry.startsWith("minecraft:iron_ingot")), held.join(","));
        check("nothing marked reaches the player", playerInventory.slots.filter(Boolean).every((stack) => !isRenderedItem(stack)));
        check("a marked copy on the cursor is discarded", cursor.item === undefined);
        check("the surface is emptied before it goes", surfaceInventory.slots.every((slot) => !slot));
        check("each hand-back is traced", traces.filter((line) => line.startsWith("close-returned")).length === 3, traces.join(","));

        // A refused take is won back from the viewer, cursor first; a refused item is handed over.
        {
            const revokeTraces = [];
            const viewerSurface = new BedrockSurface(player, { size: 27, onTrace: (line) => revokeTraces.push(line) });
            playerInventory.slots.fill(undefined);
            cursor.item = new ItemStack("minecraft:diamond", 2);
            playerInventory.slots[4] = new ItemStack("minecraft:diamond", 5);
            viewerSurface.takeBackFromViewer({ typeId: "minecraft:diamond", amount: 3 });
            check("a refused take is taken from the cursor first", cursor.item === undefined, JSON.stringify(cursor.item));
            check("and the rest from the inventory", playerInventory.slots[4]?.amount === 4, `amount=${playerInventory.slots[4]?.amount}`);
            check("in one traced step", revokeTraces.includes("conflict-taken-back item=minecraft:diamond amount=3"), revokeTraces.join(","));

            const own = new ItemStack("minecraft:iron_sword");
            own.nameTag = "Mine";
            playerInventory.slots[7] = own;
            viewerSurface.takeBackFromViewer({ typeId: "minecraft:iron_sword", amount: 1 });
            check("a look-alike with another name is never taken", playerInventory.slots[7]?.nameTag === "Mine", JSON.stringify(playerInventory.slots[7]));

            viewerSurface.giveToViewer({ typeId: "minecraft:emerald", amount: 2, native: new ItemStack("minecraft:emerald", 2) });
            const emeralds = playerInventory.slots.filter((stack) => stack?.typeId === "minecraft:emerald");
            check("a refused item is handed to the viewer", emeralds.length === 1 && emeralds[0].amount === 2, JSON.stringify(emeralds));

            viewerSurface.close("programmatic");
            check("what is never found is reported as the surface closes", revokeTraces.some((line) => line.startsWith("conflict-unresolved item=minecraft:iron_sword missing=1")), revokeTraces.join(","));
        }

        /** A menu entity and a viewer over fresh containers, reusing the entity and player above. */
        const menuWorld = ({ entityId, playerId }) => {
            const menu = makeContainer(27);
            const pocket = makeContainer(36);
            const entity = {
                ...surfaceEntity,
                id: entityId,
                isValid: true,
                getComponent: (id) => {
                    if (id === "minecraft:inventory") return { container: menu };
                    if (id === "minecraft:rideable") return { addRider: () => true };
                    return undefined;
                },
            };
            dimension.spawnEntity = () => entity;
            const viewer = {
                ...player,
                id: playerId,
                getComponent: (id) => {
                    if (id === "minecraft:inventory") return { container: pocket };
                    if (id === "minecraft:cursor_inventory") return { item: undefined, clear: () => undefined };
                    return undefined;
                },
            };
            return { menu, pocket, viewer };
        };

        /** Opens a surface with one "Buy" button in slot 4, and returns the surface. */
        const openBuyMenu = ({ viewer, onClick }) => {
            const opened = new BedrockSurface(viewer, { size: 27 });
            opened.open();
            mount(() => [h("slot", { index: 4, item: { typeId: "minecraft:emerald", name: "Buy" }, onClick })], opened);
            return opened;
        };

        // With a full inventory, an item handed back at close lands at the player's feet.
        {
            freshRuntime();
            const { menu, pocket, viewer } = menuWorld({ entityId: "surface-full", playerId: "player-full" });
            pocket.slots.fill(new ItemStack("minecraft:dirt", 64));
            const dropped = [];
            viewer.dimension = { ...viewer.dimension, spawnItem: (stack) => dropped.push(stack.typeId) };
            const closeTraces = [];
            const full = new BedrockSurface(viewer, { size: 27, onTrace: (line) => closeTraces.push(line) });
            full.open();
            mount(() => [h("input", { index: 0 })], full);
            full.activate();
            menu.slots[0] = new ItemStack("minecraft:torch", 2);
            full.close("player");
            check(
                "an item handed back to a full inventory is logged as dropped on the ground",
                dropped.includes("minecraft:torch") && closeTraces.includes("close-returned slot=0 item=minecraft:torch to=ground"),
                closeTraces.join(","),
            );
        }

        // A real item shown under another name: the scan must not read the rename as a gesture.
        {
            const { __intervals } = await loadEngine();
            freshRuntime();
            const { menu, viewer } = menuWorld({ entityId: "surface-renamed", playerId: "player-renamed" });
            const { fromItemStack } = await load("platform/items/itemConversion.js");

            let clicks = 0;
            const renamed = new BedrockSurface(viewer, { size: 27 });
            renamed.open();
            const back = { ...fromItemStack(new ItemStack("minecraft:arrow", 3)), name: "§7Назад" };
            mount(() => [h("slot", { index: 4, item: back, onClick: () => clicks++ })], renamed);
            const beforeActivate = __intervals.length;
            renamed.activate();
            const scanRenamed = __intervals[beforeActivate];
            scanRenamed();
            scanRenamed();
            check(
                "a renamed real item is written with its name and fires nothing",
                clicks === 0 && menu.slots[4]?.nameTag === "§7Назад",
                `clicks=${clicks} name=${menu.slots[4]?.nameTag}`,
            );
            renamed.close("programmatic");
        }

        // The stub keeps `runInterval` callbacks, so the scan pass is driven here by hand.
        console.log("\n  scan pass on a surface\n");
        {
            const { __intervals } = await loadEngine();
            const { clock } = freshRuntime();
            const { menu, pocket, viewer } = menuWorld({ entityId: "surface-2", playerId: "player-2" });

            let clicks = 0;
            const scanned = openBuyMenu({
                viewer,
                onClick: () => {
                    clicks++;
                },
            });
            const firstInterval = __intervals.length;
            scanned.activate();
            // `activate` starts the scan first and the watchdog second.
            const scan = __intervals[firstInterval];
            scan();
            scan();
            check("the menu's slot handles are fetched once, not every pass", menu.getSlotCalls === 27, `getSlot=${menu.getSlotCalls}`);

            pocket.slots[0] = menu.slots[4]; // the button, clicked into the inventory
            menu.slots[4] = undefined;
            scan();
            clock.runPending();
            check("a take read through the handles fires its button", clicks === 1, `clicks=${clicks}`);
            check("its copy is reclaimed from the inventory", pocket.slots[0] === undefined, JSON.stringify(pocket.slots[0]));
            check("and the button is painted back", menu.slots[4]?.typeId === "minecraft:emerald");
            check("the inventory's handles are kept too", pocket.getSlotCalls === 36, `getSlot=${pocket.getSlotCalls}`);

            const cost = scanned.measureScanCost(50);
            check("measuring scan cost runs real passes and returns a time", typeof cost === "number" && cost >= 0, `cost=${cost}`);
            const phases = scanned.measureScanPhases(20);
            check(
                "measuring scan phases times the setup, the probes and whole passes",
                phases !== null && [phases.setupMs, phases.probesMs, phases.passesMs].every((ms) => typeof ms === "number" && ms >= 0),
                JSON.stringify(phases),
            );
            check("and fires nothing on an idle menu", clicks === 1, `clicks=${clicks}`);
            menu.slots[4] = undefined; // a gesture in flight…
            scan();
            check("…is not timed", scanned.measureScanCost(50) === null);
            check("…nor split into phases", scanned.measureScanPhases(20) === null);
            scanned.close("programmatic");
        }

        // Every tick while the viewer acts, every other tick once they have not for a second,
        // and straight back to every tick on the first sign of activity.
        console.log("\n  idle scan pacing\n");
        {
            const { __intervals } = await loadEngine();
            const { clock } = freshRuntime();
            const { menu, pocket, viewer } = menuWorld({ entityId: "surface-3", playerId: "player-3" });

            let clicks = 0;
            const paced = openBuyMenu({
                viewer,
                onClick: () => {
                    clicks++;
                },
            });
            const firstInterval = __intervals.length;
            paced.activate();
            const tick = __intervals[firstInterval];

            // One urgent first pass, twenty quiet ones at full pace, then every other tick.
            for (let count = 0; count < 40; count++) tick();
            const quiet = paced.scanStats;
            check("an idle menu skips every other scan tick", quiet.idleSkips === 10 && quiet.passes === 30, `passes=${quiet.passes} skips=${quiet.idleSkips}`);

            pocket.slots[0] = menu.slots[4]; // a click on the idle menu
            menu.slots[4] = undefined;
            tick();
            tick();
            clock.runPending();
            check("a click on an idle menu is still seen within two ticks", clicks === 1, `clicks=${clicks}`);

            const skipsBefore = paced.scanStats.idleSkips;
            for (let count = 0; count < 5; count++) tick();
            check("activity puts the scan back on every tick", paced.scanStats.idleSkips === skipsBefore, `skipped=${paced.scanStats.idleSkips - skipsBefore}`);
            paced.close("programmatic");
        }

        // A handler closes a menu and opens the next: the old menu's delayed sweeps must not eat the
        // new menu's copies, and a click taken in the first ticks is still found.
        console.log("\n  closing a menu and opening the next\n");
        {
            const { __intervals, __timeouts } = await loadEngine();
            const { clock } = freshRuntime();
            const old = menuWorld({ entityId: "surface-old", playerId: "player-next" });
            const oldSurface = openBuyMenu({ viewer: old.viewer, onClick: () => undefined });
            oldSurface.activate();

            const next = menuWorld({ entityId: "surface-new", playerId: "player-next" });
            next.viewer.getComponent = old.viewer.getComponent;
            const timeoutsBefore = __timeouts.length;
            oldSurface.close("programmatic");
            const oldSweeps = __timeouts.slice(timeoutsBefore);
            check("closing schedules the delayed sweeps", oldSweeps.length === 3, `timeouts=${oldSweeps.length}`);

            let clicks = 0;
            const nextSurface = openBuyMenu({
                viewer: next.viewer,
                onClick: () => {
                    clicks++;
                },
            });
            const firstInterval = __intervals.length;
            nextSurface.activate();
            const tick = __intervals[firstInterval];
            tick();

            old.pocket.slots[0] = next.menu.slots[4]; // the new menu's button, tapped into the inventory
            next.menu.slots[4] = undefined;
            for (const sweep of oldSweeps) sweep.callback();
            tick();
            tick();
            clock.runPending();
            check("a click taken as the old menu sweeps still fires", clicks === 1, `clicks=${clicks}`);
            check("and its copy is gone", old.pocket.slots.every((slot) => !slot));
            nextSurface.close("programmatic");
        }
        {
            const { __timeouts } = await loadEngine();
            freshRuntime();
            const lone = menuWorld({ entityId: "surface-lone", playerId: "player-lone" });
            const loneSurface = openBuyMenu({ viewer: lone.viewer, onClick: () => undefined });
            loneSurface.activate();
            const stray = lone.menu.slots[4];
            const timeoutsBefore = __timeouts.length;
            loneSurface.close("programmatic");
            lone.pocket.slots[2] = stray; // a copy that escaped as the menu closed
            for (const sweep of __timeouts.slice(timeoutsBefore)) sweep.callback();
            check("with no newer menu the delayed sweep still removes escaped copies", !lone.pocket.slots[2], JSON.stringify(lone.pocket.slots[2]));
        }

        // A viewer the engine refuses to seat is not scanned.
        {
            const { __intervals } = await loadEngine();
            freshRuntime();
            const { viewer } = menuWorld({ entityId: "surface-unseated", playerId: "player-unseated" });
            const entity = viewer.dimension.spawnEntity();
            const original = entity.getComponent;
            entity.getComponent = (id) => (id === "minecraft:rideable" ? { addRider: () => false } : original(id));
            const errors = [];
            const unseated = new BedrockSurface(viewer, { size: 27, onError: (message) => errors.push(message) });
            unseated.open();
            mount(() => [h("slot", { index: 4, item: { typeId: "minecraft:emerald", name: "Buy" } })], unseated);
            const intervalsBefore = __intervals.length;
            const isActive = unseated.activate();
            check("a refused seat fails the activation", isActive === false);
            check("it reports why", errors.some((message) => message.includes("could not be seated")), errors.join(" | "));
            check("no scan or watchdog is started for it", __intervals.length === intervalsBefore, `started=${__intervals.length - intervalsBefore}`);
            unseated.close("invalidated");
        }

        // A close from a beforeEvents handler: the engine refuses every change, so the hand-back and
        // the removal wait for the next tick instead of failing silently.
        console.log("\n  closing inside the read-only window\n");
        {
            const { __runs } = await loadEngine();
            freshRuntime();
            const { menu, pocket, viewer } = menuWorld({ entityId: "surface-restricted", playerId: "player-restricted" });
            const entity = viewer.dimension.spawnEntity();
            let isRestricted = false;
            const restrict = (owner, name) => {
                const original = owner[name];
                owner[name] = function (...args) {
                    if (isRestricted) throw new Error(`Native function [${name}] does not have required privileges.`);
                    return original.apply(this, args);
                };
            };
            restrict(menu, "setItem");
            restrict(menu, "clearAll");
            restrict(pocket, "setItem");
            restrict(pocket, "addItem");
            restrict(entity, "remove");

            const traces = [];
            const restricted = new BedrockSurface(viewer, { size: 27, onTrace: (line) => traces.push(line) });
            restricted.open();
            mount(() => [h("input", { index: 0 })], restricted);
            restricted.activate();
            menu.slots[0] = new ItemStack("minecraft:torch", 2); // the player's deposit

            isRestricted = true;
            __runs.deferRuns = true;
            try {
                restricted.close("programmatic");
                check("a close inside the read-only window still closes the surface", restricted.isClosed);
                check("it neither removes the entity nor hands anything back yet", entity.isValid && pocket.slots.every((slot) => !slot));
                check("it leaves one clear record", traces.filter((line) => line.startsWith("close-deferred")).length === 1, traces.join(","));
                check("and never reports an item as lost", !traces.some((line) => line.includes("to=lost")), traces.join(","));

                isRestricted = false;
                __runs.deferRuns = false;
                for (const callback of __runs.queue.splice(0)) callback();
            } finally {
                isRestricted = false;
                __runs.deferRuns = false;
                __runs.queue.length = 0;
            }
            check("the deferred settle hands the item back", pocket.slots.some((slot) => slot?.typeId === "minecraft:torch"), JSON.stringify(pocket.slots.filter(Boolean)));
            check("it removes the entity", !entity.isValid);
            check("and empties the surface", menu.slots.every((slot) => !slot));
        }

        // A form's onClose that throws is reported, not left as an unhandled rejection.
        {
            freshRuntime();
            const { ContainerFormData } = await load("platform/surface/openForm.js");
            const { viewer } = menuWorld({ entityId: "surface-form", playerId: "player-form" });
            const records = [];
            let isRejected = false;
            const onRejection = () => {
                isRejected = true;
            };
            core.setLogger((record) => records.push(record));
            process.on("unhandledRejection", onRejection);
            try {
                const session = new ContainerFormData(27)
                    .onClose(() => {
                        throw new Error("form-close-boom");
                    })
                    .open(viewer);
                session.close();
                await new Promise((resolve) => setTimeout(resolve, 0));
                check(
                    "a form onClose that throws is reported through the logger",
                    !isRejected && records.some((record) => record.message.includes("form-close-boom")),
                    `rejected=${isRejected} records=${records.map((record) => record.message).join(" | ")}`,
                );
            } finally {
                process.off("unhandledRejection", onRejection);
                core.setLogger(null);
            }
        }
    }
};
