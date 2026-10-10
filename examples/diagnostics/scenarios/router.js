/**
 * Scenario 7: routing inside one surface. Navigation must cost a diff, not a re-open (`event=nav`
 * carries the running write count), and the shared layout must mount and unmount once.
 */

import { createContext, createRouter, h, provideContext, Routes, useContext, useEffect, useRouter, useSignal } from "../ContainerUI/ContainerFormData.js";
import { log } from "../support/report.js";

/** Carries the session holder to every screen, for the write count. */
const RouterDiagContext = createContext(null);

const navWrites = (diag) => {
    const app = diag && diag.holder && diag.holder.session && diag.holder.session.app;
    return app ? app.writeCount : "n/a";
};

const logNav = ({ diag, action, to }) => log("info", { event: "nav", action, to, writes: navWrites(diag) });

/** Logs a component's mount and unmount. */
const useLifecycleLog = (name) => {
    useEffect(() => {
        log("info", { event: "screen-mounted", screen: name });
        return () => log("info", { event: "screen-unmounted", screen: name });
    }, []);
};

const RouteChrome = (props) => {
    const router = useRouter();
    const diag = useContext(RouterDiagContext);
    useLifecycleLog("chrome");

    return h(
        "box",
        null,
        h("slot", { index: 0, item: { typeId: "minecraft:compass", name: `§7маршрут: §f${props.route.name}` } }),
        router.canGoBack()
            ? h("slot", {
                  index: 8,
                  item: { typeId: "minecraft:arrow", name: "§e← Назад по стеку" },
                  onClick: () => {
                      logNav({ diag, action: "back", to: "previous" });
                      router.back();
                  },
              })
            : h("slot", { index: 8, item: { typeId: "minecraft:barrier", name: "§8корень стека" } }),
        props.children,
    );
};

const RouteAlpha = () => {
    const router = useRouter();
    const diag = useContext(RouterDiagContext);
    useLifecycleLog("alpha");

    return h(
        "row",
        { index: 10 },
        h("slot", {
            key: "b",
            item: { typeId: "minecraft:emerald_block", name: "§aВперёд: beta" },
            onClick: () => {
                logNav({ diag, action: "push", to: "beta" });
                router.push("beta", { from: "alpha" });
            },
        }),
        h("slot", {
            key: "g",
            item: { typeId: "minecraft:gold_block", name: "§6Вперёд: gamma" },
            onClick: () => {
                logNav({ diag, action: "push", to: "gamma" });
                router.push("gamma", { from: "alpha" });
            },
        }),
    );
};

const RouteBeta = (props) => {
    const router = useRouter();
    const diag = useContext(RouterDiagContext);
    const visits = useSignal(0);
    useLifecycleLog("beta");

    return h(
        "row",
        { index: 10 },
        h("slot", {
            key: "count",
            item: () => ({
                typeId: "minecraft:paper",
                name: `§fbeta, пришли из §e${props.from ?? "?"}`,
                lore: [`§7нажатий на этом экране: §e${visits.value}`],
            }),
        }),
        h("slot", {
            key: "tap",
            item: { typeId: "minecraft:lever", name: "§bНажать" },
            onClick: () => {
                visits.value += 1;
                // Screen state: it resets after navigating away and back.
                log("info", { event: "note", scenario: "router", action: "tap", screen: "beta", taps: visits.value });
            },
        }),
        h("slot", {
            key: "g",
            item: { typeId: "minecraft:gold_block", name: "§6Дальше: gamma (replace)" },
            onClick: () => {
                logNav({ diag, action: "replace", to: "gamma" });
                router.replace("gamma", { from: "beta" });
            },
        }),
    );
};

const RouteGamma = (props) => {
    useLifecycleLog("gamma");
    return h("slot", {
        index: 13,
        item: { typeId: "minecraft:diamond_block", name: `§bgamma, пришли из §e${props.from ?? "?"}` },
    });
};

export const RouterTest = (props) => {
    const router = useSignal(null);
    if (!router.peek()) router.value = createRouter("alpha");

    provideContext(RouterDiagContext, { holder: props.holder });

    return h(Routes, {
        router: router.peek(),
        layout: RouteChrome,
        screens: { alpha: RouteAlpha, beta: RouteBeta, gamma: RouteGamma },
    });
};
