/** A stub `@minecraft/server` for the core suite: stacks, events fired by hand, and kept timers. */

/** Types that store items through `minecraft:inventory`, as a bundle does, with this many slots. */
const STORAGE_SLOTS = { "minecraft:bundle": 4 };

/** Whether a type stacks no higher than one, as tools, bundles and shulker boxes do. */
const isSingle = (typeId) => typeId === "minecraft:bundle" || typeId.endsWith("_sword") || typeId.endsWith("shulker_box");

export class ItemStack {
    constructor(typeId, amount = 1) {
        this.typeId = typeId;
        this.amount = amount;
        this.nameTag = undefined;
        this.keepOnDeath = false;
        this.lockMode = "none";
        this._canPlaceOn = [];
        this._canDestroy = [];
        this._lore = [];
        this._props = new Map();
        this._contents = STORAGE_SLOTS[typeId] ? Array.from({ length: STORAGE_SLOTS[typeId] }, () => null) : undefined;
    }
    getLore() { return [...this._lore]; }
    getCanPlaceOn() { return [...this._canPlaceOn]; }
    setCanPlaceOn(blocks) { this._canPlaceOn = blocks ? [...blocks] : []; }
    getCanDestroy() { return [...this._canDestroy]; }
    setCanDestroy(blocks) { this._canDestroy = blocks ? [...blocks] : []; }
    setLore(lore) { this._lore = lore ? [...lore] : []; }
    getDynamicProperty(id) { return this._props.get(id); }
    setDynamicProperty(id, value) {
        if (value === undefined) this._props.delete(id);
        else this._props.set(id, value);
    }
    getDynamicPropertyIds() { return [...this._props.keys()]; }
    get isStackable() { return !isSingle(this.typeId); }
    get maxAmount() { return isSingle(this.typeId) ? 1 : 64; }
    /** As the engine's: the same item and data, whatever the amount; never for a non-stackable item. */
    isStackableWith(other) {
        if (!this.isStackable || !other.isStackable) return false;
        const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
        return other.typeId === this.typeId && other.nameTag === this.nameTag && same(other._lore, this._lore) && same([...other._props], [...this._props]) && same(other.shulkerContents?.map((stored) => stored && [stored.typeId, stored.amount]), this.shulkerContents?.map((stored) => stored && [stored.typeId, stored.amount]));
    }
    clone() {
        const copy = new ItemStack(this.typeId, this.amount);
        copy.nameTag = this.nameTag;
        copy.keepOnDeath = this.keepOnDeath;
        copy.lockMode = this.lockMode;
        copy._canPlaceOn = [...this._canPlaceOn];
        copy._canDestroy = [...this._canDestroy];
        copy._lore = [...this._lore];
        copy._props = new Map(this._props);
        copy.enchantment = this.enchantment;
        copy._contents = this._contents?.map((stored) => stored?.clone() ?? null);
        // A shulker box item carries its contents as item data no component reads; a block made from it gets them.
        copy.shulkerContents = this.shulkerContents?.map((stored) => stored?.clone() ?? null);
        return copy;
    }
    getComponent(id) {
        if (id !== "minecraft:inventory" || !this._contents) return undefined;
        const contents = this._contents;
        // As the engine's: a read hands out a copy, so a change sticks only once it is set.
        return {
            container: {
                size: contents.length,
                get emptySlotsCount() { return contents.filter((stored) => !stored).length; },
                // The engine weighs by item kind; the stub counts items, which moves the same way.
                get weight() { return contents.reduce((sum, stored) => sum + (stored?.amount ?? 0), 0); },
                getItem: (index) => contents[index]?.clone(),
                setItem: (index, stored) => { contents[index] = stored ?? null; },
            },
        };
    }
}

/** Potion effects the stub knows, namespaced as the engine registers them. */
const POTION_EFFECTS = new Set(["minecraft:fire_resistance", "minecraft:healing", "minecraft:strong_healing"]);

/** The item each delivery builds, as the engine's deliveries do. */
const POTION_ITEM_BY_DELIVERY = {
    Consume: "minecraft:potion",
    ThrownSplash: "minecraft:splash_potion",
    ThrownLingering: "minecraft:lingering_potion",
};

/** Builds potions the way the engine does: from an effect and a delivery, never from a data value. */
export const Potions = {
    getAllEffectTypes: () => [...POTION_EFFECTS].map((id) => ({ id })),
    getAllDeliveryTypes: () => Object.keys(POTION_ITEM_BY_DELIVERY).map((id) => ({ id })),
    getEffectType: (id) => (POTION_EFFECTS.has(id) ? { id } : undefined),
    getDeliveryType: (id) => ({ id }),
    resolve: (effect, delivery) => {
        const effectId = typeof effect === "string" ? effect : effect.id;
        const deliveryId = typeof delivery === "string" ? delivery : delivery.id;
        if (!POTION_EFFECTS.has(effectId)) throw new Error(`InvalidPotionEffectTypeError: ${effectId}`);
        const itemId = POTION_ITEM_BY_DELIVERY[deliveryId];
        if (!itemId) throw new Error(`InvalidPotionDeliveryTypeError: ${deliveryId}`);
        const stack = new ItemStack(itemId);
        stack.potion = { effectId, deliveryId };
        return stack;
    },
};

