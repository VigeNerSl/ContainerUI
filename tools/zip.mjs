/**
 * A small ZIP writer, so a release archive needs no tool beyond Node. Entries are sorted and carry a
 * fixed timestamp, so building the same files twice gives the same bytes.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

/** The ZIP epoch, 1980-01-01 00:00, as DOS date and time fields. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8_NAMES = 0x0800;

const CRC_TABLE = Array.from({ length: 256 }, (unused, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

/** The CRC-32 of `bytes`, the checksum every ZIP entry carries. */
const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
};

/** Every file under `folder` as `{ path, contents }`, with `path` relative to `folder` and using `/`. */
export const readFolder = (folder) => {
    const walk = (directory, prefix) =>
        readdirSync(directory).flatMap((name) => {
            const full = join(directory, name);
            const path = prefix === "" ? name : `${prefix}/${name}`;
            return statSync(full).isDirectory() ? walk(full, path) : [{ path, contents: readFileSync(full) }];
        });
    return walk(folder, "");
};

/** Builds a ZIP archive from `entries`, each `{ path, contents }`, and returns it as a Buffer. */
export const buildZip = (entries) => {
    const sorted = [...entries].sort((first, second) => (first.path < second.path ? -1 : 1));
    const chunks = [];
    const directory = [];
    let offset = 0;

    for (const { path, contents } of sorted) {
        const name = Buffer.from(path, "utf8");
        const deflated = deflateRawSync(contents, { level: 9 });
        const isDeflated = deflated.length < contents.length;
        const stored = isDeflated ? deflated : contents;
        const method = isDeflated ? 8 : 0;
        const checksum = crc32(contents);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(stored.length, 18);
        local.writeUInt32LE(contents.length, 22);
        local.writeUInt16LE(name.length, 26);
        chunks.push(local, name, stored);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(UTF8_NAMES, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(stored.length, 20);
        central.writeUInt32LE(contents.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        directory.push(central, name);

        offset += local.length + name.length + stored.length;
    }

    const directorySize = directory.reduce((total, chunk) => total + chunk.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(sorted.length, 8);
    end.writeUInt16LE(sorted.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...chunks, ...directory, end]);
};
