/**
 * Scheduler, effect and commit behaviour: stale children, loop accounting, flush request failures,
 * effect creation, item views written by reference, layout numbers, writes after unmount, hidden
 * suspense and nested `flushSync`.
 */

import { deferred, isRenderError, settleLoads } from "./fixtures.mjs";

/** A host that records every write, including writes after it closed, and can fail on demand. */
const recordingHost = ({ slotCount = 9, onWrite, failWritableSlots = false } = {}) => {
    const contents = new Array(slotCount).fill(null);
    const interactionHandlers = new Set();
    const closeHandlers = new Set();
    const state = { isClosed: false, writes: [], writesAfterClose: 0 };
    const host = {
        slotCount,
        state,
        writeSlot: (index, item) => {
            state.writes.push({ index, item });
            if (state.isClosed) state.writesAfterClose++;
            contents[index] = item;
            onWrite?.(index, host);
        },
        readSlot: (index) => contents[index] ?? null,
        setPlayerWritableSlots: () => {
            if (failWritableSlots) throw new Error("setPlayerWritableSlots failed");
        },
        onInteraction: (handler) => {
            interactionHandlers.add(handler);
            return () => interactionHandlers.delete(handler);
        },
        onClose: (handler) => {
            closeHandlers.add(handler);
            return () => closeHandlers.delete(handler);
        },
        close: (reason = "programmatic") => {
            if (state.isClosed) return;
            state.isClosed = true;
            for (const handler of Array.from(closeHandlers)) handler(reason);
        },
        interact: (index, next) => {
            const previous = contents[index] ?? null;
            contents[index] = next;
            for (const handler of Array.from(interactionHandlers)) handler({ index, kind: next ? "place" : "take", previous, next });
        },
    };
    return host;
};

