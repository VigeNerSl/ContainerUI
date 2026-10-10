/**
 * Scenario 13: a modal over the menu, data that loads, and a guarded sale. A confirm dialog covers
 * the menu and an input under it keeps the player's item (`action=input-under-modal`); a balance
 * loads behind a `Suspense` fallback and a forced failure reaches an `ErrorBoundary`; swapping the
 * input's item while "sell" is open must be refused (`action=sell-refused`).
 */

import { system } from "@minecraft/server";
import { Confirm, ErrorBoundary, h, Modal, Suspense, useEffect, useResource, useSignal } from "../ContainerUI/ContainerFormData.js";
import { note } from "../support/report.js";
import { BackButton, CloseButton, Divider } from "../support/ui.js";

const BACKDROP = { typeId: "minecraft:gray_stained_glass_pane", name: " " };
/** Two seconds: long enough to see the fallback. */
const BALANCE_LOAD_TICKS = 40;

let balanceLoads = 0;

/** A pretend bank call that settles after a delay, or fails when asked to. */
const loadBalance = (shouldFail) => {
    balanceLoads++;
    const attempt = balanceLoads;
    note("modal", { action: "load-start", attempt, shouldFail });
    return new Promise((resolve, reject) => {
        system.runTimeout(() => {
            if (shouldFail) {
                note("modal", { action: "load-failed", attempt });
                reject(new Error("bank offline"));
                return;
            }
            note("modal", { action: "load-done", attempt });
            resolve(attempt * 100);
        }, BALANCE_LOAD_TICKS);
    });
};

/** Where the player holds an item of this type: `cursor`, `inventory`, `nowhere` or `unknown`. */
const whereIs = (player, typeId) => {
    try {
        if (player.getComponent("minecraft:cursor_inventory")?.item?.typeId === typeId) return "cursor";
        const container = player.getComponent("minecraft:inventory")?.container;
        const size = container?.size ?? 0;
        const isHeld = Array.from({ length: size }, (unused, index) => index).some((index) => container.getItem(index)?.typeId === typeId);
        return isHeld ? "inventory" : "nowhere";
    } catch {
        return "unknown";
    }
};

const Balance = (props) => {
    // `reloads` is a dependency, so bumping it loads again; `shouldFail` is read when the load starts.
    const balance = useResource(() => loadBalance(props.shouldFail.peek()), [props.reloads.value]);
    return h("slot", {
        index: 14,
        item: { typeId: "minecraft:gold_ingot", name: `§6Баланс: ${balance.read()}`, lore: ["§7загружено через useResource"] },
    });
};

