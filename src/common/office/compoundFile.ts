import { CFB } from 'xlsx';

// SheetJS ships its compound-file reader untyped; this declares the part the Office readers use.
interface CompoundEntry {
    readonly name: string;
    readonly type: number;
    size: number;
    content?: ArrayLike<number>;
}

export interface CompoundFile {
    readonly FullPaths: ReadonlyArray<string>;
    readonly FileIndex: ReadonlyArray<CompoundEntry>;
}

interface CompoundLibrary {
    read(data: Uint8Array, options: { readonly type: 'array' }): CompoundFile;
    find(container: CompoundFile, path: string): CompoundEntry | null;
    write(container: CompoundFile, options: { readonly type: 'array'; readonly fileType: 'cfb' }): ArrayLike<number> | ArrayBuffer;
    readonly utils: {
        cfb_del(container: CompoundFile, path: string): boolean;
    };
}

const library = CFB as CompoundLibrary;

// The first bytes of an OLE compound file, the container of .doc, .xls and .ppt files and of encrypted Office files.
const COMPOUND_SIGNATURE: ReadonlyArray<number> = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// Whether the bytes start as an OLE compound file does.
export function hasCompoundSignature(bytes: Uint8Array): boolean {
    return COMPOUND_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// Throws when the bytes are not a readable compound file.
export function readCompoundFile(bytes: Uint8Array): CompoundFile {
    return library.read(bytes, { type: 'array' });
}

// The compound file in the bytes, or null when they are not a readable one.
export function tryReadCompoundFile(bytes: Uint8Array): CompoundFile | null {
    try {
        return readCompoundFile(bytes);
    }
    catch {
        return null;
    }
}

// A stream at the top of the compound file, such as `WordDocument`; streams of embedded objects are never matched.
export function readCompoundStream(container: CompoundFile, name: string): Uint8Array | null {
    const entry = library.find(container, `/${name}`);

    if (entry == null || entry.type !== 2 || entry.content == null) {
        return null;
    }

    return toBytes(entry.content);
}

export function hasCompoundStream(container: CompoundFile, name: string): boolean {
    return library.find(container, `/${name}`) != null;
}

// A new compound file like the one in `bytes`, with top-level streams replaced by new content, or removed for null.
export function rewriteCompoundFile(bytes: Uint8Array, changes: ReadonlyMap<string, Uint8Array | null>): Uint8Array {
    const container = readCompoundFile(bytes);

    for (const [name, content] of changes) {
        const entry = library.find(container, `/${name}`);

        if (content == null) {
            library.utils.cfb_del(container, `/${name}`);

            continue;
        }

        if (entry != null && entry.type === 2) {
            entry.content = content;
            entry.size = content.length;
        }
    }

    const written = library.write(container, { type: 'array', fileType: 'cfb' });

    return written instanceof Uint8Array ? written : new Uint8Array(written instanceof ArrayBuffer ? written : Array.from(written));
}

// A plain Uint8Array over the stream's bytes. Under Node, SheetJS hands out Buffers, whose slice() shares memory
// rather than copying, so they are viewed as plain arrays, whose slices are copies.
function toBytes(content: ArrayLike<number>): Uint8Array {
    return content instanceof Uint8Array
        ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
        : Uint8Array.from(content);
}
