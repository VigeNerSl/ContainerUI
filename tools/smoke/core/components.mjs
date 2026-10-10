/**
 * Enchantments in views, `useCallback` and `useReducer`, render errors and boundaries, layers and
 * modals, and boundaries with several failures.
 */

import { isRenderError } from "./fixtures.mjs";

const PANE = { typeId: "minecraft:gray_stained_glass_pane", name: " " };

export const checkComponents = async ({ check, core, freshRuntime }) => {
    const {
        h,
        signal,
        mount,
        useState,
        useCallback,
        useReducer,
        useContext,
        createContext,
        provideContext,
        createTestHost,
        createMemoryStorage,
        StorageView,
        ErrorBoundary,
        ContainerFormBuilder,
        Layer,
        Modal,
        areItemsEqual,
        cloneItemView,
        setErrorReporter,
    } = core;

    console.log("\n  enchantments in views\n");
    {
        const sword = (enchantments) => ({ typeId: "minecraft:diamond_sword", enchantments });
        const sharpUnbreaking = sword([{ id: "sharpness", level: 5 }, { id: "unbreaking", level: 3 }]);
        const unbreakingSharp = sword([{ id: "unbreaking", level: 3 }, { id: "sharpness", level: 5 }]);
        check("the engine's order does not make a different item", areItemsEqual(sharpUnbreaking, unbreakingSharp));
        check("a different level does", !areItemsEqual(sword([{ id: "sharpness", level: 4 }]), sword([{ id: "sharpness", level: 5 }])));
        check("losing every enchantment does", !areItemsEqual(sword([{ id: "sharpness", level: 5 }]), sword([])));
        check("no list and an empty list are the same item", areItemsEqual(sword(undefined), sword([])));

        const original = sword([{ id: "sharpness", level: 5 }]);
        const copy = cloneItemView(original);
        copy.enchantments[0].level = 1;
        check("a clone does not share its enchantment list", original.enchantments[0].level === 5);

        freshRuntime();
        const storage = createMemoryStorage(1, [{ ...sword([{ id: "sharpness", level: 5 }]), native: { id: "real-sword" } }]);
        const host = createTestHost({ slotCount: 9 });
        mount(h(StorageView, { storage }), host);
        const shown = host.readSlot(0);
        check("StorageView shows a stored item's enchantments", shown?.enchantments?.[0]?.id === "sharpness", JSON.stringify(shown));
        check("without handing over its payload", shown?.native === undefined);
    }

    console.log("\n  useCallback and useReducer\n");
    {
        const { clock } = freshRuntime();
        const tick = signal(0);
        const handed = [];
        let childRenders = 0;
        let inlineRenders = 0;
        const Child = (props) => {
            childRenders++;
            return h("slot", { index: 1, item: { typeId: "minecraft:paper" }, onClick: props.onPick });
        };
        const InlineChild = (props) => {
            inlineRenders++;
            return h("slot", { index: 2, item: { typeId: "minecraft:paper" }, onClick: props.onPick });
        };
        const Parent = () => {
            const value = tick.value;
            const onPick = useCallback(() => value);
            const onPickPaired = useCallback(() => value, [Math.floor(value / 2)]);
            handed.push({ onPick, onPickPaired });
            return [
                h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `v${value}` } }),
                h(Child, { onPick }),
                h(InlineChild, { onPick: () => value }),
            ];
        };
        mount(() => h(Parent), createTestHost({ slotCount: 9 }));
        tick.value = 1;
        clock.runPending();
        const [first, second] = handed;
        check("without dependencies a callback keeps its identity", handed.length === 2 && first.onPick === second.onPick, `renders=${handed.length}`);
        check("and calls the latest closure", first.onPick() === 1, `returned=${first.onPick()}`);
        check("a stable callback spares the child a re-render", childRenders === 1, `childRenders=${childRenders}`);
        check("an inline arrow does not", inlineRenders === 2, `inlineRenders=${inlineRenders}`);
        check("with unchanged dependencies the callback is kept", first.onPickPaired === second.onPickPaired);
        tick.value = 2;
        clock.runPending();
        check("with changed dependencies it is replaced", handed[2]?.onPickPaired !== second.onPickPaired);
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const dispatches = [];
        const bonus = signal(0);
        const Counter = () => {
            const extra = bonus.value;
            const [count, dispatch] = useReducer((state, action) => (action === "add" ? state + 1 + extra : state), () => 10);
            dispatches.push(dispatch);
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count}` } });
        };
        const app = mount(() => h(Counter), host);
        const writesBefore = app.writeCount;
        dispatches[0]("add");
        dispatches[0]("add");
        clock.runPending();
        check("useReducer starts from a lazy initial state and applies actions", host.readSlot(0)?.name === "count:12", host.readSlot(0)?.name);
        check("two dispatches in one tick commit once", app.writeCount - writesBefore === 1, `writes=${app.writeCount - writesBefore}`);
        check("dispatch keeps its identity", dispatches.every((dispatch) => dispatch === dispatches[0]));
        bonus.value = 5;
        clock.runPending();
        dispatches[0]("add");
        clock.runPending();
        check("the reducer is the latest one rendered", host.readSlot(0)?.name === "count:18", host.readSlot(0)?.name);
        const writesSettled = app.writeCount;
        dispatches[0]("noop");
        clock.runPending();
        check("an action that returns the same state writes nothing", app.writeCount === writesSettled, `writes=${app.writeCount - writesSettled}`);
    }

    console.log("\n  render errors and boundaries\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const isBroken = signal(false);
        const caught = [];
        let resetBoundary = null;
        const Fragile = () => {
            if (isBroken.value) throw new Error("stock table missing");
            return h("slot", { index: 1, item: { typeId: "minecraft:emerald", name: "Buy" } });
        };
        const Screen = () => [
            h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "Header" } }),
            h(
                ErrorBoundary,
                {
                    fallback: (failure) => {
                        resetBoundary = failure.reset;
                        return h("slot", { index: 1, item: { typeId: "minecraft:barrier", name: "Unavailable" } });
                    },
                    onError: (failure) => caught.push(failure.component),
                },
                h(Fragile),
            ),
        ];
        mount(() => h(Screen), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        check("a healthy subtree renders through its boundary", host.readSlot(1)?.name === "Buy");

        isBroken.value = true;
        clock.runPending();
        check("a throwing child is replaced by the fallback", host.readSlot(1)?.name === "Unavailable", JSON.stringify(host.readSlot(1)));
        check("the rest of the screen is untouched", host.readSlot(0)?.name === "Header");
        check("onError hears the failure once", caught.length === 1 && caught[0].startsWith("Fragile"), JSON.stringify(caught));
        check("a caught error is still reported", diagnostics.some((diagnostic) => isRenderError(diagnostic, "fallback")), JSON.stringify(diagnostics.map((diagnostic) => diagnostic.message)));

        isBroken.value = false;
        resetBoundary?.();
        clock.runPending();
        check("reset renders the children again", host.readSlot(1)?.name === "Buy", JSON.stringify(host.readSlot(1)));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const isBroken = signal(false);
        const Fragile = () => {
            if (isBroken.value) throw new Error("boom");
            return h("slot", { index: 1, item: { typeId: "minecraft:emerald" } });
        };
        const Screen = () => [h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "Header" } }), h(Fragile)];
        mount(() => h(Screen), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        isBroken.value = true;
        clock.runPending();
        check("with no boundary a throwing component renders nothing, not its last frame", !host.readSlot(1), JSON.stringify(host.readSlot(1)));
        check("the rest of the screen still renders", host.readSlot(0)?.name === "Header");
        check("the error reaches the diagnostics", diagnostics.some((diagnostic) => isRenderError(diagnostic, "renders nothing")));
        isBroken.value = false;
        clock.runPending();
        check("it renders again once its state is sound", host.readSlot(1)?.typeId === "minecraft:emerald");
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const price = signal(null);
        const Screen = () => [
            h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "Header" } }),
            h("slot", { index: 1, item: () => ({ typeId: "minecraft:emerald", name: price.value.toFixed(2) }) }),
        ];
        mount(() => h(Screen), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        check("a throwing item source costs its own slot", !host.readSlot(1), JSON.stringify(host.readSlot(1)));
        check("not the rest of the surface", host.readSlot(0)?.name === "Header");
        check("and is reported", diagnostics.some((diagnostic) => isRenderError(diagnostic, "item of slot 1")), JSON.stringify(diagnostics.map((diagnostic) => diagnostic.message)));
        price.value = 5;
        clock.runPending();
        check("the slot fills in once the source stops throwing", host.readSlot(1)?.name === "5.00", JSON.stringify(host.readSlot(1)));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const isBroken = signal(false);
        mount(
            () => {
                if (isBroken.value) throw new Error("root down");
                return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "Header" } });
            },
            host,
            { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        );
        isBroken.value = true;
        clock.runPending();
        check("a throwing root keeps the last screen", host.readSlot(0)?.name === "Header");
        check("and says so", diagnostics.some((diagnostic) => isRenderError(diagnostic, "last screen stays up")));
    }
    {
        const { clock } = freshRuntime();
        const logged = [];
        setErrorReporter((error) => logged.push(String(error)));
        const host = createTestHost({ slotCount: 9 });
        const isBroken = signal(false);
        const Fragile = (props) => {
            if (isBroken.value) throw new Error(props.label);
            return h("slot", { index: props.index, item: { typeId: "minecraft:paper" } });
        };
        mount(() => [h(ErrorBoundary, { fallback: null }, h(Fragile, { label: "handled", index: 0 })), h(Fragile, { label: "loose", index: 1 })], host);
        isBroken.value = true;
        clock.runPending();
        setErrorReporter(() => undefined);
        check("a caught render error is not logged as uncaught", !logged.includes("Error: handled"), JSON.stringify(logged));
        check("an uncaught one is", logged.includes("Error: loose"), JSON.stringify(logged));
    }

    console.log("\n  layers and modals\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const confirming = signal(false);
        const events = [];
        const Theme = createContext("plain", "Theme");
        const ConfirmButtons = () => {
            const theme = useContext(Theme);
            return [
                h("slot", {
                    index: 3,
                    item: { typeId: "minecraft:lime_dye", name: `yes:${theme}` },
                    onClick: () => {
                        events.push("yes");
                        confirming.value = false;
                    },
                }),
                // Lands on the input below, so it must be dropped rather than written.
                h("slot", { index: 8, item: { typeId: "minecraft:red_dye", name: "no" } }),
            ];
        };
        const Shop = () => {
            provideContext(Theme, "dark");
            const [taps, setTaps] = useState(0);
            return [
                h("slot", {
                    index: 0,
                    item: { typeId: "minecraft:emerald", name: `taps:${taps}` },
                    onClick: () => {
                        setTaps((value) => value + 1);
                        confirming.value = true;
                    },
                }),
                h("slot", { index: 1, item: { typeId: "minecraft:paper", name: "Info" } }),
                h("input", { index: 8 }),
                h(
                    Modal,
                    {
                        open: confirming.value,
                        backdrop: PANE,
                        onDismiss: () => {
                            events.push("dismiss");
                            confirming.value = false;
                        },
                    },
                    h(ConfirmButtons),
                ),
            ];
        };
        mount(() => h(Shop), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        host.simulatePlace(8, { typeId: "minecraft:diamond", amount: 3 }); // the player's own item
        clock.runPending();

        host.simulateTake(0); // opens the modal
        clock.runPending();
        check("an open modal shows its own slots", host.readSlot(3)?.typeId === "minecraft:lime_dye", JSON.stringify(host.snapshot()));
        check("with context from where it was declared", host.readSlot(3)?.name === "yes:dark", host.readSlot(3)?.name);
        check("the menu beneath is covered by the backdrop", host.readSlot(0)?.typeId === PANE.typeId && host.readSlot(1)?.typeId === PANE.typeId, JSON.stringify(host.snapshot()));
        check("a modal never covers an input", host.readSlot(8)?.typeId === "minecraft:diamond", JSON.stringify(host.readSlot(8)));
        check("and reports the slot it dropped", diagnostics.some((diagnostic) => diagnostic.kind === "collision" && diagnostic.message.includes("never covers")));

        host.simulateTake(1); // the backdrop, where "Info" was
        clock.runPending();
        check("clicking the backdrop dismisses", events.at(-1) === "dismiss" && !host.readSlot(3), JSON.stringify(events));
        check("closing restores the menu with its state", host.readSlot(0)?.name === "taps:1" && host.readSlot(1)?.name === "Info", JSON.stringify(host.snapshot()));

        host.simulateTake(0); // open again…
        clock.runPending();
        host.simulateTake(0); // …then the backdrop over the button
        clock.runPending();
        check("a covered button cannot be pressed", host.readSlot(0)?.name === "taps:2" && events.at(-1) === "dismiss", `${host.readSlot(0)?.name} ${JSON.stringify(events)}`);

        host.simulateTake(0);
        clock.runPending();
        host.simulateTake(3); // the modal's own button
        clock.runPending();
        check("the modal's buttons work", events.at(-1) === "yes" && !host.readSlot(3), JSON.stringify(events));
    }
    {
        freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        mount(
            () => [
                h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "base0" } }),
                h("slot", { index: 1, item: { typeId: "minecraft:paper", name: "base1" } }),
                h(Layer, { z: 2 }, h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "high" } })),
                h(Layer, { z: 1 }, h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "low" } })),
            ],
            host,
            { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        );
        check("the higher layer wins a shared slot, whatever the declaration order", host.readSlot(0)?.name === "high", host.readSlot(0)?.name);
        check("an overlay without a backdrop leaves the rest alone", host.readSlot(1)?.name === "base1");
        check("overlap between layers is not a collision", !diagnostics.some((diagnostic) => diagnostic.kind === "collision"), JSON.stringify(diagnostics));
    }

    console.log("\n  boundaries with several failures, and the builder's storage ranges\n");
    {
        // Two siblings throw in the same pass: both belong to the inner boundary.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const isBroken = signal(false);
        const BadA = () => {
            if (isBroken.value) throw new Error("A broke");
            return h("slot", { index: 1, item: { typeId: "minecraft:emerald", name: "A" } });
        };
        const BadB = () => {
            if (isBroken.value) throw new Error("B broke");
            return h("slot", { index: 2, item: { typeId: "minecraft:emerald", name: "B" } });
        };
        const outerErrors = [];
        const innerErrors = [];
        const Screen = () => [
            h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "Header" } }),
            h(
                ErrorBoundary,
                { fallback: h("slot", { index: 4, item: { typeId: "minecraft:barrier", name: "outer" } }), onError: (failure) => outerErrors.push(failure.component) },
                h(
                    ErrorBoundary,
                    { fallback: h("slot", { index: 3, item: { typeId: "minecraft:barrier", name: "inner" } }), onError: (failure) => innerErrors.push(failure.component) },
                    h(BadA),
                    h(BadB),
                ),
            ),
        ];
        mount(() => h(Screen), host);
        isBroken.value = true;
        clock.runPending();
        check("the nearest boundary shows its fallback", host.readSlot(3)?.name === "inner", JSON.stringify(host.readSlot(3)));
        check("a second sibling's failure does not reach the outer boundary", !host.readSlot(4) && outerErrors.length === 0 && host.readSlot(0)?.name === "Header", JSON.stringify([host.readSlot(4), outerErrors]));
        check("the inner boundary reports once", innerErrors.length === 1, JSON.stringify(innerErrors));
    }
    {
        // The same, when both siblings fail on their very first render.
        freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const Bad = () => {
            throw new Error("broken from the start");
        };
        mount(
            () =>
                h(
                    ErrorBoundary,
                    { fallback: h("slot", { index: 4, item: { typeId: "minecraft:barrier", name: "outer" } }) },
                    h(ErrorBoundary, { fallback: h("slot", { index: 3, item: { typeId: "minecraft:barrier", name: "inner" } }) }, h(Bad), h(Bad)),
                ),
            host,
        );
        check("siblings that fail on mount stay with their own boundary", host.readSlot(3)?.name === "inner" && !host.readSlot(4), JSON.stringify([host.readSlot(3), host.readSlot(4)]));
    }
    {
        // What the fallback itself throws still goes up.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const isBroken = signal(false);
        const Bad = () => {
            if (isBroken.value) throw new Error("child broke");
            return null;
        };
        const BadFallback = () => {
            throw new Error("fallback broke");
        };
        mount(
            () => h(ErrorBoundary, { fallback: h("slot", { index: 4, item: { typeId: "minecraft:barrier", name: "outer" } }) }, h(ErrorBoundary, { fallback: h(BadFallback) }, h(Bad))),
            host,
        );
        isBroken.value = true;
        clock.runPending();
        check("an error thrown by the fallback goes to the next boundary", host.readSlot(4)?.name === "outer", JSON.stringify(host.readSlot(4)));
    }
    {
        const thrownBy = (action) => {
            try {
                action();
                return null;
            } catch (error) {
                return error;
            }
        };
        const item = { typeId: "minecraft:paper" };
        const claimers = {
            slot: (builder) => builder.slot(1, item),
            button: (builder) => builder.button(1, item, () => undefined),
            input: (builder) => builder.input(1),
            reserve: (builder) => builder.reserve(1),
            component: (builder) => builder.component(1, () => null),
        };
        const results = Object.entries(claimers).map(([name, claim]) => [name, thrownBy(() => claim(new ContainerFormBuilder(27).storage(createMemoryStorage(3)))) instanceof RangeError]);
        check("claiming a slot inside a storage range is refused, whatever claims it", results.every(([, isRefused]) => isRefused), JSON.stringify(results));
        check("a slot past the range is fine", thrownBy(() => new ContainerFormBuilder(27).storage(createMemoryStorage(3)).slot(3, item)) === null);

        const refuses = (options, size = 9) => thrownBy(() => new ContainerFormBuilder(27).storage(createMemoryStorage(size), options)) instanceof RangeError;
        check("a negative first slot is refused", refuses({ from: -1 }));
        check("a range past the storage's size is refused", refuses({ from: 5, count: 10 }) && refuses({ count: 10 }) && refuses({ from: 10 }));
        check("a negative or fractional count is refused", refuses({ count: -1 }) && refuses({ count: 1.5 }) && refuses({ from: 0.5 }));
        check("a range inside the storage is fine", !refuses({ from: 2, count: 7 }) && !refuses({ from: 3 }) && !refuses({}));
    }
};
