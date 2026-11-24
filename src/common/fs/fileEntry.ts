export type EntryKind = 'file' | 'directory';

export interface FileEntry {
    readonly name: string;
    readonly kind: EntryKind;
    readonly path: string;
}

export interface DirectoryEntry extends FileEntry {
    readonly kind: 'directory';
    readonly children: ReadonlyArray<FileEntry>;
    readonly expanded: boolean;
}

export function isDirectoryEntry(entry: FileEntry): entry is DirectoryEntry {
    return entry.kind === 'directory';
}

export function joinPath(parent: string, name: string): string {
    if (parent === '') {
        return name;
    }

    return `${parent}/${name}`;
}

export function parentPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');

    if (lastSlash < 0) {
        return '';
    }

    return path.slice(0, lastSlash);
}

export function basename(path: string): string {
    const lastSlash = path.lastIndexOf('/');

    if (lastSlash < 0) {
        return path;
    }

    return path.slice(lastSlash + 1);
}

export function extension(name: string): string {
    const lastDot = name.lastIndexOf('.');

    if (lastDot <= 0) {
        return '';
    }

    return name.slice(lastDot + 1).toLowerCase();
}

// Rewrites `path` when it is `fromPath` or sits inside it, otherwise returns it unchanged.
export function remapPath(path: string, fromPath: string, toPath: string): string {
    if (path === fromPath) {
        return toPath;
    }

    if (fromPath !== '' && path.startsWith(`${fromPath}/`)) {
        return `${toPath}${path.slice(fromPath.length)}`;
    }

    return path;
}
