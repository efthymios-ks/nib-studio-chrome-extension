import { describe, expect, it, vi } from 'vitest';
import {
    bytesForDisk,
    displayPath,
    externalTabPath,
    isDiffTab,
    normalizeTabOrder,
    orderedTabs,
    Store,
    tabId,
    textForDisk,
    textFromDisk,
    type DiffTab,
} from './store.js';
import { openFileFixture } from '../testing/testHelpers.js';

function diffTab(id: string): DiffTab {
    return {
        id,
        kind: 'diff',
        diffKind: 'text',
        original: null,
        modified: null,
        state: {} as DiffTab['state'],
    };
}

describe('isDiffTab', () => {
    it('tells diff tabs from file tabs and missing tabs', () => {
        expect(isDiffTab(diffTab('d1'))).toBe(true);
        expect(isDiffTab(openFileFixture('a.txt'))).toBe(false);
        expect(isDiffTab(null)).toBe(false);
        expect(isDiffTab(undefined)).toBe(false);
    });
});

describe('tabId', () => {
    it('uses the path of a file tab and the id of a diff tab', () => {
        expect(tabId(openFileFixture('docs/a.md'))).toBe('docs/a.md');
        expect(tabId(diffTab('diff-7'))).toBe('diff-7');
    });
});

describe('displayPath', () => {
    it('shows a workspace path as it is and a file from outside the workspace by its name', () => {
        expect(displayPath('docs/a.md')).toBe('docs/a.md');
        expect(displayPath(externalTabPath(3, 'notes.txt'))).toBe('notes.txt');
    });
});

describe('textFromDisk', () => {
    it('holds the text with newlines and keeps the line ending of the file', () => {
        expect(textFromDisk('one\r\ntwo\r\n')).toEqual({ text: 'one\ntwo\n', originalText: 'one\ntwo\n', lineEnding: '\r\n', encoding: 'utf-8' });
        expect(textFromDisk('one\ntwo')).toEqual({ text: 'one\ntwo', originalText: 'one\ntwo', lineEnding: '\n', encoding: 'utf-8' });
    });

    it('keeps the most common ending of a file with mixed line endings', () => {
        expect(textFromDisk('a\r\nb\r\nc\nd').lineEnding).toBe('\r\n');
    });

    it('keeps the encoding the text was read in', () => {
        expect(textFromDisk('Καλημέρα\r\n', 'windows-1253').encoding).toBe('windows-1253');
    });
});

describe('textForDisk', () => {
    it('puts the line ending of the file back into the text', () => {
        expect(textForDisk(openFileFixture('a.txt', 'one\ntwo\n', { lineEnding: '\r\n' }))).toBe('one\r\ntwo\r\n');
        expect(textForDisk(openFileFixture('a.txt', 'one\ntwo\n'))).toBe('one\ntwo\n');
    });
});

describe('bytesForDisk', () => {
    it('writes the text in the file\'s own encoding, with its line ending', () => {
        const greek = openFileFixture('notes.txt', 'Καλημέρα\n', { lineEnding: '\r\n', encoding: 'windows-1253' });

        expect(bytesForDisk(greek)).toEqual({ ok: true, bytes: Uint8Array.of(0xca, 0xe1, 0xeb, 0xe7, 0xec, 0xdd, 0xf1, 0xe1, 0x0d, 0x0a) });
    });

    it('writes UTF-8 when the file has no encoding of its own', () => {
        expect(bytesForDisk(openFileFixture('a.txt', 'é'))).toEqual({ ok: true, bytes: Uint8Array.of(0xc3, 0xa9) });
    });

    it('names the characters the encoding can\'t hold', () => {
        const greek = openFileFixture('notes.txt', 'Καλημέρα ü', { encoding: 'windows-1253' });

        expect(bytesForDisk(greek)).toEqual({ ok: false, unrepresentable: ['ü'] });
    });
});

describe('orderedTabs', () => {
    it('returns tabs in tab order and skips ids with no open tab', () => {
        const tabs = orderedTabs({
            openFiles: [openFileFixture('a.txt'), openFileFixture('b.txt')],
            diffTabs: [diffTab('d1')],
            tabOrder: ['b.txt', 'gone', 'd1', 'a.txt'],
        });

        expect(tabs.map(tabId)).toEqual(['b.txt', 'd1', 'a.txt']);
    });
});

