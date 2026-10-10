/** Persistence for application state over a key-value backend. */

/** A string key-value store. Setting `undefined` deletes. */
export interface KeyValueBackend {
    /** The stored string, or `undefined` when the key is absent. */
    get(key: string): string | undefined;
    /** Stores `value` under `key`; `undefined` deletes it. */
    set(key: string, value: string | undefined): void;
    /** All stored keys. */
    keys(): string[];
}

/** One `set` recorded by a {@link MemoryBackend}. */
export interface BackendWrite {
    key: string;
    value: string | undefined;
}

/** An in-memory backend that records writes, for tests. */
export interface MemoryBackend extends KeyValueBackend {
    /** Every `set` issued, in order. */
    readonly writes: BackendWrite[];
    /** Forgets the recorded writes. */
    clearHistory(): void;
}

/** How a {@link ChunkedStore} splits and names its values. */
export interface ChunkedStoreOptions {
    /**
     * Maximum characters per stored chunk: a positive integer. A surrogate pair is never split, so a
     * chunk of 1 holds such a pair whole.
     */
    chunkSize?: number;
    /**
     * Prefix isolating this store's keys from everything else in the backend. Neither empty nor
     * containing `|`. A store without one sees only keys that have no namespace.
     */
    namespace?: string;
}

/**
 * Upgrades a stored record by one version.
 *
 * @param value The record at the previous version.
 * @param key Its key.
 * @returns The record at the next version.
 */
export type JsonMigration = (value: unknown, key: string) => unknown;

/** How a {@link JsonStore} names, upgrades and reports its records. */
export interface JsonStoreOptions extends ChunkedStoreOptions {
    /**
     * Receives records that cannot be used: a backend that refused the read, bad JSON, a migration
     * that threw, or a record from a newer version. The read returns its fallback.
     */
    onCorrupt?: (key: string, error: unknown) => void;
    /**
     * One upgrade per version step: `migrations[0]` turns version 0 into 1, and so on. A record
     * is upgraded on its first read and written back. Only ever append.
     */
    migrations?: readonly JsonMigration[];
}

/** The envelope a store with migrations writes: `{"$v": version, "$d": value}`. */
interface VersionedRecord {
    $v: number;
    $d: unknown;
}

/** Default characters per chunk, under Bedrock's 32767-character limit for one dynamic property. */
export const DEFAULT_CHUNK_SIZE = 30000;

/** Ends the key that holds a value's chunk count. */
const COUNT_SUFFIX = "#n";

/** Separates a namespace from its keys. */
const NAMESPACE_SEPARATOR = "|";

/** Ends a backend key that holds a chunk count (`#n`) or a chunk (`#` and digits). */
const STORED_SUFFIX = /#(n|\d+)$/;

/** A chunk count as stored, or `undefined` when it is missing or unusable. */
const parseCount = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const count = Number.parseInt(raw, 10);
    return Number.isNaN(count) || count < 0 ? undefined : count;
};

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Splits `value` into pieces of `size` UTF-16 units, never between the halves of a surrogate pair: a piece may hold one unit more, or two when `size` is 1. */
const splitChunks = (value: string, size: number): string[] => {
    const chunks: string[] = [];
    let start = 0;
    do {
        let end = Math.min(value.length, start + size);
        const isPairCut = end < value.length && isHighSurrogate(value.charCodeAt(end - 1)) && isLowSurrogate(value.charCodeAt(end));
        // A chunk of 1 cannot hold less than a whole pair.
        if (isPairCut) end += end - 1 > start ? -1 : 1;
        chunks.push(value.slice(start, end));
        start = end;
    } while (start < value.length);
    return chunks;
};

/** The numbers `0` up to, not including, `count`. */
const indicesBelow = (count: number): number[] => Array.from({ length: count }, (_unused, index) => index);

const isVersionedRecord = (value: unknown): value is VersionedRecord => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (keys.length !== 2 || !("$v" in value) || !("$d" in value)) return false;
    const version = (value as { $v: unknown }).$v;
    return typeof version === "number" && Number.isInteger(version) && version >= 0;
};

/** What `#migrate` returns when a migration threw. */
const MIGRATION_FAILED = Symbol("migration failed");

/** What `#read` returns when there is no usable record: the caller's fallback applies. */
const MISSING = Symbol("missing");

/** A JSON deep copy; QuickJS has no `structuredClone`. */
const structuredCloneValue = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value));
};

