import { basename, joinPath, parentPath } from './fileEntry.js';
import { readTextBlobAsync, type TextEncoding } from '../text/textEncoding.js';
import { nextFreeName } from './nextFreeName.js';
import { isTransientEntry } from './transientEntry.js';

export interface FileReadResult {
    readonly path: string;
    readonly text: string;
    // The encoding the text was read in, which saving writes it back in.
    readonly encoding: TextEncoding;
    readonly file: File;
    readonly lastModified: number;
}

export async function readFileAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<FileReadResult> {
    const handle = await resolveFileHandleAsync(root, path);
    const file = await handle.getFile();
    const { text, encoding } = await readTextBlobAsync(file);

    return {
        path,
        text,
        encoding,
        file,
        lastModified: file.lastModified,
    };
}

// Returns a fresh File snapshot without reading its contents.
export async function getFileAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<File> {
    const handle = await resolveFileHandleAsync(root, path);

    return await handle.getFile();
}

// The handle of a folder inside the workspace, found by walking its path down from the root; '' is the root itself.
export async function getDirectoryAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<FileSystemDirectoryHandle> {
    return await resolveDirectoryAsync(root, path, { create: false });
}

export async function writeFileAsync(
    root: FileSystemDirectoryHandle,
    path: string,
    text: string,
): Promise<void> {
    const handle = await resolveFileHandleAsync(root, path, { create: true });
    await writeHandleAsync(handle, text);
}

// Writes raw bytes so binary files (xlsx, docx, images) survive unchanged.
export async function writeBytesAsync(
    root: FileSystemDirectoryHandle,
    path: string,
    data: Blob | ArrayBuffer,
): Promise<void> {
    const handle = await resolveFileHandleAsync(root, path, { create: true });
    await writeHandleAsync(handle, data);
}

export async function createFileAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<void> {
    const parent = await resolveDirectoryAsync(root, parentPath(path), { create: false });
    await parent.getFileHandle(basename(path), { create: true });
}

export async function createDirectoryAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<void> {
    await resolveDirectoryAsync(root, path, { create: true });
}

export async function deleteEntryAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<void> {
    const parent = await resolveDirectoryAsync(root, parentPath(path), { create: false });
    await parent.removeEntry(basename(path), { recursive: true });
}

export async function duplicateEntryAsync(
    root: FileSystemDirectoryHandle,
    sourcePath: string,
    newName: string,
): Promise<string> {
    const parent = await resolveDirectoryAsync(root, parentPath(sourcePath), { create: false });
    const sourceName = basename(sourcePath);
    const sourceFile = await parent.getFileHandle(sourceName).catch(() => null);

    if (sourceFile != null) {
        await copyFileAsync(sourceFile, parent, newName);

        return joinPath(parentPath(sourcePath), newName);
    }

    const sourceDirectory = await parent.getDirectoryHandle(sourceName);
    const targetDirectory = await parent.getDirectoryHandle(newName, { create: true });
    await copyDirectoryAsync(sourceDirectory, targetDirectory);

    return joinPath(parentPath(sourcePath), newName);
}

async function copyFileAsync(
    source: FileSystemFileHandle,
    targetDirectory: FileSystemDirectoryHandle,
    targetName: string,
): Promise<void> {
    const file = await source.getFile();
    const target = await targetDirectory.getFileHandle(targetName, { create: true });
    await writeHandleAsync(target, file);
}

export async function writeHandleAsync(handle: FileSystemFileHandle, data: Blob | ArrayBuffer | string): Promise<void> {
    const writable = await handle.createWritable();

    try {
        await writable.write(data);
    }
    finally {
        await writable.close();
    }
}

async function copyDirectoryAsync(
    source: FileSystemDirectoryHandle,
    target: FileSystemDirectoryHandle,
): Promise<void> {
    for await (const entry of source.values()) {
        if (isTransientEntry(entry.name)) {
            continue;
        }

        if (entry.kind === 'file') {
            await copyFileAsync(entry, target, entry.name);
            continue;
        }

        const subTarget = await target.getDirectoryHandle(entry.name, { create: true });
        await copyDirectoryAsync(entry, subTarget);
    }
}

export async function entryExistsAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<boolean> {
    return await entryKindAsync(root, path) != null;
}

