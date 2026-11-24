import type { CodePointRanges } from './fontTables.js';

// Controls, format characters, surrogates, separators and blanks would only show as empty cells,
// so they are neither shown nor counted.
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zs}\p{Zl}\p{Zp}]/u;

// The characters of a font that the preview can show: the first of them up to a limit, and how many there are.
export interface ShownCharacters {
    readonly shown: ReadonlyArray<string>;
    readonly total: number;
}

// One rule decides what the sheet shows and what both the sheet and the Info panel count,
// so a count never includes a character the sheet leaves out.
export function shownCharacters(ranges: CodePointRanges, limit: number): ShownCharacters {
    const shown: string[] = [];
    let total = 0;

    for (const [first, last] of ranges) {
        for (let code = first; code <= last; code += 1) {
            const character = String.fromCodePoint(code);

            if (HIDDEN_CHARACTER.test(character)) {
                continue;
            }

            total += 1;

            if (shown.length < limit) {
                shown.push(character);
            }
        }
    }

    return { shown, total };
}

export function countShownCharacters(ranges: CodePointRanges): number {
    return shownCharacters(ranges, 0).total;
}