describe('normalizeTabOrder', () => {
    it('keeps the previous order of tabs that are still open and drops closed ones', () => {
        const order = normalizeTabOrder(['b.txt', 'x.txt', 'a.txt'], [openFileFixture('a.txt'), openFileFixture('b.txt')], []);

        expect(order).toEqual(['b.txt', 'a.txt']);
    });

    it('removes duplicate ids', () => {
        const order = normalizeTabOrder(['a.txt', 'a.txt'], [openFileFixture('a.txt')], []);

        expect(order).toEqual(['a.txt']);
    });

    it('places a new file after the file it follows in openFiles', () => {
        const order = normalizeTabOrder(
            ['a.txt', 'd1', 'c.txt'],
            [openFileFixture('a.txt'), openFileFixture('b.txt'), openFileFixture('c.txt')],
            [diffTab('d1')],
        );

        expect(order).toEqual(['a.txt', 'b.txt', 'd1', 'c.txt']);
    });

    it('places a new first file before the file that comes after it', () => {
        const order = normalizeTabOrder(['d1', 'b.txt'], [openFileFixture('a.txt'), openFileFixture('b.txt')], [diffTab('d1')]);

        expect(order).toEqual(['d1', 'a.txt', 'b.txt']);
    });

    it('appends files with no placed neighbour and new diff tabs at the end', () => {
        const order = normalizeTabOrder(['d1'], [openFileFixture('a.txt')], [diffTab('d1'), diffTab('d2')]);

        expect(order).toEqual(['d1', 'a.txt', 'd2']);
    });
});

describe('Store', () => {
    it('starts empty on the files surface with the light theme', () => {
        const state = new Store().getState();

        expect(state.workspace).toBeNull();
        expect(state.openFiles).toEqual([]);
        expect(state.diffTabs).toEqual([]);
        expect(state.tabOrder).toEqual([]);
        expect(state.activePath).toBeNull();
        expect(state.activeSurface).toBe('files');
        expect(state.theme).toBe('light');
        expect(state.busy).toBe(false);
    });

    it('merges a patch and notifies every listener with the new state', () => {
        const store = new Store();
        const first = vi.fn();
        const second = vi.fn();
        store.subscribe(first);
        store.subscribe(second);

        store.update({ busy: true, selectedPath: 'a.txt' });

        expect(store.getState().busy).toBe(true);
        expect(store.getState().selectedPath).toBe('a.txt');
        expect(store.getState().theme).toBe('light');
        expect(first).toHaveBeenCalledWith(store.getState());
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('stops notifying a listener after it unsubscribes', () => {
        const store = new Store();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        unsubscribe();

        store.update({ busy: true });

        expect(listener).not.toHaveBeenCalled();
    });

    it('keeps tab order in step when open files or diff tabs change', () => {
        const store = new Store();
        store.update({ openFiles: [openFileFixture('a.txt')] });
        store.update({ diffTabs: [diffTab('d1')] });
        store.update({ openFiles: [openFileFixture('a.txt'), openFileFixture('b.txt')] });

        expect(store.getState().tabOrder).toEqual(['a.txt', 'b.txt', 'd1']);

        store.update({ openFiles: [openFileFixture('b.txt')] });

        expect(store.getState().tabOrder).toEqual(['b.txt', 'd1']);
    });

    it('accepts an explicit tab order but drops ids with no open tab', () => {
        const store = new Store();
        store.update({ openFiles: [openFileFixture('a.txt'), openFileFixture('b.txt')] });
        store.update({ tabOrder: ['b.txt', 'missing', 'a.txt'] });

        expect(store.getState().tabOrder).toEqual(['b.txt', 'a.txt']);
    });

    it('leaves tab order alone when the patch does not touch tabs', () => {
        const store = new Store();
        store.update({ openFiles: [openFileFixture('a.txt')] });
        const order = store.getState().tabOrder;

        store.update({ busy: true });

        expect(store.getState().tabOrder).toBe(order);
    });

    it('hydrates the theme from the saved session', () => {
        const store = new Store();
        const listener = vi.fn();
        store.subscribe(listener);

        store.hydrateGlobals({ theme: 'dark' });

        expect(store.getState().theme).toBe('dark');
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
