/** Ground events that arrived before the take they resolve, kept for a few passes. */

import { GROUND_EVENT_HOLD_TICKS, MAX_HELD_GROUND_EVENTS } from "../constants.js";
import type { SlotProbe } from "./slotMatching.js";

interface HeldEvent {
    probe: SlotProbe;
    passesLeft: number;
}

/** A short, bounded memory of unclaimed destroyed copies. */
export class HeldGroundEvents {
    #held: HeldEvent[] = [];

    /** Events being held. */
    get count(): number {
        return this.#held.length;
    }

    /** The held events, oldest first. */
    get all(): readonly SlotProbe[] {
        return this.#held.map((event) => event.probe);
    }

    /** Holds an event; past the bound the oldest is forgotten. */
    hold(probe: SlotProbe): void {
        this.#held.push({ probe, passesLeft: GROUND_EVENT_HOLD_TICKS });
        if (this.#held.length > MAX_HELD_GROUND_EVENTS) this.#held.shift();
    }

    /** Forgets one held event. */
    release(probe: SlotProbe): void {
        this.#held = this.#held.filter((event) => event.probe !== probe);
    }

    /** Ends a pass: events nobody claimed in time are forgotten. */
    age(): void {
        if (this.#held.length === 0) return;
        for (const event of this.#held) event.passesLeft--;
        this.#held = this.#held.filter((event) => event.passesLeft > 0);
    }

    /** Forgets every event. */
    clear(): void {
        this.#held = [];
    }
}
