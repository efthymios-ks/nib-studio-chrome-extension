// The password that opened each locked PDF,
// kept in memory per File snapshot for as long as the snapshot lives,
// which is while its tab is open, so coming back to the tab opens it again without asking.
// pdf.js decrypts as it reads, so the password stands in for the plain bytes Word and Excel files keep.
// A file changed on disk is a new snapshot and asks again; nothing here is ever written anywhere.
const passwords = new WeakMap<File, string>();

export function passwordOfUnlockedPdf(file: File): string | null {
    return passwords.get(file) ?? null;
}

export function rememberUnlockedPdf(file: File, password: string): void {
    passwords.set(file, password);
}
