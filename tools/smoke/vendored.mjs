/** Loads the core from a copied build with Node's own ESM loader, as a pack without a bundler would. */

import { runSuite } from "./harness.mjs";

await runSuite(
    { label: "vendored", passed: "vendored smoke ok", crashed: "vendored artifact failed to load", buildFolder: "ContainerUI" },
    async ({ check, load }) => {
        const { createTestHost, mount, h, signal, configureRuntime, createManualSchedulerHost } = await load("core/index.js");

        console.log("\n  vendored artifact\n");
        check("loads from a copied folder with no node_modules", typeof mount === "function");

        configureRuntime(createManualSchedulerHost());
        const host = createTestHost({ slotCount: 27 });

        const clicks = [];
        const label = signal("before");

        // Written as a consumer without a build step would: h() instead of JSX.
        const app = mount(
            () =>
                h(
                    "row",
                    { index: 9 },
                    h("slot", { item: { typeId: "minecraft:paper", name: label.value } }),
                    h("slot", {
                        item: { typeId: "minecraft:emerald", name: "click" },
                        onClick: (event) => clicks.push(event.index),
                    }),
                ),
            host,
        );

        check("renders through h() without JSX", host.readSlot(9)?.name === "before", JSON.stringify(host.snapshot()[9]));
        check("writes only the declared slots", host.writes.length === 2, `wrote ${host.writes.length}`);

        host.clearHistory();
        label.value = "after";
        app.flush();
        check("updates a slot from a signal", host.readSlot(9)?.name === "after");
        check("issues exactly one write for one changed slot", host.writes.length === 1, `wrote ${host.writes.length}`);

        host.clearHistory();
        host.simulateTake(10);
        app.flush();
        check("routes a click to its handler", clicks.length === 1);
        check("restores the button the player grabbed", host.readSlot(10)?.typeId === "minecraft:emerald");

        app.unmount();
        check("unmounts cleanly", true);

        // A sold-out button keeps its onClick while its item is empty; an item dropped there
        // must not press it.
        {
            const soldOut = signal(false);
            const presses = [];
            const emptyHost = createTestHost({ slotCount: 27 });

            const shop = mount(
                () =>
                    h("slot", {
                        index: 0,
                        item: () => (soldOut.value ? null : { typeId: "minecraft:diamond", name: "Buy" }),
                        onClick: (event) => presses.push(event.index),
                        sound: "random.orb",
                    }),
                emptyHost,
            );

            emptyHost.simulateTake(0);
            shop.flush();
            check("a stocked button still presses", presses.length === 1, `presses=${presses.length}`);
            check("a stocked button still sounds", emptyHost.sounds.length === 1, `sounds=${emptyHost.sounds.length}`);

            soldOut.value = true;
            shop.flush();
            check("selling out empties the slot", emptyHost.readSlot(0) === null, JSON.stringify(emptyHost.readSlot(0)));

            // `clearHistory` resets the sound log, so a silent interaction counts zero.
            emptyHost.clearHistory();
            emptyHost.simulatePlace(0, { typeId: "minecraft:nether_star", amount: 1 });
            shop.flush();
            check("an empty button does not press", presses.length === 1, `presses=${presses.length}`);
            check("an empty button makes no sound", emptyHost.sounds.length === 0, `sounds=${emptyHost.sounds.length}`);
            check("the empty slot is repainted empty", emptyHost.readSlot(0) === null, JSON.stringify(emptyHost.readSlot(0)));

            shop.unmount();
        }
    },
);
