/**
 * Component identity, loop protection, JSX, layout overflow, reveal, effect lifetime, real items
 * in the diff, and one commit per change.
 */

export const checkRuntime = async ({ check, core, freshRuntime }) => {
    const { h, signal, effect, createRoot, mount, useState, createTestHost, createMemoryStorage, StorageSlots } = core;

    console.log("\n  component identity\n");
    {
        const { clock } = freshRuntime();
        const make = (typeId) => () => h("slot", { index: 0, item: { typeId } });
        const Apple = make("minecraft:apple");
        const Bread = make("minecraft:bread");
        const showApple = signal(true);
        const host = createTestHost({ slotCount: 9 });
        mount(() => (showApple.value ? h(Apple) : h(Bread)), host);
        showApple.value = false;
        clock.runPending();
        check("two anonymous components are two components", host.readSlot(0)?.typeId === "minecraft:bread", `slot0=${host.readSlot(0)?.typeId}`);
    }
    {
        const { clock } = freshRuntime();
        const first = { Card: () => h("slot", { index: 0, item: { typeId: "minecraft:apple" } }) };
        const second = { Card: () => h("slot", { index: 0, item: { typeId: "minecraft:bread" } }) };
        const isFirst = signal(true);
        const host = createTestHost({ slotCount: 9 });
        mount(() => h(isFirst.value ? first.Card : second.Card, { key: "card" }), host);
        isFirst.value = false;
        clock.runPending();
        check("two components sharing a name and a key stay apart", host.readSlot(0)?.typeId === "minecraft:bread", `slot0=${host.readSlot(0)?.typeId}`);
    }
    {
        const { clock } = freshRuntime();
        let setCount = null;
        const Counter = () => {
            const [count, update] = useState(0);
            setCount = update;
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count}` } });
        };
        const tick = signal(0);
        const host = createTestHost({ slotCount: 9 });
        mount(() => (tick.value, h(Counter)), host);
        setCount(5);
        clock.runPending();
        tick.value = 1;
        clock.runPending();
        check("the same component keeps its state across a parent pass", host.readSlot(0)?.name === "count:5", `slot0=${host.readSlot(0)?.name}`);
    }

    console.log("\n  loop protection\n");
    {
        const { clock, errors } = freshRuntime();
        const isLooping = signal(false);
        const loop = signal(0);
        const count = signal(0);
        let loopRuns = 0;
        createRoot(() => {
            effect(() => {
                loopRuns++;
                if (!isLooping.value) return;
                loop.value;
                loop.set(loop.peek() + 1);
            });
        });
        const host = createTestHost({ slotCount: 9 });
        mount(() => h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count.value}` } }), host);

        isLooping.value = true;
        count.value = 1;
        clock.runPending();
        check("the loop is reported once", errors.length === 1, `errors=${errors.length}`);
        check("the commit still ran behind it", host.readSlot(0)?.name === "count:1", `slot0=${host.readSlot(0)?.name}`);

        isLooping.value = false;
        const runsBefore = loopRuns;
        count.value = 2;
        clock.runPending();
        check("the surface keeps updating afterwards", host.readSlot(0)?.name === "count:2", `slot0=${host.readSlot(0)?.name}`);
        check("the abandoned effect runs again when its dependencies change", loopRuns > runsBefore, `runs ${runsBefore} -> ${loopRuns}`);
    }
    {
        // Each run spends the whole budget, so every flush stops after one task and the
        // per-flush ceiling never trips.
        const { clock, errors } = freshRuntime({ budgetMs: 8 });
        const isLooping = signal(false);
        const loop = signal(0);
        const count = signal(0);
        createRoot(() => {
            effect(() => {
                if (!isLooping.value) return;
                loop.value;
                clock.advance(10);
                loop.set(loop.peek() + 1);
            });
        });
        const host = createTestHost({ slotCount: 9 });
        mount(() => h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count.value}` } }), host);
        // Started after mount, so it runs through the budgeted flush rather than flushSync.
        isLooping.value = true;
        count.value = 1;
        let settled = true;
        try {
            clock.runPending();
        } catch {
            settled = false;
        }
        check("a budget-spending loop is caught across flushes", settled && errors.length === 1, `settled=${settled} errors=${errors.length}`);
        check("and the commit is not starved", host.readSlot(0)?.name === "count:1", `slot0=${host.readSlot(0)?.name}`);
    }

    console.log("\n  jsx\n");
    {
        // The compiler imports `createElement` from the package root when a key follows a spread.
        const element = core.createElement?.("slot", { ...{ item: { typeId: "minecraft:stone" } }, key: "k" });
        check(
            "createElement is exported and keeps a key given in props",
            element?.key === "k" && element?.props.item?.typeId === "minecraft:stone" && !("key" in element.props),
            JSON.stringify(element),
        );
    }

    console.log("\n  layout overflow\n");
    {
        const overflowOf = (tree) => {
            freshRuntime();
            const diagnostics = [];
            mount(() => tree, createTestHost({ slotCount: 9 }), { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
            return diagnostics.find((diagnostic) => diagnostic.kind === "overflow")?.message ?? "none";
        };
        const stone = () => h("slot", { item: { typeId: "minecraft:stone" } });
        check("one cell past the end is one cell of overflow", overflowOf(Array.from({ length: 10 }, stone)).startsWith("1 cell(s)"), overflowOf(Array.from({ length: 10 }, stone)));
        check("and inside a layout too", overflowOf(h("row", { index: 7 }, stone(), stone(), stone())).startsWith("1 cell(s)"));
        const pinned = overflowOf([h("slot", { index: 30, item: { typeId: "minecraft:diamond" } }), h("slot", { index: -1, item: { typeId: "minecraft:emerald" } })]);
        check("a pinned index off the surface is reported, not dropped in silence", pinned.startsWith("2 cell(s)"), pinned);
    }

    console.log("\n  reveal\n");
    {
        // Every order shows something on its first step, whatever the surface's row count.
        const orders = ["sweep", "sweep-reverse", "rows", "columns", "wave", "center-out", "center-in", "spiral", "random"];
        const idle = orders
            .flatMap((order) => [27, 36, 54].map((size) => ({ order, size, first: Math.min(...core.revealSteps(order, size)) })))
            .filter(({ first }) => first !== 0);
        check("every reveal order starts on step 0", idle.length === 0, JSON.stringify(idle));
    }

    console.log("\n  effect lifetime\n");
    {
        // The body closes what owns it — a menu closing from its own effect — then reads and returns a cleanup.
        freshRuntime();
        const late = signal(0);
        let cleanups = 0;
        let runs = 0;
        createRoot((dispose) => {
            effect(() => {
                runs++;
                if (late.peek() === 0) dispose();
                late.value;
                return () => cleanups++;
            });
        });
        late.value = 1;
        check("an effect disposed by its own run still runs its cleanup", cleanups === 1, `cleanups=${cleanups}`);
        check("and keeps no subscription", late.subscribers.size === 0 && runs === 1, `subscribers=${late.subscribers.size} runs=${runs}`);
    }
    {
        // The same from a later run: the first run is ordinary, the second closes the owner.
        const { clock } = freshRuntime();
        const trigger = signal(0);
        let cleanups = 0;
        createRoot((dispose) => {
            effect(() => {
                if (trigger.value === 1) dispose();
                return () => cleanups++;
            });
        });
        trigger.value = 1;
        clock.runPending();
        trigger.value = 2;
        clock.runPending();
        check("an effect disposed by a later run runs each cleanup once", cleanups === 2 && trigger.subscribers.size === 0, `cleanups=${cleanups} subscribers=${trigger.subscribers.size}`);
    }
    {
        // Registered on a scope already gone: a cleanup runs at once, a child scope is born disposed.
        freshRuntime();
        let cleanups = 0;
        let child = null;
        createRoot((dispose) => {
            dispose();
            core.onCleanup(() => cleanups++);
            child = core.createScope();
        });
        check("a cleanup registered on a disposed scope runs at once", cleanups === 1, `cleanups=${cleanups}`);
        check("a scope created under a disposed one is disposed", child?.isDisposed === true);
    }
    {
        // An effect that closes its owner, then registers a cleanup and starts a nested effect.
        freshRuntime();
        let late = 0;
        let nestedRuns = 0;
        createRoot((dispose) => {
            effect(() => {
                dispose();
                core.onCleanup(() => late++);
                effect(() => {
                    nestedRuns++;
                });
            });
        });
        check("what an effect registers after closing its owner is released", late === 1 && nestedRuns === 0, `late=${late} nestedRuns=${nestedRuns}`);
    }

    console.log("\n  real items in the diff\n");
    {
        const { clock } = freshRuntime();
        const swordA = { typeId: "minecraft:diamond_sword", native: { id: "A-sharpness-5" } };
        const swordB = { typeId: "minecraft:diamond_sword", native: { id: "B-plain" } };
        const storage = createMemoryStorage(9, [swordA, { typeId: "minecraft:iron_ingot", native: { id: "ingot" } }]);
        const conflicts = [];
        const viewer1 = createTestHost({ slotCount: 9 });
        const viewer2 = createTestHost({ slotCount: 9 });
        mount(h(StorageSlots, { storage, onConflict: (event) => conflicts.push(event.index) }), viewer1);
        mount(h(StorageSlots, { storage, onConflict: (event) => conflicts.push(event.index) }), viewer2);

        // Viewer 2 drops their plain sword onto the enchanted one; A goes to their cursor.
        viewer2.simulateSwap(0, swordB);
        clock.runPending();
        check(
            "the other viewer is repainted with the new item",
            viewer1.readSlot(0)?.native?.id === "B-plain",
            `viewer1 holds ${viewer1.readSlot(0)?.native?.id}`,
        );

        const taken = viewer1.readSlot(0)?.native?.id;
        viewer1.simulateTake(0);
        clock.runPending();
        check("taking it yields the item storage held, not a copy of A", taken === "B-plain", `took ${taken}`);

        viewer1.clearHistory();
        storage.set(3, { typeId: "minecraft:apple" });
        clock.runPending();
        check("an unrelated change rewrites no real item", viewer1.writes.length === 1, `writes=${viewer1.writes.length}`);

        // A same-looking replacement behind the surface's back, then a take before the repaint.
        storage.silentSet(1, { typeId: "minecraft:iron_ingot", native: { id: "other-ingot" } });
        viewer1.simulateTake(1);
        check("a take of a replaced item is reported as a conflict", conflicts.includes(1), `conflicts=${conflicts.join(",")}`);
    }

    console.log("\n  commit once\n");
    {
        const { clock } = freshRuntime();
        const shift = signal(false);
        const Child = (props) => h("slot", { item: { typeId: "minecraft:paper", name: props.label } });
        const Parent = () => {
            const isShifted = shift.value;
            return h(
                "row",
                { index: 0 },
                isShifted ? h("slot", { item: { typeId: "minecraft:stone" } }) : null,
                h(Child, { label: isShifted ? "new" : "old" }),
            );
        };
        const host = createTestHost({ slotCount: 9 });
        mount(h(Parent), host);
        host.clearHistory();
        shift.value = true;
        clock.runPending();
        const trail = host.writes.map((write) => `${write.index}:${write.item?.name ?? write.item?.typeId ?? "empty"}`).join(", ");
        check("a child with new props is laid out once, with its new output", host.writes.length === 2, trail);
        check("no stale frame is written", !trail.includes(":old"), trail);
    }
};
