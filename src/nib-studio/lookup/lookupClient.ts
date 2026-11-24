import type { DirectoryChangeEvent } from '../../common/fs/directoryWatcher.js';
import type { LookupProgress, PdfReadOutcome } from '../../common/lookup/lookupIndex.js';
import type { LookupResults } from '../../common/lookup/lookupResults.js';
import { createLookupService, type LookupMessage, type LookupRequest } from '../../common/lookup/lookupService.js';

// The page's side of Lookup: the index runs in a worker, and the page sends it the workspace, searches,
// watcher events, unsaved texts and unlocked files, and answers its questions about PDFs and unlocked files.
// Without a worker, as in tests, the same index runs on the page.

export type LookupUpdate =
    | { readonly kind: 'results'; readonly results: LookupResults }
    | { readonly kind: 'progress'; readonly progress: LookupProgress };

export interface LookupClient {
    // Searches the index; keys typed while a search runs are searched together once it is back.
    search(query: string): void;
    // Lists the workspace again, reading only what changed, for changes the watcher may have missed.
    refresh(): void;
    applyChanges(events: ReadonlyArray<DirectoryChangeEvent>): void;
    setOpenTexts(texts: ReadonlyMap<string, string>): void;
    setUnlocked(paths: ReadonlySet<string>): void;
    // The last progress the index reported, or null before its first report.
    progress(): LookupProgress | null;
    subscribe(listener: (update: LookupUpdate) => void): () => void;
    dispose(): void;
}

