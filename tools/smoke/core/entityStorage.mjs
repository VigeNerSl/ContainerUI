/** EntityInventoryStorage through both of its subclasses: views, writes, a gone entity, and read failures reported once. */

import { storageEntity } from "./fixtures.mjs";

export const checkEntityStorage = async ({ check, load, loadEngine }) => {
    console.log("\n  entity inventory storages\n");

    const { ItemStack } = await loadEngine();
    const { PlayerInventoryStorage } = await load("platform/storage/playerStorage.js");
    const { BlockStorage } = await load("platform/block/blockStorage.js");
    const { setBlockContainerLogger } = await load("platform/block/blockEvents.js");

    {
        const player = { ...storageEntity(ItemStack, 36), id: "player-storage-1", name: "Steve" };
        const storage = PlayerInventoryStorage.forPlayer(player);
        check("one storage per player", PlayerInventoryStorage.forPlayer(player) === storage);

        const version = storage.version.peek();
        storage.set(4, { typeId: "minecraft:apple", amount: 3 });
        check("a write reaches the inventory", player.slots[4]?.typeId === "minecraft:apple" && player.slots[4]?.amount === 3, JSON.stringify(player.slots[4]));
        check("a write bumps the version", storage.version.peek() === version + 1);

        const first = storage.get(4);
        check("a slot keeps one view until it changes", first !== null && storage.get(4) === first);
        check("the size is the inventory's", storage.size === 36 && storage.isValid);

        player.isValid = false;
        let message = "";
        try {
            storage.set(0, null);
        } catch (error) {
            message = error.message;
        }
        check("writing to a gone player throws with the player's name", message.includes("Player Steve is gone"), message);
        PlayerInventoryStorage.evict(player.id);
        check("an evicted player gets a fresh storage", PlayerInventoryStorage.forPlayer({ ...player, isValid: true }) !== storage);
        PlayerInventoryStorage.evict(player.id);
    }
    {
        const records = [];
        setBlockContainerLogger((event) => records.push(event));
        try {
            const entity = { ...storageEntity(ItemStack, 9), id: "block-storage-unchanged" };
            const storage = BlockStorage.forEntity(entity);
            storage.set(0, { typeId: "minecraft:stone", amount: 2 });
            const view = storage.get(0);
            const version = storage.version.peek();
            records.length = 0;

            storage.set(1, null);
            storage.set(0, view);
            check("writing a slot what it holds is skipped", records.length === 0 && storage.version.peek() === version, JSON.stringify(records));

            storage.set(0, { typeId: "minecraft:stone", amount: 2 });
            check("an equal-looking new view is still written", records.length === 1 && storage.version.peek() === version + 1, JSON.stringify(records));

            const stale = storage.get(0);
            entity.slots[0] = new ItemStack("minecraft:dirt");
            storage.set(0, stale);
            check("a stale view over a changed slot is written back", entity.slots[0]?.typeId === "minecraft:stone", entity.slots[0]?.typeId);
            BlockStorage.evict(entity.id);
        } finally {
            setBlockContainerLogger(null);
        }
    }
    {
        // A chest opened natively, not watched: the player takes the diamonds out through its own screen.
        const crate = { ...storageEntity(ItemStack, 9), id: "block-storage-behind-its-back" };
        const storage = BlockStorage.forEntity(crate);
        crate.slots[0] = new ItemStack("minecraft:diamond", 5);
        const read = storage.get(0);
        crate.slots[0] = undefined;
        check("a slot emptied behind the storage's back reads empty", read?.typeId === "minecraft:diamond" && storage.get(0) === null, JSON.stringify(storage.get(0)));

        crate.slots[1] = new ItemStack("minecraft:emerald", 2);
        storage.get(1);
        crate.slots[1] = undefined;
        storage.set(1, null);
        storage.set(2, storage.get(1));
        check("an emptied slot cannot be copied into another", crate.slots[2] === undefined && storage.get(1) === null, JSON.stringify(crate.slots[2]));

        crate.slots[3] = new ItemStack("minecraft:iron_ingot", 4);
        const kept = storage.get(3);
        check("an unchanged slot keeps its view", storage.get(3) === kept);
        crate.slots[3] = new ItemStack("minecraft:iron_ingot", 1);
        check("a slot whose count changed behind its back is read again", storage.get(3)?.amount === 1);
        BlockStorage.evict(crate.id);
    }
    {
        const { __intervals } = await loadEngine();
        const records = [];
        setBlockContainerLogger((event) => records.push(event));
        try {
            const entity = { ...storageEntity(ItemStack, 9), id: "block-storage-watched" };
            const storage = BlockStorage.forEntity(entity);
            const before = __intervals.length;
            storage.startWatching(10);
            const watchPass = __intervals[before];

            // The stack written holds one item, not the zero the view asks for.
            storage.set(0, { typeId: "minecraft:stone", amount: 0 });
            records.length = 0;
            watchPass();
            check("the watch knows the stack a write produced", !records.some((event) => event.kind === "external-change"), JSON.stringify(records));

            entity.slots[4] = new ItemStack("minecraft:gold_ingot", 3);
            entity.slots[5] = new ItemStack("minecraft:apple", 1);
            watchPass();
            const untouched = storage.get(4);
            entity.slots[5] = new ItemStack("minecraft:apple", 2);
            watchPass();
            check("an outside change drops only the slots it changed", storage.get(4) === untouched && storage.get(5)?.amount === 2);
            storage.stopWatching();
            BlockStorage.evict(entity.id);
        } finally {
            setBlockContainerLogger(null);
        }
    }
    {
        const records = [];
        setBlockContainerLogger((event) => records.push(event));
        try {
            const entity = { ...storageEntity(ItemStack, 9), id: "block-storage-failures" };
            const storage = BlockStorage.forEntity(entity);
            storage.set(0, { typeId: "minecraft:stone", amount: 1 });
            check("a block storage write is logged", records.some((event) => event.kind === "storage-write" && event.detail.includes("slot=0")), JSON.stringify(records));

            const container = entity.getComponent("minecraft:inventory").container;
            container.isValid = false;
            storage.get(1);
            storage.get(2);
            const failures = records.filter((event) => event.kind === "storage-read-failed");
            check("read failures report once per outage", failures.length === 1, JSON.stringify(failures));

            container.isValid = true;
            storage.get(3);
            container.isValid = false;
            storage.get(4);
            check("a new outage reports again", records.filter((event) => event.kind === "storage-read-failed").length === 2);
            BlockStorage.evict(entity.id);
        } finally {
            setBlockContainerLogger(null);
        }
    }
};
