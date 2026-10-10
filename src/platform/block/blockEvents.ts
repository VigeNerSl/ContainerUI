/** Block container records: their shape, where they go, and their `key=value` format. */

import type { Entity } from "@minecraft/server";
import { log } from "../../core/logging/logger.js";
import type { ItemView } from "../../core/index.js";
import { BLOCK_COMPONENT_PROPERTY } from "../constants.js";

/** One lifecycle record of a block container. */
export interface BlockContainerEvent {
    kind:
        | "storage-spawned"
        | "storage-loaded"
        | "storage-missing"
        | "storage-wait"
        | "storage-duplicate"
        | "storage-invalidated"
        | "interact"
        | "opened"
        | "closed"
        | "inventory"
        | "storage-write"
        | "storage-read-failed"
        | "edit"
        | "conflict"
        | "external-change"
        | "hit-entity"
        | "hit-block"
        | "sneak-hide"
        | "sneak-restore"
        | "broken"
        | "dropped"
        | "orphan-removed"
        | "error";
    /** The registered component name. */
    component: string;
    /** `dimension:x:y:z` of the block. */
    blockKey?: string;
    /** The player involved. */
    player?: string;
    /** Details as `key=value` text. */
    detail?: string;
}

/** Receives block container records. */
export type BlockContainerLogger = (event: BlockContainerEvent) => void;

let globalLogger: BlockContainerLogger | null = null;

/** A block record as one line of `key=value` text. */
const formatBlockEvent = ({ kind, component, blockKey, player, detail }: BlockContainerEvent): string => {
    const parts = [`kind=${kind}`, `component=${component}`];
    if (blockKey !== undefined) parts.push(`blockKey=${blockKey}`);
    if (player !== undefined) parts.push(`player=${player}`);
    if (detail !== undefined) parts.push(detail);
    return parts.join(" ");
};

/**
 * Sets a logger for block container records alone, instead of the logger set by `setLogger`.
 *
 * @param logger Receives each record, or `null` to send them to the logger set by `setLogger` again.
 */
export const setBlockContainerLogger = (logger: BlockContainerLogger | null): void => {
    globalLogger = logger;
};

/**
 * Reports a lifecycle record.
 *
 * @param event The record. It goes to the logger set by {@link setBlockContainerLogger}, or without one to the logger set by `setLogger`.
 */
export const emitBlockEvent = (event: BlockContainerEvent): void => {
    if (!globalLogger) {
        log({ level: event.kind === "error" ? "warn" : "info", source: "block", message: formatBlockEvent(event), detail: event });
        return;
    }
    try {
        globalLogger(event);
    } catch {
        // A logger must not break the block.
    }
};

/**
 * The block component a storage entity belongs to.
 *
 * @returns The component name, or `"unknown"` when the entity carries none or cannot be read.
 */
export const componentNameOf = (entity: Entity | null | undefined): string => {
    try {
        const value = entity?.getDynamicProperty(BLOCK_COMPONENT_PROPERTY);
        return typeof value === "string" ? value : "unknown";
    } catch {
        return "unknown";
    }
};

/**
 * An item as it appears in block records: `<typeId>x<amount>` without the `minecraft:` prefix, or `empty`.
 *
 * @internal
 */
export const describeItem = (item: ItemView | null): string => {
    if (!item) return "empty";
    return `${item.typeId.replace("minecraft:", "")}x${item.amount ?? 1}`;
};
