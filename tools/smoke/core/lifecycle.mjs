/** uninstallBedrockRuntime: every world subscription and timer the adapter made is undone, and installing again works. */

const countSubscribers = (subscribers) => [...subscribers.values()].reduce((total, callbacks) => total + callbacks.length, 0);

export const checkLifecycle = async ({ check, core, load, loadEngine }) => {
    console.log("\n  uninstall\n");

    const engine = await loadEngine();
    const { uninstallBedrockRuntime } = await load("platform/lifecycle.js");
    const { installItemGuard } = await load("platform/items/itemGuard.js");
    const { installBlockSneak } = await load("platform/block/blockSneak.js");
    const { installStorageAccess } = await load("platform/block/storageAccess.js");
    const { installOrphanSweep } = await load("platform/block/storageRemoval.js");
    const { installContainerClosedHook } = await load("platform/surface/surfaceRegistry.js");
    const { installBedrockRuntime } = await load("platform/surface/openContainer.js");

    const installAll = () => {
        installBedrockRuntime();
        installItemGuard();
        installBlockSneak();
        installStorageAccess();
        installOrphanSweep();
        installContainerClosedHook();
    };

    installAll();
    uninstallBedrockRuntime();
    const baseline = countSubscribers(engine.__subscribers);

    installAll();
    const installed = countSubscribers(engine.__subscribers);
    check("installing subscribes to world events", installed > baseline, `baseline=${baseline} installed=${installed}`);

    uninstallBedrockRuntime();
    check("uninstalling unsubscribes from every one", countSubscribers(engine.__subscribers) === baseline, `after=${countSubscribers(engine.__subscribers)} baseline=${baseline}`);
    check("uninstalling removes the installed scheduler", !core.hasRuntimeScheduler() && !core.hasTimeSource());

    installAll();
    check("installing again subscribes as many as the first time", countSubscribers(engine.__subscribers) === installed, `again=${countSubscribers(engine.__subscribers)} first=${installed}`);
    uninstallBedrockRuntime();
};
