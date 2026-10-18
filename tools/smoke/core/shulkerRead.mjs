/** The shulker reader: a finished read leaves nothing, a read cut short is recovered, and only shulker boxes are read. */

export const checkShulkerRead = async ({ check, load, loadEngine }) => {
    console.log("\n  shulker reader\n");
    {
        const { ItemStack, world: stubWorld } = await loadEngine();
        const { readShulkerContents, sweepShulkerLeftovers } = await load("platform/items/shulkerReader.js");
        const originalGetDimension = stubWorld.getDimension;

        /** A world of blocks by position, all air until set; `isUnloaded` makes every lookup fail, as an unloaded chunk does. */
        const makeScene = () => {
            const blocks = new Map();
            const scene = { blocks, isUnloaded: false, shulkerAt: null };
            const dimension = {
                id: "overworld",
                heightRange: { min: 0, max: 320 },
                getEntities: () => [],
                getBlock: (position) => {
                    if (scene.isUnloaded) return undefined;
                    const key = `${position.x},${position.y},${position.z}`;
                    if (!blocks.has(key)) {
                        const block = {
                            typeId: "minecraft:air",
                            isAir: true,
                            location: { ...position },
                            setPermutation(permutation) {
                                block.typeId = permutation.type.id;
                                block.isAir = block.typeId === "minecraft:air";
                                // A powered dispenser places the shulker above itself.
                                if (block.typeId === "minecraft:redstone_block" && scene.dispenserAt) {
                                    const above = dimension.getBlock({ ...scene.dispenserAt, y: scene.dispenserAt.y + 1 });
                                    above.typeId = "minecraft:red_shulker_box";
                                    above.isAir = false;
                                    above.getComponent = () => ({
                                        container: {
                                            isValid: true,
                                            size: 27,
                                            getItem: () => {
                                                // The read is over: the chunk goes before the cleanup.
                                                if (scene.unloadsAfterRead) scene.isUnloaded = true;
                                                return undefined;
                                            },
                                            clearAll: () => undefined,
                                        },
                                    });
                                }
                                if (block.typeId === "minecraft:dispenser") scene.dispenserAt = { ...position };
                            },
                            getComponent: () => ({ container: { size: 9, setItem: () => undefined, clearAll: () => undefined } }),
                        };
                        blocks.set(key, block);
                    }
                    return blocks.get(key);
                },
            };
            scene.dimension = dimension;
            stubWorld.getDimension = () => dimension;
            return scene;
        };
        const playerAt = (scene, x) => ({ dimension: scene.dimension, location: { x: x + 0.5, y: 64, z: 10.5 } });
        const shulker = () => new ItemStack("minecraft:red_shulker_box");
        const kindsOf = (events) => events.map((event) => event.kind);
        const standing = (scene) => [...scene.blocks.values()].filter((block) => !block.isAir).map((block) => block.typeId);

        // A read that finishes leaves no blocks and no record.
        {
            const scene = makeScene();
            const events = [];
            await readShulkerContents(playerAt(scene, 10), shulker(), { onEvent: (event) => events.push(event) });
            check("a finished read removes its blocks", standing(scene).length === 0, `${standing(scene)} ${kindsOf(events)}`);
            check("and leaves no record of unfinished work", stubWorld.getDynamicProperty("containerui_shulker_pending") === undefined, String(stubWorld.getDynamicProperty("containerui_shulker_pending")));
            check("so the column is free again", !kindsOf(events).includes("column-busy") && kindsOf(events).includes("read"), kindsOf(events).join(","));
        }

        // The chunk unloads mid-read: the dispenser and the redstone block are still there afterwards.
        {
            const scene = makeScene();
            scene.unloadsAfterRead = true;
            const events = [];
            await readShulkerContents(playerAt(scene, 10), shulker(), { onEvent: (event) => events.push(event) });
            const recorded = stubWorld.getDynamicProperty("containerui_shulker_pending");
            check("a read cut short by an unloaded chunk keeps a record of its blocks", typeof recorded === "string" && recorded.includes("overworld"), String(recorded));

            // Back after a reload, with someone's stone where the redstone block was.
            scene.isUnloaded = false;
            scene.unloadsAfterRead = false;
            const redstone = [...scene.blocks.values()].find((block) => block.typeId === "minecraft:redstone_block");
            redstone.typeId = "minecraft:stone";
            check("the placed shulker is still standing before the sweep", standing(scene).includes("minecraft:red_shulker_box"), standing(scene).join(","));
            const removed = typeof sweepShulkerLeftovers === "function" ? sweepShulkerLeftovers() : -1;
            const left = standing(scene);
            check("the leftover dispenser is removed", !left.includes("minecraft:dispenser"), `removed=${removed} standing=${left}`);
            check("the placed shulker is removed too, so no copy of its contents is left", !left.includes("minecraft:red_shulker_box") && removed === 2, `removed=${removed} standing=${left}`);
            check("a block that is no longer ours stays", left.includes("minecraft:stone"), left.join(","));
            check("the record is cleared once the leftovers are gone", stubWorld.getDynamicProperty("containerui_shulker_pending") === undefined, String(stubWorld.getDynamicProperty("containerui_shulker_pending")));
        }

        // The sweep also runs at the start of the next read, and leaves what it cannot reach for later.
        {
            const scene = makeScene();
            scene.unloadsAfterRead = true;
            await readShulkerContents(playerAt(scene, 20), shulker());
            check("a second cut-short read leaves blocks to recover", standing(scene).includes("minecraft:dispenser") && standing(scene).includes("minecraft:redstone_block"), standing(scene).join(","));

            scene.unloadsAfterRead = false;
            const events = [];
            scene.isUnloaded = true;
            if (typeof sweepShulkerLeftovers === "function") sweepShulkerLeftovers();
            check("an unloaded chunk keeps its record", typeof stubWorld.getDynamicProperty("containerui_shulker_pending") === "string");

            scene.isUnloaded = false;
            await readShulkerContents(playerAt(scene, 40), shulker(), { onEvent: (event) => events.push(event) });
            check("the next read cleans up what the last one left", !standing(scene).includes("minecraft:dispenser") && !standing(scene).includes("minecraft:redstone_block"), `${standing(scene)} ${kindsOf(events)}`);
            check("and the record is cleared", stubWorld.getDynamicProperty("containerui_shulker_pending") === undefined);
        }

        // Two readers two columns apart would power each other's dispensers.
        {
            const scene = makeScene();
            const first = [];
            const second = [];
            const third = [];
            const running = [
                readShulkerContents(playerAt(scene, 10), shulker(), { onEvent: (event) => first.push(event) }),
                readShulkerContents(playerAt(scene, 12), shulker(), { onEvent: (event) => second.push(event) }),
                readShulkerContents(playerAt(scene, 9), shulker(), { onEvent: (event) => third.push(event) }),
            ];
            await Promise.all(running);
            check("a read two columns from a running one waits", kindsOf(second).includes("column-busy") && !kindsOf(second).includes("start"), kindsOf(second).join(","));
            check("so does one a column away", kindsOf(third).includes("column-busy") && !kindsOf(third).includes("start"), kindsOf(third).join(","));
            check("the first read is unaffected", kindsOf(first).includes("start"), kindsOf(first).join(","));

            const farScene = makeScene();
            const near = [];
            const far = [];
            await Promise.all([
                readShulkerContents(playerAt(farScene, 10), shulker(), { onEvent: (event) => near.push(event) }),
                readShulkerContents(playerAt(farScene, 13), shulker(), { onEvent: (event) => far.push(event) }),
            ]);
            check("a read three columns away is not held up", kindsOf(far).includes("start") && !kindsOf(far).includes("column-busy"), kindsOf(far).join(","));
        }

        // Only a shulker box is read: not any id that happens to contain the words.
        {
            const solid = { dimension: { id: "overworld", heightRange: { min: 0, max: 320 }, getBlock: () => ({ isAir: false }) }, location: { x: 1, y: 64, z: 1 } };
            const verdict = async (typeId) => {
                const events = [];
                await readShulkerContents(solid, new ItemStack(typeId), { onEvent: (event) => events.push(event) });
                return kindsOf(events)[0];
            };
            for (const typeId of ["minecraft:shulker_box", "minecraft:undyed_shulker_box", "minecraft:blue_shulker_box", "minecraft:light_gray_shulker_box"]) {
                check(`${typeId} is read`, (await verdict(typeId)) === "no-safe-space", await verdict(typeId));
            }
            for (const typeId of ["minecraft:shulker_box_fragment", "mod:shulker_box", "minecraft:shulker_shell", "minecraft:fake_shulker_box", "minecraft:purple_shulker_box_item"]) {
                check(`${typeId} is not read`, (await verdict(typeId)) === "not-a-shulker", await verdict(typeId));
            }
        }
        stubWorld.getDimension = originalGetDimension;
    }
};
