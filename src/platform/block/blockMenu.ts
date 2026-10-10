/** Opening a block container's menu: waiting for its storage, rendering it, watching it, settling it on close. */

import { system, type Dimension, type Player, type Vector3 } from "@minecraft/server";
import { h, StorageSlots, type Child, type InputEvent } from "../../core/index.js";
import { STORAGE_LOAD_RETRY_ATTEMPTS, STORAGE_LOAD_RETRY_TICKS } from "../constants.js";
import { openContainer, type ContainerSession } from "../surface/openContainer.js";
import { interactionKindOf } from "../scan/slotMatching.js";
import type { BlockContainerOptions, BlockContainerRenderContext } from "./blockContainer.js";
import { describeItem, type BlockContainerEvent } from "./blockEvents.js";
import { claimBlockStorageEntity } from "./blockRegistry.js";
import { closeSessions, registerSession, unregisterSession } from "./blockSessions.js";
import { BlockStorage } from "./blockStorage.js";
import { recordBlockType } from "./storageRemoval.js";

/** A registered component, as every step of placing, opening and breaking its block sees it. */
export interface RegisteredContainer {
    readonly componentName: string;
    readonly options: BlockContainerOptions;
    readonly openMode: "native" | "menu";
    readonly dropOnBreak: boolean;
    /** `null` when the outside-change watch is off. */
    readonly watchIntervalTicks: number | null;
    /** The name the storage entity gets when it spawns, before anyone opens it. */
    readonly staticTitle: string;
    readonly emit: (event: BlockContainerEvent) => void;
}

/** One player opening one block's menu. */
export interface MenuRequest {
    readonly container: RegisteredContainer;
    readonly player: Player;
    readonly blockKey: string;
}

/** The block menu each player has open. */
const menuByPlayerId = new Map<string, { entityId: string; session: ContainerSession }>();

/** One mirrored edit as `key=value` text, for the log. */
const describeEdit = (event: InputEvent): string => {
    const action = interactionKindOf(event.previous, event.next);
    return `slot=${event.index} action=${action} from=${describeItem(event.previous)} to=${describeItem(event.next)}`;
};

/** The menu tree: the component's `render`, or a mirror of the whole storage that logs each edit. */
const menuTreeOf = ({ request, storage, context }: { request: MenuRequest; storage: BlockStorage; context: BlockContainerRenderContext }): (() => Child) => {
    const { container, player, blockKey } = request;
    const { componentName, emit } = container;
    const render = container.options.render;
    if (render) return () => render(context);
    return () =>
        h(StorageSlots, {
            storage,
            onEdit: (vigenersl: InputEvent) => {
                emit({ kind: "edit", component: componentName, blockKey, player: player.name, detail: describeEdit(vigenersl) });
            },
            onConflict: (vigenersl: InputEvent) => {
                emit({ kind: "conflict", component: componentName, blockKey, player: player.name, detail: `slot=${vigenersl.index}` });
            },
        });
};

/**
 * Starts the outside-change watch for an open menu, closing every menu over the storage if its entity goes.
 *
 * @returns Whether a watch was started, and so has to be stopped on close.
 */
const watchWhileOpen = (request: MenuRequest, storage: BlockStorage): boolean => {
    const { componentName, watchIntervalTicks, emit } = request.container;
    const { blockKey } = request;
    if (watchIntervalTicks === null || watchIntervalTicks <= 0) return false;
    storage.startWatching(watchIntervalTicks);
    // Holds no player: the storage outlives every viewer, and the handler is kept until the entity goes.
    storage.onInvalidated(() => {
        emit({ kind: "storage-invalidated", component: componentName, blockKey });
        closeSessions(storage.entityId);
    });
    return true;
};

/** Forgets a closed menu, stops its watch and logs the storage as it was left. */
const settleClosedMenu = ({
    request,
    storage,
    session,
    isWatched,
}: {
    request: MenuRequest;
    storage: BlockStorage;
    session: ContainerSession;
    isWatched: boolean;
}): void => {
    const { container, player, blockKey } = request;
    const { componentName, emit } = container;
    unregisterSession(storage.entityId, session);
    if (menuByPlayerId.get(player.id)?.session === session) menuByPlayerId.delete(player.id);
    if (isWatched) storage.stopWatching();
    const stats = storage.watchStats;
    emit({ kind: "inventory", component: componentName, blockKey, detail: `at=close entityId=${storage.entityId} items=${storage.inventorySummary()}` });
    emit({ kind: "closed", component: componentName, blockKey, player: player.name, detail: `watchPasses=${stats.passes} watchMs=${stats.totalMs}` });
};

export const openBlockContainer = (request: MenuRequest, storage: BlockStorage): void => {
    const { container, player, blockKey } = request;
    const { componentName, options, emit } = container;
    const entity = storage.entity;
    if (!entity) {
        emit({ kind: "error", component: componentName, blockKey, detail: "storage entity invalid at open" });
        return;
    }
    if (menuByPlayerId.get(player.id)?.entityId === storage.entityId) {
        emit({ kind: "interact", component: componentName, blockKey, player: player.name, detail: "menu: already open, kept" });
        return;
    }

    let session: ContainerSession | null = null;
    const context: BlockContainerRenderContext = { storage, player, entity, close: () => session?.close() };
    const title = typeof options.title === "function" ? options.title(context) : (options.title ?? "Container");

    const opened = openContainer(player, menuTreeOf({ request, storage, context }), {
        size: options.size,
        title,
        hintMessage: options.hintMessage,
        scanIntervalTicks: options.scanIntervalTicks,
        onDiagnostic: options.onDiagnostic,
        onTrace: options.onTrace,
    });
    session = opened;

    const viewers = registerSession(storage.entityId, opened);
    menuByPlayerId.set(player.id, { entityId: storage.entityId, session: opened });
    const isWatched = watchWhileOpen(request, storage);

    emit({ kind: "opened", component: componentName, blockKey, player: player.name, detail: `entityId=${storage.entityId} viewers=${viewers} size=${storage.size}` });
    emit({ kind: "inventory", component: componentName, blockKey, detail: `at=open entityId=${storage.entityId} items=${storage.inventorySummary()}` });

    void opened.closed.then(() => settleClosedMenu({ request, storage, session: opened, isWatched }));
};

/** Opens the menu once the storage entity has loaded, retrying for a while. Never spawns a replacement. */
export const openWhenStorageLoads = ({
    request,
    dimension,
    location,
    blockTypeId,
    attemptsLeft,
}: {
    request: MenuRequest;
    dimension: Dimension;
    location: Vector3;
    blockTypeId: string;
    attemptsLeft: number;
}): void => {
    const { container, player, blockKey } = request;
    const { componentName, emit } = container;

    const entity = claimBlockStorageEntity(dimension, location);
    if (entity) {
        recordBlockType(entity, blockTypeId);
        openBlockContainer(request, BlockStorage.forEntity(entity));
        return;
    }

    if (attemptsLeft <= 0) {
        emit({
            kind: "storage-missing",
            component: componentName,
            blockKey,
            player: player.name,
            detail: `gave up after ${STORAGE_LOAD_RETRY_ATTEMPTS} retries — break and re-place the block`,
        });
        return;
    }

    emit({ kind: "storage-wait", component: componentName, blockKey, player: player.name, detail: `retriesLeft=${attemptsLeft}` });
    system.runTimeout(() => {
        if (!player.isValid) return;
        openWhenStorageLoads({ request, dimension, location, blockTypeId, attemptsLeft: attemptsLeft - 1 });
    }, STORAGE_LOAD_RETRY_TICKS);
};
