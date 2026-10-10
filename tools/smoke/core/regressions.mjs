/**
 * Checks across the core and platform modules: computed errors, storage stacks without a marker,
 * failing storage backends, step buttons, input claiming and `clear()`, `useMemo` without
 * dependencies, potion and block item conversion, loot-table rolls, effect disposal, and the
 * shulker reader's leftovers and recovery.
 */

import { storageEntity } from "./fixtures.mjs";

export const checkRegressions = async ({ check, core, load, loadEngine, freshRuntime }) => {
    const {
        h,
        mount,
        signal,
        computed,
        createRoot,
        createTestHost,
        createMemoryStorage,
        createMemoryBackend,
        ContainerFormBuilder,
        ChunkedStore,
        JsonStore,
        QuantityPicker,
        StorageSlots,
        effect,
        useEffect,
        useMemo,
        useTween,
        useState,
        configureTimeSource,
        createManualTimeSource,
        resetTimeSource,
    } = core;

    console.log("\n  regressions\n");

    {
        const source = signal(0);
        const derived = createRoot(() =>
            computed(() => {
                if (source.value === 0) throw new Error("boom");
                return source.value * 2;
            }),
        );
        const readError = () => {
            try {
                derived.value;
                return "no error";
            } catch (error) {
                return error.message;
            }
        };
        check("a computed that threw throws again on the next read", readError() === "boom" && readError() === "boom");
        source.value = 2;
        check("and recovers once a dependency changes", derived.value === 4);
        derived.dispose();
        source.value = 5;
        check("a disposed computed keeps its last value", derived.value === 4);
    }

    {
        const { ItemStack } = await loadEngine();
        const { toStorageStack } = await load("platform/items/itemConversion.js");
        const { isRenderedItem } = await load("platform/items/itemMarker.js");
        check("an item described for storage or give-back carries no marker", !isRenderedItem(toStorageStack({ typeId: "minecraft:diamond", amount: 2 })));
        check("the marker check still sees a marked stack", (() => {
            const stack = new ItemStack("minecraft:diamond");
            stack.setDynamicProperty("containerui:ui", true);
            return isRenderedItem(stack);
        })());
    }

    {
        let message = "";
        try {
            new ChunkedStore(createMemoryBackend(), { namespace: "a|b" });
        } catch (error) {
            message = error.message;
        }
        check("a namespace containing | is refused", message.includes('contains "|"'), message);

        const corrupt = [];
        const failing = { get: () => { throw new Error("entity gone"); }, set: () => undefined, keys: () => [] };
        const store = new JsonStore(failing, { onCorrupt: (key, error) => corrupt.push(`${key}:${error.message}`) });
        check("a backend that refuses a read gives the fallback and reports it", store.get("coins", 7) === 7 && corrupt[0] === "coins:entity gone", JSON.stringify(corrupt));
    }

    {
        const form = new ContainerFormBuilder(9).reserve(0).reserve(1).reserve(2).reserve(3).reserve(4);
        let message = "";
        try {
            form.storage(createMemoryStorage(9));
        } catch (error) {
            message = error.message;
        }
        check("a storage mirror that runs past the form is refused", message.includes("runs past"), message);
    }

    {
        const host = createTestHost({ slotCount: 9 });
        let message = "";
        try {
            host.readSlot(9);
        } catch (error) {
            message = error.message;
        }
        check("the test host refuses a read outside the surface", message.includes("outside"), message);
    }

    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const picked = [];
        mount(
            () =>
                h(QuantityPicker, {
                    index: 0,
                    value: 1,
                    onChange: (value) => picked.push(value),
                    steps: [1],
                    item: (value) => ({ typeId: "minecraft:apple", amount: value }),
                    stepItem: ({ delta, isEnabled }) => ({ typeId: isEnabled ? "minecraft:arrow" : "minecraft:barrier", name: `${delta}` }),
                }),
            host,
        );
        clock.runPending();
        check("step buttons use stepItem", host.readSlot(0)?.typeId === "minecraft:barrier" && host.readSlot(2)?.typeId === "minecraft:arrow", JSON.stringify([host.readSlot(0), host.readSlot(2)]));
    }

    {
        const { clock } = freshRuntime();
        const diagnostics = [];
        let setDependencies = null;
        const Watcher = () => {
            const [dependencies, update] = useState(undefined);
            setDependencies = update;
            useEffect(() => undefined, dependencies);
            return null;
        };
        mount(() => h(Watcher), createTestHost({ slotCount: 9 }), { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        setDependencies([1]);
        clock.runPending();
        check(
            "switching useEffect between tracked and dependencies is a dev-warning",
            diagnostics.some((diagnostic) => diagnostic.kind === "dev-warning" && diagnostic.message.includes("useEffect")),
            JSON.stringify(diagnostics),
        );
    }

    {
        const { clock } = freshRuntime();
        const time = createManualTimeSource();
        configureTimeSource(time);
        const target = signal(10);
        let value = null;
        const Bar = () => {
            value = useTween({ from: 0, to: target.value, durationTicks: 2 });
            return null;
        };
        mount(() => h(Bar), createTestHost({ slotCount: 9 }));
        time.advance(2);
        clock.runPending();
        const finished = value.peek();
        target.value = 20;
        clock.runPending();
        time.advance(2);
        clock.runPending();
        check("a tween restarts when its target changes", finished === 10 && value.peek() === 20, `first=${finished} second=${value.peek()}`);
        resetTimeSource();
    }

    {
        const { ItemStack } = await loadEngine();
        const { claimBlockStorageEntity, findBlockStorageEntity } = await load("platform/block/blockRegistry.js");
        const { BLOCK_KEY_PROPERTY } = await load("platform/constants.js");
        const makeStorage = (id, occupied) => {
            const entity = { ...storageEntity(ItemStack, 9), id, removed: false };
            entity.getDynamicProperty = (key) => (key === BLOCK_KEY_PROPERTY ? "overworld:1:64:2" : undefined);
            entity.remove = () => {
                entity.removed = true;
            };
            if (occupied) entity.slots[0] = new ItemStack("minecraft:stone");
            return entity;
        };
        const full = makeStorage("full", true);
        const empty = makeStorage("empty", false);
        const dimension = { id: "overworld", heightRange: { min: -64, max: 320 }, getEntities: () => [empty, full] };
        const found = findBlockStorageEntity(dimension, { x: 1, y: 64, z: 2 });
        check("finding a storage entity picks the fullest and removes nothing", found === full && !empty.removed);
        const claimed = claimBlockStorageEntity(dimension, { x: 1, y: 64, z: 2 });
        check("claiming it removes the empty duplicate", claimed === full && empty.removed);
    }

    {
        const changes = [];
        const { createContainerWatcher } = await load("platform/storage/containerWatch.js");
        const { ItemStack, __intervals } = await loadEngine();
        const entity = storageEntity(ItemStack, 3);
        const container = entity.getComponent("minecraft:inventory").container;
        const watcher = createContainerWatcher({ resolveContainer: () => container, onExternalChange: (count) => changes.push(count), onInvalid: () => undefined });
        const before = __intervals.length;
        watcher.start(1);
        entity.slots[1] = new ItemStack("minecraft:stone");
        watcher.record(2, { typeId: "minecraft:apple", amount: 1 });
        entity.slots[2] = new ItemStack("minecraft:apple");
        __intervals[before]();
        check("the container watch reports outside changes and not the owner's own write", changes.join(",") === "1", JSON.stringify(changes));
        watcher.dispose();
    }

    {
        freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        let mirrored = null;
        host.setPlayerWritableSlots = (indices, mirrors) => {
            mirrored = [...(mirrors ?? [])];
        };
        const storage = createMemoryStorage(2);
        const held = signal(null);
        mount(
            () => [
                h("input", { index: 0, item: () => held.value, onChange: (vigenersl) => (held.value = vigenersl.next) }),
                h(StorageSlots, { storage, index: 1 }),
            ],
            host,
        );
        check("only storage mirrors are declared mirrored to the host", mirrored?.join(",") === "1,2", JSON.stringify(mirrored));
    }

    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const consumed = [];
        mount(
            () =>
                h("input", {
                    index: 4,
                    onPlace: (vigenersl) => {
                        consumed.push(vigenersl.next?.typeId);
                        vigenersl.clear();
                    },
                }),
            host,
        );
        host.simulatePlace(4, { typeId: "minecraft:rotten_flesh", amount: 3 });
        clock.runPending();
        check("clear() consumes an uncontrolled input's item", host.readSlot(4) === null && consumed[0] === "minecraft:rotten_flesh", JSON.stringify(host.readSlot(4)));
        host.simulatePlace(4, { typeId: "minecraft:bone", amount: 1 });
        clock.runPending();
        check("and the input takes the next item as usual", consumed[1] === "minecraft:bone");
    }

    {
        const { clock } = freshRuntime();
        const outer = signal(0);
        const inner = signal(0);
        const runs = [];
        createRoot(() =>
            effect(() => {
                const seen = outer.value;
                effect(() => {
                    runs.push(`${seen}:${inner.value}`);
                    return () => runs.push(`cleanup ${seen}`);
                });
            }),
        );
        outer.value = 1;
        clock.runPending();
        runs.length = 0;
        inner.value = 1;
        clock.runPending();
        check("an effect's rerun disposes the effects its last run made", runs.join(",") === "cleanup 1,1:1", runs.join(","));
    }

    {
        const { clock } = freshRuntime();
        const source = signal(1);
        const bump = signal(0);
        let doubled = null;
        const Doubler = () => {
            bump.value;
            doubled = useMemo(() => source.value * 2);
            return null;
        };
        mount(() => h(Doubler), createTestHost({ slotCount: 9 }));
        bump.value = 1;
        clock.runPending();
        source.value = 5;
        clock.runPending();
        check("useMemo without dependencies follows the signals it reads", doubled === 10, `doubled=${doubled}`);
    }

    {
        const { toItemStack } = await load("platform/items/itemConversion.js");
        const splash = toItemStack({ typeId: "minecraft:splash_potion", amount: 2, potion: { effect: "healing" } });
        check(
            "a potion view is built from its effect and the delivery its item implies",
            splash?.typeId === "minecraft:splash_potion" && splash?.amount === 2 && splash?.potion?.effectId === "minecraft:healing",
            JSON.stringify({ typeId: splash?.typeId, amount: splash?.amount, potion: splash?.potion }),
        );
        const arrow = toItemStack({ typeId: "minecraft:arrow", potion: { effect: "minecraft:fire_resistance" } });
        check("an item no delivery builds stays the plain item", arrow?.typeId === "minecraft:arrow" && arrow?.potion === undefined);
        const dropper = toItemStack({ typeId: "minecraft:dropper", blockStates: { facing_direction: 3 } });
        check(
            "a block item is built from its block states",
            dropper?.typeId === "minecraft:dropper" && dropper?.blockStates?.facing_direction === 3,
            JSON.stringify({ typeId: dropper?.typeId, states: dropper?.blockStates }),
        );
        const badState = toItemStack({ typeId: "minecraft:dropper", blockStates: { no_such_state: 1 } });
        check("a state the engine refuses leaves the plain block item", badState?.typeId === "minecraft:dropper" && badState?.blockStates === undefined);
        // A bed's colour is entity data, so the engine resolves no such block: the plain bed is shown.
        const bed = toItemStack({ typeId: "minecraft:bed", blockStates: { color: "cyan" } });
        check("a data value that is not a block state leaves the plain item", bed?.typeId === "minecraft:bed" && bed?.blockStates === undefined);
        check(
            "two droppers differ by their facing",
            !core.areItemsEqual(
                { typeId: "minecraft:dropper", blockStates: { facing_direction: 3 } },
                { typeId: "minecraft:dropper", blockStates: { facing_direction: 4 } },
            ),
        );

        const unknown = toItemStack({ typeId: "minecraft:potion", potion: { effect: "no_such_effect" } });
        check("an effect the engine refuses leaves the plain item", unknown?.typeId === "minecraft:potion" && unknown?.potion === undefined);
        check(
            "two arrows differ when one carries a potion",
            !core.areItemsEqual({ typeId: "minecraft:arrow" }, { typeId: "minecraft:arrow", potion: { effect: "fire_resistance" } }) &&
                core.areItemsEqual(
                    { typeId: "minecraft:arrow", potion: { effect: "fire_resistance", delivery: "minecraft:arrow" } },
                    { typeId: "minecraft:arrow", potion: { effect: "fire_resistance", delivery: "minecraft:arrow" } },
                ),
        );
    }

    {
        const { ItemStack } = await loadEngine();
        const { fromItemStack, toItemStack } = await load("platform/items/itemConversion.js");
        const real = new ItemStack("minecraft:arrow", 3);
        const decorated = { ...fromItemStack(real), name: "§7Назад", lore: ["§8вернуться"] };
        const written = toItemStack(decorated, { isUiOwned: true });
        check(
            "a real item shown with another name and lore is written wearing them",
            written?.nameTag === "§7Назад" && written?.getLore().some((line) => line.startsWith("§8вернуться")),
            JSON.stringify({ name: written?.nameTag, lore: written?.getLore() }),
        );
        const untouched = toItemStack({ ...fromItemStack(real) }, { isUiOwned: true });
        check("a real item the view does not rename keeps its own name", untouched?.nameTag === undefined, JSON.stringify(untouched?.nameTag));
    }

    {
        const { __lootRolls } = await loadEngine();
        const { itemFromLootTable } = await load("platform/items/lootItems.js");
        const arrow = itemFromLootTable("stub/fire_arrow");
        check(
            "an item comes out of a loot table with the real stack behind it",
            arrow?.typeId === "minecraft:arrow" && arrow?.amount === 3 && arrow?.native !== undefined,
            JSON.stringify({ typeId: arrow?.typeId, amount: arrow?.amount }),
        );
        const sixteen = itemFromLootTable("stub/fire_arrow", { amount: 16 });
        check("the table is rolled once and reshaped after that", sixteen?.amount === 16 && __lootRolls.get("stub/fire_arrow") === 1, `rolls=${__lootRolls.get("stub/fire_arrow")}`);
        check("a reroll asks the table again", itemFromLootTable("stub/fire_arrow", { reroll: true }) !== null && __lootRolls.get("stub/fire_arrow") === 2);
        check("an unknown table gives nothing", itemFromLootTable("stub/no_such_table") === null);
        check("a table that produced nothing gives nothing", itemFromLootTable("stub/empty") === null);
    }

    {
        const { ItemStack } = await loadEngine();
        const { sweepDrops } = await load("platform/items/shulkerReader.js");
        const drop = (id, typeId) => {
            const entity = {
                id,
                location: { x: 0, y: 301, z: 0 },
                isValid: true,
                removed: false,
                getComponent: () => ({ itemStack: new ItemStack(typeId) }),
                remove: () => {
                    entity.removed = true;
                    entity.isValid = false;
                },
            };
            return entity;
        };
        const oldCopy = drop("old-copy", "minecraft:red_shulker_box");
        const fallingDiamond = drop("diamond", "minecraft:diamond");
        const leakedCopy = drop("leaked", "minecraft:red_shulker_box");
        const dimension = { getEntities: () => [oldCopy, fallingDiamond, leakedCopy] };
        const { swept, kept } = sweepDrops({ dimension, center: { x: 0, y: 300, z: 0 }, before: new Set(["old-copy"]), shulkerTypeId: "minecraft:red_shulker_box" });
        check(
            "the shulker reader removes only a new copy of the shulker",
            leakedCopy.removed && !fallingDiamond.removed && !oldCopy.removed && swept.length === 1 && kept.length === 2,
            JSON.stringify({ swept, kept }),
        );

        const gone = drop("gone", "minecraft:red_shulker_box");
        gone.isValid = false;
        const afterGone = sweepDrops({ dimension: { getEntities: () => [gone] }, center: { x: 0, y: 300, z: 0 }, before: new Set(), shulkerTypeId: "minecraft:red_shulker_box" });
        check("a drop that is already gone is not removed again", gone.removed === false && afterGone.swept.length === 0, JSON.stringify(afterGone));
    }

    console.log("\n  shulker reader\n");
    {
        const { ItemStack, world: stubWorld } = await loadEngine();
        const { readShulkerContents, sweepShulkerLeftovers } = await load("platform/items/shulkerReader.js");
        const originalGetDimension = stubWorld.getDimension;

        /** A world of blocks by position, all air until set; `isUnloaded` makes every lookup fail, as an unloaded chunk does. */
        const makeScene = () => {
            const blocks = new Map();
            const scene = { blocks, isUnloaded: false, shulkerAt: null };
            const dimension = {
                id: "overworld",
                heightRange: { min: 0, max: 320 },
                getEntities: () => [],
                getBlock: (position) => {
                    if (scene.isUnloaded) return undefined;
                    const key = `${position.x},${position.y},${position.z}`;
                    if (!blocks.has(key)) {
                        const block = {
                            typeId: "minecraft:air",
                            isAir: true,
                            location: { ...position },
                            setPermutation(permutation) {
                                block.typeId = permutation.type.id;
                                block.isAir = block.typeId === "minecraft:air";
                                // A powered dispenser places the shulker above itself.
                                if (block.typeId === "minecraft:redstone_block" && scene.dispenserAt) {
                                    const above = dimension.getBlock({ ...scene.dispenserAt, y: scene.dispenserAt.y + 1 });
                                    above.typeId = "minecraft:red_shulker_box";
                                    above.isAir = false;
                                    above.getComponent = () => ({
                                        container: {
                                            isValid: true,
                                            size: 27,
                                            getItem: () => undefined,
                                            clearAll: () => {
                                                // The read is over: the chunk goes before the cleanup.
                                                if (scene.unloadsAfterRead) scene.isUnloaded = true;
                                            },
                                        },
                                    });
                                }
                                if (block.typeId === "minecraft:dispenser") scene.dispenserAt = { ...position };
                            },
                            getComponent: () => ({ container: { size: 9, setItem: () => undefined, clearAll: () => undefined } }),
                        };
                        blocks.set(key, block);
                    }
                    return blocks.get(key);
                },
            };
            scene.dimension = dimension;
            stubWorld.getDimension = () => dimension;
            return scene;
        };
        const playerAt = (scene, x) => ({ dimension: scene.dimension, location: { x: x + 0.5, y: 64, z: 10.5 } });
        const shulker = () => new ItemStack("minecraft:red_shulker_box");
        const kindsOf = (events) => events.map((event) => event.kind);
        const standing = (scene) => [...scene.blocks.values()].filter((block) => !block.isAir).map((block) => block.typeId);

        // A read that finishes leaves no blocks and no record.
        {
            const scene = makeScene();
            const events = [];
            await readShulkerContents(playerAt(scene, 10), shulker(), { onEvent: (event) => events.push(event) });
            check("a finished read removes its blocks", standing(scene).length === 0, `${standing(scene)} ${kindsOf(events)}`);
            check("and leaves no record of unfinished work", stubWorld.getDynamicProperty("containerui_shulker_pending") === undefined, String(stubWorld.getDynamicProperty("containerui_shulker_pending")));
            check("so the column is free again", !kindsOf(events).includes("column-busy") && kindsOf(events).includes("read"), kindsOf(events).join(","));
        }

        // The chunk unloads mid-read: the dispenser and the redstone block are still there afterwards.
        {
            const scene = makeScene();
            scene.unloadsAfterRead = true;
            const events = [];
            await readShulkerContents(playerAt(scene, 10), shulker(), { onEvent: (event) => events.push(event) });
            const recorded = stubWorld.getDynamicProperty("containerui_shulker_pending");
            check("a read cut short by an unloaded chunk keeps a record of its blocks", typeof recorded === "string" && recorded.includes("overworld"), String(recorded));

            // Back after a reload, with someone's stone where the redstone block was.
            scene.isUnloaded = false;
            scene.unloadsAfterRead = false;
            const redstone = [...scene.blocks.values()].find((block) => block.typeId === "minecraft:redstone_block");
            redstone.typeId = "minecraft:stone";
            check("the placed shulker is still standing before the sweep", standing(scene).includes("minecraft:red_shulker_box"), standing(scene).join(","));
            const removed = typeof sweepShulkerLeftovers === "function" ? sweepShulkerLeftovers() : -1;
            const left = standing(scene);
            check("the leftover dispenser is removed", !left.includes("minecraft:dispenser"), `removed=${removed} standing=${left}`);
            check("the placed shulker is removed too, so no copy of its contents is left", !left.includes("minecraft:red_shulker_box") && removed === 2, `removed=${removed} standing=${left}`);
            check("a block that is no longer ours stays", left.includes("minecraft:stone"), left.join(","));
            check("the record is cleared once the leftovers are gone", stubWorld.getDynamicProperty("containerui_shulker_pending") === undefined, String(stubWorld.getDynamicProperty("containerui_shulker_pending")));
        }

        // The sweep also runs at the start of the next read, and leaves what it cannot reach for later.
        {
            const scene = makeScene();
            scene.unloadsAfterRead = true;
            await readShulkerContents(playerAt(scene, 20), shulker());
            check("a second cut-short read leaves blocks to recover", standing(scene).includes("minecraft:dispenser") && standing(scene).includes("minecraft:redstone_block"), standing(scene).join(","));

            scene.unloadsAfterRead = false;
            const events = [];
            scene.isUnloaded = true;
            if (typeof sweepShulkerLeftovers === "function") sweepShulkerLeftovers();
            check("an unloaded chunk keeps its record", typeof stubWorld.getDynamicProperty("containerui_shulker_pending") === "string");

            scene.isUnloaded = false;
            await readShulkerContents(playerAt(scene, 40), shulker(), { onEvent: (event) => events.push(event) });
            check("the next read cleans up what the last one left", !standing(scene).includes("minecraft:dispenser") && !standing(scene).includes("minecraft:redstone_block"), `${standing(scene)} ${kindsOf(events)}`);
            check("and the record is cleared", stubWorld.getDynamicProperty("containerui_shulker_pending") === undefined);
        }

        // Two readers two columns apart would power each other's dispensers.
        {
            const scene = makeScene();
            const first = [];
            const second = [];
            const third = [];
            const running = [
                readShulkerContents(playerAt(scene, 10), shulker(), { onEvent: (event) => first.push(event) }),
                readShulkerContents(playerAt(scene, 12), shulker(), { onEvent: (event) => second.push(event) }),
                readShulkerContents(playerAt(scene, 9), shulker(), { onEvent: (event) => third.push(event) }),
            ];
            await Promise.all(running);
            check("a read two columns from a running one waits", kindsOf(second).includes("column-busy") && !kindsOf(second).includes("start"), kindsOf(second).join(","));
            check("so does one a column away", kindsOf(third).includes("column-busy") && !kindsOf(third).includes("start"), kindsOf(third).join(","));
            check("the first read is unaffected", kindsOf(first).includes("start"), kindsOf(first).join(","));

            const farScene = makeScene();
            const near = [];
            const far = [];
            await Promise.all([
                readShulkerContents(playerAt(farScene, 10), shulker(), { onEvent: (event) => near.push(event) }),
                readShulkerContents(playerAt(farScene, 13), shulker(), { onEvent: (event) => far.push(event) }),
            ]);
            check("a read three columns away is not held up", kindsOf(far).includes("start") && !kindsOf(far).includes("column-busy"), kindsOf(far).join(","));
        }

        // Only a shulker box is read: not any id that happens to contain the words.
        {
            const solid = { dimension: { id: "overworld", heightRange: { min: 0, max: 320 }, getBlock: () => ({ isAir: false }) }, location: { x: 1, y: 64, z: 1 } };
            const verdict = async (typeId) => {
                const events = [];
                await readShulkerContents(solid, new ItemStack(typeId), { onEvent: (event) => events.push(event) });
                return kindsOf(events)[0];
            };
            for (const typeId of ["minecraft:shulker_box", "minecraft:undyed_shulker_box", "minecraft:blue_shulker_box", "minecraft:light_gray_shulker_box"]) {
                check(`${typeId} is read`, (await verdict(typeId)) === "no-safe-space", await verdict(typeId));
            }
            for (const typeId of ["minecraft:shulker_box_fragment", "mod:shulker_box", "minecraft:shulker_shell", "minecraft:fake_shulker_box", "minecraft:purple_shulker_box_item"]) {
                check(`${typeId} is not read`, (await verdict(typeId)) === "not-a-shulker", await verdict(typeId));
            }
        }
        stubWorld.getDimension = originalGetDimension;
    }
};
