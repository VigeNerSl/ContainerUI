/** Fixtures shared by the core suite's sections. */

/** Creates `freshRuntime`: a new runtime per scenario, with a manual clock and the errors it reported. */
export const freshRuntimeOf = ({ resetRuntime, createManualSchedulerHost, configureRuntime }) => (options = {}) => {
    resetRuntime();
    const clock = createManualSchedulerHost();
    const errors = [];
    const scheduler = configureRuntime(clock, { onError: (error) => errors.push(error.message), ...options });
    return { clock, scheduler, errors };
};

/** A storage entity whose container, like the engine's, hands out a copy on every read. */
export const storageEntity = (ItemStack, size) => {
    const slots = new Array(size).fill(undefined);
    // `typeId` and the rest throw on an empty slot, as the @minecraft/server API documents.
    const present = (index) => {
        if (!slots[index]) throw new Error("InvalidContainerSlotError");
        return slots[index];
    };
    const container = {
        size,
        isValid: true,
        getItem: (index) => slots[index]?.clone(),
        setItem: (index, stack) => {
            slots[index] = stack?.clone();
        },
        getSlot: (index) => ({
            get isValid() {
                return container.isValid;
            },
            hasItem: () => Boolean(slots[index]),
            get typeId() {
                return present(index).typeId;
            },
            get amount() {
                return present(index).amount;
            },
            get nameTag() {
                return present(index).nameTag;
            },
        }),
    };
    return {
        id: "storage-entity-1",
        isValid: true,
        slots,
        getComponent: (id) => (id === "minecraft:inventory" ? { container } : undefined),
        getDynamicProperty: () => undefined,
    };
};

/** A promise with its `resolve` and `reject` handed out. */
export const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};

/** Lets settled loads reach their components, then commits. */
export const settleLoads = async (clock) => {
    await Promise.resolve();
    await Promise.resolve();
    clock.runPending();
};

/** Whether a diagnostic is a render error mentioning `fragment`. */
export const isRenderError = (diagnostic, fragment) => diagnostic.kind === "render-error" && diagnostic.message.includes(fragment);

/** A container like the engine's: copies on read, and live slot handles that count their fetches. */
export const makeContainer = (size) => {
    const slots = new Array(size).fill(undefined);
    // `typeId` and the rest throw on an empty slot, as the @minecraft/server API documents.
    const present = (index) => {
        const stack = slots[index];
        if (!stack) throw new Error("InvalidContainerSlotError");
        return stack;
    };
    const container = {
        slots,
        size,
        isValid: true,
        /** Slot handles fetched, to show they are kept across passes. */
        getSlotCalls: 0,
        getItem: (index) => slots[index]?.clone(),
        setItem: (index, stack) => {
            slots[index] = stack?.clone();
        },
        addItem: (stack) => {
            const free = slots.findIndex((slot) => !slot);
            if (free === -1) return stack;
            slots[free] = stack.clone();
            return undefined;
        },
        clearAll: () => slots.fill(undefined),
        getSlot: (index) => {
            container.getSlotCalls++;
            return {
                get isValid() {
                    return container.isValid;
                },
                hasItem: () => slots[index] !== undefined,
                get typeId() {
                    return present(index).typeId;
                },
                get amount() {
                    return present(index).amount;
                },
                get nameTag() {
                    return present(index).nameTag;
                },
            };
        },
    };
    return container;
};
