// The bytes as an ArrayBuffer, such as for Web Crypto, without a copy when they already fill one.
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer;
    }

    return bytes.slice().buffer as ArrayBuffer;
}

// Whether two byte arrays hold the same bytes.
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

// The parts one after another, in one new array.
export function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> {
    const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;

    for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
    }

    return joined;
}