/** What `JSON.stringify` keeps of a value, as a value: `NaN` becomes `null`, a function `undefined`. */
const keptByJson = (value: unknown): unknown => {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : JSON.parse(text);
};

/** A copy of a caller's fallback. Plain data is copied; anything else, like a `Map`, is handed back as it is. */
const copyOfFallback = <T>(fallback: T): T => {
    if (fallback === null || typeof fallback !== "object") return fallback;
    const prototype = Object.getPrototypeOf(fallback);
    if (!Array.isArray(fallback) && prototype !== Object.prototype && prototype !== null) return fallback;
    try {
        return structuredCloneValue(fallback) as T;
    } catch {
        return fallback;
    }
};

/**
 * Creates an in-memory backend.
 *
 * @returns The backend, recording every write.
 */
export const createMemoryBackend = (): MemoryBackend => {
    const contents = new Map<string, string>();
    const writes: BackendWrite[] = [];

    return {
        writes,
        get: (key) => contents.get(key),
        set: (key, value) => {
            writes.push({ key, value });
            if (value === undefined) contents.delete(key);
            else contents.set(key, value);
        },
        keys: () => [...contents.keys()],
        clearHistory: () => {
            writes.length = 0;
        },
    };
};

/**
 * Stores strings of any length across a size-limited backend, writing only the chunks that changed.
 *
 * A write is ordered so that an interrupted one reads as absent rather than as a part of the value:
 * a value that grows announces its new chunk count first, so a read finds the chunks it has not
 * yet received missing; a value that shrinks removes its tail first and updates the count last.
 * The one case left open is an interrupted rewrite of a multi-chunk value that keeps its chunk
 * count, which can mix old and new chunks.
 */
export class ChunkedStore {
    readonly #backend: KeyValueBackend;
    readonly #chunkSize: number;
    readonly #prefix: string;

