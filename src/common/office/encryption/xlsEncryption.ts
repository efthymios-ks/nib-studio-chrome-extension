import { hasCompoundStream, readCompoundStream, rewriteCompoundFile, type CompoundFile } from '../compoundFile.js';
import { readUint16 } from '../../binary/littleEndian.js';
import {
    decryptRc4Stream,
    describeRc4Header,
    readBinaryRc4Header,
    unlockRc4,
    unsupportedRc4Reason,
    type BinaryRc4Header,
} from './binaryEncryption.js';
import { unsupportedEncryption, type OfficeEncryption } from './officeEncryptionTypes.js';
import { createXorArray, createXorKey, createXorVerifier, decryptXorByte, xorPasswordBytes } from './xorObfuscation.js';

// The password encryption of Excel 97–2003 workbooks ([MS-XLS] 2.2.10):
// a FILEPASS record near the start of the
// Workbook stream, and every record after it encrypted with RC4, RC4 through CryptoAPI, or XOR obfuscation.
// Record headers and a few records stay in the clear. Unlocking gives a plain workbook that SheetJS reads as usual.

const RECORD_TYPES = Object.freeze({
    bof: 0x0809,
    eof: 0x000a,
    filePass: 0x002f,
    boundSheet: 0x0085,
});

// The records that stay in the clear after FILEPASS: BOF, FILEPASS, UsrExcl, FileLock, InterfaceHdr,
// RRDInfo and RRDHead.
const CLEAR_RECORDS: ReadonlySet<number> = new Set([RECORD_TYPES.bof, RECORD_TYPES.filePass, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138]);

// A BoundSheet8 record keeps its first field, the sheet's stream position, in the clear.
const BOUND_SHEET_CLEAR_BYTES = 4;
const RECORD_HEADER_SIZE = 4;
const BIFF8_VERSION = 0x0600;
const RC4_BLOCK_SIZE = 1024;
const ENCRYPTION_TYPES = Object.freeze({
    xor: 0,
    rc4: 1,
});

// Once decrypted, FILEPASS becomes an InterfaceEnd record of the same length, which readers skip,
// so every stream
// position the workbook records stays right.
const FILE_PASS_STAND_IN = 0x00e2;

interface WorkbookRecord {
    readonly type: number;
    readonly at: number;
    readonly dataStart: number;
    readonly size: number;
}

interface EncryptedRange {
    readonly start: number;
    readonly end: number;
    readonly recordSize: number;
}

export function readXlsEncryption(bytes: Uint8Array, container: CompoundFile): OfficeEncryption | null {
    const streamName = hasCompoundStream(container, 'Workbook') ? 'Workbook' : 'Book';
    const stream = readCompoundStream(container, streamName);

    if (stream == null) {
        return null;
    }

    const records = readRecords(stream);
    const filePassIndex = globalsFilePassIndex(records);
    const filePass = records[filePassIndex];
    const first = records[0];

    if (filePass == null || first == null) {
        return null;
    }

    if (first.type !== RECORD_TYPES.bof || readUint16(stream, first.dataStart) !== BIFF8_VERSION) {
        return unsupportedEncryption(
            'Excel 5.0/95 encryption',
            'It is a password-protected workbook from Excel 5.0 or 95, whose encryption the preview can\'t open.',
        );
    }

    const data = stream.subarray(filePass.dataStart, filePass.dataStart + filePass.size);
    const encryptionType = readUint16(data, 0);
    const encrypted = records.slice(filePassIndex + 1);
    const finish = (plain: Uint8Array): Uint8Array => {
        plain[filePass.at] = FILE_PASS_STAND_IN & 0xff;
        plain[filePass.at + 1] = FILE_PASS_STAND_IN >>> 8;

        // A CryptoAPI workbook may keep its encrypted properties in a stream named "encryption",
        // which readers refuse.
        return rewriteCompoundFile(bytes, new Map([[streamName, plain], ['encryption', null]]));
    };

    if (encryptionType === ENCRYPTION_TYPES.xor) {
        return passwordLock('XOR obfuscation', (password) => decryptXor(stream, encrypted, data, password), finish);
    }

    if (encryptionType !== ENCRYPTION_TYPES.rc4) {
        return unsupportedEncryption('Unknown encryption', `Its encryption type ${encryptionType} isn't one the preview knows.`);
    }

    const header = readBinaryRc4Header(data, 2);
    const reason = unsupportedRc4Reason(header);

    if (reason != null) {
        return unsupportedEncryption(describeRc4Header(header), reason);
    }

    return passwordLock(describeRc4Header(header), (password) => decryptRc4(stream, encrypted, header, password), finish);
}

function passwordLock(
    scheme: string,
    decrypt: (password: string) => Uint8Array | null,
    finish: (plain: Uint8Array) => Uint8Array,
): OfficeEncryption {
    return {
        kind: 'password',
        scheme,
        unlockAsync: async (password) => {
            const plain = decrypt(password);

            return plain == null ? null : finish(plain);
        },
    };
}

function readRecords(stream: Uint8Array): WorkbookRecord[] {
    const records: WorkbookRecord[] = [];

    for (let at = 0; at + RECORD_HEADER_SIZE <= stream.length;) {
        const size = readUint16(stream, at + 2);
        records.push({ type: readUint16(stream, at), at, dataStart: at + RECORD_HEADER_SIZE, size });
        at += RECORD_HEADER_SIZE + size;
    }

    return records;
}

// FILEPASS sits in the workbook globals, before their EOF; -1 when there is none.
function globalsFilePassIndex(records: ReadonlyArray<WorkbookRecord>): number {
    const globalsEnd = records.findIndex((record) => record.type === RECORD_TYPES.eof);
    const globals = globalsEnd < 0 ? records : records.slice(0, globalsEnd);

    return globals.findIndex((record) => record.type === RECORD_TYPES.filePass);
}

// The byte ranges after FILEPASS that hold ciphertext, with the size of the record each lies in.
function encryptedRanges(records: ReadonlyArray<WorkbookRecord>): EncryptedRange[] {
    return records
        .filter((record) => !CLEAR_RECORDS.has(record.type))
        .map((record) => {
            const clear = record.type === RECORD_TYPES.boundSheet ? BOUND_SHEET_CLEAR_BYTES : 0;

            return { start: record.dataStart + Math.min(clear, record.size), end: record.dataStart + record.size, recordSize: record.size };
        });
}

function decryptRc4(
    stream: Uint8Array,
    records: ReadonlyArray<WorkbookRecord>,
    header: BinaryRc4Header,
    password: string,
): Uint8Array | null {
    const keys = unlockRc4(header, password);
    const ranges = encryptedRanges(records).map((range) => [range.start, range.end] as const);

    return keys == null ? null : decryptRc4Stream(stream, keys, RC4_BLOCK_SIZE, ranges);
}

// Each byte is XORed with the array entry at its stream position plus the size of its record.
function decryptXor(
    stream: Uint8Array,
    records: ReadonlyArray<WorkbookRecord>,
    filePass: Uint8Array,
    password: string,
): Uint8Array | null {
    const passwordData = xorPasswordBytes(password);

    if (createXorKey(passwordData) !== readUint16(filePass, 2) || createXorVerifier(passwordData) !== readUint16(filePass, 4)) {
        return null;
    }

    const array = createXorArray(passwordData);
    const plain = Uint8Array.from(stream);

    for (const range of encryptedRanges(records)) {
        for (let index = range.start; index < range.end; index += 1) {
            plain[index] = decryptXorByte(stream[index] ?? 0, array, index + range.recordSize);
        }
    }

    return plain;
}
