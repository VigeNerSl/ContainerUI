/**
 * Takes back items a refused take left with the viewer, retrying for a few ticks when the item is
 * not where a read reaches yet. What is never found is reported.
 */

import type { ItemView } from "../../core/host/host.js";
import { MAX_REVOKE_ATTEMPTS } from "../constants.js";

/** Where {@link Revocations} takes items from, and reports to. */
export interface RevocationHost {
    /** Takes back up to `amount` of `item`; returns how many were taken. */
    takeBack(item: ItemView, amount: number): number;
    /** Receives one record per take-back and per item never found. */
    trace(message: string): void;
}

interface Revocation {
    item: ItemView;
    remaining: number;
    attempts: number;
}

/** Pending take-backs. */
export class Revocations {
    readonly #host: RevocationHost;
    #queue: Revocation[] = [];

    constructor(host: RevocationHost) {
        this.#host = host;
    }

    /** Takes `item` back now, and keeps looking for what was not found. */
    request(item: ItemView): void {
        const revocation: Revocation = { item, remaining: Math.max(1, item.amount ?? 1), attempts: 0 };
        this.#attempt(revocation);
        if (revocation.remaining > 0) this.#queue.push(revocation);
    }

    /** Looks again for everything pending; gives up after `MAX_REVOKE_ATTEMPTS`. */
    retry(): void {
        if (this.#queue.length === 0) return;
        this.#queue = this.#queue.filter((revocation) => {
            this.#attempt(revocation);
            if (revocation.remaining <= 0) return false;
            if (revocation.attempts < MAX_REVOKE_ATTEMPTS) return true;
            this.#reportMissing(revocation);
            return false;
        });
    }

    /** A last look on close; what is missing is reported. */
    settle(): void {
        for (const revocation of this.#queue) {
            this.#attempt(revocation);
            if (revocation.remaining > 0) this.#reportMissing(revocation);
        }
        this.#queue = [];
    }

    #attempt(revocation: Revocation): void {
        revocation.attempts++;
        const taken = this.#host.takeBack(revocation.item, revocation.remaining);
        if (taken <= 0) return;
        revocation.remaining -= taken;
        this.#host.trace(`conflict-taken-back item=${revocation.item.typeId} amount=${taken}`);
    }

    #reportMissing(revocation: Revocation): void {
        this.#host.trace(`conflict-unresolved item=${revocation.item.typeId} missing=${revocation.remaining}`);
    }
}
