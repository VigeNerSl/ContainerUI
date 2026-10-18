/** Menus opened by click: the head and a chosen point, the wait, the refused clicks, and orphaned menu entities. */

import { makeContainer } from "./fixtures.mjs";

export const checkClickOpen = async ({ check, load, loadEngine, core, freshRuntime }) => {
    const { h, mount } = core;
    const engine = await loadEngine();
    const { ItemStack, __intervals, __subscribers, system, world } = engine;
    const { BedrockSurface } = await load("platform/surface/surface.js");
    const { toItemStack, isRenderedItem } = await load("platform/items/itemConversion.js");
    const { CLICK_OPEN_WAIT_TICKS, SURFACE_CLICK_BOX_EVENT, SURFACE_ENTITY_TYPE_ID, SURFACE_MIRRORED_PROPERTY, SURFACE_NO_SEAT_EVENT, SURFACE_VIEWER_PROPERTY } = await load("platform/constants.js");

    const fire = (key, event) => {
        for (const callback of __subscribers.get(key) ?? []) callback(event);
        return event;
    };
    const runIntervalsFrom = (start) => {
        for (const callback of __intervals.slice(start)) callback();
    };

    /** Menu entities spawned so far, which `world.getEntity` finds as the engine does. */
    const spawned = new Map();

    /** A viewer and the menu entity the engine will spawn for them, recording what the surface does to it. */
    const clickWorld = (name) => {
        const overworld = { id: "overworld", spawnItem: () => undefined };
        const menu = makeContainer(27);
        const pocket = makeContainer(36);
        const properties = new Map();
        const entity = {
            id: `surface-${name}`,
            typeId: SURFACE_ENTITY_TYPE_ID,
            isValid: true,
            location: { x: 0, y: 64, z: 0 },
            nameTag: "",
            dimension: overworld,
            events: [],
            teleports: [],
            seatings: 0,
            triggerEvent(event) {
                this.events.push(event);
            },
            teleport(location) {
                this.teleports.push(location);
                this.location = location;
            },
            getDynamicProperty: (id) => properties.get(id),
            setDynamicProperty: (id, value) => properties.set(id, value),
            getComponent(id) {
                if (id === "minecraft:inventory") return { container: menu };
                if (id === "minecraft:rideable") return { addRider: () => (entity.seatings++, true) };
                return undefined;
            },
            remove() {
                this.isValid = false;
            },
        };
        const spawnedAt = [];
        const viewer = {
            id: `player-${name}`,
            typeId: "minecraft:player",
            name,
            isValid: true,
            location: { x: 0, y: 64, z: 0 },
            head: { x: 0, y: 65.62, z: 0 },
            dimension: { ...overworld, spawnEntity: (_id, location) => (spawnedAt.push(location), spawned.set(entity.id, entity), entity) },
            getHeadLocation() {
                return this.head;
            },
            playSound: () => undefined,
            onScreenDisplay: { setActionBar: () => undefined },
            getComponent: (id) => {
                if (id === "minecraft:inventory") return { container: pocket };
                if (id === "minecraft:cursor_inventory") return { item: undefined, clear: () => undefined };
                return undefined;
            },
        };
        entity.dimension = viewer.dimension;
        return { entity, viewer, menu, pocket, spawnedAt, properties };
    };

    /** Opens a click menu with one "Buy" button, and activates it unless told not to. */
    const openClickMenu = ({ name, options = {}, isActivated = true }) => {
        const scene = clickWorld(name);
        const traces = [];
        const reasons = [];
        const surface = new BedrockSurface(scene.viewer, { size: 27, openBy: "click", onTrace: (line) => traces.push(line), ...options });
        surface.onClose((reason) => reasons.push(reason));
        surface.open();
        mount(() => [h("slot", { index: 4, item: { typeId: "minecraft:emerald", name: "Buy" } })], surface);
        const intervalsBefore = __intervals.length;
        if (isActivated) surface.activate();
        return { ...scene, surface, traces, reasons, intervalsBefore };
    };

    const click = ({ playerId, entity }) => fire("before:playerInteractWithEntity", { player: { id: playerId }, target: entity, cancel: false });
    const startTick = system.currentTick;
    const originalGetEntity = world.getEntity;
    world.getEntity = (id) => (spawned.get(id)?.isValid ? spawned.get(id) : originalGetEntity(id));

    console.log("\n  opening by click\n");
    try {
        // In the head: spawned there, never seated, refused to anyone but the viewer.
        {
            freshRuntime();
            const { surface, entity, viewer, spawnedAt, intervalsBefore } = openClickMenu({ name: "head", isActivated: false });
            check("a click-opened menu spawns in the viewer's head", spawnedAt[0]?.y === 65.62, JSON.stringify(spawnedAt));
            check("its entity carries this pack's mark", entity.getDynamicProperty(SURFACE_VIEWER_PROPERTY) === viewer.id);
            check("and no click box: the head needs none", !entity.events.includes(SURFACE_CLICK_BOX_EVENT), entity.events.join(","));
            // A click on a rideable entity seats the player instead of opening it.
            check("its seat is taken away", entity.events.includes(SURFACE_NO_SEAT_EVENT), entity.events.join(","));
            check("the viewer's click before the menu is ready is refused", click({ playerId: viewer.id, entity }).cancel === true);
            check("it goes live without seating the viewer", surface.activate() === true && entity.seatings === 0, `seatings=${entity.seatings}`);
            check("and starts its scan and watchdog", __intervals.length > intervalsBefore);
            check("then the viewer's click is left to the engine", click({ playerId: viewer.id, entity }).cancel === false);
            check("another player's click is refused", click({ playerId: "player-other", entity }).cancel === true);
            surface.close();
            check("a closed menu refuses its viewer too", click({ playerId: viewer.id, entity }).cancel === true);
        }

        // The entity keeps to the viewer's head until the click, so standing up from a sneak still lands.
        {
            freshRuntime();
            const { surface, entity, viewer, intervalsBefore } = openClickMenu({ name: "follow" });
            viewer.head = { x: 0, y: 65.92, z: 0 };
            runIntervalsFrom(intervalsBefore);
            check("the waiting entity follows the viewer's head", entity.teleports.at(-1)?.y === 65.92, JSON.stringify(entity.teleports));
            fire("after:entityContainerOpened", { entity, openSource: { entity: viewer } });
            const teleports = entity.teleports.length;
            viewer.head = { x: 1, y: 65.62, z: 0 };
            runIntervalsFrom(intervalsBefore);
            check("once the screen is open it stays put", entity.teleports.length === teleports, JSON.stringify(entity.teleports));
            surface.close();
        }

        // A point: a block-sized box there, checked against the view distance.
        {
            freshRuntime();
            const { entity, spawnedAt, surface, intervalsBefore } = openClickMenu({ name: "point", options: { clickAt: { x: 2, y: 64, z: 1 } } });
            check("a click point spawns the entity there", JSON.stringify(spawnedAt[0]) === JSON.stringify({ x: 2, y: 64, z: 1 }), JSON.stringify(spawnedAt));
            check("with the click box", entity.events.includes(SURFACE_CLICK_BOX_EVENT), entity.events.join(","));
            check("and no seat", entity.events.includes(SURFACE_NO_SEAT_EVENT), entity.events.join(","));
            const teleports = entity.teleports.length;
            runIntervalsFrom(intervalsBefore);
            check("and it does not follow the viewer", entity.teleports.length === teleports);
            surface.close();

            const { viewer } = clickWorld("refused");
            const refuses = (options) => {
                try {
                    new BedrockSurface(viewer, { size: 27, ...options });
                    return false;
                } catch (error) {
                    return error instanceof RangeError;
                }
            };
            check("click options without openBy: click throw", refuses({ clickAt: "head" }) && refuses({ clickWaitTicks: 20 }));
            check("a wait that is not a positive whole number throws", refuses({ openBy: "click", clickWaitTicks: 0 }) && refuses({ openBy: "click", clickWaitTicks: 2.5 }));
            check("a point beyond maxViewDistance throws", refuses({ openBy: "click", clickAt: { x: 20, y: 64, z: 0 } }));
        }

        // The wait: its own length, and the "timeout" reason.
        {
            freshRuntime();
            system.currentTick = startTick;
            const { surface, traces, reasons, intervalsBefore, entity } = openClickMenu({ name: "wait", options: { clickWaitTicks: 40 } });
            system.currentTick = startTick + 39;
            runIntervalsFrom(intervalsBefore);
            check("it waits clickWaitTicks for the click", !surface.isClosed);
            system.currentTick = startTick + 40;
            runIntervalsFrom(intervalsBefore);
            check("a click that never comes closes it as a timeout", surface.isClosed && !entity.isValid && reasons[0] === "timeout", reasons.join(","));
            check("with a trace", traces.includes("click-open-timeout ticks=40"), traces.join(","));

            freshRuntime();
            system.currentTick = startTick;
            const opened = openClickMenu({ name: "opened" });
            fire("after:entityContainerOpened", { entity: opened.entity, openSource: { entity: opened.viewer } });
            system.currentTick = startTick + CLICK_OPEN_WAIT_TICKS * 2;
            runIntervalsFrom(opened.intervalsBefore);
            check("once opened it no longer times out", !opened.surface.isClosed);
            fire("after:entityContainerClosed", { entity: opened.entity, closeSource: { entity: opened.viewer } });
            check("and closes with the screen", opened.surface.isClosed && opened.reasons[0] === "player", opened.reasons.join(","));
        }

        // Another dimension is out of reach whatever the coordinates say.
        {
            freshRuntime();
            system.currentTick = startTick;
            const { surface, viewer, reasons, intervalsBefore } = openClickMenu({ name: "portal" });
            viewer.dimension = { id: "nether" };
            runIntervalsFrom(intervalsBefore);
            check("a viewer in another dimension closes the menu", surface.isClosed && reasons[0] === "distance", reasons.join(","));
        }

        // The mirror slots are recorded on the entity, for a restart to know them.
        {
            freshRuntime();
            const { surface, entity } = openClickMenu({ name: "mirrors" });
            surface.setPlayerWritableSlots(new Set([1, 2, 3]), new Set([2, 3]));
            check("the entity records its mirror slots", entity.getDynamicProperty(SURFACE_MIRRORED_PROPERTY) === "2,3", String(entity.getDynamicProperty(SURFACE_MIRRORED_PROPERTY)));
            surface.close();
        }
    } finally {
        system.currentTick = startTick;
        world.getEntity = originalGetEntity;
    }

    console.log("\n  orphaned menu entities\n");
    {
        freshRuntime();
        const { removeIfOrphaned } = await load("platform/surface/surfaceOrphans.js");
        const { entity, viewer, menu, pocket, properties } = clickWorld("orphan");
        // Left by a crash: a player's own item in an input, a mirror copy and a button copy.
        properties.set(SURFACE_VIEWER_PROPERTY, viewer.id);
        properties.set(SURFACE_MIRRORED_PROPERTY, "1");
        menu.slots[0] = new ItemStack("minecraft:gold_ingot", 3);
        menu.slots[1] = new ItemStack("minecraft:diamond", 2);
        menu.slots[2] = toItemStack({ typeId: "minecraft:emerald", name: "Buy" });
        const getEntity = world.getEntity;
        world.getEntity = (id) => (id === entity.id ? entity : id === viewer.id ? viewer : undefined);
        try {
            check("a click on this pack's orphaned menu entity is refused", click({ playerId: "player-passer", entity }).cancel === true);
            check("and the entity is removed", !entity.isValid);
            const handed = pocket.slots.filter(Boolean).map((stack) => `${stack.typeId}x${stack.amount}${isRenderedItem(stack) ? "*" : ""}`);
            check("the player's own item goes back to them, the mirror copy and the button copy do not", JSON.stringify(handed) === JSON.stringify(["minecraft:gold_ingotx3"]), JSON.stringify(handed));
            check("and nothing is left in it to drop", menu.slots.every((slot) => slot === undefined));

            const foreign = clickWorld("foreign");
            check("another pack's menu entity is left to that pack", click({ playerId: "player-passer", entity: foreign.entity }).cancel === false && removeIfOrphaned(foreign.entity) === false && foreign.entity.isValid);
        } finally {
            world.getEntity = getEntity;
        }
    }
};
