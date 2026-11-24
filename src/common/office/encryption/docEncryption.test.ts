import { describe, expect, it } from 'vitest';
import { readDocFile } from '../docReader.js';
import { buildDocFile, buildPropertySet, buildWord6File, SUMMARY_FORMAT_ID } from '../testing/docFixtures.js';
import { encryptDocFile } from '../testing/encryptionFixtures.js';
import type { OfficeEncryption } from './officeEncryptionTypes.js';

// Room for the larger, CryptoAPI header at the start of the table stream.
const RESERVED = 256;

function plainDoc(text: string, data?: ReadonlyArray<number>): Uint8Array {
    return buildDocFile({
        pieces: [{ text, compressed: true }],
        tableReserved: RESERVED,
        summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Locked report']]),
        ...(data == null ? {} : { data }),
    });
}

function textOf(bytes: Uint8Array): string {
    const result = readDocFile(bytes);

    if (!result.ok) {
        throw new Error(result.message);
    }

    return result.document.blocks
        .flatMap((block) => (block.kind === 'paragraph' ? block.inlines : []))
        .map((inline) => (inline.kind === 'text' ? inline.text : ''))
        .join('|');
}

function encryptionOf(bytes: Uint8Array): OfficeEncryption | undefined {
    const result = readDocFile(bytes);

    return result.ok ? undefined : result.encryption;
}

describe('readDocEncryption', () => {
    it('unlocks an RC4 and an RC4 CryptoAPI document to the plain document', async () => {
        for (const scheme of ['rc4', 'cryptoapi'] as const) {
            const encrypted = encryptDocFile(plainDoc('Secret plans\rSecond line\r', [1, 2, 3, 4]), 'tika', scheme);
            const encryption = encryptionOf(encrypted);

            expect(encryption?.kind, scheme).toBe('password');

            const plain = encryption?.kind === 'password' ? await encryption.unlockAsync('tika') : null;

            expect(plain, scheme).not.toBeNull();
            expect(textOf(plain ?? new Uint8Array(0)), scheme).toBe('Secret plans|Second line');
        }
    });

    it('names the scheme, refuses a wrong password, and keeps the properties readable while locked', async () => {
        const encrypted = encryptDocFile(plainDoc('Text\r'), 'tika', 'cryptoapi');
        const result = readDocFile(encrypted);
        const encryption = result.ok ? undefined : result.encryption;

        expect(result).toMatchObject({
            ok: false,
            problem: 'encrypted',
            title: 'This document is protected with a password',
            message: 'Enter its password to open it.',
            version: 'word97',
        });
        expect(result.properties?.title).toBe('Locked report');
        expect(encryption?.scheme).toBe('RC4 CryptoAPI encryption, 128-bit key');
        expect(encryption?.kind === 'password' && await encryption.unlockAsync('TIKA')).toBeNull();
    });

    it('says a Word 6.0/95 file and an XOR-obfuscated file can\'t be opened', () => {
        const word6 = readDocFile(buildWord6File({ text: 'Secret\r', flags: 0x0100, fib: 0x0068 }));
        const obfuscated = readDocFile(buildDocFile({ pieces: [{ text: 'Secret\r', compressed: true }], flags: 0x8300 }));

        expect(word6).toMatchObject({ ok: false, title: 'This document\'s encryption isn\'t supported', encryption: { kind: 'unsupported', scheme: 'Word 6.0/95 encryption' } });
        expect(obfuscated).toMatchObject({ ok: false, encryption: { kind: 'unsupported', scheme: 'XOR obfuscation' } });
        expect(!word6.ok && word6.message).toContain('Open it in Word to read it.');
    });

    it('says a file without its table stream, or with a header it doesn\'t know, can\'t be opened', () => {
        const noTable = readDocFile(buildDocFile({ pieces: [{ text: 'Secret\r', compressed: true }], flags: 0x0300, omitTableStream: true }));
        const unknownHeader = readDocFile(buildDocFile({ pieces: [{ text: 'Secret\r', compressed: true }], flags: 0x0300, tableReserved: 64 }));

        expect(noTable).toMatchObject({ encryption: { kind: 'unsupported', scheme: 'Unknown encryption' } });
        expect(unknownHeader).toMatchObject({ encryption: { kind: 'unsupported', scheme: 'Unknown encryption (version 0.0)' } });
    });
});
