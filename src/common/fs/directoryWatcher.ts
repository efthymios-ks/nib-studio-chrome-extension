import { isTransientEntry } from './transientEntry.js';

export interface DirectoryChangeEvent {
    readonly kind: 'created' | 'modified' | 'deleted' | 'moved' | 'unknown';
    readonly path: string;
}

export interface DirectoryWatcher {
    dispose(): void;
}

export interface WatchOptions {
    readonly recursive?: boolean;
}

type ObserverRecord = {
    readonly type?: string;
    readonly relativePathComponents?: ReadonlyArray<string>;
    readonly changedHandle?: unknown;
};

interface FileSystemObserverCtor {
    new (callback: (records: ReadonlyArray<ObserverRecord>) => void): {
        observe(handle: FileSystemDirectoryHandle, options?: { recursive?: boolean }): Promise<void>;
        disconnect(): void;
    };
}

export async function watchDirectoryAsync(
    handle: FileSystemDirectoryHandle,
    onChange: (event: DirectoryChangeEvent) => void,
    options?: WatchOptions,
): Promise<DirectoryWatcher> {
    const recursive = options?.recursive ?? true;
    const nativeCtor = (window as unknown as { FileSystemObserver?: FileSystemObserverCtor }).FileSystemObserver;

    if (nativeCtor != null) {
        const observer = new nativeCtor((records) => {
            for (const record of records) {
                if (!isTransientEntry(record.relativePathComponents?.at(-1) ?? '')) {
                    onChange(mapRecord(record));
                }
            }
        });

        try {
            await observer.observe(handle, { recursive });

            return {
                dispose: () => observer.disconnect(),
            };
        }
        catch {
            observer.disconnect();
        }
    }

    return startPollingWatcher(handle, onChange, recursive);
}

function mapRecord(record: ObserverRecord): DirectoryChangeEvent {
    const path = (record.relativePathComponents ?? []).join('/');
    const kind = normalizeKind(record.type);

    return { kind, path };
}

function normalizeKind(type: string | undefined): DirectoryChangeEvent['kind'] {
    if (type === 'appeared' || type === 'added') {
        return 'created';
    }

    if (type === 'modified') {
        return 'modified';
    }

    if (type === 'disappeared' || type === 'removed') {
        return 'deleted';
    }

    if (type === 'moved') {
        return 'moved';
    }

    return 'unknown';
}

const POLL_INTERVAL_MS = 2500;

function startPollingWatcher(
    handle: FileSystemDirectoryHandle,
    onChange: (event: DirectoryChangeEvent) => void,
    recursive: boolean,
): DirectoryWatcher {
    let active = true;
    let lastSnapshot = new Map<string, number>();
    // False until a snapshot succeeds, so a failed first read doesn't report every entry as created.
    let hasBaseline = false;

    const tickAsync = async (): Promise<void> => {
        if (!active) {
            return;
        }

        try {
            const snapshot = await takeSnapshotAsync(handle, recursive);
            const changes = hasBaseline ? diffSnapshots(lastSnapshot, snapshot) : [];

            for (const change of changes) {
                onChange(change);
            }

            lastSnapshot = snapshot;
            hasBaseline = true;
        }
        catch {
            // Transient permission or disk error; try again on the next tick.
        }

        if (active) {
            window.setTimeout(() => void tickAsync(), POLL_INTERVAL_MS);
        }
    };

    const startAsync = async (): Promise<void> => {
        try {
            lastSnapshot = await takeSnapshotAsync(handle, recursive);
            hasBaseline = true;
        }
        catch {
            // The first read failed; the next tick takes the baseline instead.
        }

        if (active) {
            window.setTimeout(() => void tickAsync(), POLL_INTERVAL_MS);
        }
    };

    void startAsync();

    return {
        dispose: () => {
            active = false;
        },
    };
}

async function takeSnapshotAsync(
    root: FileSystemDirectoryHandle,
    recursive: boolean,
): Promise<Map<string, number>> {
    const snapshot = new Map<string, number>();
    await visitAsync(root, '', recursive, snapshot);

    return snapshot;
}

async function visitAsync(
    directory: FileSystemDirectoryHandle,
    path: string,
    recursive: boolean,
    snapshot: Map<string, number>,
): Promise<void> {
    for await (const entry of directory.values()) {
        if (isTransientEntry(entry.name)) {
            continue;
        }

        const childPath = path === '' ? entry.name : `${path}/${entry.name}`;

        if (entry.kind === 'file') {
            const file = await entry.getFile();
            snapshot.set(childPath, file.lastModified);
            continue;
        }

        snapshot.set(childPath, -1);

        if (recursive) {
            await visitAsync(entry, childPath, recursive, snapshot);
        }
    }
}

function diffSnapshots(
    previous: Map<string, number>,
    next: Map<string, number>,
): DirectoryChangeEvent[] {
    const events: DirectoryChangeEvent[] = [];

    for (const [path, mtime] of next) {
        const before = previous.get(path);

        if (before === undefined) {
            events.push({ kind: 'created', path });
            continue;
        }

        if (before !== mtime) {
            events.push({ kind: 'modified', path });
        }
    }

    for (const path of previous.keys()) {
        if (!next.has(path)) {
            events.push({ kind: 'deleted', path });
        }
    }

    return events;
}
