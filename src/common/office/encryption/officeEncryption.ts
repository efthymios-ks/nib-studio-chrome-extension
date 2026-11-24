import {
    hasCompoundSignature,
    hasCompoundStream,
    readCompoundStream,
    tryReadCompoundFile,
    type CompoundFile,
} from '../compoundFile.js';
import { isZip } from '../zipPackage.js';
import { unlockAgilePackageAsync } from './agileEncryption.js';
import { readEncryptionInfo } from './encryptionInfo.js';
import { unsupportedEncryption, type OfficeEncryption } from './officeEncryptionTypes.js';
import { unlockStandardPackageAsync } from './standardEncryption.js';
import { readXlsEncryption } from './xlsEncryption.js';

// The password Excel tries by itself before asking,
// which it uses for workbooks protected only against changes.
export const EXCEL_DEFAULT_PASSWORD = 'VelvetSweatshop';

const RIGHTS_MANAGEMENT_PATH = /DRMEncrypted|\u0009DRMContent/;

// The encryption of an OOXML file wrapped in a compound file, or of a file under rights management;
// null when the compound file holds neither.
export function readPackageEncryption(container: CompoundFile): OfficeEncryption | null {
    if (container.FullPaths.some((path) => RIGHTS_MANAGEMENT_PATH.test(path))) {
        return unsupportedEncryption(
            'Information Rights Management',
            'It is protected with Information Rights Management, which only Office can open, with permission from the person who protected it.',
        );
    }

    const encryptedPackage = readCompoundStream(container, 'EncryptedPackage');

    if (encryptedPackage == null) {
        return null;
    }

    const infoBytes = readCompoundStream(container, 'EncryptionInfo');

    if (infoBytes == null) {
        return unsupportedEncryption('Unknown encryption', 'Its encryption details are missing, so it can\'t be decrypted.');
    }

    const info = readEncryptionInfo(infoBytes);

    if (info.kind === 'unsupported') {
        return unsupportedEncryption(info.scheme, info.reason);
    }

    const unlockAsync = async (password: string): Promise<Uint8Array | null> => (
        info.kind === 'agile'
            ? await unlockAgilePackageAsync({ keyData: info.keyData, passwordKey: info.passwordKey, encryptedPackage }, password)
            : await unlockStandardPackageAsync({ header: info.header, encryptedPackage }, password)
    );

    return {
        kind: 'password',
        scheme: info.scheme,
        unlockAsync: async (password) => requirePackage(await unlockAsync(password)),
    };
}

// A password that passes the verifier but gives no ZIP package means the encrypted data is damaged.
function requirePackage(plain: Uint8Array | null): Uint8Array | null {
    if (plain != null && !isZip(plain)) {
        throw new Error('It decrypted to something other than an Office package, so its encrypted data is damaged.');
    }

    return plain;
}

// The encryption of a workbook: an encrypted XLSX, or an Excel 97–2003 workbook with a password;
// null when it has none.
export function readWorkbookEncryption(bytes: Uint8Array): OfficeEncryption | null {
    const container = hasCompoundSignature(bytes) ? tryReadCompoundFile(bytes) : null;

    if (container == null) {
        return null;
    }

    const packageEncryption = readPackageEncryption(container);

    if (packageEncryption != null) {
        return packageEncryption;
    }

    return hasCompoundStream(container, 'Workbook') || hasCompoundStream(container, 'Book')
        ? readXlsEncryption(bytes, container)
        : null;
}
