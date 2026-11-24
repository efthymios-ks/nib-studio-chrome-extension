import pako from 'pako';
import { decodeUtf16ByMark } from './codePage.js';

interface ZipEntry {
    readonly name: string;
    readonly method: number;
    readonly isEncrypted: boolean;
    readonly compressedSize: number;
    readonly size: number;
    readonly headerOffset: number;
}

// A ZIP read from its central directory, so single parts inflate without unpacking the rest.
export interface ZipPackage {
    readonly entries: ReadonlyMap<string, ZipEntry>;
    // The entry's bytes, or null when it is missing, encrypted or can't be inflated.
    read(name: string): Uint8Array | null;
    // The entry as text, UTF-8 or UTF-16 by its byte order mark.
    readText(name: string): string | null;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

const utf8 = new TextDecoder('utf-8');

export function isZip(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

// Null when the bytes hold no readable central directory.
export function openZipPackage(bytes: Uint8Array): ZipPackage | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndOfDirectory(view);

    if (end < 0) {
        return null;
    }

    const count = view.getUint16(end + 10, true);
    const directoryOffset = view.getUint32(end + 16, true);
    const entries = new Map<string, ZipEntry>();
    let position = directoryOffset;

    for (let index = 0; index < count; index += 1) {
        if (position + 46 > bytes.length || view.getUint32(position, true) !== DIRECTORY_ENTRY) {
            break;
        }

        const nameLength = view.getUint16(position + 28, true);
        const extraLength = view.getUint16(position + 30, true);
        const commentLength = view.getUint16(position + 32, true);
        const name = utf8.decode(bytes.subarray(position + 46, position + 46 + nameLength));
        entries.set(name, {
            name,
            method: view.getUint16(position + 10, true),
            isEncrypted: (view.getUint16(position + 8, true) & 1) === 1,
            compressedSize: view.getUint32(position + 20, true),
            size: view.getUint32(position + 24, true),
            headerOffset: view.getUint32(position + 42, true),
        });
        position += 46 + nameLength + extraLength + commentLength;
    }

    if (entries.size === 0) {
        return null;
    }

    const read = (name: string): Uint8Array | null => {
        const entry = entries.get(name.replace(/^\//, ''));

        return entry == null ? null : readEntry(bytes, view, entry);
    };

    return {
        entries,
        read,
        readText: (name) => {
            const data = read(name);

            return data == null ? null : decodeXmlText(data);
        },
    };
}

function findEndOfDirectory(view: DataView): number {
    const last = view.byteLength - END_RECORD_SIZE;
    const first = Math.max(0, last - MAX_COMMENT_SIZE);

    for (let position = last; position >= first; position -= 1) {
        if (view.getUint32(position, true) === END_OF_DIRECTORY) {
            return position;
        }
    }

    return -1;
}

function readEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry): Uint8Array | null {
    const header = entry.headerOffset;

    if (entry.isEncrypted || header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL_HEADER) {
        return null;
    }

    const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
    const data = bytes.subarray(start, start + entry.compressedSize);

    if (data.length < entry.compressedSize) {
        return null;
    }

    if (entry.method === 0) {
        return data;
    }

    if (entry.method !== 8) {
        return null;
    }

    try {
        return pako.inflateRaw(data).subarray(0, entry.size);
    }
    catch {
        return null;
    }
}

function decodeXmlText(data: Uint8Array): string {
    return decodeUtf16ByMark(data) ?? utf8.decode(data);
}
