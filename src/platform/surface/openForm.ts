/**
 * `ContainerFormData`: the form builder, with `.open()` for a player.
 *
 * @example
 * new ContainerFormData(27)
 *     .title("§6Shop")
 *     .border({ typeId: "minecraft:gray_stained_glass_pane", name: " " })
 *     .button(11, { typeId: "minecraft:diamond", name: "§aBuy" }, (vigenersl) => buy(vigenersl))
 *     .open(player);
 */

import type { Player } from "@minecraft/server";
import { ContainerFormBuilder } from "../../core/index.js";
import { log } from "../../core/logging/logger.js";
import { openContainer, type ContainerSession, type OpenContainerOptions } from "./openContainer.js";

/** `openContainer` options, minus what the builder already holds. */
export type ContainerFormOpenOptions = Omit<OpenContainerOptions, "size" | "title"> & {
    /** Overrides the title set with `.title()`. */
    title?: string;
};

/** A container form that opens on Bedrock. */
export class ContainerFormData extends ContainerFormBuilder {
    #onClose: (() => void) | null = null;

    /**
     * Sets what runs when the form closes, however it closed.
     *
     * @param handler Replaces any handler set before.
     * @returns The builder.
     */
    onClose(handler: () => void): this {
        this.#onClose = handler;
        return this;
    }

    /**
     * Opens the form for `player`. Changes made to the builder after opening still apply.
     *
     * @param player The viewer.
     * @param options Title override and `openContainer` options.
     * @returns The session.
     */
    open(player: Player, options: ContainerFormOpenOptions = {}): ContainerSession {
        const { title, ...rest } = options;

        const session = openContainer(player, () => this.build(), {
            ...rest,
            size: this.size,
            title: title ?? this.resolvedTitle,
        });

        if (this.#onClose) {
            const handler = this.#onClose;
            void session.closed.then(() => {
                try {
                    handler();
                } catch (error) {
                    log({ level: "warn", source: "surface", message: `Form close handler threw: ${String(error)}`, detail: error });
                }
            });
        }
        return session;
    }
}
