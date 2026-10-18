/** A storage opened by click: a shulker box, an ender chest and a source of its own. Shown, edited, written through, cleaned up. */

import { makeContainer } from "./fixtures.mjs";

export const checkShulkerOpen = async ({ check, load, loadEngine }) => {
    const { ItemStack, world, __subscribers, __intervals, __timeouts } = await loadEngine();
    const { writeShulkerContents } = await load("platform/items/shulkerReader.js");
    const { startHeldSession, discardHeldStorage, heldSessionFor } = await load("platform/items/heldStorage.js");
    const { registerHeldSource } = await load("platform/items/heldRecovery.js");
    const { shulkerBoxSource, enderChestSource, releaseShulkerBoxes } = await load("platform/items/heldSources.js");
    const { installHeldHooks } = await load("platform/items/heldHooks.js");
    const { fromItemStack } = await load("platform/items/itemConversion.js");
    const { HELD_STORAGE_ENTITY_TYPE_ID, HELD_STORAGE_OWNER_PROPERTY, HELD_STORAGE_PENDING_PROPERTY, SHULKER_LOCK_PROPERTY, SHULKER_SESSION_PROPERTY } = await load("platform/constants.js");
    const { uninstallBedrockRuntime } = await load("platform/lifecycle.js");
    const originalGetDimension = world.getDimension;
    const originalGetEntity = world.getEntity;

    const fire = (key, event) => {
        for (const callback of __subscribers.get(key) ?? []) callback(event);
        return event;
    };
    const describe = (stacks) => (stacks ?? []).map((stack, index) => (stack ? `${index}:${stack.typeId.replace("minecraft:", "")}x${stack.amount}` : null)).filter(Boolean).join(",");

    /**
     * A world whose dispenser places the loaded shulker above itself, filled from the item's data, and
     * whose placed shulker turns back into an item with what it holds. A shulker box refuses another.
     */
    const makeScene = () => {
        const blocks = new Map();
        const entities = new Map();
        const scene = { blocks, entities, loaded: null, dispenserAt: null };
        const shulkerContainer = (block) => {
            const slots = block.slots;
            return {
                isValid: true,
                size: 27,
                getItem: (index) => slots[index]?.clone(),
                setItem: (index, stack) => {
                    if (stack?.typeId.endsWith("shulker_box")) throw new Error("ContainerRulesError: a shulker box cannot hold one");
                    slots[index] = stack?.clone() ?? null;
                },
                clearAll: () => slots.fill(null),
            };
        };
        const dimension = {
            id: "overworld",
            heightRange: { min: 0, max: 320 },
            getEntities: ({ type } = {}) => [...entities.values()].filter((entity) => entity.isValid && (type === undefined || entity.typeId === type)),
            spawnItem: (stack) => {
                scene.dropped = [...(scene.dropped ?? []), stack];
            },
            getBlock: (position) => {
                const key = `${position.x},${position.y},${position.z}`;
                if (!blocks.has(key)) {
                    const block = {
                        typeId: "minecraft:air",
                        isAir: true,
                        location: { ...position },
                        slots: new Array(27).fill(null),
                        setPermutation(permutation) {
                            block.typeId = permutation.type.id;
                            block.isAir = block.typeId === "minecraft:air";
                            if (block.typeId === "minecraft:dispenser") scene.dispenserAt = { ...position };
                            if (block.typeId === "minecraft:redstone_block" && scene.dispenserAt && scene.loaded) {
                                const above = dimension.getBlock({ ...scene.dispenserAt, y: scene.dispenserAt.y + 1 });
                                above.typeId = scene.loaded.typeId;
                                above.isAir = false;
                                above.slots = Array.from({ length: 27 }, (_unused, index) => scene.loaded.shulkerContents?.[index]?.clone() ?? null);
                            }
                        },
                        setType(typeId) {
                            block.typeId = typeId;
                            block.isAir = typeId === "minecraft:air";
                            block.slots = new Array(27).fill(null);
                        },
                        getComponent: () =>
                            block.typeId === "minecraft:dispenser"
                                ? { container: { size: 9, setItem: (_index, stack) => (scene.loaded = stack), clearAll: () => (scene.loaded = null) } }
                                : { container: shulkerContainer(block) },
                        getItemStack: (amount, withData) => {
                            const stack = new ItemStack(block.typeId, amount);
                            if (withData) stack.shulkerContents = block.slots.map((stored) => stored?.clone() ?? null);
                            return stack;
                        },
                    };
                    blocks.set(key, block);
                }
                return blocks.get(key);
            },
        };
        scene.dimension = dimension;
        // The scene is all in the overworld: the other dimensions are empty.
        world.getDimension = (id) => (id === "overworld" ? dimension : { ...dimension, id, getEntities: () => [] });
        world.getEntity = (id) => entities.get(id);
        return scene;
    };

    const shulkerHolding = (items) => {
        const stack = new ItemStack("minecraft:red_shulker_box");
        stack.shulkerContents = Array.from({ length: 27 }, (_unused, index) => items[index] ?? null);
        return stack;
    };

    /** A player holding `held` in slot 0, sneaking, with an entity the dimension spawns for them. */
    const ownerIn = (scene, held) => {
        const pocket = makeContainer(36);
        pocket.slots[0] = held;
        const player = {
            id: "player-shulker",
            name: "Alex",
            typeId: "minecraft:player",
            isValid: true,
            isSneaking: true,
            selectedSlotIndex: 0,
            location: { x: 10.5, y: 64, z: 10.5 },
            onScreenDisplay: { setActionBar: () => undefined },
            getHeadLocation: () => ({ x: 10.5, y: 65.62, z: 10.5 }),
            getComponent: (id) => (id === "minecraft:inventory" ? { container: pocket } : undefined),
        };
        const holder = makeContainer(27);
        const properties = new Map();
        const entity = {
            id: "held-storage-1",
            typeId: HELD_STORAGE_ENTITY_TYPE_ID,
            isValid: true,
            nameTag: "",
            location: { x: 10.5, y: 65.62, z: 10.5 },
            getDynamicProperty: (id) => properties.get(id),
            setDynamicProperty: (id, value) => properties.set(id, value),
            getComponent: (id) => (id === "minecraft:inventory" ? { container: holder } : undefined),
            teleport: () => undefined,
            remove() {
                entity.isValid = false;
                scene.entities.delete(entity.id);
            },
        };
        player.dimension = {
            ...scene.dimension,
            spawnEntity: (typeId) => {
                scene.entities.set(entity.id, entity);
                entity.dimension = player.dimension;
                return entity;
            },
        };
        scene.entities.set(player.id, player);
        return { player, pocket, entity, holder, properties };
    };

    console.log("\n  writing a shulker box\n");
    try {
        {
            const scene = makeScene();
            const { player } = ownerIn(scene, null);
            const shell = new ItemStack("minecraft:red_shulker_box");
            shell.nameTag = "Loot";
            shell.setLore(["§7Mine"]);
            shell.setDynamicProperty("addon:owner", "Alex");
            const nested = new ItemStack("minecraft:blue_shulker_box");
            const result = writeShulkerContents({ player, shulkerStack: shell, contents: [fromItemStack(new ItemStack("minecraft:diamond", 3)), null, fromItemStack(nested)] });
            check("a shulker box is made with the contents", describe(result?.stack.shulkerContents) === "0:diamondx3", describe(result?.stack.shulkerContents));
            check("keeping the item's name, lore and dynamic properties", result?.stack.nameTag === "Loot" && result?.stack.getLore()[0] === "§7Mine" && result?.stack.getDynamicProperty("addon:owner") === "Alex");
            check("what it refused comes back with its index", result?.leftovers.length === 1 && result.leftovers[0].index === 2 && result.leftovers[0].item.typeId === "minecraft:blue_shulker_box", JSON.stringify(result?.leftovers.map((left) => left.index)));
            check("and nothing is left standing", [...scene.blocks.values()].every((block) => block.isAir));
        }

        console.log("\n  a shulker box opened by click\n");
        installHeldHooks();

        /** Runs every tick callback registered since `from`: the open's write-through among them. */
        const tick = (from) => {
            for (const callback of __intervals.slice(from)) callback();
        };
        const open = ({ entity, player }) => fire("after:entityContainerOpened", { entity, openSource: { entity: player } });
        const close = ({ entity, player }) => fire("after:entityContainerClosed", { entity, closeSource: { entity: player } });

        // The whole way: shown in the entity, edited, written through as it happens, closed.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3), new ItemStack("minecraft:emerald", 5)]));
            const events = [];
            const from = __intervals.length;
            const isReady = await startHeldSession({ player, source: shulkerBoxSource(), options: { whileSneaking: true, onEvent: (event) => events.push(event.kind) } });
            check("sneaking with a shulker readies an entity in the head", isReady && entity.isValid, events.join(","));
            check("the entity shows a copy of the contents", describe(holder.slots) === "0:diamondx3,1:emeraldx5", describe(holder.slots));
            check("and the shulker in hand keeps them all", describe(pocket.slots[0]?.shulkerContents) === "0:diamondx3,1:emeraldx5", describe(pocket.slots[0]?.shulkerContents));
            check("marked, and locked in its slot while open", typeof pocket.slots[0]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === "string" && pocket.slots[0]?.lockMode === "slot", pocket.slots[0]?.lockMode);
            check("another player's click is refused", fire("before:playerInteractWithEntity", { player: { id: "player-other" }, target: entity, cancel: false }).cancel === true);
            check("the owner's click is left to the engine", fire("before:playerInteractWithEntity", { player: { id: player.id }, target: entity, cancel: false }).cancel === false);
            open({ entity, player });

            // The owner takes the diamonds out and puts an apple in.
            pocket.slots[5] = holder.slots[0];
            holder.slots[0] = undefined;
            holder.slots[2] = new ItemStack("minecraft:apple", 4);
            tick(from);
            check("a change is written into the shulker in the tick it happens", describe(pocket.slots[0]?.shulkerContents) === "1:emeraldx5,2:applex4", describe(pocket.slots[0]?.shulkerContents));
            check("keeping it marked and locked", typeof pocket.slots[0]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === "string" && pocket.slots[0]?.lockMode === "slot");
            close({ entity, player });
            check("closing leaves the shulker with what the entity showed", describe(pocket.slots[0]?.shulkerContents) === "1:emeraldx5,2:applex4", describe(pocket.slots[0]?.shulkerContents));
            check("unmarked, and unlocked again", pocket.slots[0]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === undefined && pocket.slots[0]?.lockMode === "none", pocket.slots[0]?.lockMode);
            check("what was taken out stays taken out", pocket.slots[5]?.typeId === "minecraft:diamond" && pocket.slots[5]?.amount === 3);
            check("and the copy is gone", !entity.isValid && holder.slots.every((slot) => !slot), events.join(","));
        }

        // A shulker box put inside one is refused: it goes back to the owner, and the copy loses it.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3)]));
            const events = [];
            const from = __intervals.length;
            await startHeldSession({ player, source: shulkerBoxSource(), options: { onEvent: (event) => events.push(event.kind) } });
            open({ entity, player });
            holder.slots[3] = new ItemStack("minecraft:blue_shulker_box");
            tick(from);
            check("a shulker box put into a shulker box goes back to the owner", pocket.slots.some((slot) => slot?.typeId === "minecraft:blue_shulker_box") && !holder.slots[3], describe(pocket.slots));
            check("the shulker keeps what it can hold", describe(pocket.slots[0]?.shulkerContents) === "0:diamondx3" && events.includes("refused"), `${describe(pocket.slots[0]?.shulkerContents)} ${events.join(",")}`);
            close({ entity, player });
        }

        // Standing up before the click: nothing moved, the copy goes.
        {
            const scene = makeScene();
            const { player, pocket, entity } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3)]));
            const from = __intervals.length;
            await startHeldSession({ player, source: shulkerBoxSource(), options: { whileSneaking: true } });
            player.isSneaking = false;
            tick(from);
            check("standing up before the click leaves the shulker as it was", describe(pocket.slots[0]?.shulkerContents) === "0:diamondx3" && !entity.isValid && pocket.slots[0]?.lockMode === "none");
        }

        // A shulker moved off the hand during the read: nothing opens.
        {
            const scene = makeScene();
            const { player, pocket, entity } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3)]));
            const started = startHeldSession({ player, source: shulkerBoxSource(), options: {} });
            pocket.slots[3] = pocket.slots[0];
            pocket.slots[0] = undefined;
            const isReady = await started;
            check("a shulker moved during the read is left as it was", !isReady && !scene.entities.has(entity.id) && describe(pocket.slots[3]?.shulkerContents) === "0:diamondx3", `ready=${isReady} spawned=${scene.entities.has(entity.id)}`);
            check("without the session mark, and unlocked", pocket.slots[3]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === undefined && pocket.slots[3]?.lockMode === "none");
        }

        // What a crash left: a copy in the world, a marked and locked shulker on the player.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder, properties } = ownerIn(scene, null);
            properties.set(HELD_STORAGE_OWNER_PROPERTY, player.id);
            holder.slots[4] = new ItemStack("minecraft:gold_ingot", 7);
            scene.entities.set(entity.id, entity);
            check("a copy no open owns is thrown away", discardHeldStorage(entity) === true && !entity.isValid && holder.slots.every((slot) => !slot));
            check("and hands nothing out", pocket.slots.every((slot) => !slot), describe(pocket.slots));
            const other = ownerIn(makeScene(), null);
            other.holder.slots[0] = new ItemStack("minecraft:coal", 1);
            check("another pack's entity is left to that pack", discardHeldStorage(other.entity) === false && other.entity.isValid);
            const locked = shulkerHolding([new ItemStack("minecraft:diamond", 3)]);
            locked.setDynamicProperty(SHULKER_SESSION_PROPERTY, "old-session");
            locked.setDynamicProperty(SHULKER_LOCK_PROPERTY, "inventory");
            locked.lockMode = "slot";
            pocket.slots[2] = locked;
            releaseShulkerBoxes(player);
            check("a shulker an open left marked gets its own lock back", pocket.slots[2]?.lockMode === "inventory" && pocket.slots[2]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === undefined && pocket.slots[2]?.getDynamicProperty(SHULKER_LOCK_PROPERTY) === undefined, pocket.slots[2]?.lockMode);
            check("and keeps its contents", describe(pocket.slots[2]?.shulkerContents) === "0:diamondx3");
        }

        console.log("\n  an ender chest opened by click\n");

        /** An owner with an ender chest holding diamonds in slot 0 and emeralds in slot 4. */
        const enderOwner = (scene) => {
            const made = ownerIn(scene, null);
            const ender = makeContainer(27);
            ender.slots[0] = new ItemStack("minecraft:diamond", 3);
            ender.slots[4] = new ItemStack("minecraft:emerald", 5);
            const ownComponent = made.player.getComponent;
            made.player.getComponent = (id) => (id === "minecraft:ender_inventory" ? { container: ender } : ownComponent(id));
            return { ...made, ender };
        };
        const enderSlots = (container) => describe(container.slots);

        {
            const scene = makeScene();
            const { player, entity, holder, ender } = enderOwner(scene);
            const events = [];
            const from = __intervals.length;
            const isReady = await startHeldSession({ player, source: enderChestSource(), options: { onEvent: (event) => events.push(event.kind) } });
            check("an ender chest readies an entity in the head", isReady && entity.isValid, events.join(","));
            check("the entity shows a copy, slot for slot, and the ender chest keeps its items", describe(holder.slots) === "0:diamondx3,4:emeraldx5" && enderSlots(ender) === "0:diamondx3,4:emeraldx5", describe(holder.slots));
            open({ entity, player });
            holder.slots[0] = undefined;
            holder.slots[2] = new ItemStack("minecraft:apple", 4);
            tick(from);
            check("a change is written into the ender chest in the tick it happens", enderSlots(ender) === "2:applex4,4:emeraldx5", enderSlots(ender));
            close({ entity, player });
            check("closing leaves the ender chest as the entity showed it, and the copy is gone", enderSlots(ender) === "2:applex4,4:emeraldx5" && !entity.isValid && holder.slots.every((slot) => !slot), events.join(","));
        }

        /** Runs the timeouts scheduled since the last run, and those they schedule, as ticks pass. */
        const runTimeouts = () => {
            for (let round = 0; round < 50 && __timeouts.length > 0; round++) {
                for (const { callback } of __timeouts.splice(0)) callback();
            }
        };
        const rejoin = (player) => {
            fire("after:playerSpawn", { player, initialSpawn: true });
            runTimeouts();
        };

        // The owner takes an item out and leaves before any write took it: the game saves it on them,
        // so the screen as they left it is kept, and written into the ender chest when they are back.
        {
            const scene = makeScene();
            const { player, entity, holder, ender, properties } = enderOwner(scene);
            const events = [];
            await startHeldSession({ player, source: enderChestSource(), options: { onEvent: (event) => events.push(event.detail ?? event.kind) } });
            open({ entity, player });
            holder.slots[4] = undefined;
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            check("an owner who leaves with the screen open leaves it kept for their return", entity.isValid && typeof properties.get(HELD_STORAGE_PENDING_PROPERTY) === "string" && events.at(-1) === "reason=owner-left kept-for-return", events.join(","));
            check("a kept screen is no stale copy", discardHeldStorage(entity) === false && entity.isValid);
            check("another player's click on it is refused", fire("before:playerInteractWithEntity", { player: { id: "player-other" }, target: entity, cancel: false }).cancel === true && entity.isValid);
            rejoin(player);
            check("back, their last change is written into the ender chest", enderSlots(ender) === "0:diamondx3", enderSlots(ender));
            check("and the kept screen is gone", !entity.isValid && holder.slots.every((slot) => !slot));
        }

        // The same with a shulker box: written into it, then unmarked and unlocked.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder, properties } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3), new ItemStack("minecraft:emerald", 5)]));
            await startHeldSession({ player, source: shulkerBoxSource(), options: {} });
            open({ entity, player });
            pocket.slots[7] = holder.slots[0];
            holder.slots[0] = undefined;
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            check("a shulker box left open is kept for its owner", entity.isValid && typeof properties.get(HELD_STORAGE_PENDING_PROPERTY) === "string");
            rejoin(player);
            check("back, the shulker box holds what the screen did", describe(pocket.slots[0]?.shulkerContents) === "1:emeraldx5", describe(pocket.slots[0]?.shulkerContents));
            check("unmarked and unlocked, and the diamonds only on the owner", pocket.slots[0]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === undefined && pocket.slots[0]?.lockMode === "none" && pocket.slots[7]?.typeId === "minecraft:diamond" && !entity.isValid);
        }

        // An ender chest that cannot be used yet on the return is tried again.
        {
            const scene = makeScene();
            const { player, entity, holder, ender } = enderOwner(scene);
            await startHeldSession({ player, source: enderChestSource(), options: {} });
            open({ entity, player });
            holder.slots[0] = undefined;
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            ender.isValid = false;
            fire("after:playerSpawn", { player, initialSpawn: true });
            for (const { callback } of __timeouts.splice(0)) callback();
            check("an ender chest not ready on the return keeps the screen waiting", entity.isValid && enderSlots(ender) === "0:diamondx3,4:emeraldx5", enderSlots(ender));
            ender.isValid = true;
            runTimeouts();
            check("and gets it once it is", enderSlots(ender) === "4:emeraldx5" && !entity.isValid, enderSlots(ender));
        }

        // Back, but the kept screen is not written yet: nothing else opens for them meanwhile, and a kept
        // screen whose chunk loads late is waited for before their shulker box is unlocked.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3)]));
            await startHeldSession({ player, source: shulkerBoxSource(), options: {} });
            open({ entity, player });
            pocket.slots[6] = holder.slots[0];
            holder.slots[0] = undefined;
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            scene.entities.delete(entity.id);
            fire("after:playerSpawn", { player, initialSpawn: true });
            for (const { callback } of __timeouts.splice(0)) callback();
            check("a kept screen not loaded yet keeps the shulker box marked and locked", typeof pocket.slots[0]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === "string" && pocket.slots[0]?.lockMode === "slot", pocket.slots[0]?.lockMode);
            check("and nothing else opens for them meanwhile", (await startHeldSession({ player, source: enderChestSource(), options: {} })) === false);
            check("not even an ender chest block", fire("before:playerInteractWithBlock", { player: { id: player.id }, block: { typeId: "minecraft:ender_chest" }, cancel: false }).cancel === true);
            check("another player's ender chest block opens", fire("before:playerInteractWithBlock", { player: { id: "player-other" }, block: { typeId: "minecraft:ender_chest" }, cancel: false }).cancel === false);
            scene.entities.set(entity.id, entity);
            runTimeouts();
            check("once it loads, the shulker box gets the screen, then is unlocked", describe(pocket.slots[0]?.shulkerContents) === "" && pocket.slots[0]?.lockMode === "none" && !entity.isValid, `${describe(pocket.slots[0]?.shulkerContents)} ${pocket.slots[0]?.lockMode}`);
        }

        // A kept screen that loads only after its wait was given up is a stale copy: the ender chest the
        // owner used since is not written over.
        {
            const scene = makeScene();
            const { player, entity, holder, ender } = enderOwner(scene);
            await startHeldSession({ player, source: enderChestSource(), options: {} });
            open({ entity, player });
            holder.slots[4] = undefined;
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            scene.entities.delete(entity.id);
            rejoin(player);
            ender.slots[0] = undefined;
            ender.slots[1] = new ItemStack("minecraft:apple", 1);
            scene.entities.set(entity.id, entity);
            fire("after:entityLoad", { entity });
            runTimeouts();
            check("a kept screen loading after its wait was given up is thrown away, not written", enderSlots(ender) === "1:applex1,4:emeraldx5" && !entity.isValid, enderSlots(ender));
        }

        // A shulker box an earlier open left marked does not open again until that is settled.
        {
            const scene = makeScene();
            const held = shulkerHolding([new ItemStack("minecraft:diamond", 3)]);
            held.setDynamicProperty(SHULKER_SESSION_PROPERTY, "earlier-open");
            held.lockMode = "slot";
            const { player, pocket, entity } = ownerIn(scene, held);
            const isReady = await startHeldSession({ player, source: shulkerBoxSource(), options: {} });
            check("a shulker box still marked by an earlier open does not open", !isReady && !scene.entities.has(entity.id) && pocket.slots[0]?.getDynamicProperty(SHULKER_SESSION_PROPERTY) === "earlier-open");
        }

        // An ender chest not ready for a moment is written once it is, with nothing handed back meanwhile.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder, ender } = enderOwner(scene);
            const from = __intervals.length;
            await startHeldSession({ player, source: enderChestSource(), options: {} });
            open({ entity, player });
            holder.slots[0] = undefined;
            holder.slots[1] = new ItemStack("minecraft:apple", 2);
            ender.isValid = false;
            tick(from);
            check("an ender chest not ready keeps the open and hands nothing back", entity.isValid && pocket.slots.every((slot) => !slot), describe(pocket.slots));
            close({ entity, player });
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            check("leaving while the close waits keeps the screen for the return", entity.isValid);
            ender.isValid = true;
            rejoin(player);
            check("back, the ender chest gets it", enderSlots(ender) === "1:applex2,4:emeraldx5" && !entity.isValid, enderSlots(ender));
        }

        // A copy removed without a close ends the open: the player can open again.
        {
            const scene = makeScene();
            const { player, entity, ender } = enderOwner(scene);
            const events = [];
            const from = __intervals.length;
            await startHeldSession({ player, source: enderChestSource(), options: { onEvent: (event) => events.push(event.detail ?? event.kind) } });
            open({ entity, player });
            entity.remove();
            tick(from);
            check("a copy gone without a close ends the open", events.at(-1) === "reason=entity-gone" && enderSlots(ender) === "0:diamondx3,4:emeraldx5", events.join(","));
        }

        // A storage gone at the close's full write hands back only what was added, not the unchanged items.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, null);
            const source = {
                kind: "gone-at-close",
                read: () => [new ItemStack("minecraft:diamond_sword", 1)],
                write: ({ stacks, changed }) => {
                    if (changed.length === stacks.length) throw new Error("the vault is gone");
                    return { refused: [] };
                },
            };
            const from = __intervals.length;
            await startHeldSession({ player, source, options: {} });
            open({ entity, player });
            holder.slots[1] = new ItemStack("minecraft:apple", 3);
            tick(from);
            close({ entity, player });
            check("only what was added since the last write goes back", describe(pocket.slots) === "" && !entity.isValid, describe(pocket.slots));
        }

        // Before the screen opened, nothing could change: the copy just goes.
        {
            const scene = makeScene();
            const { player, entity, ender } = enderOwner(scene);
            await startHeldSession({ player, source: enderChestSource(), options: {} });
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            check("an owner who leaves before the click leaves nothing kept", !entity.isValid && enderSlots(ender) === "0:diamondx3,4:emeraldx5");
        }

        // An ender chest that cannot be used yet is left alone.
        {
            const scene = makeScene();
            const { player, entity, ender } = enderOwner(scene);
            ender.isValid = false;
            check("an ender chest that is not ready opens nothing", (await startHeldSession({ player, source: enderChestSource(), options: {} })) === false && !scene.entities.has(entity.id));
        }

        console.log("\n  a source of its own\n");

        // Anything can be the source: this one is a plain array.
        {
            const scene = makeScene();
            const { player, entity, holder } = ownerIn(scene, null);
            const vault = [new ItemStack("minecraft:coal", 12), undefined, new ItemStack("minecraft:iron_ingot", 2)];
            const calls = [];
            const source = {
                kind: "vault",
                read: () => (calls.push("read"), vault.map((stack) => stack?.clone())),
                prepare: () => (calls.push("prepare"), undefined),
                write: ({ stacks, changed }) => {
                    calls.push(`write:${changed.join("+")}`);
                    changed.forEach((index) => (vault[index] = stacks[index]?.clone()));
                    return { refused: [] };
                },
                release: () => calls.push("release"),
            };
            const from = __intervals.length;
            const isReady = await startHeldSession({ player, source, options: { title: "Vault" } });
            check("a source of its own fills the entity and keeps its own items", isReady && describe(holder.slots) === "0:coalx12,2:iron_ingotx2" && describe(vault) === "0:coalx12,2:iron_ingotx2" && entity.nameTag === "Vault", calls.join(","));
            open({ entity, player });
            holder.slots[1] = new ItemStack("minecraft:gold_ingot", 1);
            tick(from);
            check("each change reaches it with the slots that changed", describe(vault) === "0:coalx12,1:gold_ingotx1,2:iron_ingotx2" && calls.includes("write:1"), calls.join(","));
            close({ entity, player });
            check("and closing releases it", calls.at(-1) === "release" && !entity.isValid, calls.join(","));
        }

        // A source that is gone mid-open: what the owner put in since the last write goes back to them.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, null);
            const calls = [];
            const source = {
                kind: "broken",
                read: () => [new ItemStack("minecraft:diamond", 3)],
                write: () => {
                    throw new Error("the vault is gone");
                },
                release: () => calls.push("release"),
            };
            const from = __intervals.length;
            await startHeldSession({ player, source, options: {} });
            open({ entity, player });
            holder.slots[1] = new ItemStack("minecraft:gold_ingot", 2);
            tick(from);
            check("a source that is gone ends the open", !entity.isValid && calls.includes("release"), calls.join(","));
            check("the item put in goes back to the owner, the copy of the source's does not", pocket.slots.some((slot) => slot?.typeId === "minecraft:gold_ingot" && slot.amount === 2) && !pocket.slots.some((slot) => slot?.typeId === "minecraft:diamond"), describe(pocket.slots));
        }

        // A source that cannot be held opens nothing, and is released.
        {
            const scene = makeScene();
            const { player, entity } = ownerIn(scene, null);
            const calls = [];
            const source = { kind: "stuck", read: () => [new ItemStack("minecraft:diamond", 3)], prepare: () => "held elsewhere", write: () => ({ refused: [] }), release: () => calls.push("release") };
            const isReady = await startHeldSession({ player, source, options: {} });
            check("a source that cannot be held opens nothing", isReady === false && !scene.entities.has(entity.id) && calls.join(",") === "release", calls.join(","));
        }

        // A kind of its own registers its cleanup: every player who joins gets it.
        {
            const scene = makeScene();
            const { player } = ownerIn(scene, null);
            const released = [];
            registerHeldSource("vault-released", { release: (who) => released.push(who.id) });
            fire("after:playerSpawn", { player, initialSpawn: true });
            runTimeouts();
            check("a registered kind cleans up after a player who joins", released.includes(player.id), JSON.stringify(released));
        }

        console.log("\n  what the write-through writes, and when\n");

        // A non-stackable item, which the engine never calls stackable with anything, is not written again every tick.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond_sword", 1), new ItemStack("minecraft:emerald", 5)]));
            const steps = [];
            const from = __intervals.length;
            await startHeldSession({ player, source: shulkerBoxSource(), options: { onEvent: (event) => event.step === "written" && steps.push(event.step) } });
            open({ entity, player });
            tick(from);
            tick(from);
            tick(from);
            check("an unchanged sword is not written again every tick", steps.length === 0, `${steps.length} writes`);
            holder.slots[0] = undefined;
            tick(from);
            check("taking it out is written", steps.length === 1 && describe(pocket.slots[0]?.shulkerContents) === "1:emeraldx5", describe(pocket.slots[0]?.shulkerContents));
            holder.slots[3] = new ItemStack("minecraft:diamond_sword", 1);
            tick(from);
            const before = steps.length;
            close({ entity, player });
            check("closing writes every slot once more while a non-stackable item is in", steps.length === before + 1 && describe(pocket.slots[0]?.shulkerContents) === "1:emeraldx5,3:diamond_swordx1", describe(pocket.slots[0]?.shulkerContents));
        }

        // A storage that is there but cannot take a write now gets the same change again, and the close waits for it.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, null);
            const vault = [new ItemStack("minecraft:diamond", 3)];
            let isBusy = true;
            const source = {
                kind: "busy",
                read: () => vault.map((stack) => stack?.clone()),
                write: ({ stacks }) => {
                    if (isBusy) return undefined;
                    stacks.forEach((stack, index) => (vault[index] = stack?.clone()));
                    return { refused: [] };
                },
            };
            const from = __intervals.length;
            await startHeldSession({ player, source, options: {} });
            open({ entity, player });
            pocket.slots[4] = holder.slots[0];
            holder.slots[0] = undefined;
            tick(from);
            check("a write the storage cannot take now keeps the open, with nothing handed back", entity.isValid && vault[0]?.amount === 3 && pocket.slots.filter(Boolean).length === 1, describe(pocket.slots));
            close({ entity, player });
            check("the close waits for the write", entity.isValid && vault[0]?.amount === 3);
            isBusy = false;
            tick(from);
            check("and ends once the storage took it", !entity.isValid && vault.every((stack) => !stack), describe(vault));
        }

        // A close the storage refuses for 5 seconds, with the owner still here: kept, then written as soon
        // as the storage takes it, without a rejoin, and released after.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, null);
            const vault = [new ItemStack("minecraft:diamond", 3)];
            let isBusy = true;
            const writeVault = (stacks) => {
                if (isBusy) return undefined;
                stacks.forEach((stack, index) => (vault[index] = stack?.clone()));
                return { refused: [] };
            };
            registerHeldSource("busy-kept", { release: () => undefined, resume: ({ stacks }) => writeVault(stacks) });
            const source = {
                kind: "busy-kept",
                read: () => vault.map((stack) => stack?.clone()),
                write: ({ stacks }) => writeVault(stacks),
                key: () => "vault",
            };
            const events = [];
            const from = __intervals.length;
            await startHeldSession({ player, source, options: { onEvent: (event) => events.push(event.detail ?? event.kind) } });
            open({ entity, player });
            pocket.slots[4] = holder.slots[0];
            holder.slots[0] = undefined;
            close({ entity, player });
            for (let round = 0; round < 100; round++) tick(from);
            check("a close refused for 5 seconds is kept for the owner", events.at(-1) === "reason=closed kept-for-return" && entity.isValid && vault[0]?.amount === 3, events.join(","));
            isBusy = false;
            runTimeouts();
            check("and written while they are still here", !entity.isValid && vault.every((stack) => !stack), describe(vault));
        }

        // The same with a kind that cannot resume: the storage keeps what was last written, and is released.
        {
            const scene = makeScene();
            const { player, entity } = ownerIn(scene, null);
            let released = 0;
            const source = {
                kind: "busy-plain",
                read: () => [new ItemStack("minecraft:diamond", 3)],
                write: () => undefined,
                release: () => released++,
            };
            const from = __intervals.length;
            await startHeldSession({ player, source, options: {} });
            open({ entity, player });
            close({ entity, player });
            for (let round = 0; round < 100; round++) tick(from);
            check("a close refused for good with no resume discards the copy and releases the source", !entity.isValid && released === 1, `released=${released}`);
        }

        // A source whose key throws: the owner's leave still ends the open, so they can open again.
        {
            const scene = makeScene();
            const { player, entity, holder } = ownerIn(scene, null);
            const source = {
                kind: "ender",
                read: () => [new ItemStack("minecraft:diamond", 3)],
                write: () => ({ refused: [] }),
                key: () => {
                    throw new Error("no key");
                },
            };
            await startHeldSession({ player, source, options: {} });
            open({ entity, player });
            holder.slots[0] = undefined;
            fire("after:playerLeave", { playerId: player.id, playerName: player.name });
            check("a key that throws still ends the open on a leave", !entity.isValid && heldSessionFor(player.id) === undefined);
        }

        // The write fails for good: only what the owner added since the last write goes back to them.
        {
            const scene = makeScene();
            const { player, pocket, entity, holder } = ownerIn(scene, null);
            const source = {
                kind: "lost",
                read: () => [new ItemStack("minecraft:diamond", 3)],
                write: () => {
                    throw new Error("the vault is gone");
                },
            };
            const from = __intervals.length;
            await startHeldSession({ player, source, options: {} });
            open({ entity, player });
            holder.slots[0] = new ItemStack("minecraft:diamond", 5);
            tick(from);
            check("a stack topped up before the storage went gives back only what was added", pocket.slots.filter(Boolean).length === 1 && pocket.slots.find(Boolean)?.amount === 2 && !entity.isValid, describe(pocket.slots));
        }

        // A shulker box with a lock of its own keeps it when the open never gets that far.
        {
            const scene = makeScene();
            const held = shulkerHolding([new ItemStack("minecraft:diamond", 3)]);
            held.lockMode = "inventory";
            const { player, pocket } = ownerIn(scene, held);
            const started = startHeldSession({ player, source: shulkerBoxSource(), options: {} });
            player.isSneaking = false;
            pocket.slots[3] = pocket.slots[0];
            pocket.slots[0] = undefined;
            await started;
            check("a shulker box keeps its own lock when the open is given up", pocket.slots[3]?.lockMode === "inventory", pocket.slots[3]?.lockMode);
        }

        // Another pack's entity is left to that pack: its click is not refused here.
        {
            const other = ownerIn(makeScene(), null);
            check("a click on another pack's held entity is left alone", fire("before:playerInteractWithEntity", { player: { id: "player-x" }, target: other.entity, cancel: false }).cancel === false && other.entity.isValid);
        }

        // An uninstall ends the opens, each with its last change written.
        {
            const scene = makeScene();
            const { player, entity, holder, ender } = enderOwner(scene);
            const events = [];
            await startHeldSession({ player, source: enderChestSource(), options: { onEvent: (event) => events.push(event.detail ?? event.kind) } });
            open({ entity, player });
            holder.slots[0] = undefined;
            uninstallBedrockRuntime();
            check("an uninstall ends an open and writes its last change", !entity.isValid && enderSlots(ender) === "4:emeraldx5" && events.at(-1) === "reason=uninstalled", events.join(","));
            installHeldHooks();
        }

        console.log("\n  an item that opens a storage\n");
        {
            const { installHeldItem } = await load("platform/items/heldHooks.js");
            const { __timeouts } = await loadEngine();
            const seen = [];
            installHeldItem({
                matches: (item) => item.typeId === "addon:backpack",
                source: (_player, item) => {
                    seen.push(item.typeId);
                    return { kind: "backpack", read: () => [new ItemStack("minecraft:bread", 2)], write: () => ({ refused: [] }) };
                },
                title: "Backpack",
            });
            installHeldItem({ matches: (item) => item.typeId.endsWith("shulker_box"), source: () => shulkerBoxSource() });
            installHeldItem({
                matches: (item, player) => item.typeId === "addon:vault" && player.hasTag("vault"),
                source: () => ({ kind: "vault", read: () => [new ItemStack("minecraft:gold_ingot", 4)], write: () => ({ refused: [] }) }),
            });
            installHeldItem({
                matches: () => {
                    throw new Error("a rule that throws");
                },
                source: () => shulkerBoxSource(),
            });
            const sneak = (player) => {
                __timeouts.length = 0;
                fire("after:playerButtonInput", { button: "Sneak", newButtonState: "Pressed", player });
                for (const { callback } of __timeouts.splice(0)) callback();
            };
            const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

            // Sneaking with the registered item opens it, with its own source and title.
            {
                const scene = makeScene();
                const { player, entity, holder } = ownerIn(scene, new ItemStack("addon:backpack"));
                sneak(player);
                await flush();
                check("sneaking with a registered item opens its storage", entity.isValid && describe(holder.slots) === "0:breadx2" && entity.nameTag === "Backpack" && seen.at(-1) === "addon:backpack", describe(holder.slots));
                close({ entity, player });
            }

            // The second registered item opens with its own rule.
            {
                const scene = makeScene();
                const { player, entity, holder } = ownerIn(scene, shulkerHolding([new ItemStack("minecraft:diamond", 3)]));
                sneak(player);
                await flush();
                check("a second registered item opens with its own source", entity.isValid && describe(holder.slots) === "0:diamondx3", describe(holder.slots));
                close({ entity, player });
            }

            // An item no rule matches, and a player who is not sneaking, open nothing.
            {
                const scene = makeScene();
                const { player, entity } = ownerIn(scene, new ItemStack("minecraft:stick"));
                sneak(player);
                await flush();
                check("an item no rule matches opens nothing", !scene.entities.has(entity.id));
                const other = makeScene();
                const standing = ownerIn(other, new ItemStack("addon:backpack"));
                standing.player.isSneaking = false;
                sneak(standing.player);
                await flush();
                check("a player who is not sneaking opens nothing", !other.entities.has(standing.entity.id));
            }

            // A rule sees the player: only one with the tag opens the item.
            {
                const scene = makeScene();
                const { player, entity, holder } = ownerIn(scene, new ItemStack("addon:vault"));
                player.hasTag = (tag) => tag === "vault";
                sneak(player);
                await flush();
                check("a rule that asks for a tag opens for a player who has it", entity.isValid && describe(holder.slots) === "0:gold_ingotx4", describe(holder.slots));
                close({ entity, player });
                const other = makeScene();
                const untagged = ownerIn(other, new ItemStack("addon:vault"));
                untagged.player.hasTag = () => false;
                sneak(untagged.player);
                await flush();
                check("a rule that asks for a tag opens nothing for a player without it", !other.entities.has(untagged.entity.id));
            }
        }

        // A wait that is not a whole number of ticks is refused before anything moves.
        {
            const scene = makeScene();
            const { player, entity } = ownerIn(scene, null);
            const source = { kind: "vault", read: () => [new ItemStack("minecraft:coal", 1)], write: () => ({ refused: [] }) };
            let refused = false;
            try {
                startHeldSession({ player, source, options: { clickWaitTicks: Number.NaN } });
            } catch (error) {
                refused = error instanceof RangeError;
            }
            check("a clickWaitTicks that is not a positive whole number throws", refused && !scene.entities.has(entity.id));
        }
    } finally {
        world.getDimension = originalGetDimension;
        world.getEntity = originalGetEntity;
    }
};