    /**
     * @param backend Where the chunks are stored.
     * @param options Chunk size and namespace.
     * @throws {RangeError} For a namespace that is empty or contains `|`, which would let two stores
     * share keys, or for a `chunkSize` that is not a positive integer.
     */
    constructor(backend: KeyValueBackend, options: ChunkedStoreOptions = {}) {
        const { chunkSize = DEFAULT_CHUNK_SIZE, namespace } = options;
        if (namespace === "") {
            throw new RangeError("[ContainerUI] Store namespace is empty; leave it out for a store without one.");
        }
        if (namespace?.includes(NAMESPACE_SEPARATOR)) {
            throw new RangeError(`[ContainerUI] Store namespace "${namespace}" contains "|", which separates it from its keys.`);
        }
        if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
            throw new RangeError(`[ContainerUI] Store chunkSize must be a positive integer; got ${String(chunkSize)}.`);
        }
        this.#backend = backend;
        this.#chunkSize = chunkSize;
        this.#prefix = namespace !== undefined ? `${namespace}${NAMESPACE_SEPARATOR}` : "";
    }

    /**
     * Reads a value.
     *
     * @param key The key.
     * @returns The value, or `undefined` when it is missing or a chunk is.
     */
    get(key: string): string | undefined {
        if (!this.#isUsable(key)) return undefined;
        const count = parseCount(this.#backend.get(this.#countKey(key)));
        if (count === undefined) return undefined;

        let value = "";
        for (let index = 0; index < count; index++) {
            const chunk = this.#backend.get(this.#chunkKey(key, index));
            if (chunk === undefined) return undefined;
            value += chunk;
        }
        return value;
    }

    /**
     * Writes a value, touching only the chunks that changed.
     *
     * @param key The key.
     * @param value The value; `undefined` deletes it.
     * @throws {RangeError} For a key containing `|` in a store without a namespace.
     */
    set(key: string, value: string | undefined): void {
        if (value === undefined) {
            this.#remove(key);
            return;
        }
        if (!this.#isUsable(key)) {
            throw new RangeError(`[ContainerUI] A store without a namespace cannot hold key "${key}": "|" separates a namespace from its keys.`);
        }

        const countKey = this.#countKey(key);
        const previousRaw = this.#backend.get(countKey);
        const previousCount = parseCount(previousRaw) ?? 0;
        const chunks = splitChunks(value, this.#chunkSize);
        const nextRaw = String(chunks.length);
        const isGrowth = previousCount > 0 && chunks.length > previousCount;
        // Without a usable count, chunks left by an interrupted write are found by name.
        const present = previousCount > 0 ? indicesBelow(previousCount) : this.#strayIndices(key);

        if (isGrowth) this.#backend.set(countKey, nextRaw);

        present
            .filter((index) => index >= chunks.length)
            .sort((first, second) => second - first)
            .forEach((index) => this.#backend.set(this.#chunkKey(key, index), undefined));

        chunks.forEach((chunk, index) => {
            const chunkKey = this.#chunkKey(key, index);
            if (this.#backend.get(chunkKey) === chunk) return;
            this.#backend.set(chunkKey, chunk);
        });

        if (!isGrowth && previousRaw !== nextRaw) this.#backend.set(countKey, nextRaw);
    }

    /** Deletes a value and its chunks. */
    delete(key: string): void {
        this.#remove(key);
    }

    /** Whether a value is stored under `key`. */
    has(key: string): boolean {
        return this.#isUsable(key) && this.#backend.get(this.#countKey(key)) !== undefined;
    }

    /** The stored keys in this namespace. */
    keys(): string[] {
        return this.#backend.keys().flatMap((backendKey) => {
            const rest = this.#restOf(backendKey);
            return rest?.endsWith(COUNT_SUFFIX) ? [rest.slice(0, -COUNT_SUFFIX.length)] : [];
        });
    }

    /**
     * Removes every value in this namespace. A namespaced store also removes the chunks of values
     * whose count was lost; a store without a namespace cannot tell those from other data.
     */
    clear(): void {
        if (this.#prefix === "") {
            this.keys().forEach((key) => this.#remove(key));
            return;
        }
        const owned = this.#backend.keys().filter((backendKey) => STORED_SUFFIX.test(this.#restOf(backendKey) ?? ""));
        // Counts last: until then a half-cleared value reads as absent.
        const chunkKeys = owned.filter((backendKey) => !backendKey.endsWith(COUNT_SUFFIX));
        const countKeys = owned.filter((backendKey) => backendKey.endsWith(COUNT_SUFFIX));
        [...chunkKeys, ...countKeys].forEach((backendKey) => this.#backend.set(backendKey, undefined));
    }

    #remove(key: string): void {
        if (!this.#isUsable(key)) return;
        const countKey = this.#countKey(key);
        const raw = this.#backend.get(countKey);
        const count = parseCount(raw) ?? 0;
        const indices = count > 0 ? indicesBelow(count) : this.#strayIndices(key);

        // Highest first, count last: an interrupted delete leaves a value that reads as absent.
        indices
            .sort((first, second) => second - first)
            .forEach((index) => this.#backend.set(this.#chunkKey(key, index), undefined));
        if (raw !== undefined) this.#backend.set(countKey, undefined);
    }

    /** Indices of the chunks stored under `key` although no usable count says so. */
    #strayIndices(key: string): number[] {
        // Chunks are written from the first: if it is absent, so is everything after it.
        if (this.#backend.get(this.#chunkKey(key, 0)) === undefined) return [];
        const head = `${this.#prefix}${key}#`;
        return this.#backend
            .keys()
            .filter((backendKey) => backendKey.startsWith(head) && /^\d+$/.test(backendKey.slice(head.length)))
            .map((backendKey) => Number(backendKey.slice(head.length)));
    }

    /** Whether this store can use `key`: without a namespace, a key containing `|` cannot be used. */
    #isUsable(key: string): boolean {
        return this.#prefix !== "" || !key.includes(NAMESPACE_SEPARATOR);
    }

    /** What follows this store's prefix in `backendKey`, or `undefined` when the key is not this store's. */
    #restOf(backendKey: string): string | undefined {
        if (this.#prefix === "") return backendKey.includes(NAMESPACE_SEPARATOR) ? undefined : backendKey;
        return backendKey.startsWith(this.#prefix) ? backendKey.slice(this.#prefix.length) : undefined;
    }

    #countKey(key: string): string {
        return `${this.#prefix}${key}${COUNT_SUFFIX}`;
    }

    #chunkKey(key: string, index: number): string {
        return `${this.#prefix}${key}#${index}`;
    }
}

/**
 * Typed JSON persistence over a {@link ChunkedStore}. Reads are cached and return copies. The cache
 * belongs to this instance: keep one store per namespace, and call {@link JsonStore.forget} after
 * writing to its backend any other way.
 */
export class JsonStore {
    readonly #chunks: ChunkedStore;
    readonly #onCorrupt: ((key: string, error: unknown) => void) | undefined;
    readonly #cache = new Map<string, unknown>();
    readonly #migrations: readonly JsonMigration[];

    /**
     * @param backend Where the records are stored.
     * @param options Namespace, migrations and the corrupt-record handler.
     */
    constructor(backend: KeyValueBackend, options: JsonStoreOptions = {}) {
        this.#chunks = new ChunkedStore(backend, options);
        this.#onCorrupt = options.onCorrupt;
        this.#migrations = options.migrations ?? [];
    }

    /** The version this store writes: how many migrations it has. */
    get version(): number {
        return this.#migrations.length;
    }

    /**
     * Reads a value.
     *
     * @param key The key.
     * @param fallback Returned, as a copy, when the key is missing or unusable.
     * @returns A copy of the stored value.
     */
    get<T>(key: string, fallback: T): T {
        const stored = this.#read(key);
        return stored === MISSING ? copyOfFallback(fallback) : (stored as T);
    }

    /** Drops the cached copy of a key, so the next read goes to the backend. */
    forget(key: string): void {
        this.#cache.delete(key);
    }

    /**
     * Writes a value. What `JSON.stringify` keeps is what is stored and cached, so `NaN` reads back
     * as `null`. A value it cannot keep, such as `undefined` or a function, deletes the key.
     *
     * @param key The key.
     * @param value Anything `JSON.stringify` keeps.
     */
    set<T>(key: string, value: T): void {
        const text = JSON.stringify(value);
        if (text === undefined) {
            this.delete(key);
            return;
        }
        const kept: unknown = JSON.parse(text);
        // An unversioned store wraps a value shaped like an envelope too, so it is never taken for one.
        const isWrapped = this.version > 0 || isVersionedRecord(kept);
        // Backend first, so a refused write never reaches the cache.
        this.#chunks.set(key, isWrapped ? `{"$v":${this.version},"$d":${text}}` : text);
        this.#cache.set(key, kept);
    }

    /** Deletes a value. */
    delete(key: string): void {
        this.#cache.delete(key);
        this.#chunks.delete(key);
    }

    /** Whether a value is stored under `key`. */
    has(key: string): boolean {
        return this.#cache.has(key) || this.#chunks.has(key);
    }

    /** The stored keys in this store's namespace. */
    keys(): string[] {
        return this.#chunks.keys();
    }

    /** Removes every value in this store's namespace. */
    clear(): void {
        this.#cache.clear();
        this.#chunks.clear();
    }

    /** A copy of the stored value, or `MISSING` when there is none to use. */
    #read(key: string): unknown {
        if (this.#cache.has(key)) return structuredCloneValue(this.#cache.get(key));

        let raw: string | undefined;
        try {
            raw = this.#chunks.get(key);
        } catch (error) {
            // The backend is gone or refused the read.
            this.#onCorrupt?.(key, error);
            return MISSING;
        }
        if (raw === undefined) return MISSING;

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            this.#onCorrupt?.(key, error);
            return MISSING;
        }

        const envelope = isVersionedRecord(parsed) ? parsed : null;
        const storedVersion = envelope ? envelope.$v : 0;
        const stored = envelope ? envelope.$d : parsed;

        // Written by a newer version: neither read nor overwrite it.
        if (storedVersion > this.version) {
            this.#onCorrupt?.(key, new Error(`record is version ${storedVersion}; this store is version ${this.version}`));
            return MISSING;
        }
        if (storedVersion === this.version) {
            this.#cache.set(key, stored);
            return structuredCloneValue(stored);
        }

        const upgraded = this.#migrate({ key, stored, storedVersion });
        return upgraded === MIGRATION_FAILED || upgraded === undefined ? MISSING : keptByJson(upgraded);
    }

    /** Runs the migrations from `storedVersion` on and writes the result back. */
    #migrate({ key, stored, storedVersion }: { key: string; stored: unknown; storedVersion: number }): unknown {
        let upgraded: unknown = stored;
        try {
            for (let step = storedVersion; step < this.version; step++) upgraded = this.#migrations[step]!(upgraded, key);
        } catch (error) {
            // The record stays as it was.
            this.#onCorrupt?.(key, error);
            return MIGRATION_FAILED;
        }
        try {
            this.set(key, upgraded);
        } catch (error) {
            // The write was refused; the next read migrates again.
            this.#onCorrupt?.(key, error);
        }
        return upgraded;
    }
}
