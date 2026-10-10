/** The single logger: what reaches it by default, what a channel's own handler keeps, and the platform-error diagnostic. */

export const checkLogging = async ({ check, core, load }) => {
    const { setLogger, consoleLogger, setErrorReporter, effect, createRoot } = core;

    console.log("\n  logging\n");

    const records = [];
    setLogger((record) => records.push(record));
    setErrorReporter(null);
    try {
        {
            createRoot(() =>
                effect(() => {
                    throw new Error("effect exploded");
                }),
            );
            const record = records.find((entry) => entry.source === "runtime");
            check("an uncaught effect error reaches the logger", record?.level === "warn" && record.message.includes("effect exploded"), JSON.stringify(record));
        }
        {
            const { emitBlockEvent, setBlockContainerLogger } = await load("platform/block/blockEvents.js");
            setBlockContainerLogger(null);
            emitBlockEvent({ kind: "opened", component: "test:crate", blockKey: "overworld:1:2:3", player: "Steve" });
            emitBlockEvent({ kind: "error", component: "test:crate", detail: "spawn failed" });
            const blockRecords = records.filter((entry) => entry.source === "block");
            check(
                "a block record reaches the logger as info, an error record as warn",
                blockRecords[0]?.level === "info" && blockRecords[0].message === "kind=opened component=test:crate blockKey=overworld:1:2:3 player=Steve" && blockRecords[1]?.level === "warn",
                JSON.stringify(blockRecords),
            );

            const own = [];
            setBlockContainerLogger((event) => own.push(event));
            const before = records.length;
            emitBlockEvent({ kind: "closed", component: "test:crate" });
            check("a block logger of its own keeps the records", own.length === 1 && records.length === before);
            setBlockContainerLogger(null);
        }
        {
            const { openContainer } = await load("platform/surface/openContainer.js");
            const diagnostics = [];
            const player = {
                id: "player-logging",
                name: "Alex",
                isValid: true,
                location: { x: 0, y: 64, z: 0 },
                dimension: {
                    spawnEntity: () => {
                        throw new Error("entity type not found");
                    },
                },
                getComponent: () => undefined,
            };
            openContainer(player, null, { size: 27, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
            check(
                "a surface that cannot spawn reports platform-error",
                diagnostics.some((diagnostic) => diagnostic.kind === "platform-error" && diagnostic.message.includes("entity type not found")),
                JSON.stringify(diagnostics),
            );

            const before = records.length;
            openContainer(player, null, { size: 27 });
            const record = records.slice(before).find((entry) => entry.source === "diagnostic");
            check("without onDiagnostic, a platform-error reaches the logger as an error", record?.level === "error" && record.message.startsWith("platform-error:"), JSON.stringify(record));
        }
    } finally {
        setLogger(null);
        setErrorReporter(() => undefined);
    }

    {
        const printed = [];
        const { warn, error } = console;
        console.warn = (line) => printed.push(["warn", line]);
        console.error = (line) => printed.push(["error", line]);
        try {
            consoleLogger({ level: "info", source: "block", message: "quiet" });
            consoleLogger({ level: "warn", source: "items", message: "loud" });
            consoleLogger({ level: "error", source: "scheduler", message: "[ContainerUI] already prefixed" });
        } finally {
            console.warn = warn;
            console.error = error;
        }
        check(
            "the console logger drops info, prefixes once, and splits warnings from errors",
            printed.length === 2 && printed[0][1] === "[ContainerUI] loud" && printed[1][0] === "error" && printed[1][1] === "[ContainerUI] already prefixed",
            JSON.stringify(printed),
        );
    }
};
