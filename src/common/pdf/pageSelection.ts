import { countLabel } from '../paths/valueFormat.js';

// The pages typed for Save pages: numbers, ranges that run either way and ranges open at one end,
// in any order and
// with repeats, separated by commas, semicolons or spaces. "1, 2, 6-8, 1" is pages 1, 2, 6, 7, 8 and 1 again;
// "8-6" is 8, 7 and 6;
// "6-" runs to the last page and "-3" from the first. Spaces around a dash keep a range together.

export type PageSelection =
    | { readonly ok: true; readonly pages: ReadonlyArray<number> }
    // What is wrong, and where in the text: from `start` up to `end`.
    | { readonly ok: false; readonly message: string; readonly start: number; readonly end: number };

// The most pages one selection takes, unless the document has more,
// so a pasted run of ranges stays within reach.
export const MAX_SELECTED_PAGES = 10_000;

interface NumberToken {
    readonly value: number;
    readonly digits: string;
    readonly start: number;
    readonly end: number;
}

interface Item {
    readonly first: NumberToken | null;
    readonly last: NumberToken | null;
    readonly isRange: boolean;
    readonly start: number;
    readonly end: number;
}

type ItemResult = { readonly ok: true; readonly item: Item } | Extract<PageSelection, { ok: false }>;

const SEPARATORS = /[\s,;]/;
const SPACES = /\s/;
// A hyphen, or the en or em dash that pasted text often has.
const DASHES = new Set(['-', '–', '—']);

// Pages are numbered from 1, in the order typed.
export function parsePageSelection(text: string, pageCount: number): PageSelection {
    const pages: number[] = [];
    const limit = Math.max(MAX_SELECTED_PAGES, pageCount);
    let index = 0;

    while (index < text.length) {
        if (SEPARATORS.test(text[index] ?? '')) {
            index += 1;
            continue;
        }

        const read = readItem(text, index);

        if (!read.ok) {
            return read;
        }

        const { item } = read;
        const problem = checkItem(item, pageCount);

        if (problem != null) {
            return problem;
        }

        const first = item.first?.value ?? 1;
        const last = item.isRange ? item.last?.value ?? pageCount : first;

        if (pages.length + Math.abs(last - first) + 1 > limit) {
            return {
                ok: false,
                message: `That's more than ${formatCount(limit)} pages, the most one PDF can take here.`,
                start: item.start,
                end: item.end,
            };
        }

        const step = last >= first ? 1 : -1;

        for (let page = first; page !== last + step; page += step) {
            pages.push(page);
        }

        index = item.end;
    }

    if (pages.length === 0) {
        return { ok: false, message: 'Enter the pages to save, such as 1-3, 5.', start: 0, end: text.length };
    }

    return { ok: true, pages };
}

// "1 page", "6 pages", "1,200 pages".
export function pageCountLabel(count: number): string {
    return countLabel(count, 'page');
}

function readItem(text: string, start: number): ItemResult {
    const first = readNumber(text, start);
    let cursor = first?.end ?? start;
    let probe = cursor;

    while (probe < text.length && SPACES.test(text[probe] ?? '')) {
        probe += 1;
    }

    const isRange = DASHES.has(text[probe] ?? '');
    let last: NumberToken | null = null;

    if (isRange) {
        cursor = probe + 1;

        while (cursor < text.length && SPACES.test(text[cursor] ?? '')) {
            cursor += 1;
        }

        last = readNumber(text, cursor);
        cursor = last?.end ?? cursor;
    }

    if ((first == null && !isRange) || (cursor < text.length && !SEPARATORS.test(text[cursor] ?? ''))) {
        const end = nextSeparator(text, cursor);

        return { ok: false, message: `"${text.slice(start, end)}" isn't a page or a range.`, start, end };
    }

    if (isRange && first == null && last == null) {
        return { ok: false, message: 'A range needs a page before or after its dash.', start, end: probe + 1 };
    }

    return { ok: true, item: { first, last, isRange, start, end: cursor } };
}

function readNumber(text: string, start: number): NumberToken | null {
    let end = start;

    while (end < text.length && /\d/.test(text[end] ?? '')) {
        end += 1;
    }

    if (end === start) {
        return null;
    }

    const digits = text.slice(start, end).replace(/^0+(?=\d)/, '');

    return { value: Number(digits), digits, start, end };
}

// A page of the item that the document doesn't have.
function checkItem(item: Item, pageCount: number): Extract<PageSelection, { ok: false }> | null {
    for (const token of [item.first, item.last]) {
        if (token == null) {
            continue;
        }

        if (token.value === 0) {
            return { ok: false, message: 'There\'s no page 0; pages start at 1.', start: token.start, end: token.end };
        }

        if (token.value > pageCount) {
            return {
                ok: false,
                message: `Page ${formatNumber(token)} is past the last page, ${formatCount(pageCount)}.`,
                start: token.start,
                end: token.end,
            };
        }
    }

    return null;
}

function nextSeparator(text: string, from: number): number {
    let end = from;

    while (end < text.length && !SEPARATORS.test(text[end] ?? '')) {
        end += 1;
    }

    return end;
}

function formatCount(count: number): string {
    return count.toLocaleString('en-US');
}

// A number too long to be exact is shown as typed.
function formatNumber(token: NumberToken): string {
    return Number.isSafeInteger(token.value) ? formatCount(token.value) : token.digits;
}
