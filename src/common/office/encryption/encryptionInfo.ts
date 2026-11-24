import { AES_KEY_SIZES } from '../../crypto/aes.js';
import { parseBase64 } from '../../encoding/base64.js';
import type { HashAlgorithm } from '../../hash/hash.js';
import { parseXml, type XmlNode } from '../../paths/xmlParser.js';
import { readUint16, readUint32 } from '../../binary/littleEndian.js';
import { ALGORITHM_IDS, readCryptoApiHeader, type CryptoApiHeader } from './binaryEncryption.js';
import { unsupportedEncryption, type UnsupportedEncryption } from './officeEncryptionTypes.js';

// The EncryptionInfo stream of an encrypted OOXML file ([MS-OFFCRYPTO] 2.3.4): Agile encryption,
// described in XML,
// or Standard encryption, a CryptoAPI header with AES.

// The cipher settings Agile encryption gives the package (keyData) and the password key (encryptedKey).
export interface AgileCipher {
    readonly saltValue: Uint8Array;
    readonly hashAlgorithm: HashAlgorithm;
    readonly hashSize: number;
    readonly blockSize: number;
    readonly keyBits: number;
}

export interface AgilePasswordKey extends AgileCipher {
    readonly spinCount: number;
    readonly encryptedVerifierHashInput: Uint8Array;
    readonly encryptedVerifierHashValue: Uint8Array;
    readonly encryptedKeyValue: Uint8Array;
}

export type EncryptionInfo =
    | { readonly kind: 'agile'; readonly scheme: string; readonly keyData: AgileCipher; readonly passwordKey: AgilePasswordKey }
    | { readonly kind: 'standard'; readonly scheme: string; readonly header: CryptoApiHeader }
    | UnsupportedEncryption;

const FLAGS = Object.freeze({
    aes: 0x20,
    agile: 0x40,
});

const HASH_ALGORITHMS: Readonly<Record<string, HashAlgorithm>> = Object.freeze({
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
});

// The key size each Standard encryption AES algorithm ID stands for.
export const STANDARD_AES_BITS: ReadonlyMap<number, number> = new Map([
    [ALGORITHM_IDS.aes128, 128],
    [ALGORITHM_IDS.aes192, 192],
    [ALGORITHM_IDS.aes256, 256],
]);

const PASSWORD_ENCRYPTOR = 'http://schemas.microsoft.com/office/2006/keyEncryptor/password';
const AGILE_XML_AT = 8;
// Spin counts past this are refused, so a crafted file can't keep the preview hashing for minutes.
const MAX_SPIN_COUNT = 10_000_000;

export function readEncryptionInfo(bytes: Uint8Array): EncryptionInfo {
    const major = readUint16(bytes, 0);
    const minor = readUint16(bytes, 2);
    const flags = readUint32(bytes, 4);
    const version = `${major}.${minor}`;

    if (major === 4 && minor === 4 && (flags & FLAGS.agile) !== 0) {
        return readAgileInfo(bytes.subarray(AGILE_XML_AT));
    }

    if (minor === 2 && major >= 2 && major <= 4) {
        return readStandardInfo(bytes, flags);
    }

    if (minor === 3 && (major === 3 || major === 4)) {
        return unsupportedEncryption(
            'Extensible encryption',
            'It is encrypted by a third-party encryption provider, which only Office with that provider can open.',
        );
    }

    return unsupportedEncryption(`Unknown encryption (version ${version})`, `Its encryption has version ${version}, which isn't one the preview knows.`);
}

function readStandardInfo(bytes: Uint8Array, flags: number): EncryptionInfo {
    const header = readCryptoApiHeader(bytes, 4);

    if (header == null) {
        return unsupportedEncryption('Standard encryption', 'Its encryption header is damaged.');
    }

    const algorithmBits = STANDARD_AES_BITS.get(header.algorithmId) ?? 0;

    if ((flags & FLAGS.aes) === 0 || algorithmBits === 0) {
        return unsupportedEncryption('Standard encryption', 'It is encrypted with a cipher other than AES, which the preview can\'t decrypt.');
    }

    // The header's own key size wins; 0 means the size the algorithm stands for.
    const keyBits = header.keyBits === 0 ? algorithmBits : header.keyBits;
    const scheme = `Standard encryption, AES-${keyBits} with SHA-1`;

    if (!AES_KEY_SIZES.has(keyBits / 8)) {
        return unsupportedEncryption(scheme, `It is encrypted with ${keyBits}-bit AES, which the browser can't decrypt.`);
    }

    return { kind: 'standard', scheme, header };
}

