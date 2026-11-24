import { describe, expect, it } from 'vitest';
import type { LookupCandidate } from './lookupMatcher.js';
import { lookUp, SNIPPET_LEAD_CHARS, SNIPPET_LENGTH } from './lookupResults.js';
import { flattenText } from './lookupText.js';

function file(path: string, source: string | null, keepLines = true): LookupCandidate {
    const flat = source == null ? null : flattenText(source, { keepLines });
    const slash = path.lastIndexOf('/');

    return {
        path,
        name: path.slice(slash + 1),
        folder: slash < 0 ? '' : path.slice(0, slash),
        text: flat?.text ?? null,
        lineStarts: flat?.lineStarts ?? null,
    };
}

function marked(text: string, ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>): string[] {
    return ranges.map((range) => text.slice(range.start, range.end));
}

describe('lookUp', () => {
    it('highlights the name of a name match and gives it no preview', () => {
        const [result] = lookUp([file('docs/MyName.txt', 'my name is inside too')], 'my name').results;

        expect(result?.target).toBe('name');
        expect(marked(result?.name ?? '', result?.nameRanges ?? [])).toEqual(['MyName']);
        expect(result?.folder).toBe('docs');
        expect(result?.preview).toBeNull();
    });

    it('previews a content match flattened to one line, with every match in view highlighted and the line it starts on', () => {
        const source = 'Intro line\n\nThe   quarterly\treport is due.\nAnother quarterly note.';
        const [result] = lookUp([file('notes.txt', source)], 'quarterly').results;
        const preview = result?.preview;

        expect(result?.nameRanges).toEqual([]);
        expect(preview?.text).toBe('Intro line The quarterly report is due. Another quarterly note.');
        expect(marked(preview?.text ?? '', preview?.ranges ?? [])).toEqual(['quarterly', 'quarterly']);
        expect(preview?.line).toBe(3);
        expect(preview?.hasLead).toBe(false);
        expect(preview?.hasTail).toBe(false);
        expect(preview?.matchText).toBe('quarterly');
    });

    it('starts about twenty characters before the first match, at the start of a word, and marks what is cut off', () => {
        const before = 'alpha bravo charlie delta echo foxtrot golf hotel ';
        const source = `${before}needle ${'tail '.repeat(200)}`;
        const [result] = lookUp([file('long.txt', source, false)], 'needle').results;
        const preview = result?.preview;

        expect(preview?.hasLead).toBe(true);
        expect(preview?.hasTail).toBe(true);
        expect(preview?.text.startsWith('foxtrot golf hotel needle')).toBe(true);
        expect(preview?.text.indexOf('needle')).toBeLessThanOrEqual(SNIPPET_LEAD_CHARS);
        expect(preview?.text.length).toBeLessThanOrEqual(SNIPPET_LENGTH);
        expect(marked(preview?.text ?? '', preview?.ranges ?? [])).toEqual(['needle']);
        expect(preview?.line).toBeNull();
    });

    it('keeps the first match as the text has it, to hand to a viewer\'s Find', () => {
        const [result] = lookUp([file('invoice.txt', 'Customer: Anna   Smith')], 'anna smith').results;

        expect(result?.preview?.matchText).toBe('Anna Smith');
    });

    it('counts every match beyond the ones listed', () => {
        const results = lookUp([file('a.txt', 'x'), file('b.txt', 'x')], '');

        expect(results.total).toBe(2);
        expect(results.query).toBe('');
        expect(results.results.map((result) => result.target)).toEqual([null, null]);
    });
});
