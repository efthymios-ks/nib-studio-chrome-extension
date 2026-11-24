import { describe, expect, it } from 'vitest';
import { withLiveSides } from './app.js';
import type { DiffSide, DiffTab, OpenFile } from './store.js';

const ORIGINAL: DiffSide = { label: 'a.txt', path: 'a.txt', source: 'file', text: 'one\n' };
const MODIFIED: DiffSide = { label: 'b.txt', path: 'b.txt', source: 'file', text: 'two\n' };
const TAB = { id: 'diff-1', kind: 'diff', diffKind: 'text', original: ORIGINAL, modified: MODIFIED } as unknown as DiffTab;

function openFile(path: string, text: string): OpenFile {
    return { path, text, dirty: true, view: 'editor', file: null, preview: false } as unknown as OpenFile;
}

describe('withLiveSides', () => {
    it('hands back the tab itself when no open file changes a side', () => {
        expect(withLiveSides(TAB, [])).toBe(TAB);
        expect(withLiveSides(TAB, [openFile('a.txt', 'one\n')])).toBe(TAB);
    });

    it('puts an open file\'s unsaved text on its side', () => {
        const live = withLiveSides(TAB, [openFile('a.txt', 'one, edited\n')]);

        expect(live).not.toBe(TAB);
        expect(live.original?.text).toBe('one, edited\n');
        expect(live.modified).toBe(MODIFIED);
    });

    it('hands back the same live tab while the texts stay the same, so the compare stays mounted', () => {
        const first = withLiveSides(TAB, [openFile('a.txt', 'one, edited\n')]);
        const again = withLiveSides(TAB, [openFile('a.txt', 'one, edited\n')]);
        const changed = withLiveSides(TAB, [openFile('a.txt', 'one, edited twice\n')]);

        expect(again).toBe(first);
        expect(changed).not.toBe(first);
        expect(changed.original?.text).toBe('one, edited twice\n');
    });
});
