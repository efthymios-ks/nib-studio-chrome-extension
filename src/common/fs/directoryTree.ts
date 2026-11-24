import type { DirectoryEntry, FileEntry } from './fileEntry.js';
import { joinPath } from './fileEntry.js';
import { isTransientEntry } from './transientEntry.js';

export async function readTreeAsync(
    root: FileSystemDirectoryHandle,
    options?: { expandedPaths?: ReadonlySet<string> },
): Promise<DirectoryEntry> {
    const expanded = options?.expandedPaths ?? new Set<string>();

    return await readDirectoryAsync(root, '', expanded);
}

async function readDirectoryAsync(
    handle: FileSystemDirectoryHandle,
    path: string,
    expanded: ReadonlySet<string>,
): Promise<DirectoryEntry> {
    const children: FileEntry[] = [];

    for await (const entry of handle.values()) {
        if (isTransientEntry(entry.name)) {
            continue;
        }

        const childPath = joinPath(path, entry.name);

        if (entry.kind === 'directory') {
            const isExpanded = expanded.has(childPath);
            const child = isExpanded
                ? await readDirectoryAsync(entry, childPath, expanded)
                : createCollapsedDirectory(entry.name, childPath);
            children.push(child);
        }
        else {
            children.push({
                name: entry.name,
                kind: 'file',
                path: childPath,
            });
        }
    }

    children.sort(compareEntries);

    return {
        name: handle.name,
        kind: 'directory',
        path,
        expanded: path === '' || expanded.has(path),
        children,
    };
}

function createCollapsedDirectory(name: string, path: string): DirectoryEntry {
    return {
        name,
        kind: 'directory',
        path,
        expanded: false,
        children: [],
    };
}

function compareEntries(a: FileEntry, b: FileEntry): number {
    if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1;
    }

    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}
