import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFindHighlighter, FIND_CURRENT_HIGHLIGHT, FIND_HIGHLIGHT, indexText } from './documentFind.js';

function element(html: string): HTMLElement {
    const root = document.createElement('article');
    root.innerHTML = html;

    return root;
}

afterEach(() => {
    vi.unstubAllGlobals();
});


describe('indexText', () => {
    it('finds matches ignoring accents and final sigmas, as PDF Find does', () => {
        const root = element('<p>Η ΟΔΟΣ και η οδός</p><p>Café menu</p>');

        expect(indexText(root).find('οδος').map((range) => range.toString())).toEqual(['ΟΔΟΣ', 'οδός']);
        expect(indexText(root).find('cafe').map((range) => range.toString())).toEqual(['Café']);
    });

    it('finds matches ignoring case, across formatting inside a paragraph', () => {
        const root = element('<p>Quar<strong>terly</strong> report</p><p>QUARTERLY totals</p>');

        expect(indexText(root).find('quarterly').map((range) => range.toString())).toEqual(['Quarterly', 'QUARTERLY']);
    });

    it('never matches across two paragraphs or cells, and ignores spaces around the query', () => {
        const root = element('<p>end</p><p>start</p><table><tr><td>ab</td><td>cd</td></tr></table>');
        const index = indexText(root);

        expect(index.find('endstart')).toEqual([]);
        expect(index.find('bc')).toEqual([]);
        expect(index.find('  cd ').map((range) => range.toString())).toEqual(['cd']);
        expect(index.find('   ')).toEqual([]);
    });

    it('finds Greek text whatever its case and accents, without overlapping matches', () => {
        const root = element('<p>Η ΑΝΑΦΟΡΑ και η αναφορά</p><p>aaaa</p>');
        const index = indexText(root);

        expect(index.find('αναφορα').map((range) => range.toString())).toEqual(['ΑΝΑΦΟΡΑ', 'αναφορά']);
        expect(index.find('ΑΝΑΦΟΡΆ').map((range) => range.toString())).toEqual(['ΑΝΑΦΟΡΑ', 'αναφορά']);
        expect(index.find('aa')).toHaveLength(2);
    });
});

describe('createFindHighlighter', () => {
    it('draws all matches and the current one through CSS.highlights, and clears them', () => {
        const registry = new Map<string, unknown>();
        vi.stubGlobal('CSS', { highlights: registry });
        vi.stubGlobal('Highlight', class {
            readonly ranges: Range[];

            constructor(...ranges: Range[]) {
                this.ranges = ranges;
            }
        });
        const ranges = indexText(element('<p>one two one</p>')).find('one');
        const highlighter = createFindHighlighter();

        highlighter.show(ranges, 1);

        expect([...registry.keys()]).toEqual([FIND_HIGHLIGHT, FIND_CURRENT_HIGHLIGHT]);
        expect((registry.get(FIND_CURRENT_HIGHLIGHT) as { ranges: Range[] }).ranges).toEqual([ranges[1]]);

        highlighter.show([], -1);
        expect(registry.has(FIND_CURRENT_HIGHLIGHT)).toBe(false);

        highlighter.clear();
        expect(registry.size).toBe(0);
    });

    it('registers under names of its own when given them, such as those of the PDF preview', () => {
        const registry = new Map<string, unknown>();
        vi.stubGlobal('CSS', { highlights: registry });
        vi.stubGlobal('Highlight', class {});
        const ranges = indexText(element('<p>one two one</p>')).find('one');
        const highlighter = createFindHighlighter({ all: 'pdf-all', current: 'pdf-current' });
        highlighter.show(ranges, 0);

        expect([...registry.keys()]).toEqual(['pdf-all', 'pdf-current']);
        highlighter.clear();

        expect(registry.size).toBe(0);
    });

    it('does nothing where the browser has no highlight registry', () => {
        vi.stubGlobal('Highlight', undefined);

        expect(() => createFindHighlighter().show([], 0)).not.toThrow();
    });
});
