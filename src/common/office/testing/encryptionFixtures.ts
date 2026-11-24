import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { CFB } from 'xlsx';
import { concatBytes } from '../../binary/bytes.js';
import { Rc4 } from '../../crypto/rc4.js';
import { digestSync } from '../../hash/syncDigest.js';
import { decryptRc4Stream } from '../encryption/binaryEncryption.js';
import { littleEndian32, passwordBytes, sizedTo, spinPasswordHash } from '../encryption/passwordKeys.js';
import { createXorArray, createXorKey, createXorVerifier, xorPasswordBytes } from '../encryption/xorObfuscation.js';
import { buildCompoundFile, u16, u32 } from './docFixtures.js';

// Encrypts files the way Office does, for tests: OOXML packages with Agile or Standard encryption through Web Crypto,
// Word 97–2003 documents and Excel 97–2003 workbooks with RC4, RC4 CryptoAPI or XOR obfuscation.
// RC4 is symmetric, so the reader's stream routine encrypts too; the keys are derived here on their own.

const BLOCK = 16;
const SEGMENT_SIZE = 4096;
const CLEAR_FIB_BYTES = 68;
const DOC_BLOCK_SIZE = 512;
const XLS_BLOCK_SIZE = 1024;
const AGILE_BLOCK_KEYS = [
    Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79),
    Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e),
    Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6),
] as const;
const HASHES = Object.freeze({
    SHA1: { algorithm: 'SHA-1', size: 20 },
    SHA512: { algorithm: 'SHA-512', size: 64 },
} as const);

// Stand-ins for the random salts and keys Office makes up.
export function patternBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.from({ length }, (_, index) => (index * 73 + seed * 31 + 11) & 0xff);
}

function padToBlock(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const padded = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
    padded.set(bytes);

    return padded;
}

function base64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
}

function littleEndian64(value: number): number[] {
    return [...u32(value % 0x100000000), ...u32(Math.floor(value / 0x100000000))];
}

async function encryptAesCbcAsync(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const cryptoKey = await crypto.subtle.importKey('raw', Uint8Array.from(key), 'AES-CBC', false, ['encrypt']);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: Uint8Array.from(iv) }, cryptoKey, Uint8Array.from(data)));

    // Office data has no padding block.
    return encrypted.slice(0, data.length);
}

async function encryptAesEcbAsync(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const blocks: Uint8Array[] = [];

    for (let offset = 0; offset < data.length; offset += BLOCK) {
        blocks.push(await encryptAesCbcAsync(key, new Uint8Array(BLOCK), data.subarray(offset, offset + BLOCK)));
    }

    return concatBytes(blocks);
}

// An EncryptionInfo stream: its version, its flags and what follows them.
export function encryptionInfoStream(major: number, minor: number, flags: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
    return Uint8Array.from([...u16(major), ...u16(minor), ...u32(flags), ...body]);
}

// The compound file an encrypted OOXML file is: its EncryptionInfo, its EncryptedPackage and anything else given.
export function encryptedPackageFile(
    info: Uint8Array,
    encryptedPackage: Uint8Array,
    extra: Readonly<Record<string, Uint8Array>> = {},
): Uint8Array<ArrayBuffer> {
    return buildCompoundFile({ EncryptionInfo: info, EncryptedPackage: encryptedPackage, ...extra });
}

export interface AgileFixture {
    readonly password: string;
    readonly plain: Uint8Array;
    readonly hash?: keyof typeof HASHES;
    readonly keyBits?: 128 | 256;
    readonly spinCount?: number;
}

