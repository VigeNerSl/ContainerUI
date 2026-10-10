/** Pagination, the quantity picker, route state, and outside state. */

export const checkLists = async ({ check, core, freshRuntime }) => {
    const { h, signal, mount, createTestHost, createRouter, useRouteState, useExternal, PagedList, QuantityPicker, Routes } = core;

    console.log("\n  pagination\n");
    {
        const { clock } = freshRuntime();
        const goods = signal(Array.from({ length: 20 }, (_, position) => `good-${position}`));
        const host = createTestHost({ slotCount: 27 });
        const clicked = [];
        const cells = [0, 1, 2, 3, 4, 5, 6];
        mount(
            () =>
                h(PagedList, {
                    items: goods.value,
                    cells,
                    renderItem: (good, position) => ({ item: { typeId: "minecraft:paper", name: good }, onClick: () => clicked.push(position) }),
                    keyOf: (good) => good,
                    previous: { index: 18 },
                    next: { index: 26 },
                    indicator: { index: 22 },
                }),
            host,
        );
        clock.runPending();
        const shown = () => cells.map((index) => host.readSlot(index)?.name ?? "-").join(",");
        const range = (from, to) => Array.from({ length: to - from }, (_, offset) => `good-${from + offset}`).join(",");

        check("the first page shows the first seven", shown() === range(0, 7), shown());
        check("with no previous arrow and a next one", !host.readSlot(18) && host.readSlot(26)?.typeId === "minecraft:arrow", JSON.stringify([host.readSlot(18), host.readSlot(26)]));
        check("and the page count", host.readSlot(22)?.name === "§fPage 1/3", host.readSlot(22)?.name);
        host.simulateTake(26);
        clock.runPending();
        check("next shows the second page", shown() === range(7, 14), shown());
        host.simulateTake(3);
        clock.runPending();
        check("a click gets the item's place in the whole list", clicked.join(",") === "10", clicked.join(","));
        host.simulateTake(26);
        clock.runPending();
        check("the last page leaves the rest empty and hides next", shown() === `${range(14, 20)},-` && !host.readSlot(26), shown());
        goods.value = goods.peek().slice(0, 5);
        clock.runPending();
        check("a list that shrinks under the page falls back to a page that exists", shown() === `${range(0, 5)},-,-` && host.readSlot(22)?.name === "§fPage 1/1", shown());
    }

    console.log("\n  quantity picker\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 27 });
        const quantity = signal(1);
        const bought = [];
        mount(
            () =>
                h(QuantityPicker, {
                    index: 9,
                    value: quantity.value,
                    onChange: (value) => {
                        quantity.value = value;
                    },
                    max: 16,
                    item: (value) => ({ typeId: "minecraft:diamond", amount: value, name: `Buy ${value}` }),
                    onPick: (value) => bought.push(value),
                }),
            host,
        );
        clock.runPending();
        const row = () => [9, 10, 11, 12, 13].map((index) => host.readSlot(index)?.typeId.replace("minecraft:", "") ?? "-").join(",");
        check("at the minimum the minus steps are grey", row() === "gray_dye,gray_dye,diamond,lime_dye,lime_dye", row());
        host.simulateTake(13); // +10
        clock.runPending();
        check("a step changes the quantity, shown as the stack size", quantity.peek() === 11 && host.readSlot(11)?.amount === 11, `${quantity.peek()} ${host.readSlot(11)?.amount}`);
        host.simulateTake(13); // +10 again
        clock.runPending();
        check("a step past the maximum stops at it", quantity.peek() === 16, String(quantity.peek()));
        check("where the plus steps turn grey", row() === "red_dye,red_dye,diamond,gray_dye,gray_dye", row());
        host.simulateTake(12);
        clock.runPending();
        check("a grey step does nothing", quantity.peek() === 16, String(quantity.peek()));
        host.simulateTake(11);
        clock.runPending();
        check("the middle picks the quantity", bought.join(",") === "16", bought.join(","));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 27 });
        const picker = (stackLimit, value) =>
            h(QuantityPicker, {
                index: 9,
                value,
                onChange: () => {},
                stackLimit,
                item: (count) => ({ typeId: "minecraft:ender_pearl", amount: count, name: `Buy ${count}`, lore: ["lore"] }),
            });
        const limit = signal(16);
        const value = signal(3);
        mount(() => picker(limit.value, value.value), host);
        clock.runPending();
        const middle = () => host.readSlot(11);
        check(
            "an item whose stack is below the maximum is shown as a counter, even while the quantity fits",
            middle()?.typeId === "minecraft:gold_nugget" && middle()?.amount === 3 && middle()?.name === "Buy 3" && middle()?.lore?.[0] === "lore",
            JSON.stringify(middle()),
        );
        value.value = 40;
        clock.runPending();
        check("the counter carries the quantity the item cannot", middle()?.amount === 40 && middle()?.name === "Buy 40", JSON.stringify(middle()));
        limit.value = 64;
        clock.runPending();
        check("an item whose stack holds the maximum shows itself", middle()?.typeId === "minecraft:ender_pearl" && middle()?.amount === 40, JSON.stringify(middle()));
    }

    console.log("\n  route state\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const router = createRouter("list");
        let setPage = null;
        const List = () => {
            const [page, update] = useRouteState("page", 0);
            setPage = update;
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `page:${page}` } });
        };
        const Detail = () => h("slot", { index: 0, item: { typeId: "minecraft:diamond" } });
        mount(() => h(Routes, { router, screens: { list: List, detail: Detail } }), host);
        clock.runPending();
        setPage(3);
        clock.runPending();
        router.push("detail");
        clock.runPending();
        router.back();
        clock.runPending();
        check("route state survives a visit elsewhere and back", host.readSlot(0)?.name === "page:3", host.readSlot(0)?.name);
        router.push("list");
        clock.runPending();
        check("a new visit to the route starts fresh", host.readSlot(0)?.name === "page:0", host.readSlot(0)?.name);
        router.back();
        clock.runPending();
        check("and the older visit keeps its own", host.readSlot(0)?.name === "page:3", host.readSlot(0)?.name);
    }

    console.log("\n  external state\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const bank = { balance: 5, listeners: new Set() };
        const isShown = signal(true);
        const Balance = () => {
            const balance = useExternal({
                subscribe: (vigenersl) => {
                    bank.listeners.add(vigenersl);
                    return () => bank.listeners.delete(vigenersl);
                },
                read: () => bank.balance,
            });
            return h("slot", { index: 0, item: { typeId: "minecraft:gold_ingot", name: `balance:${balance}` } });
        };
        const notifyAll = () => bank.listeners.forEach((listener) => listener());
        mount(() => (isShown.value ? h(Balance) : null), host);
        clock.runPending();
        check("reads the outside value", host.readSlot(0)?.name === "balance:5", host.readSlot(0)?.name);
        bank.balance = 9;
        notifyAll();
        clock.runPending();
        check("and follows it when told", host.readSlot(0)?.name === "balance:9", host.readSlot(0)?.name);
        const writesBefore = host.writes.length;
        notifyAll();
        clock.runPending();
        check("a notification without a change costs no write", host.writes.length === writesBefore, `writes=${host.writes.length - writesBefore}`);
        isShown.value = false;
        clock.runPending();
        check("unmounting unsubscribes", bank.listeners.size === 0, `listeners=${bank.listeners.size}`);
    }

    console.log("\n  lists, routes and outside state: edge cases\n");
    const { usePagination } = core;
    const warningsOf = (diagnostics) => diagnostics.filter((diagnostic) => diagnostic.kind === "dev-warning").map((diagnostic) => diagnostic.message);
    {
        // A descendant without props must follow the stack entry, not the visit that mounted it.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const router = createRouter("item", { id: 1 });
        let setDeep = null;
        const Deep = () => {
            const [count, update] = useRouteState("count", 0);
            setDeep = update;
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `count:${count}` } });
        };
        const ItemPage = (props) => [h("slot", { index: 1, item: { typeId: "minecraft:paper", name: `id:${props.id}` } }), h(Deep)];
        mount(() => h(Routes, { router, screens: { item: ItemPage } }), host);
        clock.runPending();
        setDeep(5);
        clock.runPending();
        router.push("item", { id: 2 });
        clock.runPending();
        check("a deep descendant starts a new visit to the same route fresh", host.readSlot(0)?.name === "count:0" && host.readSlot(1)?.name === "id:2", JSON.stringify([host.readSlot(0)?.name, host.readSlot(1)?.name]));
        router.back();
        clock.runPending();
        check("and gets the older visit back on back()", host.readSlot(0)?.name === "count:5" && host.readSlot(1)?.name === "id:1", JSON.stringify([host.readSlot(0)?.name, host.readSlot(1)?.name]));
    }
    {
        // Leaving for another route must not let the old screen's descendants write into the new entry.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const router = createRouter("first");
        const Leaf = (props) => {
            const [value] = useRouteState("shared", props.initial);
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `value:${value}` } });
        };
        const First = () => h(Leaf, { initial: "from-first" });
        const Second = () => h(Leaf, { initial: "from-second" });
        mount(() => h(Routes, { router, screens: { first: First, second: Second } }), host);
        clock.runPending();
        router.push("second");
        clock.runPending();
        check("a screen's state key is not seeded by the screen it replaced", host.readSlot(0)?.name === "value:from-second", host.readSlot(0)?.name);
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const router = createRouter("home");
        const setters = new Set();
        let setPage = null;
        const Page = () => {
            const [page, update] = useRouteState("page", 0);
            setters.add(update);
            setPage = update;
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `page:${page}` } });
        };
        mount(() => h(Routes, { router, screens: { home: Page } }), host);
        clock.runPending();
        setPage(1);
        clock.runPending();
        setPage(2);
        clock.runPending();
        check("the route state setter keeps its identity across renders", host.readSlot(0)?.name === "page:2" && setters.size === 1, `setters=${setters.size}`);
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const diagnostics = [];
        const router = createRouter("home");
        const Home = () => h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "home" } });
        const Missing = () => h("slot", { index: 0, item: { typeId: "minecraft:barrier", name: "missing" } });
        const app = mount(() => h(Routes, { router, screens: { home: Home }, fallback: Missing }), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        router.push("toString");
        clock.runPending();
        check("a route named like an Object method is unknown, not that method", host.readSlot(0)?.name === "missing", JSON.stringify(host.readSlot(0)));
        router.push("constructor");
        clock.runPending();
        check("so is `constructor`", host.readSlot(0)?.name === "missing", JSON.stringify(host.readSlot(0)));
        app.unmount();

        const bareDiagnostics = [];
        const bareRouter = createRouter("home");
        mount(() => h(Routes, { router: bareRouter, screens: { home: Home } }), createTestHost({ slotCount: 9 }), { onDiagnostic: (diagnostic) => bareDiagnostics.push(diagnostic) });
        bareRouter.push("nowhere");
        clock.runPending();
        check("an unknown route without a fallback is reported", warningsOf(bareDiagnostics).some((message) => message.includes('"nowhere"')), JSON.stringify(warningsOf(bareDiagnostics)));
    }
    {
        const { clock } = freshRuntime();
        const row = (host) => [9, 10, 11, 12, 13].map((index) => host.readSlot(index)?.typeId.replace("minecraft:", "") ?? "-").join(",");
        const pickerWith = (props) => {
            const host = createTestHost({ slotCount: 27 });
            const changes = [];
            mount(() => h(QuantityPicker, { index: 9, onChange: (value) => changes.push(value), item: (value) => ({ typeId: "minecraft:diamond", amount: value }), ...props }), host);
            clock.runPending();
            [9, 10, 12, 13].forEach((index) => {
                host.simulateTake(index);
                clock.runPending();
            });
            return { host, changes };
        };
        const nanValue = pickerWith({ value: Number.NaN });
        check("a NaN value reads as the minimum: minus steps grey, plus steps live", row(nanValue.host) === "gray_dye,gray_dye,diamond,lime_dye,lime_dye", row(nanValue.host));
        check("and no step hands NaN to onChange", nanValue.changes.length > 0 && nanValue.changes.every(Number.isFinite), JSON.stringify(nanValue.changes));
        const nanMax = pickerWith({ value: 5, max: Number.NaN });
        check("a NaN maximum falls back to the default", nanMax.changes.length > 0 && nanMax.changes.every(Number.isFinite), JSON.stringify(nanMax.changes));
        const nanMin = pickerWith({ value: 5, min: Number.NaN });
        check("a NaN minimum falls back to the default", nanMin.changes.length > 0 && nanMin.changes.every(Number.isFinite), JSON.stringify(nanMin.changes));
    }
    {
        // The page follows the list when it shrinks and does not spring back when it grows.
        const { clock } = freshRuntime();
        const goods = signal(Array.from({ length: 20 }, (_, position) => `good-${position}`));
        const host = createTestHost({ slotCount: 27 });
        const diagnostics = [];
        const cells = [0, 1, 2, 3, 4, 5, 6];
        mount(
            () =>
                h(PagedList, {
                    items: goods.value,
                    cells,
                    renderItem: (good) => ({ item: { typeId: "minecraft:paper", name: good } }),
                    keyOf: (good) => good,
                    previous: { index: 18 },
                    next: { index: 26 },
                    indicator: { index: 22 },
                }),
            host,
            { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        );
        clock.runPending();
        host.simulateTake(26);
        clock.runPending();
        check("on the second page", host.readSlot(22)?.name === "§fPage 2/3", host.readSlot(22)?.name);
        goods.value = goods.peek().slice(0, 5);
        clock.runPending();
        goods.value = Array.from({ length: 20 }, (_, position) => `good-${position}`);
        clock.runPending();
        check("a list that shrinks and grows again stays on the page it fell back to", host.readSlot(22)?.name === "§fPage 1/3" && host.readSlot(0)?.name === "good-0", `${host.readSlot(22)?.name} ${host.readSlot(0)?.name}`);
        check("clamping the stored page is not flagged as a render writing its own state", warningsOf(diagnostics).length === 0, JSON.stringify(warningsOf(diagnostics)));
    }
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 27 });
        const Pager = () => {
            const pages = usePagination({ items: ["a", "b", "c"], pageSize: Number.NaN, initialPage: Number.NaN });
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `page:${pages.page}/${pages.pageCount}:${pages.items.join("")}` } });
        };
        mount(() => h(Pager), host);
        clock.runPending();
        check("a NaN page size and start page fall back to one item and the first page", host.readSlot(0)?.name === "page:0/3:a", host.readSlot(0)?.name);

        mount(() => h(PagedList, { items: ["a", "b"], cells: [], renderItem: (good) => ({ item: { typeId: "minecraft:paper", name: good } }), previous: { index: 18 }, next: { index: 26 } }), host);
        clock.runPending();
        check("a paged list without cells shows no arrows", !host.readSlot(18) && !host.readSlot(26), JSON.stringify([host.readSlot(18), host.readSlot(26)]));
    }
    {
        // `read` closes over props: a new prop must read again without waiting for a notification.
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const store = { values: { a: "one", b: "two" }, subscriptions: 0 };
        const id = signal("a");
        const Reader = (props) => {
            const value = useExternal({
                subscribe: () => {
                    store.subscriptions++;
                },
                read: () => store.values[props.id],
            });
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `value:${value}` } });
        };
        mount(() => h(Reader, { id: id.value }), host);
        clock.runPending();
        id.value = "b";
        clock.runPending();
        check("outside state follows a prop its read depends on", host.readSlot(0)?.name === "value:two", host.readSlot(0)?.name);
        check("and subscribes once, at mount", store.subscriptions === 1, `subscriptions=${store.subscriptions}`);
        const writesBefore = host.writes.length;
        id.value = "b";
        clock.runPending();
        check("an unchanged read costs no write", host.writes.length === writesBefore);
    }
};
