import { describe, expect, it } from 'vitest';
import { internalLinkTarget, namedActionPage, parseExplicitDestination, percentBox } from './pdfLinks.js';

describe('internalLinkTarget', () => {
    it('reads named and explicit destinations', () => {
        expect(internalLinkTarget({ subtype: 'Link', dest: 'chapter.2' })).toEqual({ kind: 'destination', destination: 'chapter.2' });
        const explicit = [{ num: 12, gen: 0 }, { name: 'XYZ' }, 0, 700, null];

        expect(internalLinkTarget({ subtype: 'Link', dest: explicit })).toEqual({ kind: 'destination', destination: explicit });
    });

    it('reads the page actions that stay in the document', () => {
        expect(internalLinkTarget({ subtype: 'Link', action: 'NextPage' })).toEqual({ kind: 'named', action: 'next' });
        expect(internalLinkTarget({ subtype: 'Link', action: 'PrevPage' })).toEqual({ kind: 'named', action: 'previous' });
        expect(internalLinkTarget({ subtype: 'Link', action: 'FirstPage' })).toEqual({ kind: 'named', action: 'first' });
        expect(internalLinkTarget({ subtype: 'Link', action: 'LastPage' })).toEqual({ kind: 'named', action: 'last' });
    });

    it('leaves out links to the web, other actions and other annotations', () => {
        expect(internalLinkTarget({ subtype: 'Link', url: 'https://example.com/' })).toBeNull();
        expect(internalLinkTarget({ subtype: 'Link', unsafeUrl: 'javascript:alert(1)' })).toBeNull();
        expect(internalLinkTarget({ subtype: 'Link', url: 'https://example.com/', dest: 'x' })).toBeNull();
        expect(internalLinkTarget({ subtype: 'Link', action: 'Print' })).toBeNull();
        expect(internalLinkTarget({ subtype: 'Link', dest: '' })).toBeNull();
        expect(internalLinkTarget({ subtype: 'Link', dest: [] })).toBeNull();
        expect(internalLinkTarget({ subtype: 'Widget', dest: 'chapter.2' })).toBeNull();
    });
});

describe('parseExplicitDestination', () => {
    const page = { num: 12, gen: 0 };

    it('reads the left and top of each fit', () => {
        expect(parseExplicitDestination([page, { name: 'XYZ' }, 72, 700, 1.5])).toEqual({ page: { reference: page }, left: 72, top: 700 });
        expect(parseExplicitDestination([page, { name: 'FitH' }, 650])).toEqual({ page: { reference: page }, left: null, top: 650 });
        expect(parseExplicitDestination([page, { name: 'FitBV' }, 40])).toEqual({ page: { reference: page }, left: 40, top: null });
        expect(parseExplicitDestination([page, { name: 'FitR' }, 10, 20, 300, 400])).toEqual({ page: { reference: page }, left: 10, top: 400 });
        expect(parseExplicitDestination([page, { name: 'Fit' }])).toEqual({ page: { reference: page }, left: null, top: null });
    });

    it('takes null coordinates as unchanged', () => {
        expect(parseExplicitDestination([page, { name: 'XYZ' }, null, null, null])).toEqual({ page: { reference: page }, left: null, top: null });
    });

    it('takes a page given by index', () => {
        expect(parseExplicitDestination([3, { name: 'Fit' }])).toEqual({ page: { index: 3 }, left: null, top: null });
    });

    it('is null for anything else', () => {
        for (const destination of [null, 'name', [], [page], [page, { name: 'Zoom' }], [{ num: 'x' }, { name: 'Fit' }], [-1, { name: 'Fit' }], [page, 'Fit']]) {
            expect(parseExplicitDestination(destination), JSON.stringify(destination)).toBeNull();
        }
    });
});

describe('namedActionPage', () => {
    it('goes to the first, last, next and previous page, within the document', () => {
        expect(namedActionPage('first', 5, 10)).toBe(0);
        expect(namedActionPage('last', 5, 10)).toBe(9);
        expect(namedActionPage('next', 5, 10)).toBe(6);
        expect(namedActionPage('next', 9, 10)).toBe(9);
        expect(namedActionPage('previous', 0, 10)).toBe(0);
    });
});

describe('percentBox', () => {
    it('gives the box as percentages of the page, whatever order its corners come in', () => {
        expect(percentBox([300, 200, 100, 100], 400, 1000)).toEqual({ left: 25, top: 10, width: 50, height: 10 });
    });

    it('is null for an empty box, a short rectangle or an empty page', () => {
        expect(percentBox([100, 100, 100, 200], 400, 1000)).toBeNull();
        expect(percentBox([100, 100, 200], 400, 1000)).toBeNull();
        expect(percentBox([0, 0, 10, 10], 0, 1000)).toBeNull();
    });
});
