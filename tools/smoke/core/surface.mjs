/** A Bedrock surface: closing, take-backs, scan passes and idle pacing. */

import { makeContainer } from "./fixtures.mjs";
import { checkReadOnlyClose } from "./surfaceReadOnly.mjs";

export const checkSurface = async ({ check, load, loadEngine, core, freshRuntime }) => {
    const { h, mount, createMemoryStorage, signal, StorageSlots } = core;

    console.log("\n  closing a surface\n");
    {
        freshRuntime();
        const { ItemStack } = await loadEngine();
        const { BedrockSurface } = await load("platform/surface/surface.js");
        const { fromItemStack, isRenderedItem, toItemStack } = await load("platform/items/itemConversion.js");

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
            getDynamicProperty: () => undefined,
            setDynamicProperty: () => undefined,
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

        // A button put in a bundle on the cursor. The cursor can only be cleared, so the cleaned bundle
        // goes to the inventory with the player's own items still in it.
        {
            const sweepTraces = [];
            const sweepSurface = new BedrockSurface(player, { size: 27, onTrace: (line) => sweepTraces.push(line) });
            playerInventory.slots.fill(undefined);
            const bundle = new ItemStack("minecraft:bundle");
            const { container: pouch } = bundle.getComponent("minecraft:inventory");
            pouch.setItem(0, toItemStack({ typeId: "minecraft:paper", name: "Info" }));
            pouch.setItem(1, new ItemStack("minecraft:diamond", 3));
            cursor.item = bundle;

            const removed = sweepSurface.scrubPlayerInventory();
            const returned = playerInventory.slots.find((stack) => stack?.typeId === "minecraft:bundle");
            const contents = returned ? [0, 1, 2, 3].map((index) => returned.getComponent("minecraft:inventory").container.getItem(index)?.typeId ?? null) : null;
            check("a copy in a bundle on the cursor is swept", removed === 1, `removed=${removed}`);
            check("the bundle leaves the cursor", cursor.item === undefined, JSON.stringify(cursor.item?.typeId));
            check("and reaches the inventory with only the player's items", JSON.stringify(contents) === JSON.stringify([null, "minecraft:diamond", null, null]), JSON.stringify(contents));
            check("in one traced step", sweepTraces.includes("cursor-storage-swept item=minecraft:bundle stacks=1 to=inventory"), sweepTraces.join(","));

            const ownBundle = new ItemStack("minecraft:bundle");
            ownBundle.getComponent("minecraft:inventory").container.setItem(0, new ItemStack("minecraft:diamond", 3));
            cursor.item = ownBundle;
            check("a bundle of the player's own items stays on the cursor", sweepSurface.scrubPlayerInventory() === 0 && cursor.item === ownBundle);
            cursor.item = undefined;
            sweepSurface.close("programmatic");
        }

        /** A real bundle holding three diamonds, as a view, and the type ids a bundle stack holds. */
        const realBundleView = () => {
            const real = new ItemStack("minecraft:bundle");
            real.getComponent("minecraft:inventory").container.setItem(0, new ItemStack("minecraft:diamond", 3));
            return fromItemStack(real);
        };
        const heldIn = (bundle) => {
            const { container } = bundle.getComponent("minecraft:inventory");
            return [0, 1, 2, 3].map((index) => container.getItem(index)?.typeId ?? null);
        };

        // A bundle on a button: an item taken out of it, or one put in, changes nothing the scan reads.
        {
            const { StorageButtons } = await load("platform/surface/storageButtons.js");
            const buttons = new StorageButtons();
            const menu = makeContainer(27);
            const returned = [];
            const sinkTraces = [];
            const sink = { giveBack: (stacks) => returned.push(...stacks), trace: (line) => sinkTraces.push(line) };
            const button = toItemStack(realBundleView(), { isUiOwned: true });
            menu.setItem(11, button);
            buttons.record({ index: 11, stack: button, isUiOwned: true });
            check("an untouched bundle button costs no write", buttons.check(menu, sink) === 0);

            menu.slots[11].getComponent("minecraft:inventory").container.setItem(0, undefined);
            check("a bundle button something was taken out of is written again", buttons.check(menu, sink) === 1 && heldIn(menu.slots[11])[0] === "minecraft:diamond", JSON.stringify(heldIn(menu.slots[11])));

            menu.slots[11].getComponent("minecraft:inventory").container.setItem(2, new ItemStack("minecraft:wind_charge", 4));
            check("a bundle button the player put an item in is written again", buttons.check(menu, sink) === 1 && heldIn(menu.slots[11])[2] === null, JSON.stringify(heldIn(menu.slots[11])));
            check("and the item goes back to the player", returned.length === 1 && returned[0].typeId === "minecraft:wind_charge" && returned[0].amount === 4);
            check("in one traced step", sinkTraces.includes("storage-button-restored slot=11 returned=1"), sinkTraces.join(","));

            // A swap for an item of the same weight reads the same; the marker still tells it apart.
            menu.slots[11].getComponent("minecraft:inventory").container.setItem(0, new ItemStack("minecraft:diamond", 3));
            check("a swap of equal weight is not written again", buttons.check(menu, sink) === 0);
            buttons.rescueAll(menu, sink);
            check("closing gives back what the player put in a bundle button", returned.length === 2 && returned[1].typeId === "minecraft:diamond" && !isRenderedItem(returned[1]) && heldIn(menu.slots[11])[0] === null, JSON.stringify(returned.map((stack) => stack.typeId)));

            menu.slots[11].getComponent("minecraft:inventory").container.setItem(3, new ItemStack("minecraft:apple", 2));
            const beforeOverwrite = buttons.takeOwnItemsAt(menu, 11);
            check("a bundle button about to be overwritten gives up the player's item", beforeOverwrite.length === 1 && beforeOverwrite[0].typeId === "minecraft:apple");
            check("but keeps it in the slot until the write", heldIn(menu.slots[11])[3] === "minecraft:apple");
            check("a slot that holds no bundle button gives up nothing", buttons.takeOwnItemsAt(menu, 10).length === 0);

            const inputs = new StorageButtons();
            const input = toItemStack(realBundleView());
            menu.setItem(12, input);
            inputs.record({ index: 12, stack: input, isUiOwned: false });
            menu.slots[12].getComponent("minecraft:inventory").container.setItem(1, new ItemStack("minecraft:apple", 1));
            check("a bundle in an input is the player's own and is not watched", inputs.check(menu, sink) === 0 && heldIn(menu.slots[12])[1] === "minecraft:apple");
        }

        // A bundle button taken onto the cursor gives up what the player put in it before it goes.
        {
            const { ViewerInventory } = await load("platform/scan/viewerInventory.js");
            const viewerTraces = [];
            const viewer = new ViewerInventory(player, { onError: () => undefined, onTrace: (line) => viewerTraces.push(line) });
            playerInventory.slots.fill(undefined);
            const lifted = toItemStack(realBundleView(), { isUiOwned: true });
            lifted.getComponent("minecraft:inventory").container.setItem(1, new ItemStack("minecraft:wind_charge", 4));
            cursor.item = lifted;
            check("the bundle copy is reclaimed from the cursor", viewer.reclaimCursor() === 1 && cursor.item === undefined);
            const kept = playerInventory.slots.filter(Boolean).map((stack) => `${stack.typeId}x${stack.amount}${isRenderedItem(stack) ? "*" : ""}`);
            check("and the player's item in it is returned, without the copies", JSON.stringify(kept) === JSON.stringify(["minecraft:wind_chargex4"]), JSON.stringify(kept));
            check("with a trace", viewerTraces.some((line) => line.startsWith("own-item-returned item=minecraft:wind_charge amount=4 to=inventory")), viewerTraces.join(","));
            viewer.dispose();
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

        await checkReadOnlyClose({ check, load, loadEngine, core, freshRuntime, menuWorld, BedrockSurface, ItemStack });
    }
};
