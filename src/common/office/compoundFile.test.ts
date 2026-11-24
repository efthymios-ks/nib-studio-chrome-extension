import { describe, expect, it } from 'vitest';
import { hasCompoundSignature, hasCompoundStream, readCompoundStream, tryReadCompoundFile } from './compoundFile.js';
import { buildCompoundFile } from './testing/docFixtures.js';

describe('hasCompoundSignature', () => {
    it('tells a compound file by its first eight bytes', () => {
        expect(hasCompoundSignature(buildCompoundFile({ WordDocument: Uint8Array.of(1) }))).toBe(true);
        expect(hasCompoundSignature(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true);
    });

    it('turns down other bytes, and bytes cut short before the signature ends', () => {
        expect(hasCompoundSignature(Uint8Array.of(0x50, 0x4b, 0x03, 0x04))).toBe(false);
        expect(hasCompoundSignature(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0))).toBe(false);
        expect(hasCompoundSignature(new Uint8Array())).toBe(false);
    });
});

describe('tryReadCompoundFile', () => {
    it('reads a compound file and its streams', () => {
        const container = tryReadCompoundFile(buildCompoundFile({ WordDocument: Uint8Array.of(7, 8) }));

        expect(container).not.toBeNull();
        expect(hasCompoundStream(container!, 'WordDocument')).toBe(true);
        expect(readCompoundStream(container!, 'WordDocument')).toEqual(Uint8Array.of(7, 8));
    });

    it('gives null for bytes that are no readable compound file', () => {
        const signatureOnly = Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

        expect(tryReadCompoundFile(signatureOnly)).toBeNull();
        expect(tryReadCompoundFile(new TextEncoder().encode('Plain text, not Office.'))).toBeNull();
    });
});