export interface LookupWorkerLike {
    onmessage: ((event: MessageEvent<LookupMessage>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: LookupRequest, transfer?: Transferable[]): void;
    terminate(): void;
}

export interface LookupClientOptions {
    readonly root: FileSystemDirectoryHandle;
    readonly codePage: number;
    readonly readPdfTextAsync: (path: string, file: File) => Promise<PdfReadOutcome>;
    readonly readUnlockedBytesAsync: (path: string, file: File) => Promise<Uint8Array | null>;
    // Null runs the index on the page.
    readonly createWorker?: (() => LookupWorkerLike) | null;
}

// Watcher events wait this long, so a burst of them goes to the index as one batch.
const CHANGE_BATCH_MS = 100;

// The worker script sits next to main.js in the package and is never fetched from anywhere else.
export function createLookupWorker(): LookupWorkerLike {
    const worker = new Worker(new URL('./lookupWorker.js', import.meta.url), { name: 'Nib Studio lookup' });

    return worker as unknown as LookupWorkerLike;
}

interface Transport {
    send(request: LookupRequest, transfer?: Transferable[]): void;
    stop(): void;
}

// The index on the page, behind the same messages, each handled in a task of its own.
function inPageTransport(receive: (message: LookupMessage) => void): Transport {
    let isStopped = false;
    const handle = createLookupService((message) => {
        setTimeout(() => {
            if (!isStopped) {
                receive(message);
            }
        }, 0);
    });

    return {
        send: (request) => {
            setTimeout(() => {
                if (!isStopped) {
                    handle(request);
                }
            }, 0);
        },
        stop: () => {
            isStopped = true;
        },
    };
}

function workerTransport(
    worker: LookupWorkerLike,
    receive: (message: LookupMessage) => void,
    onFail: () => void,
): Transport {
    worker.onmessage = (event) => receive(event.data);
    worker.onerror = (event) => {
        event.preventDefault?.();
        onFail();
    };

    return {
        send: (request, transfer) => worker.postMessage(request, transfer ?? []),
        stop: () => worker.terminate(),
    };
}

export function createLookupClient(options: LookupClientOptions): LookupClient {
    const listeners = new Set<(update: LookupUpdate) => void>();
    let lastProgress: LookupProgress | null = null;
    let nextSearch = 1;
    // The query of the search under way, or null.
    let searching: string | null = null;
    let waitingQuery: string | null = null;
    let pendingChanges: DirectoryChangeEvent[] = [];
    let changeTimer: ReturnType<typeof setTimeout> | null = null;
    let openTexts: ReadonlyArray<readonly [string, string]> = [];
    let unlocked: ReadonlyArray<string> = [];
    let isDisposed = false;

    const emit = (update: LookupUpdate): void => {
        for (const listener of [...listeners]) {
            listener(update);
        }
    };

    const answerAsync = async (
        id: number,
        readAsync: () => Promise<PdfReadOutcome | Uint8Array | null>,
        fallback: PdfReadOutcome | null,
    ): Promise<void> => {
        let value: PdfReadOutcome | Uint8Array | null;

        try {
            value = await readAsync();
        }
        catch {
            value = fallback;
        }

        if (isDisposed) {
            return;
        }

        // The bytes go over as a copy of their own, so the studio's copy of an unlocked file stays whole.
        const transfer: Transferable[] = value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : [];
        transport.send({ type: 'answer', id, value }, transfer);
    };

    const receive = (message: LookupMessage): void => {
        if (isDisposed) {
            return;
        }

        if (message.type === 'progress') {
            lastProgress = message.progress;
            emit({ kind: 'progress', progress: message.progress });

            return;
        }

        if (message.type === 'results') {
            searching = null;
            emit({ kind: 'results', results: message.results });
            sendWaitingSearch();

            return;
        }

        if (message.type === 'pdf-text') {
            const readAsync = async (): Promise<PdfReadOutcome> => await options.readPdfTextAsync(message.path, message.file);
            void answerAsync(message.id, readAsync, { kind: 'name-only' });

            return;
        }

        void answerAsync(message.id, async () => {
            const bytes = await options.readUnlockedBytesAsync(message.path, message.file);

            return bytes == null ? null : bytes.slice();
        }, null);
    };

    const start = (next: Transport): Transport => {
        next.send({ type: 'start', root: options.root, codePage: options.codePage });
        next.send({ type: 'open-texts', texts: openTexts });
        next.send({ type: 'unlocked', paths: unlocked });

        return next;
    };

    // A worker that fails to start, or stops working, gives way to the index on the page, listing the workspace again.
    const fallBack = (): void => {
        transport.stop();
        waitingQuery ??= searching;
        searching = null;
        transport = start(inPageTransport(receive));
        sendWaitingSearch();
    };

    // A worker the browser refuses to start leaves the index on the page from the start.
    const firstTransport = (): Transport => {
        if (options.createWorker == null) {
            return inPageTransport(receive);
        }

        try {
            return workerTransport(options.createWorker(), receive, () => fallBack());
        }
        catch {
            return inPageTransport(receive);
        }
    };
    let transport: Transport = start(firstTransport());

    const sendSearch = (query: string): void => {
        searching = query;
        transport.send({ type: 'search', id: nextSearch, query });
        nextSearch += 1;
    };

    const sendWaitingSearch = (): void => {
        if (waitingQuery == null || searching != null) {
            return;
        }

        const query = waitingQuery;
        waitingQuery = null;
        sendSearch(query);
    };

    const flushChanges = (): void => {
        changeTimer = null;

        if (pendingChanges.length > 0 && !isDisposed) {
            transport.send({ type: 'changes', events: pendingChanges });
            pendingChanges = [];
        }
    };

    return {
        search: (query) => {
            waitingQuery = query;
            sendWaitingSearch();
        },
        refresh: () => transport.send({ type: 'refresh' }),
        applyChanges: (events) => {
            pendingChanges.push(...events);
            changeTimer ??= setTimeout(flushChanges, CHANGE_BATCH_MS);
        },
        setOpenTexts: (texts) => {
            openTexts = [...texts];
            transport.send({ type: 'open-texts', texts: openTexts });
        },
        setUnlocked: (paths) => {
            unlocked = [...paths];
            transport.send({ type: 'unlocked', paths: unlocked });
        },
        progress: () => lastProgress,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        dispose: () => {
            isDisposed = true;
            listeners.clear();

            if (changeTimer != null) {
                clearTimeout(changeTimer);
                changeTimer = null;
            }

            transport.stop();
        },
    };
}
