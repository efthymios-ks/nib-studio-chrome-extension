import type { DirectoryChangeEvent } from '../fs/directoryWatcher.js';
import { isTransientEntry } from '../fs/transientEntry.js';
import { WORKSPACE_CONFIG_PATH } from '../fs/workspaceConfig.js';
import { looksLikeText, TEXT_SNIFF_BYTES } from '../text/textSniff.js';
import { extractText, readPlanFor, type Extraction } from './lookupExtractors.js';
import type { LookupCandidate } from './lookupMatcher.js';
import { lookUp, type LookupResults } from './lookupResults.js';
import { flattenText, type FlatText, type TextSection } from './lookupText.js';

// The Lookup index of a workspace: every file's name from the first moment, and its text as it is read in the background,
// one file at a time, PDFs on a lane of their own. Searches run on what is in memory, never on the disk.
// A file is known by its path, size and last change, so only files that change are read again.

// Folders whose files are never listed, wherever they are.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['.git', 'node_modules', 'bin', 'obj']);
// The studio's own file in each workspace.
const SKIPPED_FILES: ReadonlySet<string> = new Set([WORKSPACE_CONFIG_PATH]);
// The text of every file together stays within this many characters; files past it keep only their names.
const MAX_TOTAL_TEXT_CHARS = 64_000_000;

const PROGRESS_INTERVAL_MS = 100;
// Reading gives way this often, so a search waiting on the same thread never waits long.
const YIELD_INTERVAL_MS = 10;

export interface LookupProgress {
    // Files whose contents are settled: read, or known to have none to read.
    readonly read: number;
    readonly total: number;
    // Whether the workspace's folders are still being listed.
    readonly isListing: boolean;
    readonly isDone: boolean;
}

export type PdfReadOutcome =
    | { readonly kind: 'text'; readonly text: string; readonly isUnlocked: boolean }
    | { readonly kind: 'locked' }
    | { readonly kind: 'name-only' };

// What the index needs from the page: pdf.js and the unlocked files live there.
export interface LookupHost {
    // A PDF's text, read with the password of a tab that unlocked this same snapshot of it.
    readonly readPdfTextAsync: (path: string, file: File) => Promise<PdfReadOutcome>;
    // The plain bytes of a protected file whose tab unlocked this same snapshot of it; null when none did.
    readonly readUnlockedBytesAsync: (path: string, file: File) => Promise<Uint8Array | null>;
    // Files were listed or read.
    readonly onChange: (progress: LookupProgress) => void;
}

export interface LookupIndexOptions {
    readonly root: FileSystemDirectoryHandle;
    // The Windows code page that text which isn't UTF-8 is read in.
    readonly codePage: number;
    readonly host: LookupHost;
    readonly yieldAsync?: () => Promise<void>;
    readonly now?: () => number;
}

export interface LookupIndex {
    readonly progress: () => LookupProgress;
    readonly search: (query: string) => LookupResults;
    // Lists the workspace again, reading only the files whose size or last change differ, and dropping those gone,
    // for changes the watcher may have missed.
    readonly refresh: () => void;
    // What the workspace watcher saw: changed files are read again, new ones are added and deleted ones dropped;
    // a move, or a change it can't place, has the workspace listed again.
    readonly applyChanges: (events: ReadonlyArray<DirectoryChangeEvent>) => void;
    // The text of open files with unsaved edits, by path, searched instead of what is on disk.
    readonly setOpenTexts: (texts: ReadonlyMap<string, string>) => void;
    // The protected files a tab holds unlocked: those are read from their plain bytes,
    // and those unlocked before but no longer are searched by name only again.
    readonly setUnlocked: (paths: ReadonlySet<string>) => void;
    readonly dispose: () => void;
}

type EntryState = 'pending' | 'text' | 'name-only' | 'locked';

interface Entry extends LookupCandidate {
    handle: FileSystemFileHandle;
    size: number;
    lastModified: number;
    state: EntryState;
    text: string | null;
    lineStarts: Int32Array | null;
    sections: ReadonlyArray<TextSection> | null;
    // Whether the text came from a tab's unlocked copy.
    isUnlocked: boolean;
    // Goes up whenever the file changes, so a read of an older snapshot is dropped.
    version: number;
}

interface OpenText {
    readonly source: string;
    readonly flat: FlatText;
}