export async function entryKindAsync(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<FileSystemHandleKind | null> {
    const parent = await resolveDirectoryAsync(root, parentPath(path), { create: false }).catch(() => null);

    if (parent == null) {
        return null;
    }

    return await childKindAsync(parent, basename(path));
}

// Names of the entries directly inside a folder, read from disk so collapsed folders count too.
export async function listChildNamesAsync(
    root: FileSystemDirectoryHandle,
    folderPath: string,
): Promise<Set<string>> {
    const folder = await resolveDirectoryAsync(root, folderPath, { create: false });

    return await childNamesAsync(folder);
}

// Each entry directly inside a folder, by name, with its kind, read from disk.
export async function listChildEntriesAsync(
    root: FileSystemDirectoryHandle,
    folderPath: string,
): Promise<Map<string, FileSystemHandleKind>> {
    const folder = await resolveDirectoryAsync(root, folderPath, { create: false });
    const entries = new Map<string, FileSystemHandleKind>();

    for await (const entry of folder.values()) {
        if (!isTransientEntry(entry.name)) {
            entries.set(entry.name, entry.kind);
        }
    }

    return entries;
}

async function childNamesAsync(folder: FileSystemDirectoryHandle): Promise<Set<string>> {
    const names = new Set<string>();

    for await (const entry of folder.values()) {
        if (!isTransientEntry(entry.name)) {
            names.add(entry.name);
        }
    }

    return names;
}

// Copies a file or a folder tree byte for byte; the target parent folder is created when missing.
export async function copyEntryAsync(
    root: FileSystemDirectoryHandle,
    sourcePath: string,
    targetPath: string,
): Promise<void> {
    if (isSameOrInside(targetPath, sourcePath)) {
        throw new Error(`Cannot copy ${sourcePath} into itself.`);
    }

    const sourceParent = await resolveDirectoryAsync(root, parentPath(sourcePath), { create: false });
    const targetParent = await resolveDirectoryAsync(root, parentPath(targetPath), { create: true });
    await copyChildAsync(sourceParent, basename(sourcePath), targetParent, basename(targetPath));
}

// Moves a file or folder by copying it and removing the source.
export async function moveEntryAsync(
    root: FileSystemDirectoryHandle,
    sourcePath: string,
    targetPath: string,
): Promise<void> {
    if (sourcePath === targetPath) {
        return;
    }

    if (parentPath(sourcePath) === parentPath(targetPath)) {
        await renameEntryAsync(root, sourcePath, basename(targetPath));

        return;
    }

    await copyEntryAsync(root, sourcePath, targetPath);
    await deleteEntryAsync(root, sourcePath);
}

// Renames a file or folder in place. Uses the native `move()` when the browser has it,
// otherwise copies the bytes (recursively for folders) and removes the original.
export async function renameEntryAsync(
    root: FileSystemDirectoryHandle,
    path: string,
    newName: string,
): Promise<string> {
    const parent = await resolveDirectoryAsync(root, parentPath(path), { create: false });
    const oldName = basename(path);
    const newPath = joinPath(parentPath(path), newName);

    if (oldName === newName) {
        return path;
    }

    const caseOnly = oldName.toLowerCase() === newName.toLowerCase();

    if (!caseOnly && await childKindAsync(parent, newName) != null) {
        throw new Error(`${newName} already exists.`);
    }

    const fileHandle = await parent.getFileHandle(oldName).catch(() => null);
    const handle: FileSystemHandle = fileHandle ?? await parent.getDirectoryHandle(oldName);

    if (await tryNativeMoveAsync(handle, newName)) {
        return newPath;
    }

    if (caseOnly) {
        // Case-insensitive file systems see both names as one entry, so go through a temporary name.
        const temporaryName = await uniqueTemporaryNameAsync(parent, newName);
        await copyChildAsync(parent, oldName, parent, temporaryName);
        await parent.removeEntry(oldName, { recursive: true });
        await copyChildAsync(parent, temporaryName, parent, newName);
        await parent.removeEntry(temporaryName, { recursive: true });

        return newPath;
    }

    await copyChildAsync(parent, oldName, parent, newName);
    await parent.removeEntry(oldName, { recursive: true });

    return newPath;
}

async function tryNativeMoveAsync(handle: FileSystemHandle, newName: string): Promise<boolean> {
    const movable = handle as FileSystemHandle & { move?: (name: string) => Promise<void> };

    if (typeof movable.move !== 'function') {
        return false;
    }

    try {
        await movable.move(newName);

        return true;
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'NotSupportedError') {
            return false;
        }

        throw error;
    }
}

async function copyChildAsync(
    sourceParent: FileSystemDirectoryHandle,
    sourceName: string,
    targetParent: FileSystemDirectoryHandle,
    targetName: string,
): Promise<void> {
    const sourceFile = await sourceParent.getFileHandle(sourceName).catch(() => null);

    if (sourceFile != null) {
        await copyFileAsync(sourceFile, targetParent, targetName);

        return;
    }

    const sourceDirectory = await sourceParent.getDirectoryHandle(sourceName);
    const targetDirectory = await targetParent.getDirectoryHandle(targetName, { create: true });
    await copyDirectoryAsync(sourceDirectory, targetDirectory);
}

async function childKindAsync(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemHandleKind | null> {
    const file = await parent.getFileHandle(name).catch(() => null);

    if (file != null) {
        return 'file';
    }

    const directory = await parent.getDirectoryHandle(name).catch(() => null);

    return directory == null ? null : 'directory';
}

async function uniqueTemporaryNameAsync(parent: FileSystemDirectoryHandle, name: string): Promise<string> {
    const existingNames = await childNamesAsync(parent);

    return nextFreeName({ base: `${name}.nib-rename`, extension: '', existingNames });
}

function isSameOrInside(path: string, folder: string): boolean {
    return path === folder || path.startsWith(`${folder}/`);
}

async function resolveFileHandleAsync(
    root: FileSystemDirectoryHandle,
    path: string,
    options?: { create?: boolean },
): Promise<FileSystemFileHandle> {
    const create = options?.create ?? false;
    const directory = await resolveDirectoryAsync(root, parentPath(path), { create });

    return await directory.getFileHandle(basename(path), { create });
}

async function resolveDirectoryAsync(
    root: FileSystemDirectoryHandle,
    path: string,
    options: { create: boolean },
): Promise<FileSystemDirectoryHandle> {
    if (path === '') {
        return root;
    }

    const segments = path.split('/').filter((segment) => segment.length > 0);
    let current = root;

    for (const segment of segments) {
        current = await current.getDirectoryHandle(segment, { create: options.create });
    }

    return current;
}