// An OOXML package with Agile encryption ([MS-OFFCRYPTO] 2.3.4.10–2.3.4.13), in 4096-byte segments.
export async function buildAgileEncryptedAsync(fixture: AgileFixture): Promise<Uint8Array<ArrayBuffer>> {
    const hash = HASHES[fixture.hash ?? 'SHA512'];
    const keyBits = fixture.keyBits ?? 256;
    const spinCount = fixture.spinCount ?? 1000;
    const keyDataSalt = patternBytes(16, 1);
    const passwordSalt = patternBytes(16, 2);
    const secretKey = patternBytes(keyBits / 8, 3);
    const verifierInput = patternBytes(16, 4);
    const spun = spinPasswordHash(hash.algorithm, passwordSalt, fixture.password, spinCount);
    const [inputKey, valueKey, keyKey] = AGILE_BLOCK_KEYS.map((blockKey) => sizedTo(digestSync(hash.algorithm, spun, blockKey), keyBits / 8, 0x36));
    const encryptedInput = await encryptAesCbcAsync(inputKey ?? new Uint8Array(0), passwordSalt, verifierInput);
    const encryptedValue = await encryptAesCbcAsync(valueKey ?? new Uint8Array(0), passwordSalt, padToBlock(digestSync(hash.algorithm, verifierInput)));
    const encryptedKey = await encryptAesCbcAsync(keyKey ?? new Uint8Array(0), passwordSalt, secretKey);
    const segments: Uint8Array[] = [];

    for (let start = 0, segment = 0; start < fixture.plain.length; start += SEGMENT_SIZE, segment += 1) {
        const iv = sizedTo(digestSync(hash.algorithm, keyDataSalt, littleEndian32(segment)), BLOCK, 0x36);
        segments.push(await encryptAesCbcAsync(secretKey, iv, padToBlock(fixture.plain.subarray(start, start + SEGMENT_SIZE))));
    }

    const cipher = (salt: Uint8Array): string => [
        `saltSize="16" blockSize="16" keyBits="${keyBits}" hashSize="${hash.size}" cipherAlgorithm="AES"`,
        `cipherChaining="ChainingModeCBC" hashAlgorithm="${fixture.hash ?? 'SHA512'}" saltValue="${base64(salt)}"`,
    ].join(' ');
    const xml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption"',
        ' xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password">',
        `<keyData ${cipher(keyDataSalt)}/>`,
        '<dataIntegrity encryptedHmacKey="" encryptedHmacValue=""/>',
        '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">',
        `<p:encryptedKey spinCount="${spinCount}" ${cipher(passwordSalt)}`,
        ` encryptedVerifierHashInput="${base64(encryptedInput)}" encryptedVerifierHashValue="${base64(encryptedValue)}"`,
        ` encryptedKeyValue="${base64(encryptedKey)}"/>`,
        '</keyEncryptor></keyEncryptors></encryption>',
    ].join('');
    const info = encryptionInfoStream(4, 4, 0x40, new TextEncoder().encode(xml));

    return encryptedPackageFile(info, Uint8Array.from([...littleEndian64(fixture.plain.length), ...concatBytes(segments)]));
}

export interface StandardFixture {
    readonly password: string;
    readonly plain: Uint8Array;
    readonly keyBits?: 128 | 256;
}

// An OOXML package with Standard encryption ([MS-OFFCRYPTO] 2.3.4.5–2.3.4.9), all of it AES-ECB.
export async function buildStandardEncryptedAsync(fixture: StandardFixture): Promise<Uint8Array<ArrayBuffer>> {
    const keyBits = fixture.keyBits ?? 128;
    const salt = patternBytes(16, 5);
    const verifier = patternBytes(16, 6);
    const key = standardKey(salt, fixture.password, keyBits);
    const encryptedVerifier = await encryptAesEcbAsync(key, verifier);
    const encryptedVerifierHash = await encryptAesEcbAsync(key, padToBlock(digestSync('SHA-1', verifier)));
    const header = cryptoApiHeader({ flags: 0x24, algorithmId: keyBits === 256 ? 0x6610 : 0x660e, keyBits, provider: 'Microsoft Enhanced RSA and AES Cryptographic Provider' });
    const info = encryptionInfoStream(4, 2, 0x24, Uint8Array.from([
        ...u32(header.length),
        ...header,
        ...u32(16),
        ...salt,
        ...encryptedVerifier,
        ...u32(20),
        ...encryptedVerifierHash,
    ]));
    const encrypted = await encryptAesEcbAsync(key, padToBlock(fixture.plain));

    return encryptedPackageFile(info, Uint8Array.from([...littleEndian64(fixture.plain.length), ...encrypted]));
}

