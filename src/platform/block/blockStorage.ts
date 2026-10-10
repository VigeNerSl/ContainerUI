/**
 * A storage entity's inventory as a `SlotStorage`. One instance per entity, so every surface over
 * a block shares one version signal.
 */

import type { Entity } from "@minecraft/server";
import type { ItemView } from "../../core/index.js";
import { BLOCK_KEY_PROPERTY, STORAGE_WATCH_INTERVAL_TICKS } from "../constants.js";
import { componentNameOf, describeItem, emitBlockEvent } from "./blockEvents.js";
import { EntityInventoryStorage } from "../storage/entityInventoryStorage.js";
import { onUninstall } from "../lifecycle.js";

const storageByEntityId = new Map<string, BlockStorage>();

let isEvictHookInstalled = false;

/** Evicts every block storage on uninstall. Registered once per installation. */
const installEvictHook = (): void => {
    if (isEvictHookInstalled) return;
    isEvictHookInstalled = true;
    onUninstall(() => {
        isEvictHookInstalled = false;
        for (const entityId of Array.from(storageByEntityId.keys())) BlockStorage.evict(entityId);
    });
};

/** A block's storage entity as a live `SlotStorage`. */
export class BlockStorage extends EntityInventoryStorage {
    #onInvalidated: (() => void) | null = null;

    private constructor(entity: Entity) {
        super(entity, STORAGE_WATCH_INTERVAL_TICKS);
    }

    /**
     * The shared storage for an entity, created on first use.
     *
     * @param entity The storage entity.
     * @returns The storage every viewer of that entity shares.
     */
    static forEntity(entity: Entity): BlockStorage {
        const existing = storageByEntityId.get(entity.id);
        if (existing) return existing;
        installEvictHook();
        const created = new BlockStorage(entity);
        storageByEntityId.set(entity.id, created);
        return created;
    }

    /** Drops an entity's storage. */
    static evict(entityId: string): void {
        storageByEntityId.get(entityId)?._dispose();
        storageByEntityId.delete(entityId);
    }

    /** The entity, or `null` once it is gone. */
    get entity(): Entity | null {
        return this._entity();
    }

    /** The contents as `slot:<typeId>x<amount>` pairs, or `empty`. */
    inventorySummary(): string {
        const container = this._container();
        if (!container) return "no-container";
        const entries = Array.from({ length: container.size }, (_, slotIndex) => slotIndex).flatMap((slotIndex) => {
            try {
                const stack = container.getItem(slotIndex);
                return stack ? [`${slotIndex}:${stack.typeId.replace("minecraft:", "")}x${stack.amount}`] : [];
            } catch {
                return [`${slotIndex}:unreadable`];
            }
        });
        return entries.length > 0 ? entries.join(",") : "empty";
    }

    /** Called once when a watch pass finds the entity gone. */
    onInvalidated(handler: () => void): void {
        this.#onInvalidated = handler;
    }

    protected override _containerGone(index: number): Error {
        emitBlockEvent({
            kind: "error",
            component: componentNameOf(this.entity),
            detail: `entityId=${this.entityId} write to slot ${index} failed: storage entity is gone`,
        });
        return new Error(`[ContainerUI] Storage entity ${this.entityId} is gone; cannot write slot ${index}.`);
    }

    protected override _onWritten(index: number, item: ItemView | null): void {
        emitBlockEvent({
            ...this.#eventSource(),
            kind: "storage-write",
            detail: `entityId=${this.entityId} slot=${index} item=${describeItem(item)}`,
        });
    }

    protected override _onExternalChange(slotsChanged: number): void {
        emitBlockEvent({
            ...this.#eventSource(),
            kind: "external-change",
            detail: `entityId=${this.entityId} slotsChanged=${slotsChanged}`,
        });
    }

    protected override _onInvalid(): void {
        const handler = this.#onInvalidated;
        this.#onInvalidated = null;
        try {
            handler?.();
        } finally {
            // The entity is gone: nothing may find this storage again by its id.
            BlockStorage.evict(this.entityId);
        }
    }

    protected override _onReadFailure(detail: string): void {
        emitBlockEvent({
            ...this.#eventSource(),
            kind: "storage-read-failed",
            detail: `entityId=${this.entityId} ${detail}`,
        });
    }

    /** The component and block key a record from this storage carries. */
    #eventSource(): { component: string; blockKey?: string } {
        const entity = this.entity;
        const blockKey = entity?.getDynamicProperty(BLOCK_KEY_PROPERTY);
        return { component: componentNameOf(entity), ...(typeof blockKey === "string" ? { blockKey } : {}) };
    }
}
