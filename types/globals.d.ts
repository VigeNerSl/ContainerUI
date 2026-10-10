/**
 * Minimal ambient declarations.
 *
 * The library targets QuickJS inside Bedrock, where there is no Node and no DOM — only a
 * `console` shim. Declaring exactly what is used keeps the project free of `@types/node`
 * and makes it impossible to accidentally depend on a platform API that will not exist at
 * runtime.
 */

declare const console: {
    log(...values: unknown[]): void;
    info(...values: unknown[]): void;
    warn(...values: unknown[]): void;
    error(...values: unknown[]): void;
};

/** Declared for the test runner only; nothing in `src/` uses it. */
declare const process: {
    exitCode: number | undefined;
    argv: string[];
};
