import { isTransientEntry } from '../../common/fs/transientEntry.js';

// Files and folders dropped from the computer.
// Chromium hands out a file system handle per item, which can save back to the file and be found in the workspace;
// otherwise a folder is walked through its entry and a file is read from the files list.

export interface DroppedFile {
    readonly kind: 'file';
    readonly name: string;
    readonly handle: FileSystemFileHandle | null;
    readonly readAsync: () => Promise<File>;
}

export interface DroppedFolder {
    readonly kind: 'directory';
    readonly name: string;
    readonly handle: FileSystemDirectoryHandle | null;
    readonly listAsync: () => Promise<DroppedItem[]>;
}

export type DroppedItem = DroppedFile | DroppedFolder;

interface CapturedItem {
    readonly handle: Promise<FileSystemHandle | null> | null;
    readonly entry: FileSystemEntry | null;
    readonly file: File | null;
}

// The items of a DataTransfer are only readable while its drop event runs,
// so everything is taken from it before the first await.
export async function readDroppedItemsAsync(dataTransfer: DataTransfer): Promise<DroppedItem[]> {
    const captured = captureItems(dataTransfer);
    const items: DroppedItem[] = [];

    for (const item of captured) {
        const resolved = await resolveItemAsync(item);

        if (resolved != null) {
            items.push(resolved);
        }
    }

    return items;
}

export function isDroppedFile(item: DroppedItem): item is DroppedFile {
    return item.kind === 'file';
}

export function isDroppedFolder(item: DroppedItem): item is DroppedFolder {
    return item.kind === 'directory';
}

function captureItems(dataTransfer: DataTransfer): CapturedItem[] {
    const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === 'file');

    if (items.length === 0) {
        return Array.from(dataTransfer.files ?? []).map((file) => ({ handle: null, entry: null, file }));
    }

    return items.map((item) => ({
        handle: handleOf(item),
        entry: typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null,
        file: item.getAsFile(),
    }));
}

function handleOf(item: DataTransferItem): Promise<FileSystemHandle | null> | null {
    if (typeof item.getAsFileSystemHandle !== 'function') {
        return null;
    }

    try {
        return item.getAsFileSystemHandle().catch(() => null);
    }
    catch {
        return null;
    }
}

async function resolveItemAsync(item: CapturedItem): Promise<DroppedItem | null> {
    const handle = await item.handle;

    if (handle != null) {
        return fromHandle(handle);
    }

    if (item.entry?.isDirectory === true) {
        return fromEntry(item.entry);
    }

    if (item.file != null) {
        return fromFile(item.file);
    }

    return item.entry == null ? null : fromEntry(item.entry);
}

function fromHandle(handle: FileSystemHandle): DroppedItem {
    if (handle.kind === 'file') {
        const fileHandle = handle as FileSystemFileHandle;

        return {
            kind: 'file',
            name: handle.name,
            handle: fileHandle,
            readAsync: async () => await fileHandle.getFile(),
        };
    }

    const directory = handle as FileSystemDirectoryHandle;

    return {
        kind: 'directory',
        name: handle.name,
        handle: directory,
        listAsync: async () => {
            const children: DroppedItem[] = [];

            for await (const child of directory.values()) {
                if (!isTransientEntry(child.name)) {
                    children.push(fromHandle(child));
                }
            }

            return children;
        },
    };
}

function fromEntry(entry: FileSystemEntry): DroppedItem {
    if (entry.isDirectory) {
        const directory = entry as FileSystemDirectoryEntry;

        return {
            kind: 'directory',
            name: entry.name,
            handle: null,
            listAsync: async () => (await readAllEntriesAsync(directory))
                .filter((child) => !isTransientEntry(child.name))
                .map(fromEntry),
        };
    }

    const fileEntry = entry as FileSystemFileEntry;

    return {
        kind: 'file',
        name: entry.name,
        handle: null,
        readAsync: async () => await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject)),
    };
}

function fromFile(file: File): DroppedFile {
    return {
        kind: 'file',
        name: file.name,
        handle: null,
        readAsync: async () => file,
    };
}

// A directory reader hands out the children in batches and an empty batch at the end.
async function readAllEntriesAsync(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = directory.createReader();
    const entries: FileSystemEntry[] = [];

    while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

        if (batch.length === 0) {
            return entries;
        }

        entries.push(...batch);
    }
}