/** Subscribers by `after:<event>` and `before:<event>`. Every event exists; none fires by itself. */
export const __subscribers = new Map();
const events = (kind) =>
    new Proxy({}, {
        get: (target, name) => ({
            // The game refuses a second argument, even undefined, on signals without options.
            subscribe: (...args) => {
                if (args.length !== 1) throw new TypeError(`Incorrect number of arguments to function. Expected 1, received ${args.length}`);
                const [callback] = args;
                const key = kind + ":" + String(name);
                __subscribers.set(key, [...(__subscribers.get(key) ?? []), callback]);
                return callback;
            },
            unsubscribe: (callback) => {
                const key = kind + ":" + String(name);
                __subscribers.set(key, (__subscribers.get(key) ?? []).filter((known) => known !== callback));
            },
        }),
    });

/** Loot tables the stub knows, and what each roll produces. A table's rolls are counted. */
export const __lootRolls = new Map();
const LOOT_TABLES = {
    "stub/fire_arrow": () => {
        const stack = new ItemStack("minecraft:arrow", 3);
        stack.localizationKey = "tipped_arrow.effect.fireResistance";
        return [stack];
    },
    "stub/empty": () => [],
};

/** World dynamic properties, kept as the engine keeps them: by identifier. */
const worldProperties = new Map();

export const world = {
    getDynamicProperty: (identifier) => worldProperties.get(identifier),
    setDynamicProperty: (identifier, value) => {
        if (value === undefined) worldProperties.delete(identifier);
        else worldProperties.set(identifier, value);
    },
    afterEvents: events("after"),
    beforeEvents: events("before"),
    getEntity: () => undefined,
    getAllPlayers: () => [],
    getDimension: () => {
        throw new Error("no dimensions in the stub");
    },
    getLootTableManager: () => ({
        getLootTable: (path) => (LOOT_TABLES[path] ? { path } : undefined),
        generateLootFromTable: (table) => {
            __lootRolls.set(table.path, (__lootRolls.get(table.path) ?? 0) + 1);
            return LOOT_TABLES[table.path]();
        },
    }),
};

/** How an item may move, as the engine names it. */
export const ItemLockMode = { inventory: "inventory", none: "none", slot: "slot" };

/** Input buttons and their states, as the engine names them. */
export const InputButton = { Jump: "Jump", Sneak: "Sneak" };
export const ButtonState = { Pressed: "Pressed", Released: "Released" };

export const EquipmentSlot = { Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Offhand: "Offhand", Mainhand: "Mainhand", Body: "Body" };

export const EnchantmentTypes = { get: (id) => ({ id, maxLevel: 5 }) };

/**
 * Blocks the stub resolves, with the states they accept. A bed is deliberately absent: the engine
 * refuses `minecraft:bed` with a colour, since a bed's colour is entity data, not a state.
 */
const BLOCK_STATES = {
    "minecraft:dropper": ["facing_direction"],
    "minecraft:brown_mushroom_block": ["huge_mushroom_bits"],
    "minecraft:air": [],
    "minecraft:dispenser": ["facing_direction"],
    "minecraft:redstone_block": [],
};

/** Block permutations, and the item form a block item is built from. */
export const BlockPermutation = {
    resolve: (typeId, states = {}) => {
        const known = BLOCK_STATES[typeId];
        if (!known) throw new Error(`Failed to resolve block "${typeId}"`);
        for (const name of Object.keys(states)) {
            if (!known.includes(name)) throw new Error(`InvalidBlockStateError: ${typeId} has no state "${name}"`);
        }
        return {
            type: { id: typeId },
            getAllStates: () => ({ ...states }),
            getItemStack: (amount = 1) => {
                const stack = new ItemStack(typeId, amount);
                stack.blockStates = { ...states };
                return stack;
            },
        };
    },
};

/** Interval callbacks, kept so a test can drive a scan pass by hand. */
export const __intervals = [];

/** Timeouts, kept so a test can fire them by hand. Ids stay 0: only intervals are cleared by id. */
export const __timeouts = [];

/** `deferRuns` queues `system.run` callbacks in `queue` instead of running them at once. */
export const __runs = { deferRuns: false, queue: [] };

export const system = {
    currentTick: 0,
    run: (callback) => {
        if (__runs.deferRuns) __runs.queue.push(callback);
        else callback();
        return 0;
    },
    runTimeout: (callback, delay) => {
        __timeouts.push({ callback, delay });
        return 0;
    },
    waitTicks: () => Promise.resolve(),
    runInterval: (callback) => __intervals.push(callback),
    clearRun: (runId) => {
        if (typeof runId === "number" && runId > 0) __intervals[runId - 1] = () => undefined;
    },
};
