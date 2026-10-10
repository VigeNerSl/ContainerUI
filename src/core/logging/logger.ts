/** The one place the library's output goes: errors, warnings and activity records. */

/** How much a record matters. */
export type LogLevel = "error" | "warn" | "info";

/** The part of the library a record comes from. */
export type LogSource = "runtime" | "scheduler" | "diagnostic" | "surface" | "block" | "storage" | "item-guard" | "items";

/** One thing the library has to say. */
export interface LogRecord {
    readonly level: LogLevel;
    readonly source: LogSource;
    readonly message: string;
    /** The error or event behind the record, when there is one. */
    readonly detail?: unknown;
}

/** Receives every record the library writes. */
export type Logger = (record: LogRecord) => void;

const PREFIX = "[ContainerUI]";

/**
 * The default logger: errors and warnings to the console, activity records nowhere.
 *
 * @param record The record.
 */
export const consoleLogger: Logger = (record) => {
    if (record.level === "info") return;
    const line = record.message.startsWith(PREFIX) ? record.message : `${PREFIX} ${record.message}`;
    if (record.level === "error") console.error(line);
    else console.warn(line);
};

let currentLogger: Logger = consoleLogger;

/**
 * Sets where the library's output goes: render and effect errors, scheduler loops, default
 * diagnostics, surface failures, block container records, item guard activity and item warnings.
 * A channel given its own handler (`onDiagnostic`, `onError`, `setBlockContainerLogger`, …) keeps
 * using that handler.
 *
 * @param logger Receives every record, or `null` to restore {@link consoleLogger}.
 * @example
 * setLogger(({ level, source, message }) => {
 *     if (level !== "info" || source === "block") console.warn(`[shop] ${source}: ${message}`);
 * });
 */
export const setLogger = (logger: Logger | null): void => {
    currentLogger = logger ?? consoleLogger;
};

/**
 * Writes a record to the current logger. A throwing logger is ignored.
 *
 * @internal
 */
export const log = (record: LogRecord): void => {
    try {
        currentLogger(record);
    } catch {
        // A logger must not break the code that reports through it.
    }
};
