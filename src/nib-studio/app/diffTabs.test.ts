import { describe, expect, it } from 'vitest';
import { diffKindForPath, diffTabTitle, findDiffTab, openDiffTab, persistableDiffTabs, swapDiffTab } from './diffTabs.js';
import { normalizeTabOrder, type DiffSide } from './store.js';
import { openFileFixture } from '../testing/testHelpers.js';

function file(path: string): DiffSide {
    return { label: path, path, source: 'file', text: path };
}

describe('diff tabs', () => {
    it('picks the diff kind from the file type', () => {
        expect(diffKindForPath('a.json')).toBe('json');
        expect(diffKindForPath('a.xml')).toBe('xml');
        expect(diffKindForPath('a.yaml')).toBe('yaml');
        expect(diffKindForPath('ci.yml')).toBe('yaml');
        expect(diffKindForPath('a.md')).toBe('markdown');
        expect(diffKindForPath('a.csv')).toBe('rows');
        expect(diffKindForPath('a.xlsx')).toBe('rows');
        expect(diffKindForPath('a.tsv')).toBe('rows');

        for (const path of ['a.xls', 'a.xlsm', 'a.xltx', 'a.xltm', 'a.xlsb', 'a.ODS']) {
            expect(diffKindForPath(path), path).toBe('rows');
        }

        expect(diffKindForPath('a.ts')).toBe('text');
    });

    it('opens a tab for a new pair and focuses the existing one for the same pair in either order', () => {
        const first = openDiffTab({ diffTabs: [] }, file('a.json'), file('b.json'));
        expect(first.existed).toBe(false);
        expect(first.patch.activePath).toBe(first.tab.id);

        const again = openDiffTab({ diffTabs: first.patch.diffTabs }, file('b.json'), file('a.json'));
        expect(again.existed).toBe(true);
        expect(again.patch.diffTabs).toHaveLength(1);
        expect(again.patch.activePath).toBe(first.tab.id);
    });

    it('tells clipboard diffs apart by their text', () => {
        const clip = (text: string): DiffSide => ({ label: 'Clipboard', source: 'clipboard', text });
        const tab = openDiffTab({ diffTabs: [] }, file('a.txt'), clip('one')).tab;

        expect(findDiffTab([tab], file('a.txt'), clip('one'))).toBe(tab);
        expect(findDiffTab([tab], file('a.txt'), clip('two'))).toBeNull();
    });

    it('titles a tab with both names and swaps sides while keeping its state', () => {
        const tab = openDiffTab({ diffTabs: [] }, file('dir/a.json'), { label: 'Pasted text', source: 'paste', text: '{}' }).tab;
        expect(diffTabTitle(tab)).toBe('a.json ↔ Pasted text');

        tab.state.json.scroll['original'] = { top: 10, left: 0 };
        const swapped = swapDiffTab(tab);

        expect(diffTabTitle(swapped)).toBe('Pasted text ↔ a.json');
        expect(swapped.state).toBe(tab.state);
        expect(swapped.state.json.scroll['modified']).toEqual({ top: 10, left: 0 });
    });

    it('persists only diffs between two workspace files', () => {
        const files = openDiffTab({ diffTabs: [] }, file('a.json'), file('b.json'));
        const clip = openDiffTab({ diffTabs: files.patch.diffTabs }, file('a.json'), { label: 'Clipboard', source: 'clipboard', text: 'x' });
        const disk = openDiffTab({ diffTabs: clip.patch.diffTabs }, file('a.json'), { label: 'c.json', path: 'c.json', source: 'disk', text: 'x' });
        const tabOrder = ['a.json', files.tab.id, clip.tab.id, disk.tab.id];

        expect(persistableDiffTabs({ diffTabs: disk.patch.diffTabs, tabOrder })).toEqual([
            { original: 'a.json', modified: 'b.json', position: 1 },
        ]);
    });
});

describe('normalizeTabOrder', () => {
    it('appends new diff tabs and keeps a replaced preview file in its place', () => {
        const order = normalizeTabOrder(['a', 'diff:1', 'b'], [openFileFixture('a'), openFileFixture('c')], [
            { id: 'diff:1' } as never,
            { id: 'diff:2' } as never,
        ]);

        expect(order).toEqual(['a', 'c', 'diff:1', 'diff:2']);
    });
});