const defaultYieldAsync = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
};

export function createLookupIndex(options: LookupIndexOptions): LookupIndex {
    const { root, host, codePage } = options;
    const yieldAsync = options.yieldAsync ?? defaultYieldAsync;
    const now = options.now ?? (() => performance.now());
    const entries = new Map<string, Entry>();
    const queue: Entry[] = [];
    const queued = new Set<Entry>();
    let openTexts = new Map<string, OpenText>();
    let totalChars = 0;
    // Files whose contents are settled, kept as states change, so progress never counts them all again.
    let readCount = 0;
    let isDisposed = false;
    let isReading = false;
    let isListing = false;
    let pdfLane: Promise<void> = Promise.resolve();
    let changeLane: Promise<void> = Promise.resolve();
    let scanRequested = false;
    let reportTimer: ReturnType<typeof setTimeout> | null = null;
    let lastYield = now();

    const progress = (): LookupProgress => ({
        read: readCount,
        total: entries.size,
        isListing,
        isDone: !isListing && readCount === entries.size,
    });

    const setState = (entry: Entry, state: EntryState): void => {
        readCount += Number(entry.state === 'pending') - Number(state === 'pending');
        entry.state = state;
    };

    // Reports at most every PROGRESS_INTERVAL_MS, and at once when everything is read.
    const report = (): void => {
        if (isDisposed) {
            return;
        }

        const current = progress();

        if (current.isDone) {
            if (reportTimer != null) {
                clearTimeout(reportTimer);
                reportTimer = null;
            }

            host.onChange(current);

            return;
        }

        reportTimer ??= setTimeout(() => {
            reportTimer = null;

            if (!isDisposed) {
                host.onChange(progress());
            }
        }, PROGRESS_INTERVAL_MS);
    };

    const setText = (entry: Entry, flat: FlatText | null, sections: ReadonlyArray<TextSection> | null = null): void => {
        totalChars -= entry.text?.length ?? 0;
        entry.text = flat?.text ?? null;
        entry.lineStarts = flat?.lineStarts ?? null;
        entry.sections = flat == null ? null : sections;
        totalChars += entry.text?.length ?? 0;
    };

    // A read that ends after its file was dropped from the index changes nothing.
    const settle = (entry: Entry, extraction: Extraction, isUnlocked: boolean): void => {
        if (entries.get(entry.path) !== entry) {
            return;
        }

        if (extraction.kind !== 'text') {
            setText(entry, null);
            setState(entry, extraction.kind);
            entry.isUnlocked = false;

            return;
        }

        const flat = flattenText(extraction.text, { keepLines: extraction.keepsLines });
        const room = MAX_TOTAL_TEXT_CHARS - totalChars + (entry.text?.length ?? 0);

        if (flat.text === '' || flat.text.length > room) {
            setText(entry, null);
            setState(entry, 'name-only');
            entry.isUnlocked = false;

            return;
        }

        setText(entry, flat, extraction.sections ?? null);
        setState(entry, 'text');
        entry.isUnlocked = isUnlocked;
    };

    const enqueue = (entry: Entry): void => {
        entry.version += 1;
        setState(entry, 'pending');

        if (!queued.has(entry)) {
            queued.add(entry);
            queue.push(entry);
        }

        void pumpAsync();
    };

    const extractSafely = (name: string, bytes: Uint8Array, isUnlocked: boolean): Extraction => {
        try {
            return extractText(name, bytes, { codePage, isUnlocked });
        }
        catch {
            return { kind: 'name-only' };
        }
    };

    const readPdfAsync = async (entry: Entry, file: File, version: number): Promise<void> => {
        try {
            const outcome = await host.readPdfTextAsync(entry.path, file);

            if (entry.version !== version || isDisposed) {
                return;
            }

            const extraction: Extraction = outcome.kind === 'text'
                ? { kind: 'text', text: outcome.text, keepsLines: false }
                : outcome;
            settle(entry, extraction, outcome.kind === 'text' && outcome.isUnlocked);
        }
        catch {
            if (entry.version === version) {
                settle(entry, { kind: 'name-only' }, false);
            }
        }
        finally {
            report();
        }
    };

    const readEntryAsync = async (entry: Entry): Promise<void> => {
        const version = entry.version;
        let file: File;

        try {
            file = await entry.handle.getFile();
        }
        catch {
            // Gone since it was listed; the watcher tells, or the next listing drops it.
            settle(entry, { kind: 'name-only' }, false);

            return;
        }

        entry.size = file.size;
        entry.lastModified = file.lastModified;
        const plan = readPlanFor(entry.name, file.size);

        if (plan === 'name-only') {
            settle(entry, { kind: 'name-only' }, false);

            return;
        }

        if (plan === 'pdf') {
            pdfLane = pdfLane.then(async () => await readPdfAsync(entry, file, version));

            return;
        }

        if (plan === 'sniff' && !looksLikeText(new Uint8Array(await file.slice(0, TEXT_SNIFF_BYTES).arrayBuffer()))) {
            settle(entry, { kind: 'name-only' }, false);

            return;
        }

        const bytes = new Uint8Array(await file.arrayBuffer());

        if (entry.version !== version) {
            return;
        }

        const extraction = extractSafely(entry.name, bytes, false);

        if (extraction.kind !== 'locked') {
            settle(entry, extraction, false);

            return;
        }

        const plain = await host.readUnlockedBytesAsync(entry.path, file).catch(() => null);

        if (entry.version !== version) {
            return;
        }

        settle(entry, plain == null ? extraction : extractSafely(entry.name, plain, true), plain != null);
    };

    const pumpAsync = async (): Promise<void> => {
        if (isReading) {
            return;
        }

        isReading = true;

        try {
            for (let entry = queue.shift(); entry != null && !isDisposed; entry = queue.shift()) {
                queued.delete(entry);

                if (entries.get(entry.path) !== entry) {
                    continue;
                }

                const version = entry.version;

                try {
                    await readEntryAsync(entry);
                }
                catch {
                    if (entry.version === version) {
                        settle(entry, { kind: 'name-only' }, false);
                    }
                }

                report();

                if (now() - lastYield >= YIELD_INTERVAL_MS) {
                    await yieldAsync();
                    lastYield = now();
                }
            }
        }
        finally {
            isReading = false;
        }
    };

    // Adds a file, or takes in its new size and date; a file that changed is read again, keeping its old text until then.
    const upsert = (path: string, handle: FileSystemFileHandle, file: File): void => {
        const existing = entries.get(path);

        if (existing != null) {
            existing.handle = handle;

            if (existing.size !== file.size || existing.lastModified !== file.lastModified) {
                existing.size = file.size;
                existing.lastModified = file.lastModified;
                enqueue(existing);
            }

            return;
        }

        const slash = path.lastIndexOf('/');
        const entry: Entry = {
            path,
            name: path.slice(slash + 1),
            folder: slash < 0 ? '' : path.slice(0, slash),
            handle,
            size: file.size,
            lastModified: file.lastModified,
            state: 'pending',
            text: null,
            lineStarts: null,
            sections: null,
            isUnlocked: false,
            version: 0,
        };
        entries.set(path, entry);
        enqueue(entry);
    };

    const drop = (entry: Entry): void => {
        entry.version += 1;
        setText(entry, null);
        setState(entry, 'pending');
        entries.delete(entry.path);
    };

    // Drops the file at a path, or every file in the folder at it.
    const remove = (path: string): void => {
        for (const entry of [...entries.values()]) {
            if (entry.path === path || entry.path.startsWith(`${path}/`)) {
                drop(entry);
            }
        }
    };

    // Lists a folder and every folder in it, breadth first so the top of the workspace comes first,
    // and adds the path of each file listed to `seen`.
    const listAsync = async (folder: FileSystemDirectoryHandle, path: string, seen: Set<string>): Promise<void> => {
        const folders: Array<readonly [FileSystemDirectoryHandle, string]> = [[folder, path]];

        for (let next = folders.shift(); next != null && !isDisposed; next = folders.shift()) {
            const [directory, directoryPath] = next;

            try {
                for await (const child of directory.values()) {
                    const childPath = directoryPath === '' ? child.name : `${directoryPath}/${child.name}`;

                    if (child.kind === 'directory') {
                        if (!SKIPPED_FOLDERS.has(child.name)) {
                            folders.push([child as FileSystemDirectoryHandle, childPath]);
                        }

                        continue;
                    }

                    if (SKIPPED_FILES.has(child.name) || isTransientEntry(child.name)) {
                        continue;
                    }

                    try {
                        const fileHandle = child as FileSystemFileHandle;
                        upsert(childPath, fileHandle, await fileHandle.getFile());
                        seen.add(childPath);
                    }
                    catch {
                        // A file that can't be opened, or is gone already, isn't listed.
                    }
                }
            }
            catch {
                // A folder that can't be read is left out.
            }

            report();
        }
    };

    // Lists the whole workspace, then drops what is no longer there; a request during a listing lists again after it.
    const scanAsync = async (): Promise<void> => {
        if (isListing) {
            scanRequested = true;

            return;
        }

        isListing = true;
        report();

        try {
            do {
                scanRequested = false;
                const seen = new Set<string>();
                await listAsync(root, '', seen);

                for (const entry of [...entries.values()]) {
                    if (!seen.has(entry.path) && !isDisposed) {
                        drop(entry);
                    }
                }
            } while (scanRequested && !isDisposed);
        }
        finally {
            isListing = false;
            report();
        }
    };

    const isSkipped = (path: string): boolean => {
        const segments = path.split('/');
        const name = segments.at(-1) ?? '';

        return segments.slice(0, -1).some((segment) => SKIPPED_FOLDERS.has(segment)) || SKIPPED_FILES.has(name) || isTransientEntry(name);
    };

    // The file or folder at a path, or null when nothing is there.
    const resolveAsync = async (path: string): Promise<FileSystemHandle | null> => {
        let directory = root;
        const segments = path.split('/');

        try {
            for (const segment of segments.slice(0, -1)) {
                directory = await directory.getDirectoryHandle(segment);
            }
        }
        catch {
            return null;
        }

        const name = segments.at(-1) ?? '';

        try {
            return await directory.getFileHandle(name);
        }
        catch {
            // Not a file; maybe a folder.
        }

        try {
            return await directory.getDirectoryHandle(name);
        }
        catch {
            return null;
        }
    };

    const applyChangeAsync = async (event: DirectoryChangeEvent): Promise<void> => {
        if (event.path === '' || isSkipped(event.path)) {
            return;
        }

        const handle = event.kind === 'deleted' ? null : await resolveAsync(event.path);

        if (handle == null) {
            remove(event.path);

            return;
        }

        if (handle.kind === 'directory') {
            if (!SKIPPED_FOLDERS.has(handle.name)) {
                await listAsync(handle as FileSystemDirectoryHandle, event.path, new Set());
            }

            return;
        }

        try {
            const fileHandle = handle as FileSystemFileHandle;
            upsert(event.path, fileHandle, await fileHandle.getFile());
        }
        catch {
            remove(event.path);
        }
    };

    void scanAsync();

    return {
        progress,
        search: (query) => {
            const candidates = function* (): Generator<LookupCandidate> {
                for (const entry of entries.values()) {
                    const open = openTexts.get(entry.path);
                    yield open == null ? entry : { ...entry, text: open.flat.text, lineStarts: open.flat.lineStarts, sections: null };
                }
            };

            return lookUp(candidates(), query);
        },
        refresh: () => {
            void scanAsync();
        },
        applyChanges: (events) => {
            if (events.some((event) => event.kind === 'moved' || event.kind === 'unknown')) {
                void scanAsync();

                return;
            }

            changeLane = changeLane.then(async () => {
                for (const event of events) {
                    if (!isDisposed) {
                        await applyChangeAsync(event);
                    }
                }

                report();
            });
        },
        setOpenTexts: (texts) => {
            const next = new Map<string, OpenText>();

            for (const [path, source] of texts) {
                const known = openTexts.get(path);
                const isSame = known?.source === source;
                next.set(path, isSame && known != null ? known : { source, flat: flattenText(source, { keepLines: true }) });
            }

            openTexts = next;
        },
        setUnlocked: (paths) => {
            for (const entry of entries.values()) {
                if (entry.state === 'locked' && paths.has(entry.path)) {
                    enqueue(entry);
                }
                else if (entry.isUnlocked && !paths.has(entry.path)) {
                    setText(entry, null);
                    setState(entry, 'locked');
                    entry.isUnlocked = false;
                }
            }

            report();
        },
        dispose: () => {
            isDisposed = true;
            queue.length = 0;
            queued.clear();

            if (reportTimer != null) {
                clearTimeout(reportTimer);
                reportTimer = null;
            }
        },
    };
}
