import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ICON_DIRECTORY = join(SCRIPT_DIRECTORY, '..', 'public', 'icons');
const ICON_SIZES = [16, 32, 48, 128];

const START_COLOR = { r: 0x1f, g: 0x6f, b: 0xeb };
const END_COLOR = { r: 0x8b, g: 0x5c, b: 0xf6 };

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let value = index;

        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }

        table[index] = value >>> 0;
    }

    return table;
})();

function crc32(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
    const typeBytes = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 0);

    return Buffer.concat([length, typeBytes, payload, checksum]);
}

function pixelFor(x, y, size) {
    const distance = (x + y) / (size * 2 - 2);
    const weight = Math.min(1, Math.max(0, distance));
    const r = Math.round(START_COLOR.r + (END_COLOR.r - START_COLOR.r) * weight);
    const g = Math.round(START_COLOR.g + (END_COLOR.g - START_COLOR.g) * weight);
    const b = Math.round(START_COLOR.b + (END_COLOR.b - START_COLOR.b) * weight);

    return [r, g, b, 0xff];
}

function drawGlyph(size, pixels) {
    // A small "N" wordmark, centred. White on the gradient.
    const inset = Math.max(1, Math.round(size * 0.22));
    const left = inset;
    const right = size - inset - 1;
    const top = inset;
    const bottom = size - inset - 1;
    const stroke = Math.max(1, Math.round(size * 0.14));

    const paint = (x, y) => {
        if (x < 0 || y < 0 || x >= size || y >= size) {
            return;
        }

        const offset = (y * size + x) * 4;
        pixels[offset] = 0xff;
        pixels[offset + 1] = 0xff;
        pixels[offset + 2] = 0xff;
        pixels[offset + 3] = 0xff;
    };

    for (let y = top; y <= bottom; y += 1) {
        for (let w = 0; w < stroke; w += 1) {
            paint(left + w, y);
            paint(right - w, y);
        }
    }

    const height = bottom - top;
    const width = right - left;

    for (let step = 0; step <= height; step += 1) {
        const x = left + Math.round((step / height) * width);

        for (let w = 0; w < stroke; w += 1) {
            paint(x + w, top + step);
        }
    }
}

function buildPng(size) {
    const pixels = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const [r, g, b, a] = pixelFor(x, y, size);
            const offset = (y * size + x) * 4;
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
            pixels[offset + 3] = a;
        }
    }

    drawGlyph(size, pixels);

    const rows = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y += 1) {
        rows[y * (size * 4 + 1)] = 0;
        pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

await mkdir(ICON_DIRECTORY, { recursive: true });

for (const size of ICON_SIZES) {
    const path = join(ICON_DIRECTORY, `icon-${size}.png`);
    await writeFile(path, buildPng(size));
    console.log(`wrote ${path}`);
}