export const ModalTest = (props) => {
    const confirming = useSignal(false);
    const purchases = useSignal(0);
    const reloads = useSignal(0);
    const shouldFail = useSignal(false);
    /** The type the input last reported. */
    const deposited = useSignal(null);
    /** The input's item itself, for `Confirm` to compare. */
    const offered = useSignal(null);
    const selling = useSignal(false);

    // An input under an open modal keeps the player's item.
    useEffect(() => {
        if (!confirming.value) return;
        const handle = system.runTimeout(() => {
            const surface = props.holder.session?.surface;
            if (!surface || surface.isClosed) return;
            const under = surface.readSlot(19);
            note("modal", {
                action: "input-under-modal",
                typeId: under?.typeId ?? "empty",
                amount: under?.amount,
                expected: deposited.peek() ?? "empty",
            });
        }, 2);
        return () => system.clearRun(handle);
    });

    return h(
        "box",
        null,
        h(Divider, { index: 0 }),
        h("slot", {
            index: 9,
            item: {
                typeId: "minecraft:paper",
                name: "§fСценарий 13",
                lore: ["§7изумруд: окно подтверждения", "§7золото: загрузка через Suspense", "§7слот 19: твой предмет под окном"],
            },
        }),
        h("slot", {
            index: 10,
            item: { typeId: "minecraft:emerald", name: "§aКупить алмаз", lore: ["§7откроет «Подтвердить покупку?»"] },
            sound: "random.click",
            onClick: () => {
                confirming.value = true;
                note("modal", { action: "open" });
            },
        }),
        h("slot", { index: 12, item: () => ({ typeId: "minecraft:diamond", name: `§bКуплено: ${purchases.value}` }) }),

        h(
            ErrorBoundary,
            {
                fallback: (vigenersl) =>
                    h("slot", {
                        index: 14,
                        item: { typeId: "minecraft:barrier", name: "§cОшибка загрузки", lore: ["§7ErrorBoundary поймал отказ", "§7нажми: попробовать снова"] },
                        onClick: () => {
                            shouldFail.value = false;
                            note("modal", { action: "reset" });
                            vigenersl.reset();
                        },
                    }),
                onError: (vigenersl) => {
                    const { component, error } = vigenersl;
                    note("modal", { action: "error-caught", component, error: JSON.stringify(String(error)) });
                },
            },
            h(
                Suspense,
                { fallback: h("slot", { index: 14, item: { typeId: "minecraft:clock", name: "§7Загрузка баланса…", lore: ["§7fallback у Suspense"] } }) },
                h(Balance, { reloads, shouldFail }),
            ),
        ),
        h("slot", {
            index: 15,
            item: { typeId: "minecraft:compass", name: "§eЗагрузить заново" },
            onClick: () => {
                reloads.value += 1;
                note("modal", { action: "reload", reloads: reloads.value });
            },
        }),
        h("slot", {
            index: 16,
            item: () =>
                shouldFail.value
                    ? { typeId: "minecraft:redstone", name: "§cСледующая загрузка упадёт" }
                    : { typeId: "minecraft:gunpowder", name: "§7Сломать следующую загрузку" },
            onClick: () => {
                shouldFail.value = !shouldFail.value;
                note("modal", { action: "fail-toggle", shouldFail: shouldFail.value });
            },
        }),

        // Signposts on both sides of the input, which looks like any empty cell.
        h("slot", {
            index: 18,
            item: () =>
                deposited.value
                    ? {
                          typeId: "minecraft:paper",
                          name: `§aВ слоте 19: ${deposited.value}`,
                          lore: ["§7не забирай его обратно,", "§7сразу жми изумруд:", "§7окно не должно его закрыть"],
                      }
                    : { typeId: "minecraft:paper", name: "§fСвой предмет — сюда →", lore: ["§7потом нажми изумруд"] },
        }),
        h("input", {
            index: 19,
            onChange: (vigenersl) => {
                const { next, previous } = vigenersl;
                offered.value = next;
                deposited.value = next?.typeId ?? null;
                note("modal", { action: "input-change", typeId: next?.typeId ?? "empty", amount: next?.amount });
                const takenTypeId = previous?.typeId;
                if (next || !takenTypeId) return;
                // A take from an input is not traced, so say where the item went.
                system.runTimeout(() => note("modal", { action: "input-taken-to", typeId: takenTypeId, where: whereIs(props.player, takenTypeId) }), 1);
            },
        }),
        h("slot", { index: 20, item: { typeId: "minecraft:arrow", name: "§f← сюда, а не в этот слот" } }),

        h(
            Modal,
            {
                open: confirming.value,
                backdrop: BACKDROP,
                onDismiss: () => {
                    confirming.value = false;
                    note("modal", { action: "dismiss" });
                },
            },
            h("slot", { index: 4, item: { typeId: "minecraft:emerald", name: "§fКупить алмаз за 5 изумрудов?" } }),
            h("slot", {
                index: 11,
                item: { typeId: "minecraft:lime_dye", name: "§aДа, купить" },
                sound: "random.orb",
                onClick: () => {
                    purchases.value += 1;
                    confirming.value = false;
                    note("modal", { action: "confirm", purchases: purchases.value });
                },
            }),
            h("slot", {
                index: 15,
                item: { typeId: "minecraft:red_dye", name: "§cОтмена" },
                onClick: () => {
                    confirming.value = false;
                    note("modal", { action: "cancel" });
                },
            }),
        ),

        // Open, swap or take the item in slot 19 while the dialog shows, then press "yes".
        h("slot", {
            index: 13,
            item: { typeId: "minecraft:gold_nugget", name: "§eПродать предмет из слота 19", lore: ["§7Confirm сверит предмет при «Да»", "§7подмени его, пока окно открыто"] },
            onClick: () => {
                if (!offered.peek()) {
                    note("modal", { action: "sell-empty" });
                    return;
                }
                selling.value = true;
                note("modal", { action: "sell-open", typeId: offered.peek()?.typeId });
            },
        }),
        h(
            Confirm,
            {
                open: selling.value,
                watch: () => offered.value,
                backdrop: BACKDROP,
                confirm: { index: 11, item: { typeId: "minecraft:lime_dye", name: "§aДа, продать" }, sound: "random.orb" },
                cancel: { index: 15, item: { typeId: "minecraft:red_dye", name: "§cОтмена" } },
                onConfirm: () => {
                    selling.value = false;
                    note("modal", { action: "sold", typeId: offered.peek()?.typeId ?? "empty" });
                },
                onCancel: () => {
                    selling.value = false;
                    note("modal", { action: "sell-cancel" });
                },
                onChanged: () => {
                    selling.value = false;
                    note("modal", { action: "sell-refused", reason: "item-changed", now: offered.peek()?.typeId ?? "empty" });
                },
            },
            h("slot", { index: 4, item: () => ({ typeId: "minecraft:gold_nugget", name: `§fПродать ${offered.value?.typeId ?? "пустоту"}?` }) }),
        ),

        h(CloseButton, { index: 25 }),
        h(BackButton, { index: 26, player: props.player }),
    );
};
