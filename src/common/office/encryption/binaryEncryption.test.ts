import { describe, expect, it } from 'vitest';
import { Rc4 } from '../../crypto/rc4.js';
import { binaryEncryptionHeader } from '../testing/encryptionFixtures.js';
import { u16, u32 } from '../testing/docFixtures.js';
import {
    decryptRc4Stream,
    describeRc4Header,
    readBinaryRc4Header,
    unlockRc4,
    unsupportedRc4Reason,
} from './binaryEncryption.js';

describe('readBinaryRc4Header', () => {
    it('reads an RC4 header and a CryptoAPI header', () => {
        const rc4 = readBinaryRc4Header(binaryEncryptionHeader('pw', 'rc4').bytes, 0);
        const cryptoApi = readBinaryRc4Header(binaryEncryptionHeader('pw', 'cryptoapi').bytes, 0);

        expect(rc4.kind).toBe('rc4');
        expect(cryptoApi).toMatchObject({ kind: 'cryptoapi', algorithmId: 0x6801, hashAlgorithmId: 0x8004, keyBits: 128, verifierHashSize: 20 });
        expect(describeRc4Header(rc4)).toBe('RC4 encryption');
        expect(describeRc4Header(cryptoApi)).toBe('RC4 CryptoAPI encryption, 128-bit key');
    });

    it('reads its header at an offset, as a workbook\'s FILEPASS record holds it', () => {
        const header = binaryEncryptionHeader('pw', 'rc4').bytes;

        expect(readBinaryRc4Header(Uint8Array.of(1, 0, ...header), 2).kind).toBe('rc4');
    });

    it('names a version it doesn\'t know, and a header cut short', () => {
        const unknown = readBinaryRc4Header(Uint8Array.of(...u16(5), ...u16(5), ...new Array(60).fill(0)), 0);

        expect(unknown).toEqual({ kind: 'unknown', version: '5.5' });
        expect(unsupportedRc4Reason(unknown)).toBe('Its encryption header has version 5.5, which isn\'t one the preview knows.');
        expect(describeRc4Header(unknown)).toBe('Unknown encryption (version 5.5)');
        expect(readBinaryRc4Header(Uint8Array.of(...u16(1), ...u16(1), 1, 2, 3), 0).kind).toBe('unknown');
    });

    it('says why a CryptoAPI header with another cipher or hash can\'t be opened', () => {
        const header = binaryEncryptionHeader('pw', 'cryptoapi').bytes;
        const withAlgorithm = (at: number, value: number): Uint8Array => {
            const changed = Uint8Array.from(header);
            changed.set(u32(value), at);

            return changed;
        };
        // The header's AlgID sits 20 bytes in, after the version, flags, size, header flags and SizeExtra.
        const aes = readBinaryRc4Header(withAlgorithm(20, 0x660e), 0);
        const md5 = readBinaryRc4Header(withAlgorithm(24, 0x8003), 0);

        expect(unsupportedRc4Reason(aes)).toContain('a cipher other than RC4');
        expect(unsupportedRc4Reason(md5)).toContain('a hash other than SHA-1');
        expect(unlockRc4(aes, 'pw')).toBeNull();
    });
});

describe('unlockRc4', () => {
    it('gives the block keys for the right password and null for a wrong one', () => {
        for (const scheme of ['rc4', 'cryptoapi'] as const) {
            const fixture = binaryEncryptionHeader('Pässwort', scheme);
            const header = readBinaryRc4Header(fixture.bytes, 0);
            const keys = unlockRc4(header, 'Pässwort');

            expect(unlockRc4(header, 'passwort'), scheme).toBeNull();
            expect(keys?.(3), scheme).toEqual(fixture.keys(3));
        }
    });

    it('pads a 40-bit CryptoAPI key with zeros to 128 bits', () => {
        const fixture = binaryEncryptionHeader('pw', 'cryptoapi', 40);
        const keys = unlockRc4(readBinaryRc4Header(fixture.bytes, 0), 'pw');

        expect(keys?.(0)).toHaveLength(16);
        expect([...keys?.(0).subarray(5) ?? []]).toEqual(new Array(11).fill(0));
    });
});

describe('decryptRc4Stream', () => {
    it('uses each block\'s keystream at the byte\'s offset, and leaves clear ranges alone', () => {
        const keys = (block: number): Uint8Array => Uint8Array.of(block + 1, 7, 7);
        const plain = Uint8Array.from({ length: 40 }, (_, index) => index);
        const keystream = (block: number, length: number): Uint8Array => new Rc4(keys(block)).apply(new Uint8Array(length));
        const encrypted = Uint8Array.from(plain);
        const first = keystream(0, 16);
        const second = keystream(1, 16);
        const third = keystream(2, 8);

        for (let index = 4; index < 40; index += 1) {
            const stream = index < 16 ? first : index < 32 ? second : third;
            encrypted[index] = (plain[index] ?? 0) ^ (stream[index % 16] ?? 0);
        }

        expect(decryptRc4Stream(encrypted, keys, 16, [[4, 40]])).toEqual(plain);
        expect(decryptRc4Stream(encrypted, keys, 16, [[4, 40]]).subarray(0, 4)).toEqual(encrypted.subarray(0, 4));
    });
});
