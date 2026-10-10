/** A row of buttons that picks a quantity. */

import type { ItemView } from "../host/host.js";
import { h, type Child } from "../runtime/element.js";

/** One step button, as {@link QuantityPickerProps.stepItem} draws it. */
export interface QuantityStep {
    /** How much the button adds; negative for minus buttons. */
    delta: number;
    /** Whether pressing it would change the quantity. A disabled step does nothing. */
    isEnabled: boolean;
}

/** Props of {@link QuantityPicker}. */
export interface QuantityPickerProps {
    /** Surface index of the leftmost step. Defaults to layout flow. */
    index?: number;
    /** The quantity shown. */
    value: number;
    /** Called with the new quantity. */
    onChange: (value: number) => void;
    /** Smallest quantity. Defaults to 1. */
    min?: number;
    /** Largest quantity. Defaults to 64. */
    max?: number;
    /** Step sizes, each a minus button on the left and a plus button on the right. Defaults to `[1, 10]`. */
    steps?: readonly number[];
    /** The middle cell. Give it `amount: value` to show the quantity as the stack size. */
    item: (value: number) => ItemView;
    /** How many of the item fit in one stack (`maxStackOf` on Bedrock). Below `max`, the middle cell is `counter`. */
    stackLimit?: number;
    /** The middle cell when `stackLimit` is below `max`. Defaults to a gold nugget with the item's name and lore. */
    counter?: (value: number) => ItemView;
    /** Makes the middle cell a button that receives the quantity. */
    onPick?: (value: number) => void;
    /** Draws a step button. Defaults to lime and red dye, grey dye when disabled, labelled `+10`, `−1`. */
    stepItem?: (step: QuantityStep) => ItemView;
    /** Played by every step and by the pick. */
    sound?: string;
}

const DEFAULT_STEPS: readonly number[] = [1, 10];
const COUNTER_TYPE_ID = "minecraft:gold_nugget";
/** The largest stack an icon shows. */
const COUNTER_STACK = 64;

const defaultStepItem = ({ delta, isEnabled }: QuantityStep): ItemView => {
    const label = `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
    if (!isEnabled) return { typeId: "minecraft:gray_dye", name: `§7${label}` };
    return { typeId: delta > 0 ? "minecraft:lime_dye" : "minecraft:red_dye", name: `${delta > 0 ? "§a" : "§c"}${label}` };
};

/** The default middle cell for items whose stack cannot show the quantity: a nugget with the item's name and lore. */
const defaultCounter = (item: ItemView, quantity: number): ItemView => {
    return {
        typeId: COUNTER_TYPE_ID,
        amount: Math.min(quantity, COUNTER_STACK),
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.lore !== undefined ? { lore: item.lore } : {}),
    };
};

/**
 * `−10 −1 [item] +1 +10`. A step that would overshoot stops at the bound; one that would change
 * nothing is grey and inert. An item whose stack is below `max` shows as a counter for every
 * quantity.
 *
 * @example
 * const [count, setCount] = useState(1);
 * h(QuantityPicker, {
 *     index: 20,
 *     value: count,
 *     onChange: setCount,
 *     item: (value) => ({ typeId: "minecraft:diamond", amount: value, name: `§bBuy ${value}` }),
 *     onPick: (value) => buy(value),
 * });
 */
export const QuantityPicker = (props: QuantityPickerProps): Child => {
    const min = Number.isFinite(props.min) ? (props.min as number) : 1;
    const max = Math.max(min, Number.isFinite(props.max) ? (props.max as number) : 64);
    const clamp = (value: number): number => Math.min(max, Math.max(min, Math.floor(value)));
    // A NaN value would make every step look live and hand NaN to onChange.
    const value = Number.isNaN(props.value) ? min : clamp(props.value);
    const steps = [...new Set(props.steps ?? DEFAULT_STEPS)].filter((size) => size > 0).sort((first, second) => first - second);
    const soundProps = props.sound !== undefined ? { sound: props.sound } : {};
    const stepItem = props.stepItem ?? defaultStepItem;

    const step = (delta: number): Child => {
        const target = clamp(value + delta);
        const isEnabled = target !== value;
        const item = stepItem({ delta, isEnabled });
        if (!isEnabled) return h("slot", { key: `step:${delta}`, item });
        return h("slot", { key: `step:${delta}`, item, onClick: () => props.onChange(target), ...soundProps });
    };

    const isCounted = props.stackLimit !== undefined && props.stackLimit < max;
    const middleItem = !isCounted ? props.item(value) : props.counter ? props.counter(value) : defaultCounter(props.item(value), value);

    const middle = h("slot", {
        key: "value",
        item: middleItem,
        ...(props.onPick ? { onClick: () => props.onPick?.(value), ...soundProps } : {}),
    });

    return h("row", props.index !== undefined ? { index: props.index } : null, [
        ...[...steps].reverse().map((size) => step(-size)),
        middle,
        ...steps.map((size) => step(size)),
    ]);
};
