/** Items that open a storage by click while a player sneaks with one in hand. */

import { ButtonState, InputButton, system, world, type ItemStack, type Player, type PlayerButtonInputAfterEvent } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import { onReinstall, onUninstall } from "../lifecycle.js";
import { inventoryContainerOf } from "../storage/inventoryContainer.js";
import { assertClickWaitTicks } from "../surface/clickWait.js";
import { playerById } from "../world/entities.js";
import { heldSessionFor, startHeldSession, type HeldOpenOptions, type HeldSource } from "./heldStorage.js";

/** An item that opens a storage by click, and how. */
export interface HeldItemOptions extends Omit<HeldOpenOptions, "whileSneaking"> {
    /** Whether an item in the player's hand opens a storage for them. Called when they start sneaking. */
    matches: (item: ItemStack, player: Player) => boolean;
    /** The source of the storage for this open: one source serves one open, so make a new one here. */
    source: (player: Player, item: ItemStack) => HeldSource;
}

/** The items registered, in the order they were. The first that matches opens. */
const items: HeldItemOptions[] = [];
let isListening = false;

/** Whether a rule matches, a rule that throws counting as no. */
const isMatch = ({ rule, item, player }: { rule: HeldItemOptions; item: ItemStack; player: Player }): boolean => {
    try {
        return rule.matches(item, player);
    } catch {
        return false;
    }
};

/**
 * A player starting to sneak with a registered item in hand opens it. The sneak shows on the next
 * tick: on a touch screen the button counts as pressed for one tick only, so `isSneaking` decides.
 */
const onSneakPressed = (vigenersl: PlayerButtonInputAfterEvent): void => {
    const { button, newButtonState, player } = vigenersl;
    if (button !== InputButton.Sneak || newButtonState !== ButtonState.Pressed) return;
    const playerId = player.id;
    system.runTimeout(() => {
        const owner = playerById(playerId);
        if (!owner?.isSneaking || heldSessionFor(playerId)) return;
        const held = inventoryContainerOf(owner)?.getItem(owner.selectedSlotIndex);
        const rule = held ? items.find((rule) => isMatch({ rule, item: held, player: owner })) : undefined;
        if (!held || !rule) return;
        const { title, clickWaitTicks, onEvent } = rule;
        let source: HeldSource;
        try {
            source = rule.source(owner, held);
        } catch (error) {
            log({ level: "warn", source: "storage", message: `held-source-failed error=${String(error)}` });
            return;
        }
        void startHeldSession({ player: owner, source, options: { title, clickWaitTicks, onEvent, whileSneaking: true } });
    }, 1);
};

/** Listens to sneak presses alone, once an item is registered, until uninstall. */
const listen = (): void => {
    if (isListening || items.length === 0) return;
    isListening = true;
    // [Source: minecraft-server.md:4227] The engine filters the presses, so other buttons never reach the script.
    world.afterEvents.playerButtonInput.subscribe(onSneakPressed);
    onUninstall(() => {
        world.afterEvents.playerButtonInput.unsubscribe(onSneakPressed);
        isListening = false;
    });
};

/**
 * Registers an item that opens a storage by click.
 *
 * @internal `installHeldItem` is the public way in.
 * @throws {RangeError} For a `clickWaitTicks` that is not a positive whole number.
 */
export const addHeldItem = (options: HeldItemOptions): void => {
    // Checked now: the wait is made only when a player sneaks, where a throw reaches nobody.
    if (options.clickWaitTicks !== undefined) assertClickWaitTicks(options.clickWaitTicks);
    const isFirst = items.length === 0;
    items.push(options);
    listen();
    if (isFirst) onReinstall(listen);
};
