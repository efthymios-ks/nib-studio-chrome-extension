// Integers stored least significant byte first, as Office's binary formats store them.
// A byte past the end reads as 0, so a short record reads as zeros rather than throwing.

export function readUint16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

export function readUint32(bytes: Uint8Array, offset: number): number {
    return readInt32(bytes, offset) >>> 0;
}

export function readInt32(bytes: Uint8Array, offset: number): number {
    return readUint16(bytes, offset) | (readUint16(bytes, offset + 2) << 16);
}

export function readInt16(bytes: Uint8Array, offset: number): number {
    const value = readUint16(bytes, offset);

    return value >= 0x8000 ? value - 0x10000 : value;
}
