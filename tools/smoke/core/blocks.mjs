/** Orphaned storage entities, and block containers that open natively or as a menu. */

import { storageEntity } from "./fixtures.mjs";

export const checkBlocks = async ({ check, load, loadEngine, freshRuntime }) => {
    console.log("\n  orphaned storage\n");
    {
        freshRuntime();
        const { ItemStack } = await loadEngine();
        const { orphanVerdict, registerRemovalPolicy, settleIfOrphaned } = await load("platform/block/storageRemoval.js");
        const { BLOCK_KEY_PROPERTY, BLOCK_COMPONENT_PROPERTY, BLOCK_TYPE_PROPERTY, HIDDEN_TAG } = await load("platform/constants.js");
        const air = { typeId: "minecraft:air", isAir: true };
        const stone = { typeId: "minecraft:stone", isAir: false };
        const crate = { typeId: "containerui:crate", isAir: false };

        check("an unloaded chunk is unknown", orphanVerdict({ recordedType: "containerui:crate", block: undefined }) === "unknown");
        check("its own block type is alive", orphanVerdict({ recordedType: "containerui:crate", block: crate }) === "alive");
        check("another block where it stood is an orphan", orphanVerdict({ recordedType: "containerui:crate", block: stone }) === "orphan");
        check("air under an unrecorded entity is an orphan", orphanVerdict({ recordedType: undefined, block: air }) === "orphan");
        check("anything else under an unrecorded entity is unknown", orphanVerdict({ recordedType: undefined, block: stone }) === "unknown");

        /** A storage entity at overworld 1 64 2 holding three diamonds; `block: null` is an unloaded chunk. */
        const makeStorage = ({ component = "containerui:crate", block = stone, tags = [] } = {}) => {
            const entity = storageEntity(ItemStack, 9);
            entity.slots[0] = new ItemStack("minecraft:diamond", 3);
            const props = new Map([
                [BLOCK_KEY_PROPERTY, "overworld:1:64:2"],
                [BLOCK_COMPONENT_PROPERTY, component],
                [BLOCK_TYPE_PROPERTY, "containerui:crate"],
            ]);
            const drops = [];
            return Object.assign(entity, {
                typeId: "containerui:block_storage",
                drops,
                removed: false,
                getDynamicProperty: (id) => props.get(id),
                setDynamicProperty: (id, value) => props.set(id, value),
                hasTag: (tag) => tags.includes(tag),
                remove() {
                    this.removed = true;
                    this.isValid = false;
                },
                dimension: {
                    getBlock: () => block,
                    spawnItem: (stack, at) => drops.push(`${stack.typeId}x${stack.amount}@${at.x},${at.y},${at.z}`),
                },
            });
        };
        registerRemovalPolicy("containerui:crate", { dropOnBreak: true });
        registerRemovalPolicy("containerui:bin", { dropOnBreak: false });

        const replaced = makeStorage();
        check("a storage whose block was replaced is settled", settleIfOrphaned(replaced) === true && replaced.removed);
        check("with its items dropped where the block stood", replaced.drops.join(",") === "minecraft:diamondx3@1.5,64.5,2.5", replaced.drops.join(","));
        const live = makeStorage({ block: crate });
        check("a storage under its own block is kept", settleIfOrphaned(live) === false && !live.removed && live.slots[0] !== undefined);
        const unloaded = makeStorage({ block: null });
        check("one in an unloaded chunk is kept", settleIfOrphaned(unloaded) === false && !unloaded.removed);
        const parked = makeStorage({ tags: [HIDDEN_TAG] });
        check("a parked one is the sneak machine's, and kept", settleIfOrphaned(parked) === false && !parked.removed);
        const foreign = makeStorage({ component: "someone:else" });
        check("one of a component this world does not register is kept", settleIfOrphaned(foreign) === false && !foreign.removed);
        const bin = makeStorage({ component: "containerui:bin" });
        check("dropOnBreak: false removes it without dropping", settleIfOrphaned(bin) === true && bin.removed && bin.drops.length === 0);
    }

    console.log("\n  native block containers\n");
    {
        freshRuntime();
        const { ItemStack, __subscribers, system: stubSystem } = await loadEngine();
        const { registerBlockContainer } = await load("platform/block/blockContainer.js");
        const { hasOpenSessions } = await load("platform/block/blockSessions.js");
        const { BLOCK_KEY_PROPERTY, BLOCK_COMPONENT_PROPERTY } = await load("platform/constants.js");
        const components = new Map();
        const registry = { registerCustomComponent: (name, component) => components.set(name, component) };
        const events = [];
        registerBlockContainer(registry, "containerui:crate", { size: 27, onEvent: (vigenersl) => events.push(vigenersl) });
        const player = { id: "player-1", name: "Tester", typeId: "minecraft:player", isValid: true };

        components.get("containerui:crate").onPlayerInteract({
            block: { location: { x: 1, y: 64, z: 2 }, typeId: "containerui:crate" },
            dimension: { id: "overworld" },
            player,
        });
        check(
            "without render, a click that reaches the block opens no menu",
            events.length === 1 && events[0].kind === "interact" && events[0].detail?.startsWith("native"),
            JSON.stringify(events),
        );
        let isRefused = false;
        try {
            registerBlockContainer(registry, "containerui:machine", { size: 27, open: "native", render: () => null });
        } catch {
            isRefused = true;
        }
        check("render with open: native is refused", isRefused);

        const entity = storageEntity(ItemStack, 27);
        entity.slots[0] = new ItemStack("minecraft:diamond", 3);
        const props = new Map([
            [BLOCK_KEY_PROPERTY, "overworld:1:64:2"],
            [BLOCK_COMPONENT_PROPERTY, "containerui:crate"],
        ]);
        Object.assign(entity, { id: "native-storage-1", typeId: "containerui:block_storage", getDynamicProperty: (id) => props.get(id) });
        const fire = (name, event) => (__subscribers.get(`after:${name}`) ?? []).forEach((callback) => callback(event));

        events.length = 0;
        fire("entityContainerOpened", { entity, openSource: { entity: player } });
        const opened = events.find((event) => event.kind === "opened");
        check("the engine's open is logged with its viewer", opened?.player === "Tester" && opened?.detail?.startsWith("native"), JSON.stringify(events));
        check("with what the storage holds", events.some((event) => event.kind === "inventory" && event.detail?.includes("0:diamondx3")), JSON.stringify(events));
        check("an open storage is in use, so the sneak machine cannot park it", hasOpenSessions("native-storage-1"));
        fire("entityContainerClosed", { entity, closeSource: { entity: player } });
        check("closing is logged and frees it", events.some((event) => event.kind === "closed") && !hasOpenSessions("native-storage-1"), JSON.stringify(events));
        fire("entityContainerOpened", { entity, openSource: { entity: player } });
        fire("playerLeave", { playerId: "player-1" });
        check("a viewer who leaves with it open frees it too", !hasOpenSessions("native-storage-1"));

        const fireBefore = (name, event) => (__subscribers.get(`before:${name}`) ?? []).forEach((callback) => callback(event));
        const crateClick = { player, target: entity, cancel: false };
        fireBefore("playerInteractWithEntity", crateClick);
        check("a click on a native block's storage entity is left to the engine", crateClick.cancel === false);

        const machineEvents = [];
        registerBlockContainer(registry, "containerui:machine", { size: 27, render: () => null, onEvent: (vigenersl) => machineEvents.push(vigenersl) });
        const machine = storageEntity(ItemStack, 27);
        const machineProps = new Map([
            [BLOCK_KEY_PROPERTY, "overworld:3:64:2"],
            [BLOCK_COMPONENT_PROPERTY, "containerui:machine"],
        ]);
        Object.assign(machine, { id: "machine-storage-1", typeId: "containerui:block_storage", getDynamicProperty: (id) => machineProps.get(id) });
        const machineClick = { player, target: machine, cancel: false };
        fireBefore("playerInteractWithEntity", machineClick);
        check("a click on a menu block's storage entity is cancelled, so its raw inventory stays shut", machineClick.cancel === true);
        check(
            "and opens the menu instead",
            machineEvents.some((event) => event.kind === "interact" && event.detail?.startsWith("menu") && event.blockKey === "overworld:3:64:2"),
            JSON.stringify(machineEvents),
        );

        // The stub cannot mount a surface, so the menu's session closes on the next microtask:
        // the repeat click comes before any `await`, and on a later tick so the same-tick guard
        // does not drop it.
        stubSystem.currentTick += 1;
        const repeatClick = { player, target: machine, cancel: false };
        fireBefore("playerInteractWithEntity", repeatClick);
        check(
            "a second click on the block whose menu is open keeps that menu",
            repeatClick.cancel === true && machineEvents.some((event) => event.detail === "menu: already open, kept"),
            JSON.stringify(machineEvents),
        );
        check("and builds no second one", machineEvents.filter((event) => event.kind === "opened").length === 1, JSON.stringify(machineEvents));
    }
    {
        // A player parks a storage by sneaking at it, then leaves the game before standing up.
        const { __subscribers, __intervals, system: stubSystem, world: stubWorld } = await loadEngine();
        const { STORAGE_UUID_PROPERTY, BLOCK_KEY_PROPERTY, HIDDEN_TAG, STORAGE_ENTITY_TYPE_ID } = await load("platform/constants.js");
        const fire = (name, event) => (__subscribers.get(`after:${name}`) ?? []).forEach((callback) => callback(event));
        const sneakTick = __intervals.find((callback) => callback.name === "tick");
        const dimension = { id: "overworld", heightRange: { min: -64, max: 320 } };
        const tags = new Set();
        const props = new Map([
            [STORAGE_UUID_PROPERTY, "uuid-sneak"],
            [BLOCK_KEY_PROPERTY, "overworld:4:64:4"],
        ]);
        const storage = {
            id: "sneak-storage",
            typeId: STORAGE_ENTITY_TYPE_ID,
            isValid: true,
            dimension,
            location: { x: 4.5, y: 64, z: 4.5 },
            getDynamicProperty: (id) => props.get(id),
            addTag: (tag) => tags.add(tag),
            removeTag: (tag) => tags.delete(tag),
            hasTag: (tag) => tags.has(tag),
            teleport(location) {
                this.location = location;
            },
        };
        const sneaker = {
            id: "sneaker",
            name: "Sneaker",
            typeId: "minecraft:player",
            isValid: true,
            isSneaking: true,
            dimension,
            getEntitiesFromViewDirection: () => [{ entity: storage }],
            getBlockFromViewDirection: () => ({ block: { location: { x: 4, y: 64, z: 4 } } }),
            setDynamicProperty: () => undefined,
        };
        const saved = { getAllPlayers: stubWorld.getAllPlayers, getEntity: stubWorld.getEntity, getDimension: stubWorld.getDimension };
        stubWorld.getAllPlayers = () => (sneaker.isValid ? [sneaker] : []);
        stubWorld.getEntity = (id) => (id === storage.id ? storage : id === sneaker.id && sneaker.isValid ? sneaker : undefined);
        stubWorld.getDimension = () => ({ ...dimension, getEntities: () => (tags.has(HIDDEN_TAG) ? [storage] : []) });
        stubSystem.currentTick = 1000;
        try {
            sneakTick();
            const wasParked = tags.has(HIDDEN_TAG) && storage.location.y !== 64;
            sneaker.isValid = false;
            fire("playerLeave", { playerId: "sneaker" });
            sneakTick();
            check(
                "a player who leaves mid-break gets the storage put back in its block",
                wasParked && !tags.has(HIDDEN_TAG) && storage.location.y === 64,
                `parked=${wasParked} hidden=${tags.has(HIDDEN_TAG)} y=${storage.location.y}`,
            );
        } finally {
            Object.assign(stubWorld, saved);
            stubSystem.currentTick = 0;
        }
    }
    {
        // A second parked-and-restored storage, long after the first: the first one's cooldown has run out.
        const { __subscribers, __intervals, system: stubSystem, world: stubWorld } = await loadEngine();
        const { countRestoreCooldowns } = await load("platform/block/blockSneak.js");
        const { STORAGE_UUID_PROPERTY, BLOCK_KEY_PROPERTY, HIDDEN_TAG, STORAGE_ENTITY_TYPE_ID } = await load("platform/constants.js");
        const fire = (name, event) => (__subscribers.get(`after:${name}`) ?? []).forEach((callback) => callback(event));
        const sneakTick = __intervals.find((callback) => callback.name === "tick");
        const dimension = { id: "overworld", heightRange: { min: -64, max: 320 } };
        const tags = new Set();
        const props = new Map([
            [STORAGE_UUID_PROPERTY, "stored-id-later"],
            [BLOCK_KEY_PROPERTY, "overworld:8:64:8"],
        ]);
        const storage = {
            id: "sneak-storage-later",
            typeId: STORAGE_ENTITY_TYPE_ID,
            isValid: true,
            dimension,
            location: { x: 8.5, y: 64, z: 8.5 },
            getDynamicProperty: (id) => props.get(id),
            addTag: (tag) => tags.add(tag),
            removeTag: (tag) => tags.delete(tag),
            hasTag: (tag) => tags.has(tag),
            teleport(location) {
                this.location = location;
            },
        };
        const sneaker = {
            id: "sneaker-later",
            name: "Later",
            typeId: "minecraft:player",
            isValid: true,
            isSneaking: true,
            dimension,
            getEntitiesFromViewDirection: () => [{ entity: storage }],
            getBlockFromViewDirection: () => ({ block: { location: { x: 8, y: 64, z: 8 } } }),
            setDynamicProperty: () => undefined,
        };
        const saved = { getAllPlayers: stubWorld.getAllPlayers, getEntity: stubWorld.getEntity, getDimension: stubWorld.getDimension };
        stubWorld.getAllPlayers = () => (sneaker.isValid ? [sneaker] : []);
        stubWorld.getEntity = (id) => (id === storage.id ? storage : id === sneaker.id && sneaker.isValid ? sneaker : undefined);
        stubWorld.getDimension = () => ({ ...dimension, getEntities: () => (tags.has(HIDDEN_TAG) ? [storage] : []) });
        stubSystem.currentTick = 5000;
        try {
            sneakTick();
            sneaker.isValid = false;
            fire("playerLeave", { playerId: "sneaker-later" });
            check(
                "a restore forgets the cooldowns that ran out",
                typeof countRestoreCooldowns === "function" && countRestoreCooldowns() === 1,
                String(typeof countRestoreCooldowns === "function" ? countRestoreCooldowns() : "no counter"),
            );
        } finally {
            Object.assign(stubWorld, saved);
            stubSystem.currentTick = 0;
        }
    }

    console.log("\n  storage entities and the blocks that replace them\n");
    {
        freshRuntime();
        const { ItemStack, __subscribers, system: stubSystem } = await loadEngine();
        const { registerBlockContainer } = await load("platform/block/blockContainer.js");
        const { setBlockContainerLogger } = await load("platform/block/blockEvents.js");
        const { registerSession, recordNativeAccess } = await load("platform/block/blockSessions.js");
        const { removeStorage } = await load("platform/block/storageRemoval.js");
        const { BlockStorage } = await load("platform/block/blockStorage.js");
        const { BLOCK_KEY_PROPERTY, BLOCK_COMPONENT_PROPERTY, BLOCK_TYPE_PROPERTY, STORAGE_ENTITY_TYPE_ID } = await load("platform/constants.js");
        const fire = (name, event) => (__subscribers.get(`after:${name}`) ?? []).forEach((callback) => callback(event));
        const fireBefore = (name, event) => (__subscribers.get(`before:${name}`) ?? []).forEach((callback) => callback(event));

        const components = new Map();
        const registry = { registerCustomComponent: (name, component) => components.set(name, component) };
        const records = [];
        const menuRecords = [];
        setBlockContainerLogger((event) => records.push(event));
        registerBlockContainer(registry, "containerui:vault", { size: 27, onEvent: (vigenersl) => records.push(vigenersl) });
        registerBlockContainer(registry, "containerui:press", { size: 54, render: () => null, onEvent: (vigenersl) => menuRecords.push(vigenersl) });
        const player = { id: "replacer-1", name: "Replacer", typeId: "minecraft:player", isValid: true };
        const vault = { typeId: "containerui:vault", isAir: false };
        const stone = { typeId: "minecraft:stone", isAir: false };

        /** A dimension holding `entities`, with the block under every position set by `world.block`. */
        const makeWorld = () => {
            const entities = [];
            const drops = [];
            const spawned = [];
            const state = { block: stone, spawnSize: 27 };
            const dimension = {
                id: "overworld",
                heightRange: { min: -64, max: 320 },
                getEntities: () => entities.filter((entity) => entity.isValid),
                getBlock: () => state.block,
                spawnItem: (stack, at) => drops.push(`${stack.typeId}x${stack.amount}@${at.x},${at.y},${at.z}`),
                spawnEntity: (typeId, at) => {
                    const entity = makeEntity({ id: `spawned-${spawned.length + 1}`, size: state.spawnSize, dimension });
                    entity.typeId = typeId;
                    entity.location = at;
                    spawned.push(entity);
                    entities.push(entity);
                    return entity;
                },
            };
            return { dimension, entities, drops, spawned, state };
        };

        /** A storage entity as the block's component left it. */
        const makeEntity = ({ id, size = 27, dimension, component = "containerui:vault", key = "overworld:5:64:5", blockType = "containerui:vault", tags = [] }) => {
            const entity = storageEntity(ItemStack, size);
            const props = new Map([
                [BLOCK_KEY_PROPERTY, key],
                [BLOCK_COMPONENT_PROPERTY, component],
                [BLOCK_TYPE_PROPERTY, blockType],
            ]);
            return Object.assign(entity, {
                id,
                typeId: STORAGE_ENTITY_TYPE_ID,
                dimension,
                removed: false,
                location: { x: 5.5, y: 64, z: 5.5 },
                nameTag: "",
                getDynamicProperty: (propertyId) => props.get(propertyId),
                setDynamicProperty: (propertyId, value) => props.set(propertyId, value),
                hasTag: (tag) => tags.includes(tag),
                addTag: (tag) => tags.push(tag),
                triggerEvent: () => undefined,
                remove() {
                    this.removed = true;
                    this.isValid = false;
                },
            });
        };

        const place = (component, dimension, block = { x: 5, y: 64, z: 5 }) =>
            components.get(component).onPlace({ block: { location: block, typeId: component }, dimension });

        // A crate replaced by a machine with no break event: the machine must not inherit the crate's entity.
        {
            const scene = makeWorld();
            const crateEntity = makeEntity({ id: "replaced-crate", dimension: scene.dimension });
            crateEntity.slots[0] = new ItemStack("minecraft:diamond", 3);
            scene.entities.push(crateEntity);
            scene.state.spawnSize = 54;
            records.length = 0;
            place("containerui:press", scene.dimension);
            check("a placed block does not adopt another component's storage", crateEntity.removed === true, `removed=${crateEntity.removed}`);
            check("the replaced storage's items drop where its block stood", scene.drops.join(",") === "minecraft:diamondx3@5.5,64.5,5.5", scene.drops.join(","));
            check("a fresh storage is spawned for the new block", scene.spawned.length === 1, `spawned=${scene.spawned.length}`);
            check(
                "and it belongs to the new component",
                scene.spawned[0]?.getDynamicProperty(BLOCK_COMPONENT_PROPERTY) === "containerui:press" && scene.spawned[0]?.getDynamicProperty(BLOCK_TYPE_PROPERTY) === "containerui:press",
            );
            check("the replacement is logged", records.some((event) => event.kind === "orphan-removed" && event.detail?.includes("replacedBy=containerui:press")), JSON.stringify(records));
        }
        // The same component at another size is no more usable.
        {
            const scene = makeWorld();
            const small = makeEntity({ id: "replaced-small", size: 9, dimension: scene.dimension });
            small.slots[0] = new ItemStack("minecraft:gold_ingot", 2);
            scene.entities.push(small);
            place("containerui:vault", scene.dimension);
            check("a storage of the right component but the wrong size is replaced", small.removed === true && scene.spawned.length === 1, `removed=${small.removed} spawned=${scene.spawned.length}`);
            check("with its items dropped", scene.drops.join(",") === "minecraft:gold_ingotx2@5.5,64.5,5.5", scene.drops.join(","));
        }
        // Its own storage is kept, so a re-placed block keeps its inventory.
        {
            const scene = makeWorld();
            const own = makeEntity({ id: "kept-vault", dimension: scene.dimension, blockType: "containerui:vault_old" });
            own.slots[0] = new ItemStack("minecraft:emerald", 4);
            scene.entities.push(own);
            place("containerui:vault", scene.dimension);
            check("a storage of the same component and size is kept", own.removed === false && scene.spawned.length === 0 && scene.drops.length === 0);
            check("and its recorded block type follows the block now there", own.getDynamicProperty(BLOCK_TYPE_PROPERTY) === "containerui:vault");
        }

        // A block replaced without a break: its entity is found out when someone opens or clicks it.
        {
            const scene = makeWorld();
            const orphan = makeEntity({ id: "orphan-open", dimension: scene.dimension, key: "overworld:6:64:6" });
            orphan.slots[0] = new ItemStack("minecraft:diamond", 5);
            scene.entities.push(orphan);
            fire("entityContainerOpened", { entity: orphan, openSource: { entity: player } });
            check("a native open of an orphaned storage settles it", orphan.removed === true && scene.drops.join(",") === "minecraft:diamondx5@6.5,64.5,6.5", `removed=${orphan.removed} drops=${scene.drops}`);

            const clicked = makeEntity({ id: "orphan-click", dimension: scene.dimension, key: "overworld:7:64:7" });
            clicked.slots[0] = new ItemStack("minecraft:iron_ingot", 6);
            const click = { player, target: clicked, cancel: false };
            fireBefore("playerInteractWithEntity", click);
            check("a click on an orphaned storage settles it", clicked.removed === true && scene.drops.some((drop) => drop.startsWith("minecraft:iron_ingotx6")), `removed=${clicked.removed} drops=${scene.drops}`);
            check("and the engine is not stopped from handling the click", click.cancel === false);

            const menuOrphan = makeEntity({ id: "orphan-menu", dimension: scene.dimension, component: "containerui:press", blockType: "containerui:press", size: 54, key: "overworld:8:64:8" });
            menuRecords.length = 0;
            stubSystem.currentTick += 1;
            const menuClick = { player, target: menuOrphan, cancel: false };
            fireBefore("playerInteractWithEntity", menuClick);
            check("a click on an orphaned menu block settles it", menuOrphan.removed === true, `removed=${menuOrphan.removed}`);
            check("and opens no menu over nothing", !menuRecords.some((event) => event.kind === "opened" || event.detail?.startsWith("menu")), JSON.stringify(menuRecords));
        }
        // Whatever is not certain is left alone.
        {
            const scene = makeWorld();
            const liveBlock = makeEntity({ id: "live-vault", dimension: scene.dimension, key: "overworld:9:64:9" });
            scene.state.block = vault;
            fire("entityContainerOpened", { entity: liveBlock, openSource: { entity: player } });
            fireBefore("playerInteractWithEntity", { player, target: liveBlock, cancel: false });
            check("a storage under its own block is kept when opened or clicked", liveBlock.removed === false);
            fire("entityContainerClosed", { entity: liveBlock, closeSource: { entity: player } });

            scene.state.block = stone;
            const watched = makeEntity({ id: "watched-orphan", dimension: scene.dimension, key: "overworld:10:64:10" });
            recordNativeAccess({ entityId: "watched-orphan", viewerId: "someone-else", isOpen: true });
            fireBefore("playerInteractWithEntity", { player, target: watched, cancel: false });
            check("an orphan someone has open is left to its viewer", watched.removed === false);
            recordNativeAccess({ entityId: "watched-orphan", viewerId: "someone-else", isOpen: false });

            scene.state.block = undefined;
            const unloaded = makeEntity({ id: "unloaded-orphan", dimension: scene.dimension, key: "overworld:11:64:11" });
            fireBefore("playerInteractWithEntity", { player, target: unloaded, cancel: false });
            check("a storage in an unloaded chunk is left alone", unloaded.removed === false);

            scene.state.block = stone;
            const foreign = makeEntity({ id: "foreign-orphan", dimension: scene.dimension, component: "someone:else", key: "overworld:12:64:12" });
            fire("entityContainerOpened", { entity: foreign, openSource: { entity: player } });
            check("a storage of a component this world does not register is left alone", foreign.removed === false);

            const plain = { typeId: "minecraft:cow", isValid: true };
            fireBefore("playerInteractWithEntity", { player, target: plain, cancel: false });
            check("a click on another entity is not looked at", plain.isValid === true);
        }

        // A menu that cannot close must not strand the items of a block that is gone.
        {
            const scene = makeWorld();
            const entity = makeEntity({ id: "stuck-menu", dimension: scene.dimension });
            entity.slots[0] = new ItemStack("minecraft:diamond", 2);
            registerSession("stuck-menu", {
                close: () => {
                    throw new Error("close failed");
                },
            });
            let isThrown = false;
            try {
                removeStorage({ entity, location: { x: 5, y: 64, z: 5 }, dropOnBreak: true });
            } catch {
                isThrown = true;
            }
            check("removing a storage survives a menu that fails to close", !isThrown);
            check("and still drops its items", scene.drops.join(",") === "minecraft:diamondx2@5.5,64.5,5.5", scene.drops.join(","));
            check("and still removes the entity", entity.removed === true);
        }

        // A cached storage is evicted once its entity is found gone, and a native open's storage once its last viewer closes.
        {
            const { __intervals } = await loadEngine();
            const scene = makeWorld();
            const gone = makeEntity({ id: "killed-storage", dimension: scene.dimension });
            const storage = BlockStorage.forEntity(gone);
            const before = __intervals.length;
            storage.startWatching(10);
            const watchPass = __intervals[before];
            gone.isValid = false;
            watchPass();
            check("a storage whose entity is found gone is evicted", BlockStorage.forEntity(gone) !== storage);
            BlockStorage.evict("killed-storage");

            const crate = makeEntity({ id: "opened-natively", dimension: scene.dimension, key: "overworld:13:64:13" });
            scene.state.block = vault;
            const described = BlockStorage.forEntity(crate);
            fire("entityContainerOpened", { entity: crate, openSource: { entity: player } });
            check("the storage made to describe a native open stays while it is open", BlockStorage.forEntity(crate) === described);
            fire("entityContainerClosed", { entity: crate, closeSource: { entity: player } });
            check("and goes with the last viewer", BlockStorage.forEntity(crate) !== described);
            BlockStorage.evict("opened-natively");
        }
        setBlockContainerLogger(null);
    }
};
