// The plain bytes of each file opened with its password,
// kept per File snapshot for as long as the snapshot lives,
// which is while its tab is open. Switching tabs doesn't ask again;
// a file changed on disk is a new snapshot and does.
// The password itself is never kept.
const unlockedFiles = new WeakMap<File, Uint8Array>();

export function unlockedBytesOf(file: File): Uint8Array | null {
    return unlockedFiles.get(file) ?? null;
}

export function rememberUnlocked(file: File, plain: Uint8Array): void {
    unlockedFiles.set(file, plain);
}