function standardKey(salt: Uint8Array, password: string, keyBits: number): Uint8Array {
    const final = digestSync('SHA-1', spinPasswordHash('SHA-1', salt, password, 50_000), littleEndian32(0));
    const stretched = (fill: number): Uint8Array => digestSync('SHA-1', Uint8Array.from({ length: 64 }, (_, index) => fill ^ (final[index] ?? 0)));

    return concatBytes([stretched(0x36), stretched(0x5c)]).slice(0, keyBits / 8);
}

interface CryptoApiHeaderInput {
    readonly flags: number;
    readonly algorithmId: number;
    readonly keyBits: number;
    readonly provider: string;
}

function cryptoApiHeader(input: CryptoApiHeaderInput): number[] {
    return [
        ...u32(input.flags),
        ...u32(0),
        ...u32(input.algorithmId),
        ...u32(0x8004),
        ...u32(input.keyBits),
        ...u32(0x18),
        ...u32(0),
        ...u32(0),
        ...passwordBytes(`${input.provider}\u0000`),
    ];
}

export type BinaryScheme = 'rc4' | 'cryptoapi';

interface BinaryHeader {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly keys: (block: number) => Uint8Array;
}

// The RC4 (1.1) or RC4 CryptoAPI (4.2) header of a binary file, with the block keys of the password.
export function binaryEncryptionHeader(password: string, scheme: BinaryScheme, keyBits = 128): BinaryHeader {
    const salt = patternBytes(16, 7);
    const verifier = patternBytes(16, 8);

    if (scheme === 'rc4') {
        const first = digestSync('MD5', passwordBytes(password)).subarray(0, 5);
        const base = digestSync('MD5', concatBytes(new Array<Uint8Array>(16).fill(concatBytes([first, salt])))).subarray(0, 5);
        const keys = (block: number): Uint8Array => digestSync('MD5', base, littleEndian32(block));
        const cipher = new Rc4(keys(0));
        const encryptedVerifier = cipher.apply(verifier.slice());
        const encryptedHash = cipher.apply(digestSync('MD5', verifier));

        return { bytes: Uint8Array.from([...u16(1), ...u16(1), ...salt, ...encryptedVerifier, ...encryptedHash]), keys };
    }

    const base = digestSync('SHA-1', salt, passwordBytes(password));
    const keys = (block: number): Uint8Array => sizedTo(digestSync('SHA-1', base, littleEndian32(block)).slice(0, keyBits / 8), 16, 0);
    const cipher = new Rc4(keys(0));
    const encryptedVerifier = cipher.apply(verifier.slice());
    const encryptedHash = cipher.apply(digestSync('SHA-1', verifier));
    const header = cryptoApiHeader({ flags: 0x04, algorithmId: 0x6801, keyBits, provider: 'Microsoft Enhanced Cryptographic Provider v1.0' });

    return {
        bytes: Uint8Array.from([
            ...u16(4),
            ...u16(2),
            ...u32(0x04),
            ...u32(header.length),
            ...header,
            ...u32(16),
            ...salt,
            ...encryptedVerifier,
            ...u32(20),
            ...encryptedHash,
        ]),
        keys,
    };
}

interface WritableEntry {
    content: ArrayLike<number>;
    size: number;
}

interface WritableCompound {
    readonly FullPaths: ReadonlyArray<string>;
}

