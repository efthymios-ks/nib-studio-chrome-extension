import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../common/fs/testing/fakeFileSystem.js';
import type { LookupMessage, LookupRequest } from '../common/lookup/lookupService.js';

interface WorkerScope {
    onmessage: ((event: { data: LookupRequest }) => void) | null;
}

const scope = self as unknown as WorkerScope;
let posted: LookupMessage[];

beforeEach(() => {
    posted = [];
    vi.spyOn(window, 'postMessage').mockImplementation(((message: LookupMessage) => {
        posted.push(message);
    }) as unknown as typeof window.postMessage);
});

afterEach(() => {
    scope.onmessage = null;
    vi.restoreAllMocks();
});

describe('lookupWorker', () => {
    it('lists the workspace it is sent, reads it and answers searches', async () => {
        vi.resetModules();
        await import('./lookupWorker.js');
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('notes/plan.txt', 'the warehouse inventory');
        scope.onmessage?.({ data: { type: 'start', root: asRoot(folder), codePage: 1252 } });

        await vi.waitFor(() => expect(posted.some((message) => message.type === 'progress' && message.progress.isDone)).toBe(true));
        scope.onmessage?.({ data: { type: 'search', id: 9, query: 'inventory' } });

        expect(posted.at(-1)).toMatchObject({ type: 'results', id: 9, results: { total: 1, results: [{ path: 'notes/plan.txt', folder: 'notes' }] } });
    });
});
