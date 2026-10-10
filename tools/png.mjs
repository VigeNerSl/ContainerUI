/** Encoding PNG images for generated textures. */

import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (unused, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

const crc32 = (bytes) => (bytes.reduce((crc, byte) => CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

const pngChunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
};

/** An RGB PNG of `size`×`size` pixels, each coloured by `colorAt(x, y)`. */
export const encodePng = ({ size, colorAt }) => {
    const stride = size * 3 + 1;
    const raw = Buffer.alloc(size * stride);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) raw.set(colorAt(x, y), y * stride + 1 + x * 3);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // truecolour
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
};