const compound = CFB as unknown as {
    read(data: Uint8Array, options: { readonly type: 'array' }): WritableCompound;
    find(container: WritableCompound, path: string): WritableEntry | null;
    write(container: WritableCompound, options: { readonly type: 'array'; readonly fileType: 'cfb' }): ArrayLike<number> | ArrayBuffer;
};

function replaceStreams(bytes: Uint8Array, streams: ReadonlyMap<string, Uint8Array>): Uint8Array<ArrayBuffer> {
    const container = compound.read(bytes, { type: 'array' });

    for (const [name, content] of streams) {
        const entry = compound.find(container, `/${name}`);

        if (entry == null) {
            throw new Error(`The compound file has no ${name} stream.`);
        }

        entry.content = content;
        entry.size = content.length;
    }

    const written = compound.write(container, { type: 'array', fileType: 'cfb' });

    return written instanceof ArrayBuffer ? new Uint8Array(written) : Uint8Array.from(written);
}

function streamOf(bytes: Uint8Array, name: string): Uint8Array<ArrayBuffer> {
    const entry = compound.find(compound.read(bytes, { type: 'array' }), `/${name}`);

    if (entry == null) {
        throw new Error(`The compound file has no ${name} stream.`);
    }

    return Uint8Array.from(entry.content);
}

// Encrypts a .doc built with `tableReserved` room for the header at the start of its table stream, as Word 97–2003 does.
export function encryptDocFile(plainDoc: Uint8Array, password: string, scheme: BinaryScheme = 'rc4'): Uint8Array<ArrayBuffer> {
    const wordDocument = streamOf(plainDoc, 'WordDocument');
    const view = new DataView(wordDocument.buffer);
    const flags = view.getUint16(0x0a, true);
    const tableName = (flags & 0x0200) !== 0 ? '1Table' : '0Table';
    const table = streamOf(plainDoc, tableName);
    const header = binaryEncryptionHeader(password, scheme);
    view.setUint16(0x0a, flags | 0x0100, true);
    view.setUint32(0x0e, header.bytes.length, true);
    table.set(header.bytes, 0);
    const streams = new Map<string, Uint8Array>([
        ['WordDocument', decryptRc4Stream(wordDocument, header.keys, DOC_BLOCK_SIZE, [[CLEAR_FIB_BYTES, wordDocument.length]])],
        [tableName, decryptRc4Stream(table, header.keys, DOC_BLOCK_SIZE, [[header.bytes.length, table.length]])],
    ]);
    const container = compound.read(plainDoc, { type: 'array' });

    if (compound.find(container, '/Data') != null) {
        const data = streamOf(plainDoc, 'Data');
        streams.set('Data', decryptRc4Stream(data, header.keys, DOC_BLOCK_SIZE, [[0, data.length]]));
    }

    return replaceStreams(plainDoc, streams);
}

export type WorkbookScheme = BinaryScheme | 'xor';

// The records Excel never encrypts after FILEPASS.
const CLEAR_RECORDS: ReadonlySet<number> = new Set([0x0809, 0x002f, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138]);

interface WorkbookRecord {
    readonly type: number;
    readonly data: Uint8Array;
}

