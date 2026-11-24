import { readCompoundStream, rewriteCompoundFile, type CompoundFile } from '../compoundFile.js';
import { readUint16, readUint32 } from '../../binary/littleEndian.js';
import {
    decryptRc4Stream,
    describeRc4Header,
    readBinaryRc4Header,
    unlockRc4,
    unsupportedRc4Reason,
    type BinaryRc4Header,
} from './binaryEncryption.js';
import { unsupportedEncryption, type OfficeEncryption } from './officeEncryptionTypes.js';

// The password encryption of Word 97–2003 documents ([MS-DOC] 2.2.6.2):
// the table stream starts with an RC4 or
// RC4 CryptoAPI header, and the WordDocument stream after its first bytes,
// the rest of the table stream and the Data
// stream are encrypted in 512-byte blocks. Unlocking gives a plain .doc that the reader reads as usual.

const FIB_AT = Object.freeze({
    flags: 0x0a,
    // lKey: the size of the encryption header at the start of the table stream.
    headerSize: 0x0e,
});

const FIB_FLAGS = Object.freeze({
    encrypted: 0x0100,
    tableStream: 0x0200,
    obfuscated: 0x8000,
});

// The start of the FIB stays in the clear, so a reader can tell the file is encrypted and how.
const CLEAR_FIB_BYTES = 68;
const RC4_BLOCK_SIZE = 512;

export interface DocEncryptionInput {
    // The whole file, which unlocking rewrites with its streams decrypted.
    readonly bytes: Uint8Array;
    readonly container: CompoundFile;
    readonly wordDocument: Uint8Array;
    // Word 6.0 and Word 95 encrypt differently from Word 97 and later.
    readonly isWord6: boolean;
}

// How a .doc whose FIB says it is encrypted can be opened.
export function readDocEncryption(input: DocEncryptionInput): OfficeEncryption {
    const flags = readUint16(input.wordDocument, FIB_AT.flags);

    if (input.isWord6) {
        return unsupportedEncryption(
            'Word 6.0/95 encryption',
            'It is a password-protected document from Word 6.0 or 95, whose encryption the preview can\'t open.',
        );
    }

    if ((flags & FIB_FLAGS.obfuscated) !== 0) {
        return unsupportedEncryption(
            'XOR obfuscation',
            'It is protected with the XOR obfuscation of older Word versions, which the preview can\'t open.',
        );
    }

    const tableName = (flags & FIB_FLAGS.tableStream) !== 0 ? '1Table' : '0Table';
    const table = readCompoundStream(input.container, tableName);

    if (table == null) {
        return unsupportedEncryption('Unknown encryption', 'Its encryption header is missing, so it can\'t be decrypted.');
    }

    const header = readBinaryRc4Header(table, 0);
    const reason = unsupportedRc4Reason(header);

    if (reason != null) {
        return unsupportedEncryption(describeRc4Header(header), reason);
    }

    return {
        kind: 'password',
        scheme: describeRc4Header(header),
        unlockAsync: async (password) => unlockDoc({ ...input, header, table, tableName }, password),
    };
}

interface DocUnlockInput extends DocEncryptionInput {
    readonly header: BinaryRc4Header;
    readonly table: Uint8Array;
    readonly tableName: string;
}

function unlockDoc(input: DocUnlockInput, password: string): Uint8Array | null {
    const keys = unlockRc4(input.header, password);

    if (keys == null) {
        return null;
    }

    const headerSize = readUint32(input.wordDocument, FIB_AT.headerSize);
    const wordDocument = decryptRc4Stream(input.wordDocument, keys, RC4_BLOCK_SIZE, [[CLEAR_FIB_BYTES, input.wordDocument.length]]);
    const fib = new DataView(wordDocument.buffer);
    fib.setUint16(FIB_AT.flags, readUint16(wordDocument, FIB_AT.flags) & ~(FIB_FLAGS.encrypted | FIB_FLAGS.obfuscated), true);
    fib.setUint32(FIB_AT.headerSize, 0, true);
    const changes = new Map<string, Uint8Array>([
        ['WordDocument', wordDocument],
        [input.tableName, decryptRc4Stream(input.table, keys, RC4_BLOCK_SIZE, [[headerSize, input.table.length]])],
    ]);
    const data = readCompoundStream(input.container, 'Data');

    if (data != null) {
        changes.set('Data', decryptRc4Stream(data, keys, RC4_BLOCK_SIZE, [[0, data.length]]));
    }

    return rewriteCompoundFile(input.bytes, changes);
}
