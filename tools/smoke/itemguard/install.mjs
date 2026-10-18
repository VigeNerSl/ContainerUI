/** Uninstalling the guard, and installing it again: everyone already in the world is swept on the next tick. */

export const checkInstall = async ({ check, load, ItemStack, toItemStack, world, system }) => {
    console.log("\n  install and uninstall\n");

    // Uninstalling takes the new subscription away with the others.
    {
        const { uninstallBedrockRuntime } = await load("platform/lifecycle.js");
        uninstallBedrockRuntime();
        check("uninstalling unsubscribes from entity loads", world.afterEvents.entityLoad.handlers.length === 0, String(world.afterEvents.entityLoad.handlers.length));
    }

    // Installing the guard sweeps everyone already in the world: after a script reload nobody joins.
    {
        const { installBedrockRuntime } = await load("platform/surface/runtimeInstall.js");
        const { uninstallBedrockRuntime } = await load("platform/lifecycle.js");
        const slots = [toItemStack({ typeId: "minecraft:diamond", name: "Buy" }), new ItemStack("minecraft:dirt", 5)];
        const enderSlots = [new ItemStack("minecraft:dirt", 2), toItemStack({ typeId: "minecraft:emerald", name: "Sell" })];
        const containerOver = (held) => ({ size: held.length, getItem: (index) => held[index] ?? undefined, setItem: (index, stack) => (held[index] = stack ?? null) });
        world.onlinePlayers = [
            {
                name: "Steve",
                getComponent: (id) => {
                    if (id === "minecraft:inventory") return { container: containerOver(slots) };
                    if (id === "minecraft:ender_inventory") return { container: containerOver(enderSlots) };
                    return undefined;
                },
            },
        ];
        // Ticks held back, so "at once" and "on the next tick" differ.
        const nextTick = [];
        const runNow = system.run;
        system.run = (callback) => (nextTick.push(callback), 0);
        installBedrockRuntime();
        check("installing the runtime installs the guard at once", world.afterEvents.entityItemDrop.handlers.length === 1, String(world.afterEvents.entityItemDrop.handlers.length));
        check("before the world loads, it sweeps nobody", slots[0]?.typeId === "minecraft:diamond", JSON.stringify(slots.map((stack) => stack?.typeId ?? null)));
        system.run = runNow;
        nextTick.forEach((callback) => callback());
        check("on the next tick it sweeps the players already in the world", slots[0] === null && slots[1]?.typeId === "minecraft:dirt", JSON.stringify(slots.map((stack) => stack?.typeId ?? null)));
        check("their ender chests included", enderSlots[1] === null && enderSlots[0]?.typeId === "minecraft:dirt", JSON.stringify(enderSlots.map((stack) => stack?.typeId ?? null)));
        world.onlinePlayers = [];
        uninstallBedrockRuntime();
    }
};
