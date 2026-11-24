import { describe, expect, it } from 'vitest';
import { CFB } from 'xlsx';
import { buildAgileEncryptedAsync, buildStandardEncryptedAsync, encryptionInfoStream } from '../testing/encryptionFixtures.js';
import { readEncryptionInfo } from './encryptionInfo.js';

const compound = CFB as unknown as {
    read(data: Uint8Array, options: { readonly type: 'array' }): unknown;
    find(container: unknown, path: string): { readonly content: ArrayLike<number> } | null;
};

function infoOf(file: Uint8Array): Uint8Array {
    return Uint8Array.from(compound.find(compound.read(file, { type: 'array' }), '/EncryptionInfo')?.content ?? []);
}

function agileXml(keyData: string, encryptors: string): Uint8Array {
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password">',
        `<keyData ${keyData}/>`,
        `<keyEncryptors>${encryptors}</keyEncryptors>`,
        '</encryption>',
    ].join('');

    return encryptionInfoStream(4, 4, 0x40, new TextEncoder().encode(xml));
}

const AES_256 = 'saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="AAECAwQFBgcICQoLDA0ODw=="';

describe('readEncryptionInfo', () => {
    it('reads Agile encryption with its password key', async () => {
        const info = readEncryptionInfo(infoOf(await buildAgileEncryptedAsync({ password: 'pw', plain: Uint8Array.of(1), spinCount: 7 })));

        expect(info.kind).toBe('agile');
        expect(info.scheme).toBe('Agile encryption, AES-256 with SHA-512');
        expect(info.kind === 'agile' && info.passwordKey).toMatchObject({ spinCount: 7, hashAlgorithm: 'SHA-512', keyBits: 256, hashSize: 64 });
    });

    it('reads Standard encryption', async () => {
        const info = readEncryptionInfo(infoOf(await buildStandardEncryptedAsync({ password: 'pw', plain: Uint8Array.of(1), keyBits: 256 })));

        expect(info).toMatchObject({ kind: 'standard', scheme: 'Standard encryption, AES-256 with SHA-1' });
    });

    it('says extensible encryption and unknown versions can\'t be opened', () => {
        expect(readEncryptionInfo(encryptionInfoStream(4, 3, 0, new Uint8Array(16)))).toMatchObject({
            kind: 'unsupported',
            scheme: 'Extensible encryption',
        });
        expect(readEncryptionInfo(encryptionInfoStream(9, 9, 0, new Uint8Array(16)))).toEqual({
            kind: 'unsupported',
            scheme: 'Unknown encryption (version 9.9)',
            reason: 'Its encryption has version 9.9, which isn\'t one the preview knows.',
        });
    });

    it('says a certificate-only file, another cipher, another mode, AES-192 or bad XML can\'t be opened', () => {
        const certificate = agileXml(AES_256, '<keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate"/>');
        const password = (keyData: string): Uint8Array => agileXml(keyData, [
            '<keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">',
            `<p:encryptedKey spinCount="10" ${AES_256}/>`,
            '</keyEncryptor>',
        ].join(''));

        expect(readEncryptionInfo(certificate)).toMatchObject({ kind: 'unsupported', scheme: 'Agile encryption with a certificate' });
        expect(readEncryptionInfo(password(AES_256.replace('"AES"', '"3DES"')))).toMatchObject({
            kind: 'unsupported',
            reason: 'It is encrypted with 3DES, which the preview can\'t decrypt.',
        });
        expect(readEncryptionInfo(password(AES_256.replace('ChainingModeCBC', 'ChainingModeCFB')))).toMatchObject({
            reason: 'It uses a cipher mode other than CBC, which the preview can\'t decrypt.',
        });
        expect(readEncryptionInfo(password(AES_256.replace('keyBits="256"', 'keyBits="192"')))).toMatchObject({
            reason: 'It is encrypted with 192-bit AES, which the browser can\'t decrypt.',
        });
        expect(readEncryptionInfo(password(AES_256.replace('SHA512', 'WHIRLPOOL')))).toMatchObject({
            reason: 'It uses the hash WHIRLPOOL, which the preview can\'t compute.',
        });
        expect(readEncryptionInfo(encryptionInfoStream(4, 4, 0x40, new TextEncoder().encode('<encryption')))).toMatchObject({
            kind: 'unsupported',
        });
    });

    it('refuses a spin count past what a real file uses', () => {
        const info = agileXml(AES_256, [
            '<keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">',
            `<p:encryptedKey spinCount="99000000" ${AES_256}/>`,
            '</keyEncryptor>',
        ].join(''));

        expect(readEncryptionInfo(info)).toMatchObject({ kind: 'unsupported', reason: 'Its password hashing settings are out of range.' });
    });
});