function readAgileInfo(xmlBytes: Uint8Array): EncryptionInfo {
    const parsed = parseXml(new TextDecoder('utf-8').decode(xmlBytes));

    if (!parsed.ok) {
        return unsupportedEncryption('Agile encryption', 'Its encryption description can\'t be read.');
    }

    const keyDataNode = childNamed(parsed.root, 'keyData');
    const encryptors = childNamed(parsed.root, 'keyEncryptors')?.children ?? [];
    const passwordNode = encryptors
        .filter((encryptor) => encryptor.attributes['uri'] === PASSWORD_ENCRYPTOR)
        .map((encryptor) => childNamed(encryptor, 'encryptedKey'))
        .find((node) => node != null);

    if (keyDataNode == null) {
        return unsupportedEncryption('Agile encryption', 'Its encryption description is incomplete.');
    }

    if (passwordNode == null) {
        return unsupportedEncryption(
            'Agile encryption with a certificate',
            'It is encrypted for a digital certificate rather than a password, which the preview can\'t use.',
        );
    }

    const keyData = readCipher(keyDataNode);
    const passwordCipher = readCipher(passwordNode);
    const problem = cipherProblem(keyDataNode, keyData) ?? cipherProblem(passwordNode, passwordCipher);

    if (problem != null || keyData == null || passwordCipher == null) {
        return unsupportedEncryption('Agile encryption', problem ?? 'Its encryption description is incomplete.');
    }

    const scheme = `Agile encryption, AES-${keyData.keyBits} with ${keyData.hashAlgorithm}`;

    const spinCount = Number(passwordNode.attributes['spinCount']);

    if (!Number.isInteger(spinCount) || spinCount < 0 || spinCount > MAX_SPIN_COUNT) {
        return unsupportedEncryption(scheme, 'Its password hashing settings are out of range.');
    }

    const encryptedVerifierHashInput = base64Bytes(passwordNode.attributes['encryptedVerifierHashInput']);
    const encryptedVerifierHashValue = base64Bytes(passwordNode.attributes['encryptedVerifierHashValue']);
    const encryptedKeyValue = base64Bytes(passwordNode.attributes['encryptedKeyValue']);

    // Without these, every password would look wrong.
    if ([encryptedVerifierHashInput, encryptedVerifierHashValue, encryptedKeyValue].some((value) => value.length === 0)) {
        return unsupportedEncryption(scheme, 'Its encryption description is incomplete.');
    }

    return {
        kind: 'agile',
        scheme,
        keyData,
        passwordKey: { ...passwordCipher, spinCount, encryptedVerifierHashInput, encryptedVerifierHashValue, encryptedKeyValue },
    };
}

function childNamed(node: XmlNode, name: string): XmlNode | null {
    return node.children.find((child) => child.name.slice(child.name.indexOf(':') + 1) === name) ?? null;
}

function readCipher(node: XmlNode): AgileCipher | null {
    const hashAlgorithm = HASH_ALGORITHMS[node.attributes['hashAlgorithm'] ?? ''];
    const numbers = ['hashSize', 'blockSize', 'keyBits'].map((name) => Number(node.attributes[name]));
    const [hashSize = 0, blockSize = 0, keyBits = 0] = numbers;

    if (hashAlgorithm == null || numbers.some((value) => !Number.isInteger(value) || value <= 0)) {
        return null;
    }

    return { saltValue: base64Bytes(node.attributes['saltValue']), hashAlgorithm, hashSize, blockSize, keyBits };
}

// Why a cipher the description names can't be used, or null when it can.
function cipherProblem(node: XmlNode, cipher: AgileCipher | null): string | null {
    const algorithm = node.attributes['cipherAlgorithm'] ?? '';
    const chaining = node.attributes['cipherChaining'] ?? '';

    if (algorithm !== 'AES') {
        return `It is encrypted with ${algorithm === '' ? 'an unnamed cipher' : algorithm}, which the preview can't decrypt.`;
    }

    if (chaining !== 'ChainingModeCBC') {
        return 'It uses a cipher mode other than CBC, which the preview can\'t decrypt.';
    }

    if (HASH_ALGORITHMS[node.attributes['hashAlgorithm'] ?? ''] == null) {
        return `It uses the hash ${node.attributes['hashAlgorithm'] ?? '(none)'}, which the preview can't compute.`;
    }

    if (cipher == null) {
        return 'Its encryption settings are out of range.';
    }

    if (!AES_KEY_SIZES.has(cipher.keyBits / 8)) {
        return `It is encrypted with ${cipher.keyBits}-bit AES, which the browser can't decrypt.`;
    }

    if (cipher.blockSize !== 16 || cipher.saltValue.length === 0) {
        return 'Its encryption settings are out of range.';
    }

    return null;
}

// The bytes of a Base64 value; none for a missing or broken one.
function base64Bytes(value: string | undefined): Uint8Array {
    const parsed = parseBase64(value ?? '');

    return parsed.ok ? parsed.value : new Uint8Array(0);
}
