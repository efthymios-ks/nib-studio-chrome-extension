// A file Office encrypted with a password, and how to open it.
export interface PasswordEncryption {
    readonly kind: 'password';
    // How the file is encrypted, for the Info panel, such as "Agile encryption, AES-256 with SHA-512".
    readonly scheme: string;
    // The plain file, or null when the password is wrong. The password serves this call and is kept nowhere.
    unlockAsync(password: string): Promise<Uint8Array | null>;
}

// A file encrypted in a way the preview can't open, such as with rights management.
export interface UnsupportedEncryption {
    readonly kind: 'unsupported';
    readonly scheme: string;
    // Why it can't be opened, as a sentence.
    readonly reason: string;
}

export type OfficeEncryption = PasswordEncryption | UnsupportedEncryption;

export function unsupportedEncryption(scheme: string, reason: string): UnsupportedEncryption {
    return { kind: 'unsupported', scheme, reason };
}
