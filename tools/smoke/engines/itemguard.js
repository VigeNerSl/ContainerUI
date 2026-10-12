/** A stub `@minecraft/server` for the anti-dupe suite: stacks with the engine's limits, and emitting events. */

/** Types treated as stackable, which silently drop dynamic properties. */
const STACKABLE = new Set(["minecraft:golden_apple", "minecraft:glass_pane", "minecraft:barrier"]);

/** Types that carry `minecraft:enchantable` and `minecraft:durability`. */
const ENCHANTABLE = new Set(["minecraft:diamond_sword"]);
const MAX_DURABILITY = { "minecraft:diamond_sword": 1561 };
/** Enchantments a type refuses, as the engine's EnchantmentTypeNotCompatibleError. */
const INCOMPATIBLE = { "minecraft:diamond_sword": new Set(["protection"]) };

/** The engine's lore limits: lines per stack, characters per line. */
const MAX_LORE_LINES = 20;
const MAX_LORE_LINE_LENGTH = 50;
/** The engine accepts 1 to 255 for `amount` and clamps it to the item's maximum stack size. */
const MAX_AMOUNT = 255;
const MAX_STACK = { "minecraft:diamond_sword": 1, "minecraft:ender_pearl": 16, "minecraft:bundle": 1 };
/** Types that store items through `minecraft:inventory`, as a bundle does, with this many slots. */
const STORAGE_SLOTS = { "minecraft:bundle": 4 };
const maxStackOf = (typeId) => MAX_STACK[typeId] ?? 64;

export class ItemStack {
    constructor(typeId, amount = 1) {
        this.typeId = typeId;
        this._amount = 1;
        this.amount = amount;
        this.nameTag = undefined;
        this._lore = [];
        this._props = new Map();
        this._enchantments = [];
        this._damage = 0;
        this._contents = STORAGE_SLOTS[typeId] ? Array.from({ length: STORAGE_SLOTS[typeId] }, () => null) : undefined;
    }
    get amount() { return this._amount; }
    set amount(value) {
        if (!(value >= 1 && value <= MAX_AMOUNT)) throw new Error(`ArgumentOutOfBoundsError: amount ${value} is outside 1-${MAX_AMOUNT}`);
        this._amount = Math.min(value, maxStackOf(this.typeId));
    }
    get maxAmount() { return maxStackOf(this.typeId); }
    getLore() { return [...this._lore]; }
    setLore(lore) {
        const lines = lore ? [...lore] : [];
        if (lines.length > MAX_LORE_LINES) throw new Error(`ArgumentOutOfBoundsError: lore has ${lines.length} lines, the maximum is ${MAX_LORE_LINES}`);
        const long = lines.find((line) => line.length > MAX_LORE_LINE_LENGTH);
        if (long !== undefined) throw new Error(`ArgumentOutOfBoundsError: a lore line has ${long.length} characters, the maximum is ${MAX_LORE_LINE_LENGTH}`);
        this._lore = lines;
    }
    getDynamicProperty(id) { return this._props.get(id); }
    setDynamicProperty(id, value) {
        // A stackable item accepts the write and keeps nothing, as measured in a world.
        if (STACKABLE.has(this.typeId)) return;
        if (value === undefined) this._props.delete(id);
        else this._props.set(id, value);
    }
    getDynamicPropertyIds() { return [...this._props.keys()]; }
    clearDynamicProperties() { this._props.clear(); }
    clone() {
        const copy = new ItemStack(this.typeId, this.amount);
        copy.nameTag = this.nameTag;
        copy._lore = [...this._lore];
        copy._props = new Map(this._props);
        copy._enchantments = this._enchantments.map((entry) => ({ ...entry }));
        copy._damage = this._damage;
        copy._contents = this._contents?.map((stored) => stored?.clone() ?? null);
        return copy;
    }
    getComponent(id) {
        const stack = this;
        if (id === "minecraft:inventory" && this._contents) {
            // As the engine's: a read hands out a copy, so a change sticks only once it is set.
            return {
                container: {
                    size: stack._contents.length,
                    get emptySlotsCount() { return stack._contents.filter((stored) => !stored).length; },
                    // The engine weighs by item kind; the stub counts items, which moves the same way.
                    get weight() { return stack._contents.reduce((sum, stored) => sum + (stored?.amount ?? 0), 0); },
                    getItem: (index) => stack._contents[index]?.clone(),
                    setItem: (index, stored) => { stack._contents[index] = stored ?? null; },
                },
            };
        }
        if (id === "minecraft:enchantable" && ENCHANTABLE.has(this.typeId)) {
            return {
                getEnchantments: () => stack._enchantments.map((entry) => ({ ...entry })),
                addEnchantment: (enchantment) => {
                    if (INCOMPATIBLE[stack.typeId]?.has(enchantment.type.id)) throw new Error("EnchantmentTypeNotCompatibleError");
                    stack._enchantments.push({ type: enchantment.type, level: enchantment.level });
                },
            };
        }
        if (id === "minecraft:durability" && MAX_DURABILITY[this.typeId]) {
            return {
                maxDurability: MAX_DURABILITY[this.typeId],
                get damage() { return stack._damage; },
                set damage(value) { stack._damage = value; },
            };
        }
        return undefined;
    }
}

const KNOWN_ENCHANTMENTS = new Set(["sharpness", "unbreaking", "protection"]);
/**
 * Blocks the stub resolves, with the states they accept. A bed is deliberately absent: the engine
 * refuses `minecraft:bed` with a colour, since a bed's colour is entity data, not a state.
 */
const BLOCK_STATES = { "minecraft:dropper": ["facing_direction"], "minecraft:brown_mushroom_block": ["huge_mushroom_bits"] };

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

export const EnchantmentTypes = {
    get: (id) => (KNOWN_ENCHANTMENTS.has(id) ? { id, maxLevel: 5 } : undefined),
};

/** An event signal a test fires with `emit`. */
const signal = () => {
    const handlers = [];
    return {
        handlers,
        subscribe(callback) { handlers.push(callback); return callback; },
        unsubscribe(callback) {
            const position = handlers.indexOf(callback);
            if (position !== -1) handlers.splice(position, 1);
        },
        emit(event) { for (const handler of [...handlers]) handler(event); },
    };
};

export const world = {
    afterEvents: {
        entityItemDrop: signal(),
        entitySpawn: signal(),
        entityContainerClosed: signal(),
        entityLoad: signal(),
        playerLeave: signal(),
        entityHitEntity: signal(),
        entityHitBlock: signal(),
        playerSpawn: signal(),
        blockContainerOpened: signal(),
        blockContainerClosed: signal(),
        entityContainerOpened: signal(),
    },
    beforeEvents: {
        itemUse: signal(),
        playerInteractWithBlock: signal(),
        playerInteractWithEntity: signal(),
    },
    getEntity: () => undefined,
};

export const system = {
    currentTick: 0,
    run: (callback) => (callback(), 0),
    runTimeout: () => 0,
    runInterval: () => 0,
    clearRun: () => undefined,
};

export const EquipmentSlot = {
    Body: "Body",
    Chest: "Chest",
    Feet: "Feet",
    Head: "Head",
    Legs: "Legs",
    Mainhand: "Mainhand",
    Offhand: "Offhand",
};
