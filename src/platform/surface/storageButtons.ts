/**
 * Menu buttons that are storage items, such as a bundle. A player can take an item out of one, or put
 * one of their own in, without changing the type, amount or name the scan reads, so the scan compares
 * a fingerprint of what they hold with the one written, every half second.
 */

import type { Container, ItemStack } from "@minecraft/server";
import { storageContainerOf, storageFingerprintOf, takeOwnItemsOut } from "../items/storageItems.js";

/** What a storage button was written with. */
interface WrittenStorage {
    readonly stack: ItemStack;
    readonly fingerprint: string;
}

/** Where the player's own items go, and where a repaint is recorded. */
export interface StorageButtonSink {
    /** Gives the player back their own items. */
    giveBack(stacks: readonly ItemStack[]): void;
    /** Receives tracking records. */
    trace(message: string): void;
}

/** The storage items a surface wrote to its UI-owned slots. */
export class StorageButtons {
    readonly #written = new Map<number, WrittenStorage>();

    /**
     * Records a write: a storage item in a UI-owned slot is watched, anything else is not.
     *
     * @param write.index Surface slot.
     * @param write.stack The stack the slot now holds.
     * @param write.isUiOwned Whether the slot is the UI's rather than an `input`.
     */
    record({ index, stack, isUiOwned }: { index: number; stack: ItemStack | undefined; isUiOwned: boolean }): void {
        if (!isUiOwned || !stack || !storageContainerOf(stack)) {
            this.#written.delete(index);
            return;
        }
        this.#written.set(index, { stack: stack.clone(), fingerprint: storageFingerprintOf(stack) });
    }

    /**
     * Gives the player back what they put in a watched button, and writes a changed one again: an
     * item taken out of it is a marked copy, and the button shows it gone until repainted.
     *
     * @returns How many buttons were written again.
     */
    check(container: Container, sink: StorageButtonSink): number {
        let repainted = 0;
        this.#written.forEach((written, index) => {
            const current = this.#read(container, index);
            // Emptied or replaced: a take or a write, which the scan handles.
            if (!current || current.typeId !== written.stack.typeId) return;
            if (storageFingerprintOf(current) === written.fingerprint) return;
            const own = takeOwnItemsOut(current);
            try {
                container.setItem(index, written.stack.clone());
            } catch {
                return;
            }
            repainted++;
            sink.trace(`storage-button-restored slot=${index} returned=${own.length}`);
            sink.giveBack(own);
        });
        return repainted;
    }

    /**
     * Takes the player's own items out of a watched button that is about to be overwritten. The
     * slot keeps them until the write: hand them back only once it is done.
     *
     * @returns The items; empty for a slot that is not watched.
     */
    takeOwnItemsAt(container: Container, index: number): ItemStack[] {
        const written = this.#written.get(index);
        if (!written) return [];
        const current = this.#read(container, index);
        return current?.typeId === written.stack.typeId ? takeOwnItemsOut(current) : [];
    }

    /** Gives the player back what they put in any watched button, as the surface closes. */
    rescueAll(container: Container, sink: StorageButtonSink): void {
        this.#written.forEach((written, index) => {
            const current = this.#read(container, index);
            if (!current || current.typeId !== written.stack.typeId) return;
            const own = takeOwnItemsOut(current);
            if (own.length === 0) return;
            try {
                container.setItem(index, current);
            } catch {
                return;
            }
            sink.trace(`storage-button-emptied slot=${index} returned=${own.length}`);
            sink.giveBack(own);
        });
    }

    #read(container: Container, index: number): ItemStack | undefined {
        try {
            return container.getItem(index);
        } catch {
            return undefined;
        }
    }
}
