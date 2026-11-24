// Names compare ignoring case everywhere here, as on Windows,
// so a new file never lands on an existing one that differs only in case.

export interface FreeNameRequest {
    // The name before its number, such as `report-copy`.
    readonly base: string;
    // What follows the number, such as `.json`; empty for none.
    readonly extension: string;
    readonly existingNames: Iterable<string>;
}

export function isNameTaken(name: string, existingNames: Iterable<string>): boolean {
    const wanted = name.toLowerCase();

    return [...existingNames].some((existing) => existing.toLowerCase() === wanted);
}

// Why a name can't be given in a folder holding these entries, or null when it's free.
export function takenNameMessage(name: string, entries: ReadonlyMap<string, FileSystemHandleKind>): string | null {
    const wanted = name.toLowerCase();

    for (const [entryName, kind] of entries) {
        if (entryName.toLowerCase() === wanted) {
            return nameTakenMessage(entryName, kind);
        }
    }

    return null;
}

// Such as `A file named notes.md already exists.`
export function nameTakenMessage(name: string, kind: FileSystemHandleKind): string {
    return `A ${kind === 'directory' ? 'folder' : 'file'} named ${name} already exists.`;
}

// The first of `<base><extension>`, `<base>-2<extension>`, `<base>-3<extension>`… that no existing name takes.
export function nextFreeName(request: FreeNameRequest): string {
    const taken = new Set([...request.existingNames].map((name) => name.toLowerCase()));
    let candidate = `${request.base}${request.extension}`;
    let counter = 2;

    while (taken.has(candidate.toLowerCase())) {
        candidate = `${request.base}-${counter}${request.extension}`;
        counter += 1;
    }

    return candidate;
}

// The first free `-copy`, `-copy-2`, `-copy-3`… name before the extension, as `report-copy.json` for `report.json`.
// A name whose only dot starts it, such as `.env`, has no extension.
export function nextCopyName(name: string, existingNames: Iterable<string>): string {
    const lastDot = name.lastIndexOf('.');
    const base = lastDot <= 0 ? name : name.slice(0, lastDot);
    const extension = lastDot <= 0 ? '' : name.slice(lastDot);

    return nextFreeName({ base: `${base}-copy`, extension, existingNames });
}
