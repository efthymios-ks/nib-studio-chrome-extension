import { describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../fs/testing/fakeFileSystem.js';
import { createLookupService, type LookupMessage } from './lookupService.js';

function serve(): { readonly handle: ReturnType<typeof createLookupService>; readonly messages: LookupMessage[] } {
    const messages: LookupMessage[] = [];

    return { handle: createLookupService((message) => messages.push(message)), messages };
}

describe('createLookupService', () => {
    it('answers a search with no results before it is started', () => {
        const { handle, messages } = serve();
        handle({ type: 'search', id: 7, query: 'report' });

        expect(messages).toEqual([{ type: 'results', id: 7, results: { query: 'report', results: [], total: 0 } }]);
    });

    it('lists the workspace it is started on, reports its progress and answers searches with their id', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('notes.txt', 'the quarterly report');
        const { handle, messages } = serve();
        handle({ type: 'start', root: asRoot(folder), codePage: 1252 });

        await vi.waitFor(() => expect(messages.some((message) => message.type === 'progress' && message.progress.isDone)).toBe(true));
        handle({ type: 'search', id: 1, query: 'quarterly' });

        expect(messages.at(-1)).toMatchObject({ type: 'results', id: 1, results: { query: 'quarterly', total: 1 } });
    });

    it('asks the page for a PDF\'s text and takes its answer', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('invoice.pdf', '%PDF-1.4');
        const { handle, messages } = serve();
        handle({ type: 'start', root: asRoot(folder), codePage: 1252 });

        const question = await vi.waitFor(() => {
            const asked = messages.find((message) => message.type === 'pdf-text');
            expect(asked).toBeDefined();

            return asked as Extract<LookupMessage, { type: 'pdf-text' }>;
        });
        expect(question.path).toBe('invoice.pdf');
        handle({ type: 'answer', id: question.id, value: { kind: 'text', text: 'Total due', isUnlocked: false } });

        await vi.waitFor(() => {
            handle({ type: 'search', id: 2, query: 'total due' });
            expect(messages.at(-1)).toMatchObject({ type: 'results', id: 2, results: { total: 1 } });
        });
    });

    it('takes unsaved texts and unlocked paths', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('draft.txt', 'saved');
        const { handle, messages } = serve();
        handle({ type: 'start', root: asRoot(folder), codePage: 1252 });
        await vi.waitFor(() => expect(messages.some((message) => message.type === 'progress' && message.progress.isDone)).toBe(true));

        handle({ type: 'open-texts', texts: [['draft.txt', 'unsaved']] });
        handle({ type: 'unlocked', paths: [] });
        handle({ type: 'search', id: 3, query: 'unsaved' });

        expect(messages.at(-1)).toMatchObject({ type: 'results', id: 3, results: { total: 1 } });
    });
});
