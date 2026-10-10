/**
 * Scenario 12: what a slot probe costs. Times the probe candidates on a fully occupied menu, then
 * whole scan passes back to back (`action=scan-cost`), split into setup, probes and tracker work.
 */

import { system } from "@minecraft/server";
import { h, useEffect } from "../ContainerUI/ContainerFormData.js";
import { note } from "../support/report.js";
import { BackButton, CloseButton, PANE } from "../support/ui.js";

/** Typical buttons: what `getItem` copies depends on what the stack carries. */
const BENCH_ITEMS = [
    PANE,
    { typeId: "minecraft:emerald", name: "§aКупить", lore: ["§7Цена: 5", "§8нажми"] },
    { typeId: "minecraft:golden_apple", amount: 8 },
    { typeId: "minecraft:diamond_sword", name: "§bМеч", enchantments: [{ id: "sharpness", level: 5 }] },
    { typeId: "minecraft:paper", name: "§fИнфо" },
];
/** Four per-slot probes, then the scan's per-pass fixed work. */
const BENCH_METHODS = ["getItem", "getItemBare", "getSlot", "cachedSlot", "resolveContainer", "entityIsValid"];
const BENCH_ROUNDS = 3;
/** Full sweeps per batch: about 1000 probes, enough for a 1 ms clock and short enough for one tick. */
const BENCH_SWEEPS = 40;

const SCAN_COST_ROUNDS = 3;
/** Passes per round: enough to time a sub-millisecond pass, few enough for a tick. */
const SCAN_COST_PASSES = 100;

const readSlotHandle = (slot) => {
    // `typeId` throws on an empty slot.
    if (!slot.hasItem()) return 0;
    return slot.typeId.length + slot.amount + (slot.nameTag?.length ?? 0);
};

/** One probe per method over a fixed target. Each returns a number, so the reads feed a printed sink. */
const BENCH_PROBES = {
    // A copy of the stack, then three reads from the copy.
    getItem: (target) => (index) => {
        const stack = target.container.getItem(index);
        if (!stack) return 0;
        return stack.typeId.length + stack.amount + (stack.nameTag?.length ?? 0);
    },
    // The copy alone.
    getItemBare: (target) => (index) => (target.container.getItem(index) ? 1 : 0),
    // The three reads through a slot handle fetched per probe.
    getSlot: (target) => (index) => readSlotHandle(target.container.getSlot(index)),
    // The same handle, fetched once and kept.
    cachedSlot: (target) => (index) => readSlotHandle(target.slots[index]),
    // Finding the surface container at the start of a pass.
    resolveContainer: (target) => () => (target.entity.getComponent("minecraft:inventory")?.container?.isValid ? 1 : 0),
    // The entity validity read made once a pass.
    entityIsValid: (target) => () => (target.entity.isValid ? 1 : 0),
};

/** Times whole scan passes back to back, one round per tick. */
const measureScanRounds = (surface, round) => {
    if (surface.isClosed || round >= SCAN_COST_ROUNDS) return;
    const phases = surface.measureScanPhases(SCAN_COST_PASSES);
    const perPassUs = (ms) => ((ms * 1000) / SCAN_COST_PASSES).toFixed(0);
    note("bench", {
        action: "scan-cost",
        round,
        passes: SCAN_COST_PASSES,
        // Skipped while a gesture is in flight.
        totalMs: phases?.passesMs ?? "skipped",
        perPassUs: phases ? perPassUs(phases.passesMs) : undefined,
        setupUs: phases ? perPassUs(phases.setupMs) : undefined,
        probesUs: phases ? perPassUs(phases.probesMs - phases.setupMs) : undefined,
        trackerUs: phases ? perPassUs(phases.passesMs - phases.probesMs) : undefined,
    });
    system.runTimeout(() => measureScanRounds(surface, round + 1), 1);
};

/** Times each probe method over the open surface, one batch per tick, methods interleaved. */
const runBench = (holder) => {
    const surface = holder.session?.surface;
    const entity = surface?.entity;
    const container = entity?.getComponent("minecraft:inventory")?.container;
    if (!container) {
        note("bench", { action: "aborted", reason: "no-container" });
        return;
    }

    const size = container.size;
    const slots = Array.from({ length: size }, (unused, index) => container.getSlot(index));
    const occupied = slots.filter((slot) => slot.hasItem()).length;
    const target = { container, slots, entity };
    const totals = Object.fromEntries(BENCH_METHODS.map((method) => [method, 0]));
    const batches = Array.from({ length: BENCH_ROUNDS }, () => BENCH_METHODS).flat();
    let sink = 0;
    note("bench", { action: "start", size, occupied, rounds: BENCH_ROUNDS, sweeps: BENCH_SWEEPS });

    const runBatch = (position) => {
        if (surface.isClosed) {
            note("bench", { action: "aborted", reason: "closed", batch: position });
            return;
        }
        if (position >= batches.length) {
            const probes = BENCH_ROUNDS * BENCH_SWEEPS * size;
            for (const method of BENCH_METHODS) {
                note("bench", {
                    method,
                    probes,
                    totalMs: totals[method],
                    perProbeUs: ((totals[method] * 1000) / probes).toFixed(1),
                });
            }
            // Whether a handle kept for a dozen ticks still reads.
            note("bench", { action: "done", occupied, cachedValid: slots.every((slot) => slot.isValid), sink });
            system.runTimeout(() => measureScanRounds(surface, 0), 1);
            return;
        }

        const method = batches[position];
        const probe = BENCH_PROBES[method](target);
        const startedAtMs = Date.now();
        for (let sweep = 0; sweep < BENCH_SWEEPS; sweep++) {
            for (let index = 0; index < size; index++) sink += probe(index);
        }
        totals[method] += Date.now() - startedAtMs;
        system.runTimeout(() => runBatch(position + 1), 1);
    };
    runBatch(0);
};

export const BenchTest = (props) => {
    useEffect(() => {
        // Ten ticks for the mount and first paint to settle.
        const handle = system.runTimeout(() => runBench(props.holder), 10);
        return () => system.clearRun(handle);
    }, []);

    // Every slot occupied: occupancy is what the probe cost depends on.
    return h(
        "box",
        null,
        h("slot", { index: 0, item: { typeId: "minecraft:paper", name: "§eЗамер: не трогай меню 1 секунду" } }),
        ...Array.from({ length: 24 }, (unused, offset) =>
            h("slot", { key: offset + 1, index: offset + 1, item: BENCH_ITEMS[offset % BENCH_ITEMS.length] }),
        ),
        h(CloseButton, { index: 25 }),
        h(BackButton, { index: 26, player: props.player }),
    );
};
