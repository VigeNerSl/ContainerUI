/** Checks that the fluent builder produces an ordinary element tree, mounted against a test host. */

import { runSuite } from "./harness.mjs";

const pane = { typeId: "minecraft:gray_stained_glass_pane", name: " " };

/** Runs `create` and returns what it threw, or `null`. */
const thrownBy = (create) => {
    try {
        create();
        return null;
    } catch (error) {
        return error;
    }
};

await runSuite({ label: "builder", passed: "fluent builder ok", crashed: "builder smoke failed" }, async ({ check, load }) => {
    const { ContainerFormBuilder, createManualSchedulerHost, configureRuntime, createMemoryStorage, createTestHost, mount, signal } = await load("core/index.js");

    configureRuntime(createManualSchedulerHost());

    /** Mounts a builder's tree and returns the host, so writes can be inspected. */
    const render = (builder) => {
        const host = createTestHost({ slotCount: builder.size });
        const app = mount(() => builder.build(), host);
        return { host, app };
    };

    console.log("\n  fluent builder\n");

    // The tree it produces is an ordinary tree.
    {
        const clicks = [];
        const builder = new ContainerFormBuilder(27)
            .title("§6Shop")
            .border(pane)
            .button(11, { typeId: "minecraft:diamond", name: "Buy" }, (event) => clicks.push(event.index));

        const { host, app } = render(builder);

        check("the title is carried", builder.resolvedTitle === "§6Shop");
        check("the border is painted", host.readSlot(0)?.typeId === "minecraft:gray_stained_glass_pane");
        check("the button is painted", host.readSlot(11)?.name === "Buy");
        check("the middle is left empty", host.readSlot(13) === null);

        host.clearHistory();
        host.simulateTake(11);
        app.flush();
        check("a click reaches the handler", clicks.length === 1, `clicks=${clicks.length}`);
        check("the button is restored", host.readSlot(11)?.typeId === "minecraft:diamond");
        app.unmount();
    }

    // A function item stays on the fine-grained path.
    {
        const coins = signal(10);
        const builder = new ContainerFormBuilder(27).slot(4, () => ({ typeId: "minecraft:paper", name: `Coins: ${coins.value}` }));
        const { host, app } = render(builder);

        check("a function item renders", host.readSlot(4)?.name === "Coins: 10");

        host.clearHistory();
        coins.value = 25;
        app.flush();
        check("changing the signal repaints the slot", host.readSlot(4)?.name === "Coins: 25");
        check("and costs exactly one write", host.writes.length === 1, `writes=${host.writes.length}`);
        app.unmount();
    }

    // Declared slots win over fill and border.
    {
        const builder = new ContainerFormBuilder(27)
            .button(4, { typeId: "minecraft:emerald", name: "Keep me" })
            .reserve(5)
            .fill(pane);
        const { host, app } = render(builder);

        check("fill does not paint over a declared slot", host.readSlot(4)?.name === "Keep me");
        check("a reserved slot stays empty", host.readSlot(5) === null);
        check("fill covers the rest", host.readSlot(6)?.typeId === "minecraft:gray_stained_glass_pane");
        app.unmount();
    }

    // Patterns, and their two failures.
    {
        const builder = new ContainerFormBuilder(27).pattern(["#########", "#       #", "#########"], { "#": pane });
        const { host, app } = render(builder);

        check("a pattern paints its perimeter", host.readSlot(0) !== null && host.readSlot(26) !== null);
        check("a pattern leaves spaces alone", host.readSlot(10) === null);
        // 9 + 2 + 9: the middle row contributes only its edges.
        check("a pattern claims the right count", builder.claimedIndices.length === 20, `claimed=${builder.claimedIndices.length}`);
        app.unmount();

        const overWide = thrownBy(() => new ContainerFormBuilder(27).pattern(["##########"], { "#": pane }));
        check("an over-wide row throws instead of truncating", overWide instanceof RangeError, String(overWide));

        const unmapped = thrownBy(() => new ContainerFormBuilder(27).pattern(["#X#"], { "#": pane }));
        check("an unmapped character throws", unmapped instanceof RangeError, String(unmapped));
    }

    // rect, and an out-of-range index.
    {
        const builder = new ContainerFormBuilder(27).rect({ from: [1, 1], to: [3, 1] }, pane);
        const { host, app } = render(builder);
        check("rect fills the inclusive range", host.readSlot(10) !== null && host.readSlot(12) !== null);
        check("rect stops at the edge", host.readSlot(13) === null);
        app.unmount();

        const outOfRange = thrownBy(() => new ContainerFormBuilder(27).slot(27, pane));
        check("an out-of-range slot throws", outOfRange instanceof RangeError, String(outOfRange));
    }

    // A mirrored storage is real access, and fill respects its range.
    {
        const storage = createMemoryStorage(5, [{ typeId: "minecraft:iron_ingot", amount: 3 }]);
        const builder = new ContainerFormBuilder(27).storage(storage).fill(pane);
        const { host, app } = render(builder);

        check("the storage is mirrored from the first free slot", host.readSlot(0)?.typeId === "minecraft:iron_ingot");
        check("fill does not paint over the mirrored range", host.readSlot(4) === null);
        check("fill covers past the range", host.readSlot(5)?.typeId === "minecraft:gray_stained_glass_pane");

        host.clearHistory();
        storage.set(1, { typeId: "minecraft:gold_ingot", amount: 1 });
        app.flush();
        check("a storage write repaints the mirror", host.readSlot(1)?.typeId === "minecraft:gold_ingot");
        app.unmount();

        // The mirror is contiguous from the first free slot: a claimed slot inside its range throws
        // instead of being replaced by a storage slot.
        const close = { typeId: "minecraft:barrier", name: "Close" };
        const overrun = thrownBy(() => new ContainerFormBuilder(27).button(5, close, () => undefined).storage(createMemoryStorage(9)));
        check("a mirror over a claimed slot throws", overrun instanceof RangeError && String(overrun).includes("slot 5"), String(overrun));
        const clear = thrownBy(() => new ContainerFormBuilder(27).button(5, close, () => undefined).storage(createMemoryStorage(9), { count: 5 }));
        check("a mirror that stops before it does not", clear === null, String(clear));
    }

    // Changing the builder after mounting still takes effect, because build() runs again.
    {
        const builder = new ContainerFormBuilder(27).slot(0, pane);
        const { host, app } = render(builder);
        check("the first slot is painted", host.readSlot(0) !== null);

        builder.slot(1, { typeId: "minecraft:apple" });
        app.flush();
        check("a slot added after mount appears on the next commit", host.readSlot(1)?.typeId === "minecraft:apple");
        app.unmount();
    }
});
