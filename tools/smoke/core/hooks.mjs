/**
 * Suspense and resources, useId, context selectors, development checks, Confirm, hook-order
 * warnings, state writes from effects, reload after unmount, reveal argument checks, useReveal
 * width handling and useTicker's interval fallback.
 */

import { deferred, isRenderError, settleLoads } from "./fixtures.mjs";

export const checkHooks = async ({ check, core, freshRuntime }) => {
    const {
        h,
        signal,
        mount,
        useState,
        useEffect,
        useId,
        useResource,
        useContextSelector,
        createContext,
        provideContext,
        createTestHost,
        Suspense,
        ErrorBoundary,
        Confirm,
    } = core;

    console.log("\n  suspense and resources\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const pending = deferred();
        const tick = signal(0);
        let loads = 0;
        const Balance = () => {
            const balance = useResource(() => {
                loads++;
                return pending.promise;
            }, []);
            return h("slot", { index: 4, item: { typeId: "minecraft:gold_ingot", name: `coins:${balance.read()}` } });
        };
        mount(
            () => [
                h("slot", { index: 0, item: () => ({ typeId: "minecraft:paper", name: `tick:${tick.value}` }) }),
                h(Suspense, { fallback: h("slot", { index: 4, item: { typeId: "minecraft:clock", name: "loading" } }) }, h(Balance)),
            ],
            host,
        );
        clock.runPending();
        check("while loading, the fallback shows", host.readSlot(4)?.name === "loading", JSON.stringify(host.readSlot(4)));
        tick.value = 1;
        clock.runPending();
        tick.value = 2;
        clock.runPending();
        check("the waiting component stays mounted: one load, not one per pass", loads === 1, `loads=${loads}`);
        pending.resolve(42);
        await settleLoads(clock);
        check("once loaded, the content replaces the fallback", host.readSlot(4)?.name === "coins:42", JSON.stringify(host.readSlot(4)));
    }
    {
        // Two waiters share an identity string — the same component, first of its kind, in two parents.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const loads = { a: deferred(), b: deferred() };
        const Balance = (props) => {
            const balance = useResource(() => loads[props.who].promise, [props.who]);
            return h("slot", { index: props.index, item: { typeId: "minecraft:gold_ingot", name: `${props.who}:${balance.read()}` } });
        };
        const Row = (props) => h(Balance, props);
        mount(
            () =>
                h(
                    Suspense,
                    { fallback: h("slot", { index: 8, item: { typeId: "minecraft:clock", name: "loading" } }) },
                    h(Row, { who: "a", index: 0 }),
                    h(Row, { who: "b", index: 1 }),
                ),
            host,
        );
        clock.runPending();
        loads.a.resolve(10);
        await settleLoads(clock);
        check("the fallback stays while any waiter is loading, whatever its identity", host.readSlot(8)?.name === "loading", JSON.stringify(host.readSlot(8)));
        loads.b.resolve(20);
        await settleLoads(clock);
        check("and goes once the last one loads", !host.readSlot(8) && host.readSlot(1)?.name === "b:20", JSON.stringify(host.readSlot(1)));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const pending = deferred();
        const diagnostics = [];
        const Profile = () => {
            const profile = useResource(() => pending.promise, []);
            return h("slot", { index: 2, item: { typeId: "minecraft:name_tag", name: profile.read() } });
        };
        mount(
            () =>
                h(
                    ErrorBoundary,
                    { fallback: h("slot", { index: 2, item: { typeId: "minecraft:barrier", name: "offline" } }) },
                    h(Suspense, { fallback: h("slot", { index: 2, item: { typeId: "minecraft:clock", name: "loading" } }) }, h(Profile)),
                ),
            host,
            { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        );
        clock.runPending();
        pending.reject(new Error("database offline"));
        await settleLoads(clock);
        check("a failed load reaches the error boundary", host.readSlot(2)?.name === "offline", JSON.stringify(host.readSlot(2)));
        check("and is reported rather than left loading for ever", diagnostics.some((diagnostic) => isRenderError(diagnostic, "database offline")));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const pending = deferred();
        const Name = () => h("slot", { index: 1, item: { typeId: "minecraft:paper", name: useResource(() => pending.promise, []).read() } });
        mount(() => h(Name), host);
        check("with no Suspense above, a waiting component renders nothing", !host.readSlot(1), JSON.stringify(host.readSlot(1)));
        pending.resolve("Steve");
        await settleLoads(clock);
        check("and appears once its load settles", host.readSlot(1)?.name === "Steve", JSON.stringify(host.readSlot(1)));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const pages = [deferred(), deferred()];
        const page = signal(0);
        const Page = () => {
            const current = page.value;
            const data = useResource(() => pages[current].promise, [current]);
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: data.status === "ready" ? data.value : "..." } });
        };
        mount(() => h(Page), host);
        page.value = 1;
        clock.runPending();
        pages[1].resolve("page one");
        await settleLoads(clock);
        pages[0].resolve("page zero"); // the older load settles last
        await settleLoads(clock);
        check("a slower earlier load cannot overwrite a later one", host.readSlot(0)?.name === "page one", JSON.stringify(host.readSlot(0)));
    }
    {
        freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const Seven = () => h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `v${useResource(() => 7).read()}` } });
        mount(() => h(Seven), host);
        check("a synchronous load never suspends", host.readSlot(0)?.name === "v7", JSON.stringify(host.readSlot(0)));
    }

    console.log("\n  useId, context selectors, development checks\n");
    {
        const { clock } = freshRuntime();
        const tick = signal(0);
        const ids = [];
        const Named = (props) => {
            tick.value;
            ids.push(`${props.label}=${useId()}`);
            return null;
        };
        mount(() => [h(Named, { label: "a" }), h(Named, { label: "b" })], createTestHost({ slotCount: 9 }));
        tick.value = 1;
        clock.runPending();
        const idsOf = (label) => [...new Set(ids.filter((entry) => entry.startsWith(`${label}=`)).map((entry) => entry.slice(2)))];
        check("useId is stable across renders", idsOf("a").length === 1 && idsOf("b").length === 1, JSON.stringify(ids));
        check("and unique per instance", idsOf("a")[0] !== idsOf("b")[0], JSON.stringify(ids));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const Shop = createContext(null, "Shop");
        const state = signal({ coins: 5, items: ["apple"] });
        const renders = { coins: 0, items: 0 };
        const Coins = () => {
            renders.coins++;
            const coins = useContextSelector(Shop, (shop) => shop.state.value.coins);
            return h("slot", { index: 0, item: { typeId: "minecraft:gold_ingot", name: `coins:${coins}` } });
        };
        const Items = () => {
            renders.items++;
            const count = useContextSelector(Shop, (shop) => shop.state.value.items.length);
            return h("slot", { index: 1, item: { typeId: "minecraft:chest", name: `items:${count}` } });
        };
        const App = () => {
            provideContext(Shop, { state });
            return [h(Coins), h(Items)];
        };
        mount(() => h(App), host);
        state.value = { ...state.value, coins: 9 };
        clock.runPending();
        check("a selector re-renders the component whose part changed", host.readSlot(0)?.name === "coins:9" && renders.coins === 2, `coins renders=${renders.coins}`);
        check("and spares the one whose part did not", renders.items === 1, `items renders=${renders.items}`);
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const Greedy = () => {
            const [count, setCount] = useState(0);
            if (count < 1) setCount(1); // written during its own render
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count}` } });
        };
        const Twin = (props) => h("slot", { index: props.index, item: { typeId: "minecraft:paper" } });
        const Eager = () => {
            useEffect(async () => undefined, []);
            return null;
        };
        mount(
            () => [h(Greedy), h(Twin, { key: "same", index: 1 }), h(Twin, { key: "same", index: 2 }), h(Eager)],
            host,
            { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        );
        clock.runPending();
        const warnings = diagnostics.filter((diagnostic) => diagnostic.kind === "dev-warning").map((diagnostic) => diagnostic.message);
        check("setting your own state while rendering is flagged", warnings.some((message) => message.includes("set its own state while rendering")), JSON.stringify(warnings));
        check("so is a duplicate key", warnings.some((message) => message.includes('Duplicate key "same"')), JSON.stringify(warnings));
        check("and an async effect", warnings.some((message) => message.includes("async function to useEffect")), JSON.stringify(warnings));
        check("each warning is said once", new Set(warnings).size === warnings.length, JSON.stringify(warnings));
        check("the flagged write still stands", host.readSlot(0)?.name === "count:1", JSON.stringify(host.readSlot(0)));
    }

    console.log("\n  confirm guards the item\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const offered = signal(null);
        const isOpen = signal(false);
        const outcomes = [];
        const Sell = () => [
            h("input", {
                index: 8,
                onChange: (event) => {
                    offered.value = event.next;
                },
            }),
            h("slot", {
                index: 0,
                item: { typeId: "minecraft:emerald", name: "Sell" },
                onClick: () => {
                    isOpen.value = true;
                },
            }),
            h(Confirm, {
                open: isOpen.value,
                watch: () => offered.value,
                confirm: { index: 3, item: { typeId: "minecraft:lime_dye", name: "Yes" } },
                cancel: { index: 5, item: { typeId: "minecraft:red_dye", name: "No" } },
                onConfirm: () => {
                    outcomes.push(`sold:${offered.peek()?.native?.id ?? "nothing"}`);
                    isOpen.value = false;
                },
                onCancel: () => {
                    outcomes.push("cancelled");
                    isOpen.value = false;
                },
                onChanged: () => {
                    outcomes.push("refused");
                    isOpen.value = false;
                },
            }),
        ];
        mount(() => h(Sell), host);
        const press = (index) => {
            host.simulateTake(index);
            clock.runPending();
        };
        host.simulatePlace(8, { typeId: "minecraft:diamond_sword", name: "Blade", native: { id: "sword-A" } });
        clock.runPending();

        press(0);
        press(3);
        check("confirming an untouched item runs onConfirm", outcomes.at(-1) === "sold:sword-A", JSON.stringify(outcomes));

        press(0);
        host.simulateSwap(8, { typeId: "minecraft:diamond_sword", name: "Blade", native: { id: "sword-B" } }); // same look, another sword
        clock.runPending();
        press(3);
        check("a look-alike swapped in while open is refused", outcomes.at(-1) === "refused", JSON.stringify(outcomes));

        press(0);
        press(8); // taken out while open
        press(3);
        check("so is an item taken out", outcomes.at(-1) === "refused", JSON.stringify(outcomes));

        press(0);
        press(5);
        check("cancel cancels", outcomes.at(-1) === "cancelled", JSON.stringify(outcomes));
        check("and the dialog is gone after each answer", !host.readSlot(3), JSON.stringify(host.readSlot(3)));
    }

    console.log("\n  hook order, effects that write, resources, reveals\n");
    const { createReveal, revealSteps, useReveal, useTicker, createManualTimeSource, configureTimeSource, resetTimeSource } = core;
    const warningsOf = (diagnostics) => diagnostics.filter((diagnostic) => diagnostic.kind === "dev-warning").map((diagnostic) => diagnostic.message);
    const thrownBy = (action) => {
        try {
            action();
            return null;
        } catch (error) {
            return error;
        }
    };
    {
        // A hook after a conditional early return is skipped when the flag flips.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const isEarly = signal(false);
        const Early = () => {
            const [first] = useState("first");
            if (isEarly.value) return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `early:${first}` } });
            const [second] = useState("second");
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `late:${first}:${second}` } });
        };
        mount(() => h(Early), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        clock.runPending();
        check("a steady component raises no hook-order warning", warningsOf(diagnostics).length === 0, JSON.stringify(warningsOf(diagnostics)));
        isEarly.value = true;
        clock.runPending();
        isEarly.value = false;
        clock.runPending();
        isEarly.value = true;
        clock.runPending();
        const orderWarnings = warningsOf(diagnostics).filter((message) => message.includes("number of hooks"));
        check("a hook skipped by an early return is flagged, once", orderWarnings.length === 1, JSON.stringify(warningsOf(diagnostics)));
        check(
            "as a dev-warning: the surface keeps rendering",
            host.readSlot(0)?.name === "early:first" && !diagnostics.some((diagnostic) => diagnostic.kind === "render-error"),
            JSON.stringify(host.readSlot(0)),
        );
    }
    {
        // A hook that only appears on a later render.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const hasExtra = signal(false);
        const Growing = () => {
            useState("first");
            if (hasExtra.value) useState("second");
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "growing" } });
        };
        mount(() => h(Growing), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        hasExtra.value = true;
        clock.runPending();
        check("a hook that appears after the first render is flagged", warningsOf(diagnostics).some((message) => message.includes("number of hooks")), JSON.stringify(warningsOf(diagnostics)));
    }
    {
        // A first render that waits on a resource creates its hooks over several passes: not a violation.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const pending = deferred();
        const Waiting = () => {
            useState(0);
            const value = useResource(() => pending.promise, []).read();
            const [after] = useState(value);
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `v${after}` } });
        };
        mount(() => h(Suspense, { fallback: null }, h(Waiting)), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        clock.runPending();
        pending.resolve(5);
        await settleLoads(clock);
        check(
            "hooks created after a suspension are not a hook-order violation",
            host.readSlot(0)?.name === "v5" && warningsOf(diagnostics).length === 0,
            JSON.stringify([host.readSlot(0), warningsOf(diagnostics)]),
        );
    }
    {
        // The documented fix for "set state while rendering" must not warn itself.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const Seeded = () => {
            const [count, setCount] = useState(0);
            useEffect(() => {
                setCount(1);
            }, []);
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count}` } });
        };
        mount(() => h(Seeded), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        clock.runPending();
        check("a state write inside an effect body is not flagged as rendering", warningsOf(diagnostics).length === 0, JSON.stringify(warningsOf(diagnostics)));
        check("and still lands", host.readSlot(0)?.name === "count:1", JSON.stringify(host.readSlot(0)));
    }
    {
        // reload() after the component is gone must not call load again.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const isShown = signal(true);
        const held = { resource: null };
        let loads = 0;
        const Loader = () => {
            held.resource = useResource(() => {
                loads++;
                return "value";
            }, []);
            return null;
        };
        mount(() => (isShown.value ? h(Loader) : null), host);
        clock.runPending();
        isShown.value = false;
        clock.runPending();
        held.resource.reload();
        check("reload after unmount is a no-op", loads === 1, `loads=${loads}`);
    }
    {
        check("a zero-width `center-out` reveal is refused", thrownBy(() => createReveal({ size: 27, order: "center-out", width: 0 })) instanceof RangeError);
        // A zero width makes rows Infinity; the call must throw instead of looping.
        check("a zero-width spiral is refused instead of hanging", thrownBy(() => revealSteps("spiral", 27, 0)) instanceof RangeError);
        check("a fractional size is refused", thrownBy(() => revealSteps("sweep", 2.5)) instanceof RangeError);
        check("a NaN seed is refused", thrownBy(() => revealSteps("random", 9, 9, Number.NaN)) instanceof RangeError);
        check("valid arguments still work", revealSteps("rows", 18).join() === "0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1");
    }
    {
        // useReveal must see an omitted width and the default width as the same layout.
        const { clock } = freshRuntime();
        const time = createManualTimeSource();
        configureTimeSource(time);
        const host = createTestHost({ slotCount: 9 });
        const width = signal(undefined);
        const seen = { reveal: null };
        const Reveal = () => {
            seen.reveal = useReveal({ size: 27, order: "sweep", ...(width.value !== undefined ? { width: width.value } : {}) });
            return null;
        };
        mount(() => h(Reveal), host);
        time.advance(3);
        clock.runPending();
        const stepBefore = seen.reveal.step.peek();
        width.value = 9;
        clock.runPending();
        check("toggling an omitted width to 9 does not restart the reveal", stepBefore > 0 && seen.reveal.step.peek() === stepBefore, `before=${stepBefore} after=${seen.reveal.step.peek()}`);
        resetTimeSource();
    }
    {
        const { clock } = freshRuntime();
        const time = createManualTimeSource();
        const requested = [];
        configureTimeSource({
            after: time.after,
            every: (intervalTicks, callback) => {
                requested.push(intervalTicks);
                return time.every(intervalTicks, callback);
            },
        });
        const host = createTestHost({ slotCount: 9 });
        let ticks = 0;
        const Timer = () => {
            useTicker(Number.NaN, () => ticks++);
            return null;
        };
        mount(() => h(Timer), host);
        time.advance(3);
        clock.runPending();
        check("a NaN interval falls back to every tick", ticks === 3 && requested.join() === "1", `ticks=${ticks} requested=${requested.join()}`);
        resetTimeSource();
    }
};
