import { foldPattern } from '../text/findFolding.js';

// A Lookup query as the matchers use it: case, accents, Greek tones and a final ς are ignored everywhere,
// and the separators space, `_`, `-`, `.` and `,` may come and go between the typed letters,
// so "my name" matches "MyName", "my_name" and "My-Name".

const SEPARATORS = /[\s_.,-]+/u;
const LOOSE_GAP = '[\\s_.,\\-]*';
const FLAGS = 'giu';
// Scattered letters need the place of each letter, which only `d` gives.
const SCATTERED_FLAGS = 'dgiu';

export interface LookupQuery {
    // The typed letters without separators, such as "myname" for "my name".
    readonly compact: string;
    // How many characters the query matches with, the separators and lone marks left out.
    readonly letterCount: number;
    // The whole query as one phrase, separators optional.
    readonly phrase: RegExp;
    // Each word of a query of two words or more, matched in any order; empty for one word.
    readonly words: ReadonlyArray<RegExp>;
    // The letters in order with anything between, each in its own group; null for a single letter.
    readonly scattered: RegExp | null;
}

// The pattern of one word: each typed character with all its folded forms, separators optional between them.
function loosePattern(word: string): string {
    return Array.from(word)
        .map((character) => foldPattern(character))
        .filter((pattern) => pattern != null)
        .join(LOOSE_GAP);
}

// Null for a query of only separators, or of marks that fold to nothing.
export function createLookupQuery(text: string): LookupQuery | null {
    const words = text.trim().split(SEPARATORS).filter((word) => word !== '');
    const compact = words.join('');
    const phrase = loosePattern(compact);

    if (phrase === '') {
        return null;
    }

    const letters = Array.from(compact)
        .map((character) => foldPattern(character))
        .filter((pattern) => pattern != null);
    const wordPatterns = words
        .map((word) => loosePattern(word))
        .filter((pattern) => pattern !== '');

    return {
        compact,
        letterCount: letters.length,
        phrase: new RegExp(phrase, FLAGS),
        words: words.length > 1 ? wordPatterns.map((pattern) => new RegExp(pattern, FLAGS)) : [],
        scattered: letters.length > 1
            ? new RegExp(letters.map((pattern) => `(${pattern})`).join('.*?'), SCATTERED_FLAGS)
            : null,
    };
}
