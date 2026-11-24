import { describe, expect, it } from 'vitest';
import { createLookupQuery } from './lookupQuery.js';
import { findMatches, firstMatchRange, MAX_RANGES, MAX_RESULTS, type LookupCandidate } from './lookupMatcher.js';

function file(path: string, text: string | null = null): LookupCandidate {
    const slash = path.lastIndexOf('/');

    return { path, name: path.slice(slash + 1), folder: slash < 0 ? '' : path.slice(0, slash), text, lineStarts: null };
}

function ranked(candidates: ReadonlyArray<LookupCandidate>, query: string): Array<[string, number]> {
    return findMatches(candidates, query).matches.map((match) => [match.candidate.path, match.tier]);
}

function marked(text: string, ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>): string[] {
    return ranges.map((range) => text.slice(range.start, range.end));
}

describe('createLookupQuery', () => {
    it('drops the separators space, _, -, . and , from the phrase, and keeps the words apart', () => {
        const query = createLookupQuery('  my_name-is.here, ok ');

        expect(query?.compact).toBe('mynameishereok');
        expect(query?.words).toHaveLength(5);
        expect(query?.letterCount).toBe(14);
    });

    it('has no words for a single word and no scattered letters for a single letter', () => {
        expect(createLookupQuery('report')?.words).toEqual([]);
        expect(createLookupQuery('r')?.scattered).toBeNull();
    });

    it('is null for a query of only separators, or of marks that fold to nothing', () => {
        expect(createLookupQuery(' _-., ')).toBeNull();
        expect(createLookupQuery('́')).toBeNull();
    });
});

describe('findMatches tiers', () => {
    const files = [
        file('MyName.txt'),
        file('notes/name-my.md'),
        file('budget.txt', 'The total of my name list.'),
        file('mnemonic.txt'),
        file('m.n.o.p.q.r.s.t.u.v.w.x.y.z.m.txt'),
        file('words.txt', 'name, and later: my'),
    ];

    it('ranks phrase in name, words in name, phrase in content, scattered letters in name, then words in content', () => {
        expect(ranked(files, 'my name')).toEqual([
            ['MyName.txt', 5],
            ['notes/name-my.md', 4],
            ['budget.txt', 3],
            ['words.txt', 1],
        ]);
        expect(ranked(files, 'mnm')).toEqual([['MyName.txt', 2], ['mnemonic.txt', 2]]);
    });

    it('lets the first rule that matches a file win, so a file found by name never ranks by its content', () => {
        const both = [file('report.txt', 'report report')];
        const [match] = findMatches(both, 'report').matches;

        expect(match?.target).toBe('name');
        expect(match?.tier).toBe(5);
    });

    it('ignores case, accents, Greek tones, a final ς and separators', () => {
        const greek = [file('Σημειώσεις Συνάντησης.txt'), file('Ο_δρόμος-της.md'), file('Café-Menu.txt')];

        expect(ranked(greek, 'συναντηση').map(([path]) => path)).toEqual(['Σημειώσεις Συνάντησης.txt']);
        expect(ranked(greek, 'ΣΥΝΑΝΤΗΣΗΣ').map(([path]) => path)).toEqual(['Σημειώσεις Συνάντησης.txt']);
        expect(ranked(greek, 'οδρομοσ').map(([path]) => path)).toEqual(['Ο_δρόμος-της.md']);
        expect(ranked(greek, 'cafe menu').map(([path]) => path)).toEqual(['Café-Menu.txt']);
    });

    it('never matches content by scattered letters', () => {
        expect(ranked([file('a.txt', 'many nice moments')], 'mnm')).toEqual([]);
    });

    it('takes scattered letters only while they span at most three characters for each letter typed', () => {
        const near = file('m123n123m.txt');
        const far = file('m1234n123m.txt');

        expect(ranked([near, far], 'mnm').map(([path]) => path)).toEqual(['m123n123m.txt']);
    });

    it('tries scattered letters from each place the first letter appears, so a tight match later in the name counts', () => {
        const [match] = findMatches([file('m_________________MyName.txt')], 'mnm').matches;

        expect(marked('m_________________MyName.txt', match?.ranges ?? [])).toEqual(['M', 'N', 'm']);
    });

    it('needs every word of the query, in name or content', () => {
        expect(ranked([file('alpha.txt', 'beta gamma')], 'beta delta')).toEqual([]);
    });
});

describe('findMatches order and limits', () => {
    it('puts an earlier match first within a tier, then a shorter name', () => {
        const files = [
            file('zz-report.txt'),
            file('report-long-name.txt'),
            file('report.txt'),
            file('a/report.md'),
        ];

        expect(ranked(files, 'report').map(([path]) => path)).toEqual(['a/report.md', 'report.txt', 'report-long-name.txt', 'zz-report.txt']);
    });

    it('orders content matches by where the first match is', () => {
        const files = [file('late.txt', 'xxxxxxxxxx needle'), file('early.txt', 'needle')];

        expect(ranked(files, 'needle').map(([path]) => path)).toEqual(['early.txt', 'late.txt']);
    });

    it('keeps the best 500 files and counts every match', () => {
        const files = Array.from({ length: MAX_RESULTS + 20 }, (_, index) => file(`note-${index}.txt`));
        const list = findMatches(files, 'note');

        expect(list.matches).toHaveLength(MAX_RESULTS);
        expect(list.total).toBe(MAX_RESULTS + 20);
    });

    it('keeps at most 50 ranges for a file', () => {
        const [match] = findMatches([file('a.txt', 'cat '.repeat(80))], 'cat').matches;

        expect(match?.ranges).toHaveLength(MAX_RANGES);
    });

    it('sorts the ranges of words by where they are', () => {
        const text = 'gamma beta alpha beta';
        const [match] = findMatches([file('a.txt', text)], 'beta gamma').matches;

        expect(marked(text, match?.ranges ?? [])).toEqual(['gamma', 'beta', 'beta']);
        expect(match?.position).toBe(0);
    });

    it('lists every file by folder and then by name for an empty query', () => {
        const files = [file('b/two.txt'), file('z.txt'), file('a.txt'), file('b/One.txt')];
        const list = findMatches(files, '   ');

        expect(list.matches.map((match) => match.candidate.path)).toEqual(['a.txt', 'z.txt', 'b/One.txt', 'b/two.txt']);
        expect(list.matches.every((match) => match.target == null && match.tier === 0)).toBe(true);
    });
});

describe('firstMatchRange', () => {
    const text = 'Total due\nNothing here\nThe total\n  amount is due\n';

    it('finds the phrase as the editor holds the text, across a line break too', () => {
        const range = firstMatchRange(text, 'total amount', null);

        expect(text.slice(range?.start, range?.end)).toBe('total\n  amount');
    });

    it('starts from the line Lookup showed, so the same match is selected', () => {
        const range = firstMatchRange(text, 'due', 3);

        expect(range?.start).toBe(text.lastIndexOf('due'));
    });

    it('falls back to the earliest word when the phrase isn\'t there, and to the start when the line is past it', () => {
        const words = firstMatchRange(text, 'here nothing', null);
        const fromStart = firstMatchRange(text, 'total', 9);

        expect(text.slice(words?.start, words?.end)).toBe('Nothing');
        expect(fromStart?.start).toBe(0);
        expect(firstMatchRange(text, 'missing', null)).toBeNull();
    });
});
