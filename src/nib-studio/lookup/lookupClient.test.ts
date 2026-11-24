import { afterEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import type { LookupMessage, LookupRequest } from '../../common/lookup/lookupService.js';
import { createLookupClient, type LookupClient, type LookupClientOptions, type LookupUpdate, type LookupWorkerLike } from './lookupClient.js';

const clients: LookupClient[] = [];

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.dispose();
    }
});

function connect(folder: FakeDirectoryHandle, options: Partial<LookupClientOptions> = {}): { client: LookupClient; updates: LookupUpdate[] } {
    const client = createLookupClient({
        root: asRoot(folder),
        codePage: 1252,
        readPdfTextAsync: async () => ({ kind: 'name-only' }),
        readUnlockedBytesAsync: async () => null,
        createWorker: null,
        ...options,
    });
    const updates: LookupUpdate[] = [];
    client.subscribe((update) => updates.push(update));
    clients.push(client);

    return { client, updates };
}

function searched(updates: ReadonlyArray<LookupUpdate>): string[] {
    return updates.flatMap((update) => (update.kind === 'results' ? [update.results.query] : []));
}

async function readAllAsync(client: LookupClient): Promise<void> {
    await vi.waitFor(() => expect(client.progress()?.isDone).toBe(true));
}

interface FakeWorker extends LookupWorkerLike {
    readonly posted: Array<{ readonly request: LookupRequest; readonly transfer: Transferable[] }>;
}

function fakeWorker(): FakeWorker {
    const posted: FakeWorker['posted'] = [];

    return {
        posted,
        onmessage: null,
        onerror: null,
        postMessage: (request, transfer = []) => posted.push({ request, transfer }),
        terminate: vi.fn(),
    };
}

describe('createLookupClient', () => {
    it('runs the index on the page without a worker, and searches keys typed during a search together', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('report.txt', 'quarterly');
        const { client, updates } = connect(folder);
        await readAllAsync(client);

        client.search('r');
        client.search('re');
        client.search('rep');

        await vi.waitFor(() => expect(searched(updates)).toEqual(['r', 'rep']));
        expect(updates.some((update) => update.kind === 'progress')).toBe(true);
    });

    it('answers the index\'s question about a PDF with the page\'s reader', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('invoice.pdf', '%PDF-1.7');
        const readPdfTextAsync = vi.fn(async () => ({ kind: 'text', text: 'Total due', isUnlocked: false }) as const);
        const { client, updates } = connect(folder, { readPdfTextAsync });
        await readAllAsync(client);
        client.search('total due');

        await vi.waitFor(() => expect(updates.at(-1)).toMatchObject({ kind: 'results', results: { total: 1 } }));
        expect(readPdfTextAsync).toHaveBeenCalledWith('invoice.pdf', expect.any(File));
    });

    it('sends watcher events in a batch', async () => {
        const folder = new FakeDirectoryHandle('space');
        const { client, updates } = connect(folder);
        await readAllAsync(client);

        folder.addFile('one.txt', 'fresh');
        folder.addFile('two.txt', 'fresh');
        client.applyChanges([{ kind: 'created', path: 'one.txt' }]);
        client.applyChanges([{ kind: 'created', path: 'two.txt' }]);

        await vi.waitFor(() => {
            client.search('fresh');
            expect(updates.at(-1)).toMatchObject({ kind: 'results', results: { total: 2 } });
        });
    });

    it('starts a worker with the workspace, the code page, the unsaved texts and the unlocked files', () => {
        const worker = fakeWorker();
        const folder = new FakeDirectoryHandle('space');
        const { client } = connect(folder, { createWorker: () => worker, codePage: 1253 });
        client.setOpenTexts(new Map([['a.txt', 'draft']]));
        client.setUnlocked(new Set(['b.xlsx']));
        client.search('draft');

        expect(worker.posted.map((post) => post.request.type)).toEqual(['start', 'open-texts', 'unlocked', 'open-texts', 'unlocked', 'search']);
        expect(worker.posted[0]?.request).toMatchObject({ type: 'start', codePage: 1253 });
        expect(worker.posted[3]?.request).toEqual({ type: 'open-texts', texts: [['a.txt', 'draft']] });
    });

    it('hands the worker a copy of an unlocked file\'s bytes, so the tab\'s copy stays whole', async () => {
        const worker = fakeWorker();
        const unlocked = Uint8Array.of(1, 2, 3);
        connect(new FakeDirectoryHandle('space'), { createWorker: () => worker, readUnlockedBytesAsync: async () => unlocked });
        const file = new File(['x'], 'salaries.xlsx');
        worker.onmessage?.({ data: { type: 'unlocked-bytes', id: 4, path: 'salaries.xlsx', file } } as MessageEvent<LookupMessage>);

        await vi.waitFor(() => expect(worker.posted.at(-1)?.request.type).toBe('answer'));
        const answer = worker.posted.at(-1);

        expect(answer?.request).toEqual({ type: 'answer', id: 4, value: Uint8Array.of(1, 2, 3) });
        expect(answer?.transfer).toHaveLength(1);
        expect(answer?.transfer[0]).not.toBe(unlocked.buffer);
    });

    it('gives way to the index on the page when the worker fails, searching again what was under way', async () => {
        const worker = fakeWorker();
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('report.txt', 'quarterly');
        const { client, updates } = connect(folder, { createWorker: () => worker });
        client.search('quarterly');
        worker.onerror?.({ preventDefault: () => {} } as ErrorEvent);

        expect(worker.terminate).toHaveBeenCalled();
        await vi.waitFor(() => {
            client.search('quarterly');
            expect(updates.at(-1)).toMatchObject({ kind: 'results', results: { query: 'quarterly', total: 1 } });
        });
    });
});
