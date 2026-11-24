// Integers stored most significant byte first, as image formats such as PNG and HEIF store them.
// A byte past the end reads as 0.

export function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

export function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
    const value = ((bytes[offset] ?? 0) << 24)
        | ((bytes[offset + 1] ?? 0) << 16)
        | ((bytes[offset + 2] ?? 0) << 8)
        | (bytes[offset + 3] ?? 0);

    return value >>> 0;
}