// An Excel 97–2003 workbook of one sheet named "Data", written by SheetJS, then encrypted as Excel does:
// a FILEPASS record after the first BOF and every record after it encrypted, apart from the ones Excel leaves clear.
export function buildEncryptedWorkbook(rows: ReadonlyArray<ReadonlyArray<unknown>>, password: string, scheme: WorkbookScheme): Uint8Array<ArrayBuffer> {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows.map((row) => [...row])), 'Data');
    const plain = new Uint8Array(XLSX.write(book, { bookType: 'biff8', type: 'array' }) as ArrayBuffer);
    const records = readWorkbookRecords(streamOf(plain, 'Workbook'));
    const header = scheme === 'xor' ? null : binaryEncryptionHeader(password, scheme);
    const passwordData = xorPasswordBytes(password);
    const filePassData = header == null
        ? Uint8Array.from([...u16(0), ...u16(createXorKey(passwordData)), ...u16(createXorVerifier(passwordData))])
        : Uint8Array.from([...u16(1), ...header.bytes]);
    const filePassLength = 4 + filePassData.length;
    const withFilePass: WorkbookRecord[] = [records[0] ?? { type: 0x0809, data: new Uint8Array(16) }, { type: 0x002f, data: filePassData }, ...records.slice(1)];

    // Each BoundSheet8 records where its sheet starts, which the new record moves along.
    for (const record of withFilePass) {
        if (record.type === 0x0085) {
            const position = new DataView(record.data.buffer, record.data.byteOffset);
            position.setUint32(0, position.getUint32(0, true) + filePassLength, true);
        }
    }

    const stream = Uint8Array.from(withFilePass.flatMap((record) => [...u16(record.type), ...u16(record.data.length), ...record.data]));
    const ranges: Array<{ readonly start: number; readonly end: number; readonly size: number }> = [];
    let at = 0;

    for (const [index, record] of withFilePass.entries()) {
        const dataStart = at + 4;
        at = dataStart + record.data.length;

        if (index > 1 && !CLEAR_RECORDS.has(record.type)) {
            ranges.push({ start: dataStart + (record.type === 0x0085 ? 4 : 0), end: at, size: record.data.length });
        }
    }

    const encrypted = header == null
        ? xorEncrypt(stream, ranges, createXorArray(passwordData))
        : decryptRc4Stream(stream, header.keys, XLS_BLOCK_SIZE, ranges.map((range) => [range.start, range.end] as const));

    return replaceStreams(plain, new Map([['Workbook', encrypted]]));
}

function readWorkbookRecords(stream: Uint8Array): WorkbookRecord[] {
    const records: WorkbookRecord[] = [];

    for (let at = 0; at + 4 <= stream.length;) {
        const size = (stream[at + 2] ?? 0) | ((stream[at + 3] ?? 0) << 8);
        records.push({ type: (stream[at] ?? 0) | ((stream[at + 1] ?? 0) << 8), data: stream.slice(at + 4, at + 4 + size) });
        at += 4 + size;
    }

    return records;
}

// The inverse of the reader's transform: XOR with the array entry, then rotate right by three bits.
function xorEncrypt(stream: Uint8Array, ranges: ReadonlyArray<{ readonly start: number; readonly end: number; readonly size: number }>, array: Uint8Array): Uint8Array {
    const encrypted = Uint8Array.from(stream);

    for (const range of ranges) {
        for (let index = range.start; index < range.end; index += 1) {
            const mixed = ((stream[index] ?? 0) ^ (array[(index + range.size) & 15] ?? 0)) & 0xff;
            encrypted[index] = ((mixed >>> 3) | (mixed << 5)) & 0xff;
        }
    }

    return encrypted;
}

// A small DOCX package with one paragraph, for encrypting.
export async function buildTinyDocxAsync(text: string): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('_rels/.rels', [
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>',
        '</Relationships>',
    ].join(''));
    zip.file('word/document.xml', [
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
        '</w:body></w:document>',
    ].join(''));

    return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
}

// A small XLSX workbook of one sheet, for encrypting.
export function buildTinyXlsx(rows: ReadonlyArray<ReadonlyArray<unknown>>): Uint8Array {
    return buildTinyWorkbook(rows, 'xlsx');
}

// A one-sheet workbook as SheetJS writes it in the given format, such as xlsm, xlsb or ods.
export function buildTinyWorkbook(rows: ReadonlyArray<ReadonlyArray<unknown>>, bookType: XLSX.BookType): Uint8Array {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows.map((row) => [...row])), 'Data');

    return new Uint8Array(XLSX.write(book, { bookType, type: 'array' }) as ArrayBuffer);
}
