import { joinPath } from './fileEntry.js';
import { isTransientEntry } from './transientEntry.js';

export interface WorkspaceEntry {
    // The path with every name as it is on disk.
    readonly path: string;
    readonly kind: FileSystemHandleKind;
}

// The entries of folders listed so far, by folder path;
// one lookup cache serves many lookups in the same folders.
export type FolderListings = Map<string, Promise<ReadonlyArray<FileSystemHandle>>>;

// Finds a file or folder by its workspace path. Each name matches exactly when it can, and otherwise
// case-insensitively, as Windows folders do; the result names the entries as they are on disk,
// so a link written as `Docs/Guide.MD` opens the same tab as the tree's `docs/guide.md`.
export async function findWorkspaceEntryAsync(
    root: FileSystemDirectoryHandle,
    path: string,
    listings: FolderListings = new Map(),
): Promise<WorkspaceEntry | null> {
    const names = path.split('/').filter((name) => name !== '');

    if (names.length === 0) {
        return { path: '', kind: 'directory' };
    }

    let directory = root;
    let found = '';

    for (const [index, name] of names.entries()) {
        const child = await findChildAsync(directory, found, name, listings);

        if (child == null) {
            return null;
        }

        found = joinPath(found, child.name);

        if (index === names.length - 1) {
            return { path: found, kind: child.kind };
        }

        if (child.kind !== 'directory') {
            return null;
        }

        directory = child as FileSystemDirectoryHandle;
    }

    return null;
}

async function findChildAsync(
    directory: FileSystemDirectoryHandle,
    directoryPath: string,
    name: string,
    listings: FolderListings,
): Promise<FileSystemHandle | null> {
    const entries = await listAsync(directory, directoryPath, listings);
    const exact = entries.find((entry) => entry.name === name);

    if (exact != null) {
        return exact;
    }

    const folded = name.toLowerCase();

    return entries.find((entry) => entry.name.toLowerCase() === folded) ?? null;
}

function listAsync(
    directory: FileSystemDirectoryHandle,
    directoryPath: string,
    listings: FolderListings,
): Promise<ReadonlyArray<FileSystemHandle>> {
    const listed = listings.get(directoryPath);

    if (listed != null) {
        return listed;
    }

    const listing = readEntriesAsync(directory);
    listings.set(directoryPath, listing);

    return listing;
}

// Entries sorted by name,
// so a case-insensitive match is the same on every run when a folder holds `A.md` and `a.md`.
async function readEntriesAsync(directory: FileSystemDirectoryHandle): Promise<ReadonlyArray<FileSystemHandle>> {
    const entries: FileSystemHandle[] = [];

    try {
        for await (const entry of directory.values()) {
            if (!isTransientEntry(entry.name)) {
                entries.push(entry);
            }
        }
    }
    catch {
        // A folder removed or no longer readable lists as empty.
    }

    return entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}
