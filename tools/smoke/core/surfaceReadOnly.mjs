/** Closing a surface inside the read-only window of a `beforeEvents` handler: the hand-back and the removal wait a tick. */

export const checkReadOnlyClose = async ({ check, load, loadEngine, core, freshRuntime, menuWorld, BedrockSurface, ItemStack }) => {
    const { h, mount } = core;
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
};
