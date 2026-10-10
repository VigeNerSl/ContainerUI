/**
 * Two viewers on one slot in one tick, refused items, `JsonStore` migrations and edge cases, and
 * `ChunkedStore`.
 */

export const checkStorage = async ({ check, core, freshRuntime }) => {
    const { h, mount, createTestHost, createMemoryStorage, createMemoryBackend, StorageSlots, JsonStore, ChunkedStore } = core;

    // Two viewers act on the same slot before either commit repaints the other: the first edit
    // stands, and what the second handed its player is taken back.
    console.log("\n  two viewers, one slot, one tick\n");
    const raceWorld = (contents) => {
        const { clock } = freshRuntime();
        const storage = createMemoryStorage(9, contents);
        const edits = [];
        const conflicts = [];
        const mountViewer = (name) => {
            const host = createTestHost({ slotCount: 9 });
            mount(h(StorageSlots, { storage, onEdit: () => edits.push(name), onConflict: () => conflicts.push(name) }), host);
            return host;
        };
        return { clock, storage, edits, conflicts, viewer1: mountViewer("viewer1"), viewer2: mountViewer("viewer2") };
    };
    const theDiamond = { typeId: "minecraft:diamond", amount: 1, native: { id: "the-diamond" } };
    {
        const { clock, storage, edits, conflicts, viewer1, viewer2 } = raceWorld([theDiamond]);
        viewer1.simulateTake(0);
        viewer2.simulateTake(0); // same tick: viewer 2 still shows the diamond
        clock.runPending();
        check("a double take leaves the first standing", edits.join(",") === "viewer1" && storage.get(0) === null, `edits=${edits.join(",")}`);
        check("the second is reported as a conflict", conflicts.join(",") === "viewer2", conflicts.join(","));
        check(
            "and its diamond is taken back",
            viewer2.takenBack.map((item) => item.typeId).join(",") === "minecraft:diamond" && viewer1.takenBack.length === 0,
            JSON.stringify(viewer2.takenBack),
        );
    }
    {
        const { clock, storage, viewer1, viewer2 } = raceWorld([theDiamond]);
        viewer1.simulateTake(0);
        viewer2.simulateSwap(0, { typeId: "minecraft:iron_ingot", amount: 4, native: { id: "viewer2-iron" } });
        clock.runPending();
        check("a stale swap stores what was put in, since the slot is free", storage.get(0)?.native?.id === "viewer2-iron", JSON.stringify(storage.get(0)));
        check("and takes back the diamond it handed out", viewer2.takenBack.map((item) => item.typeId).join(",") === "minecraft:diamond", JSON.stringify(viewer2.takenBack));
    }
    {
        const { clock, storage, viewer1, viewer2 } = raceWorld([]);
        viewer1.simulatePlace(0, { typeId: "minecraft:emerald", amount: 1, native: { id: "viewer1-emerald" } });
        viewer2.simulatePlace(0, { typeId: "minecraft:iron_ingot", amount: 1, native: { id: "viewer2-iron" } });
        clock.runPending();
        check("two deposits into one free slot keep the first", storage.get(0)?.native?.id === "viewer1-emerald", JSON.stringify(storage.get(0)));
        check(
            "and hand the second back instead of deleting either",
            viewer2.givenBack.map((item) => item.native?.id).join(",") === "viewer2-iron" && viewer2.takenBack.length === 0,
            JSON.stringify(viewer2.givenBack),
        );
        check("the second screen then shows what the storage holds", viewer2.readSlot(0)?.native?.id === "viewer1-emerald", JSON.stringify(viewer2.readSlot(0)));
    }

    console.log("\n  refused items\n");
    {
        const { clock } = freshRuntime();
        const host = createTestHost({ slotCount: 9 });
        const changes = [];
        mount(
            h("input", {
                index: 0,
                initialItem: { typeId: "minecraft:diamond", amount: 1 },
                accept: (item) => item.typeId !== "minecraft:bedrock",
                onChange: (event) => changes.push(`${event.previous?.typeId ?? "empty"}->${event.next?.typeId ?? "empty"}`),
            }),
            host,
        );
        clock.runPending();
        host.simulateSwap(0, { typeId: "minecraft:bedrock", amount: 1 }); // the diamond goes to the cursor
        clock.runPending();
        check("a refused item is handed back", host.givenBack.map((item) => item.typeId).join(",") === "minecraft:bedrock", JSON.stringify(host.givenBack));
        check("the item it displaced is not written back, since the player holds it", !host.readSlot(0), JSON.stringify(host.readSlot(0)));
        check("and is reported as taken", changes.join(",") === "minecraft:diamond->empty", changes.join(","));
        host.simulatePlace(0, { typeId: "minecraft:bedrock", amount: 1 });
        clock.runPending();
        check(
            "a refused place is handed back too, with nothing to report",
            host.givenBack.length === 2 && changes.length === 1 && !host.readSlot(0),
            `${JSON.stringify(host.givenBack)} ${changes.join(",")}`,
        );
    }

    console.log("\n  JsonStore migrations\n");
    {
        const backend = createMemoryBackend();
        new JsonStore(backend, { namespace: "app" }).set("profile", { coins: 5 }); // written before versions existed
        const migrated = [];
        const migrations = [
            (value, key) => {
                migrated.push(key);
                return { balance: value.coins, gems: 0 };
            },
            (value) => ({ ...value, gems: value.gems + 1 }),
        ];
        const raw = (key, source = backend) => new ChunkedStore(source, { namespace: "app" }).get(key);

        const store = new JsonStore(backend, { namespace: "app", migrations });
        check("a store's version is its migration count", store.version === 2, `version=${store.version}`);
        const profile = JSON.stringify(store.get("profile", null));
        check("an unversioned record is upgraded through every step", profile === '{"balance":5,"gems":1}', profile);
        new JsonStore(backend, { namespace: "app", migrations }).get("profile", null);
        check("and written back, so each step runs once per record", migrated.length === 1, `ran ${migrated.length} times`);

        store.set("fresh", { balance: 1 });
        check("new records carry the version", raw("fresh") === '{"$v":2,"$d":{"balance":1}}', raw("fresh"));

        const errors = [];
        const older = new JsonStore(backend, { namespace: "app", migrations: migrations.slice(0, 1), onCorrupt: (key, error) => errors.push(`${key}:${error.message}`) });
        check("a record from a newer version reads as the fallback", older.get("fresh", "fallback") === "fallback");
        check("and is reported, and left as it was", errors.some((line) => line.startsWith("fresh:record is version 2")) && raw("fresh")?.includes('"$v":2'), errors.join(","));

        const brittleBackend = createMemoryBackend();
        new JsonStore(brittleBackend, { namespace: "app" }).set("k", { a: 1 });
        const brittleErrors = [];
        const brittle = new JsonStore(brittleBackend, {
            namespace: "app",
            migrations: [
                () => {
                    throw new Error("bad step");
                },
            ],
            onCorrupt: (key, error) => brittleErrors.push(error.message),
        });
        check("a migration that throws costs the fallback", brittle.get("k", "fallback") === "fallback" && brittleErrors.includes("bad step"), brittleErrors.join(","));
        check("and leaves the record for a fixed migration", raw("k", brittleBackend) === '{"a":1}', raw("k", brittleBackend));

        const plainBackend = createMemoryBackend();
        new JsonStore(plainBackend).set("x", { $v: 1, $d: "looks versioned" });
        const plain = JSON.stringify(new JsonStore(plainBackend).get("x", null));
        check("a store without migrations never unwraps a look-alike value", plain === '{"$v":1,"$d":"looks versioned"}', plain);
    }

    console.log("\n  json store edges\n");
    const thrownBy = (action) => {
        try {
            action();
            return null;
        } catch (error) {
            return error;
        }
    };
    {
        const backend = createMemoryBackend();
        const store = new JsonStore(backend, { namespace: "app" });
        store.set("kept", 1);
        store.set("kept", undefined);
        check("setting undefined deletes the key", !store.has("kept") && store.get("kept", "fallback") === "fallback" && backend.keys().length === 0, JSON.stringify(backend.keys()));

        const versionedBackend = createMemoryBackend();
        const versioned = new JsonStore(versionedBackend, { namespace: "app", migrations: [(value) => value] });
        versioned.set("kept", 1);
        versioned.set("kept", undefined);
        check("so does a versioned store, writing no half envelope", !versioned.has("kept") && versionedBackend.keys().length === 0, JSON.stringify(versionedBackend.keys()));

        store.set("number", Number.NaN);
        const afterRestart = new JsonStore(backend, { namespace: "app" }).get("number", "fallback");
        check("the cache holds what the disk holds: NaN is null in both", store.get("number", "fallback") === null && afterRestart === null, `cache=${store.get("number", "fallback")} disk=${afterRestart}`);

        const fallback = { list: [1] };
        const copy = store.get("missing", fallback);
        copy.list.push(2);
        check("a fallback comes back as a copy", copy !== fallback && fallback.list.length === 1, JSON.stringify(fallback));
        const map = new Map();
        check("a fallback that is not plain data comes back as it is", store.get("missing", map) === map);
    }
    {
        // A record written by a newer version, read by a store that has no migrations at all.
        const backend = createMemoryBackend();
        new ChunkedStore(backend, { namespace: "app" }).set("k", '{"$v":3,"$d":{"coins":9}}');
        const reports = [];
        const old = new JsonStore(backend, { namespace: "app", onCorrupt: (key, error) => reports.push(`${key}:${error.message}`) });
        const read = old.get("k", "fallback");
        check("an unversioned store treats a newer record as the fallback and reports it", read === "fallback" && reports.length === 1, `${read} ${reports.join()}`);
        check("and never writes it back", new ChunkedStore(backend, { namespace: "app" }).get("k") === '{"$v":3,"$d":{"coins":9}}');

        new ChunkedStore(backend, { namespace: "app" }).set("zero", '{"$v":0,"$d":{"coins":2}}');
        check("a version 0 envelope is unwrapped", JSON.stringify(old.get("zero", null)) === '{"coins":2}');
    }

    console.log("\n  chunked store\n");
    {
        const sizes = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];
        const refused = sizes.map((chunkSize) => thrownBy(() => new ChunkedStore(createMemoryBackend(), { chunkSize })) instanceof RangeError);
        check("a chunk size that is not a positive integer is refused", refused.every(Boolean), JSON.stringify(refused));
        check("an empty namespace is refused", thrownBy(() => new ChunkedStore(createMemoryBackend(), { namespace: "" })) instanceof RangeError);
    }
    {
        const backend = createMemoryBackend();
        const store = new ChunkedStore(backend, { namespace: "n", chunkSize: 4 });
        store.set("k", "aaaabbbbcc");
        // The count is lost: the chunks stay behind.
        backend.set("n|k#n", undefined);
        check("a value without its count reads as absent", store.get("k") === undefined);
        store.set("k", "zz");
        check("rewriting it removes the chunks the lost count left behind", backend.keys().sort().join() === "n|k#0,n|k#n", backend.keys().sort().join());

        store.set("k", "aaaabbbbcc");
        backend.set("n|k#n", "garbage");
        store.delete("k");
        check("deleting a value whose count is unusable removes its chunks", backend.keys().length === 0, backend.keys().join());

        store.set("a", "aaaabbbb");
        store.set("b", "ccccdddd");
        backend.set("n|a#n", undefined);
        store.clear();
        check("clearing a namespace removes chunks whose count is lost, too", backend.keys().length === 0, backend.keys().join());
    }
    {
        // A grow that fails halfway must not leave a readable prefix of the new value.
        const backend = createMemoryBackend();
        let failingKey = null;
        const flaky = {
            get: (key) => backend.get(key),
            keys: () => backend.keys(),
            set: (key, value) => {
                if (key === failingKey) throw new Error("write refused");
                backend.set(key, value);
            },
        };
        const store = new ChunkedStore(flaky, { namespace: "n", chunkSize: 4 });
        store.set("k", "aaaabbbb");
        failingKey = "n|k#3";
        thrownBy(() => store.set("k", "ccccddddeeeeffff"));
        const read = store.get("k");
        check("a grow cut short reads as absent or as the old value, never as part of the new one", read === undefined || read === "aaaabbbb", String(read));
        failingKey = null;
        store.set("k", "ccccddddeeeeffff");
        check("and writing again completes it", store.get("k") === "ccccddddeeeeffff");

        failingKey = "n|k#n";
        thrownBy(() => store.set("k", "gggghhhhiiiijjjjkkkk"));
        check("a refused count leaves the old value whole", store.get("k") === "ccccddddeeeeffff", String(store.get("k")));
        failingKey = "n|k#2";
        thrownBy(() => store.set("k", "x"));
        const shrunk = store.get("k");
        check("a shrink cut short reads as absent or whole, never as a mixture", shrunk === undefined || shrunk === "x" || shrunk === "ccccddddeeeeffff", String(shrunk));
    }
    {
        const backend = createMemoryBackend();
        const store = new ChunkedStore(backend, { chunkSize: 3 });
        const text = "ab😀cd😀😀e";
        store.set("k", text);
        const chunks = backend.keys().filter((key) => key !== "k#n").sort().map((key) => backend.get(key));
        check("the value round-trips", store.get("k") === text);
        const isHalfPair = (chunk) => /^[\udc00-\udfff]|[\ud800-\udbff]$/.test(chunk);
        check("no chunk starts or ends inside a surrogate pair", !chunks.some(isHalfPair), JSON.stringify(chunks));
        check("and none is longer than the chunk size", chunks.every((chunk) => chunk.length <= 3), JSON.stringify(chunks));

        const tiny = new ChunkedStore(createMemoryBackend(), { chunkSize: 1 });
        tiny.set("k", "a😀b");
        check("a chunk size of 1 still holds a pair whole", tiny.get("k") === "a😀b");
    }
    {
        const backend = createMemoryBackend();
        const bare = new ChunkedStore(backend);
        const inA = new ChunkedStore(backend, { namespace: "a" });
        inA.set("k", "from a");
        bare.set("own", "bare value");
        check("a store without a namespace does not list another namespace's keys", bare.keys().join() === "own", bare.keys().join());
        bare.clear();
        check("and clearing it leaves other namespaces alone", inA.get("k") === "from a" && bare.get("own") === undefined);
        check("it cannot hold a key that looks like a namespaced one", thrownBy(() => bare.set("a|k", "x")) instanceof RangeError && inA.get("k") === "from a");
        check("nor read one", bare.get("a|k") === undefined && !bare.has("a|k"));
    }
};
