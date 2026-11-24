import { foldCharacter } from '../text/findFolding.js';

// Find in a PDF: each page's text as pdf.js gives it, folded so a search ignores case and accents,
// with every folded character traced back to the text item and the offsets it came from.

// A text item of a page, as pdf.js's getTextContent gives it.
export interface PdfTextItem {
    readonly str: string;
    readonly hasEOL: boolean;
}

// A place in a page's text: the item, and an offset in its string.
interface ItemOffset {
    readonly item: number;
    readonly offset: number;
}

export interface PdfMatch {
    readonly page: number;
    readonly start: ItemOffset;
    // Just past the match's last character, with any accent written after it.
    readonly end: ItemOffset;
}

// A page's text ready to search: the folded text, and for each of its characters the item it came from
// and where in that item's string the original character starts and ends.
// The space a line break folds to belongs to no item, so its item is -1.
export interface SearchablePage {
    readonly folded: string;
    readonly items: ReadonlyArray<number>;
    readonly starts: ReadonlyArray<number>;
    readonly ends: ReadonlyArray<number>;
}

const WHITESPACE = /^\s$/u;
const LINE_BREAK = -1;

interface Folder {
    append(text: string, item: number): void;
    appendLineBreak(): void;
    finish(): SearchablePage;
}

// Folds text character by character. A run of white space becomes one space,
// and leading white space is dropped;
// a mark on its own, such as a combining accent, folds to nothing and stays with the character before it.
function createFolder(): Folder {
    let folded = '';
    const items: number[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    let isAfterSpace = true;

    const emit = (output: string, item: number, start: number, end: number): void => {
        folded += output;

        for (let unit = 0; unit < output.length; unit += 1) {
            items.push(item);
            starts.push(start);
            ends.push(end);
        }
    };

    return {
        append: (text, item) => {
            let offset = 0;

            for (const character of text) {
                const start = offset;
                offset += character.length;

                if (WHITESPACE.test(character)) {
                    if (!isAfterSpace) {
                        emit(' ', item, start, offset);
                        isAfterSpace = true;
                    }

                    continue;
                }

                const output = foldCharacter(character);

                if (output === '') {
                    if (items.at(-1) === item) {
                        ends[ends.length - 1] = offset;
                    }

                    continue;
                }

                emit(output, item, start, offset);
                isAfterSpace = false;
            }
        },
        appendLineBreak: () => {
            if (!isAfterSpace) {
                emit(' ', LINE_BREAK, 0, 0);
                isAfterSpace = true;
            }
        },
        finish: () => ({ folded, items, starts, ends }),
    };
}

// A page's items joined in pdf.js order: items on one line run together,
// as pdf.js puts the spaces between words
// into the items, and the end of a line counts as a space, so a phrase still matches where a line wraps.
export function searchablePage(items: ReadonlyArray<PdfTextItem>): SearchablePage {
    const folder = createFolder();

    items.forEach((item, index) => {
        folder.append(item.str, index);

        if (item.hasEOL) {
            folder.appendLineBreak();
        }
    });

    return folder.finish();
}

// Whether a page holds any text to search; a scanned page has none, or only white space.
export function hasSearchableText(page: SearchablePage): boolean {
    return page.folded !== '';
}

// The query as a page's text is folded, without white space at either end; empty for a query of only spaces.
export function foldQuery(query: string): string {
    const folder = createFolder();
    folder.append(query, 0);

    return folder.finish().folded.trimEnd();
}

// Every match of a folded query on one page, in reading order and never overlapping.
export function findInPage(page: SearchablePage, needle: string, pageIndex: number): PdfMatch[] {
    const matches: PdfMatch[] = [];

    if (needle === '') {
        return matches;
    }

    for (let at = page.folded.indexOf(needle); at >= 0; at = page.folded.indexOf(needle, at + needle.length)) {
        const last = at + needle.length - 1;
        matches.push({
            page: pageIndex,
            start: { item: page.items[at] ?? 0, offset: page.starts[at] ?? 0 },
            end: { item: page.items[last] ?? 0, offset: page.ends[last] ?? 0 },
        });
    }

    return matches;
}
