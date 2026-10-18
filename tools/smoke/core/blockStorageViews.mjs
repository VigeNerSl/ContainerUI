/** Block storage views: what a block's storage shows, and what its edits write. */

import { storageEntity } from "./fixtures.mjs";

export const checkBlockStorageViews = async ({ check, load, loadEngine, core, freshRuntime }) => {
    const { createTestHost, StorageSlots, h, mount } = core;
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
};