export const checkRuntimeFixes = async ({ check, core, freshRuntime, load }) => {
    const { h, signal, effect, batch, createRoot, createScope, runWithScope, mount, createTestHost, ErrorBoundary, Suspense, useResource } = core;

    console.log("\n  stale children\n");
    {
        const { clock } = freshRuntime();
        const user = signal({ name: "Steve" });
        const diagnostics = [];
        const Profile = () => h("slot", { index: 0, item: { typeId: "minecraft:paper", name: user.value.name } });
        const Parent = () => (user.value ? h(Profile) : null);
        const host = createTestHost({ slotCount: 9 });
        mount(() => h(Parent), host, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
        user.value = null;
        clock.runPending();
        const errors = diagnostics.filter((diagnostic) => diagnostic.kind === "render-error").map((diagnostic) => diagnostic.message);
        check("a child its parent stops rendering does not render once more on its way out", errors.length === 0, errors.join(" | "));
        check("and its slot is cleared", !host.readSlot(0), JSON.stringify(host.readSlot(0)));
        user.value = { name: "Alex" };
        clock.runPending();
        check("a child the parent renders again shows the new value", host.readSlot(0)?.name === "Alex", JSON.stringify(host.readSlot(0)));
    }
    {
        const { clock } = freshRuntime();
        const user = signal({ name: "Steve" });
        const seen = [];
        const Profile = () => {
            core.useEffect(() => {
                seen.push(user.value === null ? "gone" : user.value.name);
            });
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "profile" } });
        };
        const Parent = () => (user.value ? h(Profile) : null);
        mount(() => h(Parent), createTestHost({ slotCount: 9 }));
        clock.runPending();
        seen.length = 0;
        user.value = null;
        clock.runPending();
        check("a hook effect of a child on its way out does not run once more", !seen.includes("gone"), seen.join(","));
    }
    {
        const { clock } = freshRuntime();
        const label = signal("a");
        const seen = [];
        const Child = () => {
            core.useEffect(() => {
                seen.push(label.value);
            });
            return h("slot", { index: 1, item: { typeId: "minecraft:paper", name: "child" } });
        };
        const Parent = () => [h("slot", { index: 0, item: { typeId: "minecraft:paper", name: label.value } }), h(Child)];
        mount(() => h(Parent), createTestHost({ slotCount: 9 }));
        clock.runPending();
        seen.length = 0;
        label.value = "b";
        clock.runPending();
        check("a held hook effect of a child that stays runs once the walk reaches it", seen.join(",") === "b", seen.join(","));
    }
    {
        const { clock } = freshRuntime();
        const user = signal({ name: "Steve" });
        const Profile = () => h("slot", { index: 0, item: { typeId: "minecraft:paper", name: user.value.name } });
        const Parent = () => (user.value ? h(Profile) : h("slot", { index: 1, item: { typeId: "minecraft:barrier", name: "signed out" } }));
        const host = createTestHost({ slotCount: 9 });
        mount(() => h(ErrorBoundary, { fallback: h("slot", { index: 2, item: { typeId: "minecraft:tnt", name: "fallback" } }) }, h(Parent)), host);
        user.value = null;
        clock.runPending();
        check(
            "an error boundary above does not show its fallback for a child on its way out",
            !host.readSlot(2) && host.readSlot(1)?.name === "signed out",
            JSON.stringify([host.readSlot(1), host.readSlot(2)]),
        );
    }
    {
        // A child whose parent re-renders but keeps it still renders in the same pass.
        const { clock } = freshRuntime();
        const label = signal("a");
        let childRenders = 0;
        const Child = () => {
            childRenders++;
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `child:${label.value}` } });
        };
        const Parent = () => [h("slot", { index: 1, item: { typeId: "minecraft:paper", name: `parent:${label.value}` } }), h(Child)];
        const host = createTestHost({ slotCount: 9 });
        mount(() => h(Parent), host);
        host.clearHistory();
        const rendersBefore = childRenders;
        label.value = "b";
        clock.runPending();
        check(
            "a held child that stays renders once, inside the commit's walk",
            host.readSlot(0)?.name === "child:b" && childRenders - rendersBefore === 1 && host.writes.length === 2,
            `renders=${childRenders - rendersBefore} writes=${host.writes.length} slot0=${host.readSlot(0)?.name}`,
        );
    }

    console.log("\n  loop accounting\n");
    {
        const { clock, errors } = freshRuntime();
        const total = signal(0);
        const writerCount = 126;
        const triggers = Array.from({ length: writerCount }, () => signal(0));
        let seen = -1;
        createRoot(() => {
            effect(() => {
                seen = total.value;
            });
            // Deeper than the reader, so the reader runs between every two writers.
            runWithScope(createScope(), () => {
                triggers.forEach((trigger) => {
                    effect(() => {
                        if (trigger.value === 0) return;
                        total.update((value) => value + 1);
                    });
                });
            });
        });
        batch(() => triggers.forEach((trigger) => trigger.set(1)));
        clock.runPending();
        check("a reader fed by many distinct writers is not reported as a loop", errors.length === 0, errors.join(" | "));
        check("and ends on the final value", seen === writerCount && total.peek() === writerCount, `seen=${seen} total=${total.peek()}`);
    }
    {
        const { clock, errors } = freshRuntime();
        const first = signal(0);
        const second = signal(0);
        const isOn = signal(false);
        createRoot(() => {
            effect(() => {
                if (!isOn.value) return;
                second.set(first.value + 1);
            });
            effect(() => {
                if (!isOn.value) return;
                first.set(second.value + 1);
            });
        });
        isOn.value = true;
        let isSettled = true;
        try {
            clock.runPending();
        } catch {
            isSettled = false;
        }
        check("a loop between two effects is still reported", isSettled && errors.length >= 1, `settled=${isSettled} errors=${errors.length}`);
    }

    console.log("\n  flush request failures\n");
    {
        core.resetRuntime();
        const flushes = [];
        let shouldFail = true;
        let requests = 0;
        const errors = [];
        core.configureRuntime(
            {
                requestFlush: (callback) => {
                    requests++;
                    if (shouldFail) throw new Error("system.run is not available");
                    flushes.push(callback);
                },
                now: () => 0,
            },
            { onError: (error) => errors.push(error.message) },
        );
        const count = signal(0);
        const seen = { first: -1, second: -1 };
        createRoot(() => {
            effect(() => {
                seen.first = count.value;
            });
            effect(() => {
                seen.second = count.value;
            });
        });
        const write = (value) => {
            try {
                count.value = value;
                return true;
            } catch {
                return false;
            }
        };
        const isFirstWriteQuiet = write(1);
        core.flushSync();
        check("a host whose flush request throws does not throw into the write", isFirstWriteQuiet);
        check("and every subscriber of the write is still marked", seen.first === 1 && seen.second === 1, JSON.stringify(seen));
        const isSecondWriteQuiet = write(2);
        check("nor into the writes after it", isSecondWriteQuiet);
        check("the failure is reported once per run of failures", errors.length === 1, errors.join(" | "));
        shouldFail = false;
        write(3);
        while (flushes.length > 0) flushes.shift()();
        check("a later write retries the request, and every subscriber runs", seen.first === 3 && seen.second === 3, `requests=${requests} seen=${JSON.stringify(seen)}`);
        shouldFail = true;
        write(4);
        check("a new run of failures is reported again", errors.length === 2, errors.join(" | "));
        shouldFail = false;
        write(5);
        while (flushes.length > 0) flushes.shift()();
        check("and recovers again", seen.first === 5 && seen.second === 5, JSON.stringify(seen));
    }

    console.log("\n  effect creation\n");
    {
        const { scheduler } = freshRuntime();
        const { createEffect } = await load("core/reactive/effect.js");
        let runs = 0;
        // `deferInitialRun` is deliberately not a CreateEffectOptions key: passing it must not skip the first run.
        createRoot(() => createEffect(() => void runs++, scheduler, { deferInitialRun: true }));
        check("an effect always runs once when created; there is no deferred first run", runs === 1, `runs=${runs}`);
    }

    console.log("\n  item views written by reference\n");
    {
        const { clock } = freshRuntime();
        const item = { typeId: "minecraft:paper", name: "before" };
        const tick = signal(0);
        const host = createTestHost({ slotCount: 9 });
        mount(() => (tick.value, h("slot", { index: 0, item })), host);
        item.name = "after";
        tick.value = 1;
        clock.runPending();
        check("an item changed in place and rendered again is written", host.readSlot(0)?.name === "after", JSON.stringify(host.readSlot(0)));
    }
    {
        const { clock } = freshRuntime();
        const payload = { id: "real-sword" };
        const tick = signal(0);
        const host = createTestHost({ slotCount: 9 });
        mount(
            () => (
                tick.value,
                [
                    h("slot", { index: 0, item: { typeId: "minecraft:diamond_sword", native: payload } }),
                    h("slot", { index: 1, item: { typeId: "minecraft:paper", name: "same", lore: ["line"] } }),
                    h("input", { index: 2, initialItem: { typeId: "minecraft:apple" } }),
                ]
            ),
            host,
        );
        host.clearHistory();
        tick.value = 1;
        clock.runPending();
        check("an unchanged item, real or described, costs no write", host.writes.length === 0, `writes=${host.writes.length}`);
    }
    {
        const { clock } = freshRuntime();
        const seed = { typeId: "minecraft:apple", name: "seed" };
        const tick = signal(0);
        const host = createTestHost({ slotCount: 9 });
        mount(() => (tick.value, h("input", { index: 0, initialItem: seed })), host);
        host.clearHistory();
        seed.name = "changed";
        tick.value = 1;
        clock.runPending();
        check("an input's seed changed in place does not overwrite the player's slot", host.writes.length === 0, `writes=${host.writes.length}`);
    }

    console.log("\n  layout numbers\n");
    {
        const layoutOutcome = (layout) => {
            freshRuntime();
            const diagnostics = [];
            const host = createTestHost({ slotCount: 9 });
            mount(
                () =>
                    h(
                        "row",
                        { index: 0 },
                        h("slot", { item: { typeId: "minecraft:apple" } }),
                        layout,
                        h("slot", { item: { typeId: "minecraft:bread" } }),
                    ),
                host,
                { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
            );
            return { host, diagnostics };
        };
        const stone = () => h("slot", { item: { typeId: "minecraft:stone" } });
        const cases = [
            ["a fractional gap", h("box", { gap: 0.5 }, stone(), stone())],
            ["a NaN gap", h("row", { gap: Number.NaN }, stone(), stone())],
            ["an infinite gap", h("row", { gap: Number.POSITIVE_INFINITY }, stone(), stone())],
            ["fractional columns", h("grid", { columns: 2.5 }, stone(), stone())],
            ["NaN columns", h("grid", { columns: Number.NaN }, stone(), stone())],
        ];
        cases.forEach(([label, layout]) => {
            const { host, diagnostics } = layoutOutcome(layout);
            const reported = diagnostics.filter((diagnostic) => isRenderError(diagnostic, "layout"));
            const contents = Object.values(host.snapshot()).map((item) => item?.typeId?.replace("minecraft:", "") ?? "-");
            check(
                `${label} is a render error, its contents are not drawn, and its cell is still taken`,
                reported.length >= 1 && host.readSlot(0)?.typeId === "minecraft:apple" && !host.readSlot(1) && host.readSlot(2)?.typeId === "minecraft:bread" && !contents.includes("stone"),
                `${reported.map((diagnostic) => diagnostic.message).join(" | ") || "no report"} slots=${contents.join(",")}`,
            );
        });
        const { diagnostics } = layoutOutcome(h("row", { gap: 1 }, stone()));
        check("an integer gap is no error", diagnostics.length === 0, JSON.stringify(diagnostics.map((diagnostic) => diagnostic.message)));
    }

    console.log("\n  writes after unmount\n");
    {
        const { clock } = freshRuntime();
        const typeId = signal("minecraft:stone");
        const host = recordingHost({
            onWrite: (index, target) => {
                if (index === 0 && target.readSlot(0)?.typeId === "minecraft:dirt") target.close("player");
            },
        });
        mount(() => [0, 1, 2, 3].map((index) => h("slot", { index, item: { typeId: typeId.value } })), host);
        typeId.value = "minecraft:dirt";
        clock.runPending();
        check("a write that closes the surface ends the commit's writes", host.state.writesAfterClose === 0, `writesAfterClose=${host.state.writesAfterClose}`);
    }
    {
        const { clock } = freshRuntime();
        const host = recordingHost();
        mount(() => h("slot", { index: 4, item: { typeId: "minecraft:barrier" }, onClick: (event) => event.close() }), host);
        host.interact(4, null);
        clock.runPending();
        check("a click handler that closes the menu is not followed by a restore", host.state.writesAfterClose === 0, `writesAfterClose=${host.state.writesAfterClose}`);
    }
    {
        const { clock } = freshRuntime();
        const host = recordingHost();
        const changes = [];
        mount(
            () =>
                h("input", {
                    index: 3,
                    onPlace: (event) => event.close(),
                    onChange: (event) => changes.push(event.next?.typeId ?? "empty"),
                }),
            host,
        );
        host.interact(3, { typeId: "minecraft:apple" });
        clock.runPending();
        check(
            "an input handler that closes the menu writes nothing after, and the edit still reaches onChange",
            host.state.writesAfterClose === 0 && changes.join(",") === "minecraft:apple",
            `writesAfterClose=${host.state.writesAfterClose} changes=${changes.join(",")}`,
        );
    }
    {
        const { clock } = freshRuntime();
        const diagnostics = [];
        const host = recordingHost({ failWritableSlots: true });
        const tick = signal(0);
        mount(() => (tick.value, [h("slot", { index: 0, item: { typeId: "minecraft:stone" } }), h("input", { index: 1 })]), host, {
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });
        const writesAfterMount = host.state.writes.length;
        tick.value = 1;
        clock.runPending();
        const platformErrors = diagnostics.filter((diagnostic) => diagnostic.kind === "platform-error");
        check(
            "a throwing setPlayerWritableSlots is a platform-error, and the slots are still written",
            platformErrors.length >= 1 && host.readSlot(0)?.typeId === "minecraft:stone",
            `platformErrors=${platformErrors.length} slot0=${JSON.stringify(host.readSlot(0))}`,
        );
        check("and the next commit writes nothing new", host.state.writes.length === writesAfterMount, `writes ${writesAfterMount} -> ${host.state.writes.length}`);
    }

    console.log("\n  hidden suspense\n");
    {
        const { clock } = freshRuntime();
        const diagnostics = [];
        const pending = deferred();
        const host = createTestHost({ slotCount: 9 });
        const Waiter = () => {
            const value = useResource(() => pending.promise, []).read();
            return h("slot", { index: 0, item: { typeId: "minecraft:paper", name: `value:${value}` } });
        };
        const isBroken = signal(true);
        const hasExtras = signal(false);
        // The extras arrive once the subtree is already hidden: the first pass, before Suspense knows of the waiter, is shown.
        const extras = () =>
            hasExtras.value
                ? [
                      h("slot", { index: 30, item: { typeId: "minecraft:diamond" } }),
                      h("row", { index: 7 }, h("slot", { item: { typeId: "minecraft:stone" } }), h("slot", { item: { typeId: "minecraft:stone" } }), h("slot", { item: { typeId: "minecraft:stone" } })),
                      h("slot", {
                          index: 3,
                          item: () => {
                              if (isBroken.value) throw new Error("item source broke");
                              return { typeId: "minecraft:emerald" };
                          },
                      }),
                  ]
                : null;
        mount(
            () => h(Suspense, { fallback: h("slot", { index: 8, item: { typeId: "minecraft:clock", name: "loading" } }) }, h(Waiter), extras()),
            host,
            { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
        );
        clock.runPending();
        hasExtras.value = true;
        clock.runPending();
        const kinds = () => diagnostics.map((diagnostic) => diagnostic.kind);
        check("a hidden subtree reports no overflow while it waits", !kinds().includes("overflow"), JSON.stringify(diagnostics.map((diagnostic) => diagnostic.message)));
        check("nor an item source that throws inside it", !kinds().includes("render-error"), JSON.stringify(diagnostics.map((diagnostic) => diagnostic.message)));
        pending.resolve(5);
        await settleLoads(clock);
        const overflow = diagnostics.find((diagnostic) => diagnostic.kind === "overflow");
        check("once shown, the same subtree reports its overflow", overflow?.message.startsWith("2 cell(s)") === true, overflow?.message ?? "none");
        check("and its throwing item source", diagnostics.some((diagnostic) => isRenderError(diagnostic, "item of slot 3")), JSON.stringify(kinds()));
    }

    console.log("\n  nested flushSync\n");
    {
        const { clock } = freshRuntime();
        const count = signal(0);
        let depth = 0;
        let deepest = 0;
        const seen = [];
        createRoot(() => {
            effect(() => {
                depth++;
                deepest = Math.max(deepest, depth);
                const value = count.value;
                seen.push(value);
                if (value === 0) {
                    count.value = 1;
                    core.flushSync();
                }
                depth--;
            });
        });
        clock.runPending();
        check("flushSync inside an effect does not run that effect inside itself", deepest === 1, `deepest=${deepest} seen=${seen.join(",")}`);
        check("the effect runs again once its run is over", seen.join(",") === "0,1", `seen=${seen.join(",")}`);
    }
};
