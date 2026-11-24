import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PdfPagesSource } from '../../common/pdf/pdfPagesBuilder.js';
import { buildTestPdf } from '../../common/pdf/testing/pdfBuilder.js';
import { createFakeEngine, createFakeObservers, createFakePdf, type FakeEngine, type FakeObservers, type FakePdf } from '../testing/fakePdf.js';
import { settleAsync } from '../testing/testHelpers.js';
import {
    ENCRYPTED_MESSAGE,
    PREVIEW_TILE_LIMIT,
    showSavePagesDialogAsync,
    type SavePagesDialogOptions,
} from './pdfSavePagesDialog.js';

// Eight pages, each a different width, so the saved PDF tells which page each of its pages came from.
const SIZES: ReadonlyArray<readonly [number, number]> = [210, 220, 230, 240, 250, 260, 270, 280].map((width) => [width, 300] as const);
const NEAR_VIEW = '160px 0px';

let observers: FakeObservers;
let fakePdf: FakePdf;
let fake: FakeEngine;
let saveAsync: Mock<(name: string, bytes: Uint8Array) => Promise<boolean>>;
let revoked: string[];
let dialogs: Array<Promise<boolean>>;

function pdfFile(options: Parameters<typeof buildTestPdf>[0] = { pages: SIZES }): File {
    return new File([buildTestPdf(options).slice()], 'report.pdf', { type: 'application/pdf' });
}

// Opens the dialog and lets it read the PDF; `closed` settles when it closes.
async function openDialogAsync(overrides: Partial<SavePagesDialogOptions> = {}): Promise<{ readonly closed: Promise<boolean> }> {
    const closed = showSavePagesDialogAsync({
        file: pdfFile(),
        fileName: 'report.pdf',
        suggestedName: 'report-pages.pdf',
        destinationHint: 'It is saved in documents/, next to report.pdf.',
        saveLabel: 'Save',
        open: { document: fakePdf.document, engine: fake.engine },
        validateName: () => null,
        saveAsync,
        createObserver: observers.factory,
        devicePixelRatio: () => 2,
        ...overrides,
    });
    dialogs.push(closed);
    await settleAsync();

    return { closed };
}

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.modal-backdrop[data-role="save-pages"] .modal');
}

function pagesInput(): HTMLInputElement {
    return dialog()?.querySelector('.pdf-pages-input') as HTMLInputElement;
}

function nameInput(): HTMLInputElement {
    return dialog()?.querySelector('.pdf-pages-name') as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
    return dialog()?.querySelector('[data-role="primary"]') as HTMLButtonElement;
}

function footerButton(label: string): HTMLButtonElement | undefined {
    return [...(dialog()?.querySelectorAll<HTMLButtonElement>('.modal-footer button') ?? [])].find((button) => button.textContent === label);
}

function tiles(): HTMLElement[] {
    return [...(dialog()?.querySelectorAll<HTMLElement>('.pdf-pages-tile') ?? [])];
}

function labels(): string[] {
    return tiles().map((tile) => tile.querySelector('.pdf-pages-label')?.textContent ?? '');
}

function visibleErrors(): string[] {
    return [...(dialog()?.querySelectorAll<HTMLElement>('.modal-error') ?? [])]
        .filter((error) => !error.hidden && error.closest('[hidden]') == null)
        .map((error) => error.textContent ?? '');
}

function summary(): string {
    return dialog()?.querySelector('.pdf-pages-summary')?.textContent ?? '';
}

function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function keyDown(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);

    return event;
}

// Reports tiles coming near the view of the preview, as the browser's observer does while it scrolls.
function bringNear(indexes: ReadonlyArray<number>, isIntersecting = true): void {
    const all = tiles();
    observers.report(NEAR_VIEW, indexes.map((index) => ({ element: all[index]!, isIntersecting })));
}

// Finishes the draws in progress and the ones they let start, until none is left;
// each thumbnail is encoded in a frame of its own before the next page starts.
async function finishAllDrawsAsync(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
        const finished = await fake.finishDrawsAsync();
        await settleAsync();

        if (finished.length === 0) {
            return;
        }
    }
}

async function waitForPreviewAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 260));
    await settleAsync();
}

// The page each page of a saved PDF came from, read from its width.
async function sourcePagesAsync(bytes: Uint8Array): Promise<number[]> {
    const document = await PDFDocument.load(bytes);

    return document.getPages().map((page) => SIZES.findIndex(([width]) => width === Math.round(page.getWidth())) + 1);
}

beforeEach(() => {
    observers = createFakeObservers();
    fakePdf = createFakePdf({ pages: SIZES });
    fake = createFakeEngine(fakePdf);
    saveAsync = vi.fn(async () => true);
    revoked = [];
    dialogs = [];
    let created = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        created += 1;

        return `blob:nib/thumbnail-${created}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url);
    });
});

afterEach(async () => {
    if (dialog() != null) {
        keyDown(document.body, 'Escape');
    }

    await Promise.all(dialogs);
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('showSavePagesDialogAsync', () => {
    it('opens with every page, the count, a tile for each page and the suggested name, ready to save', async () => {
        await openDialogAsync();

        expect(dialog()?.dataset['state']).toBe('ready');
        expect(dialog()?.querySelector('h2')?.textContent).toBe('Save pages');
        expect(dialog()?.querySelector('.modal-hint')?.textContent).toBe('From report.pdf, 8 pages.');
        expect(pagesInput().value).toBe('1-8');
        expect(summary()).toBe('8 pages');
        expect(labels()).toEqual(['p. 1', 'p. 2', 'p. 3', 'p. 4', 'p. 5', 'p. 6', 'p. 7', 'p. 8']);
        expect(nameInput().value).toBe('report-pages.pdf');
        expect(saveButton().disabled).toBe(false);
        expect(document.activeElement).toBe(pagesInput());
        expect([pagesInput().selectionStart, pagesInput().selectionEnd]).toEqual([0, 3]);
    });

    it('offers just page 1 for a one-page PDF', async () => {
        fakePdf = createFakePdf({ pages: [[612, 792]] });
        fake = createFakeEngine(fakePdf);
        await openDialogAsync({ file: pdfFile({ pages: [[612, 792]] }), open: { document: fakePdf.document, engine: fake.engine } });

        expect(pagesInput().value).toBe('1');
        expect(summary()).toBe('1 page');
    });

    it('counts the pages as they are typed and shows them in their new order after a pause', async () => {
        await openDialogAsync();
        type(pagesInput(), '1, 2, 6-8, 1');

        expect(summary()).toBe('6 pages');
        expect(labels()).toHaveLength(8);

        await waitForPreviewAsync();

        expect(labels()).toEqual(['p. 1', 'p. 2', 'p. 6', 'p. 7', 'p. 8', 'p. 1']);
        expect(tiles().map((tile) => tile.dataset['page'])).toEqual(['1', '2', '6', '7', '8', '1']);
    });

    it('waits for typing to pause before it lays the preview out again', async () => {
        await openDialogAsync();
        type(pagesInput(), '3');
        await new Promise((resolve) => setTimeout(resolve, 120));
        type(pagesInput(), '3-4');
        await new Promise((resolve) => setTimeout(resolve, 120));

        expect(labels()).toHaveLength(8);

        await waitForPreviewAsync();

        expect(labels()).toEqual(['p. 3', 'p. 4']);
    });

    it('draws the thumbnails near the view only, two at a time, at the thumbnail size', async () => {
        await openDialogAsync();
        bringNear([0, 1, 2, 3]);
        await settleAsync();

        expect(fake.draws.map((draw) => draw.page)).toEqual([1, 2]);
        expect(fake.draws[0]?.pixelsPerPoint).toBeCloseTo(Math.min(104 / 210, 136 / 300) * 2);

        await fake.finishDrawsAsync();
        await settleAsync();

        expect(fake.draws.map((draw) => draw.page)).toEqual([1, 2, 3, 4]);
        expect(tiles().slice(0, 4).map((tile) => tile.dataset['state'])).toEqual(['drawn', 'drawn', 'waiting', 'waiting']);

        await finishAllDrawsAsync();

        expect(fake.draws).toHaveLength(4);
        expect(tiles().slice(0, 4).map((tile) => tile.dataset['state'])).toEqual(['drawn', 'drawn', 'drawn', 'drawn']);
        expect(tiles().slice(4).map((tile) => tile.dataset['state'])).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
        expect(tiles()[0]?.querySelector('img')?.getAttribute('src')).toMatch(/^blob:nib\/thumbnail-\d+$/);
    });

    it('skips pages scrolled past before their turn to draw', async () => {
        await openDialogAsync();
        bringNear([0, 1, 2, 3]);
        await settleAsync();
        bringNear([2, 3], false);
        await finishAllDrawsAsync();

        expect(fake.draws.map((draw) => draw.page)).toEqual([1, 2]);
    });

    it('draws a repeated page once and keeps thumbnails across edits', async () => {
        await openDialogAsync();
        type(pagesInput(), '1, 2, 6-8, 1');
        await waitForPreviewAsync();
        bringNear([0, 1, 2, 3, 4, 5]);
        await finishAllDrawsAsync();

        expect(fake.draws.map((draw) => draw.page).sort((left, right) => left - right)).toEqual([1, 2, 6, 7, 8]);
        expect(tiles()[5]?.querySelector('img')?.getAttribute('src')).toBe(tiles()[0]?.querySelector('img')?.getAttribute('src'));

        type(pagesInput(), '8, 1, 2');
        await waitForPreviewAsync();

        expect(tiles().map((tile) => tile.dataset['state'])).toEqual(['drawn', 'drawn', 'drawn']);

        bringNear([0, 1, 2]);
        await finishAllDrawsAsync();

        expect(fake.draws).toHaveLength(5);
    });

    it('shows a page that can\'t be drawn as failed', async () => {
        await openDialogAsync();
        bringNear([0]);
        await settleAsync();
        fake.draws[0]?.fail(new Error('Bad page'));
        await settleAsync();

        expect(tiles()[0]?.dataset['state']).toBe('failed');
    });

    it('explains an entry it can\'t read, turns Save off and dims the preview', async () => {
        await openDialogAsync();
        type(pagesInput(), '1, 20');

        expect(visibleErrors()).toEqual(['Page 20 is past the last page, 8.']);
        expect(saveButton().disabled).toBe(true);
        expect(pagesInput().getAttribute('aria-invalid')).toBe('true');
        expect(summary()).toBe('');
        expect(dialog()?.querySelector<HTMLElement>('.pdf-pages-preview')?.dataset['stale']).toBe('true');

        type(pagesInput(), '1, 2');
        await waitForPreviewAsync();

        expect(visibleErrors()).toEqual([]);
        expect(saveButton().disabled).toBe(false);
        expect(dialog()?.querySelector<HTMLElement>('.pdf-pages-preview')?.dataset['stale']).toBe('false');
    });

    it('points at the wrong part when Enter is pressed on an entry it can\'t read', async () => {
        await openDialogAsync();
        type(pagesInput(), '1, x7, 3');
        keyDown(pagesInput(), 'Enter');
        await settleAsync();

        expect(saveAsync).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(pagesInput());
        expect(pagesInput().value.slice(pagesInput().selectionStart ?? 0, pagesInput().selectionEnd ?? 0)).toBe('x7');
    });

    it('saves the pages in their order when Enter is pressed, and closes', async () => {
        const { closed } = await openDialogAsync();
        type(pagesInput(), '1, 2, 6-8, 1');
        keyDown(pagesInput(), 'Enter');
        await settleAsync();

        expect(saveAsync).toHaveBeenCalledTimes(1);
        const [name, bytes] = saveAsync.mock.calls[0]!;
        expect(name).toBe('report-pages.pdf');
        expect(await sourcePagesAsync(bytes)).toEqual([1, 2, 6, 7, 8, 1]);
        expect(dialog()).toBeNull();
        expect(await closed).toBe(true);
    });

    it('saves under the name typed when Save is clicked', async () => {
        await openDialogAsync();
        type(pagesInput(), '8-6');
        type(nameInput(), '  last three.pdf ');
        saveButton().click();
        await settleAsync();

        expect(saveAsync.mock.calls[0]?.[0]).toBe('last three.pdf');
        expect(await sourcePagesAsync(saveAsync.mock.calls[0]![1])).toEqual([8, 7, 6]);
    });

    it('turns everything off while it saves', async () => {
        let finish: (saved: boolean) => void = () => {};
        saveAsync.mockImplementation(async () => await new Promise<boolean>((resolve) => {
            finish = resolve;
        }));
        await openDialogAsync();
        saveButton().click();
        await settleAsync();

        expect(dialog()?.dataset['state']).toBe('saving');
        expect(saveButton().textContent).toBe('Saving…');
        expect([saveButton().disabled, pagesInput().disabled, nameInput().disabled, footerButton('Cancel')?.disabled]).toEqual([true, true, true, true]);

        keyDown(document.body, 'Escape');

        expect(dialog()).not.toBeNull();

        finish(true);
        await settleAsync();

        expect(dialog()).toBeNull();
    });

    it('stays open when nothing was written, such as when the file picker is closed', async () => {
        saveAsync.mockResolvedValue(false);
        await openDialogAsync();
        saveButton().click();
        await settleAsync();

        expect(dialog()?.dataset['state']).toBe('ready');
        expect(saveButton().textContent).toBe('Save');
        expect(saveButton().disabled).toBe(false);
    });

    it('shows why the PDF could not be written and stays open', async () => {
        saveAsync.mockRejectedValue(new Error('report-pages.pdf already exists here.'));
        await openDialogAsync();
        saveButton().click();
        await settleAsync();

        expect(visibleErrors()).toEqual(['The pages could not be saved: report-pages.pdf already exists here.']);
        expect(dialog()?.dataset['state']).toBe('ready');
    });

    it('checks the name as it is typed: it ends in .pdf and passes the app\'s checks', async () => {
        await openDialogAsync({ validateName: (name) => (name === 'report.pdf' ? 'report.pdf already exists here.' : null) });
        type(nameInput(), 'pages');

        expect(visibleErrors()).toEqual(['The name needs to end in .pdf.']);
        expect(saveButton().disabled).toBe(true);

        type(nameInput(), 'report.pdf');

        expect(visibleErrors()).toEqual(['report.pdf already exists here.']);

        keyDown(nameInput(), 'Enter');

        expect(saveAsync).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(nameInput());

        type(nameInput(), 'summary.pdf');

        expect(visibleErrors()).toEqual([]);
        expect(saveButton().disabled).toBe(false);
    });

    it('closes with Escape, Cancel, the close button or a click beside it, and lets go of its thumbnails', async () => {
        const { closed: first } = await openDialogAsync();
        bringNear([0]);
        await fake.finishDrawsAsync();
        await settleAsync();
        keyDown(document.body, 'Escape');

        expect(await first).toBe(false);
        expect(dialog()).toBeNull();
        expect(revoked).toEqual(['blob:nib/thumbnail-1']);

        const { closed: second } = await openDialogAsync();
        footerButton('Cancel')?.click();

        expect(await second).toBe(false);

        const { closed: third } = await openDialogAsync();
        dialog()?.querySelector<HTMLButtonElement>('.modal-close')?.click();

        expect(await third).toBe(false);

        const { closed: fourth } = await openDialogAsync();
        document.querySelector<HTMLElement>('.modal-backdrop[data-role="save-pages"]')?.click();

        expect(await fourth).toBe(false);
        expect(saveAsync).not.toHaveBeenCalled();
    });

    it('gives focus back to where it was when it closes', async () => {
        const button = document.createElement('button');
        document.body.append(button);
        button.focus();
        await openDialogAsync();
        keyDown(document.body, 'Escape');
        await settleAsync();

        expect(document.activeElement).toBe(button);
    });

    it('keeps Tab within the dialog', async () => {
        await openDialogAsync();
        const closeButton = dialog()?.querySelector<HTMLButtonElement>('.modal-close');
        saveButton().focus();
        const forward = keyDown(saveButton(), 'Tab');

        expect(forward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(closeButton);

        const backward = keyDown(closeButton!, 'Tab', { shiftKey: true });

        expect(backward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(saveButton());
    });

    it('says the pages of a password-protected PDF can\'t be saved, and shows no preview', async () => {
        const { closed } = await openDialogAsync({ file: pdfFile({ pages: SIZES, isEncrypted: true }) });

        expect(dialog()?.dataset['state']).toBe('encrypted');
        expect(dialog()?.querySelector('.pdf-pages-status-title')?.textContent).toBe(ENCRYPTED_MESSAGE);
        expect(ENCRYPTED_MESSAGE).toBe('Pages of a password-protected PDF can\'t be saved.');
        expect(dialog()?.querySelector<HTMLElement>('.pdf-pages-form')?.hidden).toBe(true);
        expect(tiles()).toEqual([]);
        expect(fake.draws).toEqual([]);
        expect(saveButton().hidden).toBe(true);
        expect(document.activeElement).toBe(footerButton('Close'));

        keyDown(document.body, 'Enter');
        footerButton('Close')?.click();

        expect(await closed).toBe(false);
        expect(saveAsync).not.toHaveBeenCalled();
    });

    it('says a damaged PDF\'s pages can\'t be saved, with the reason', async () => {
        const file = new File(['This is a text file named like a PDF.\n'], 'notes.pdf', { type: 'application/pdf' });
        await openDialogAsync({ file });

        expect(dialog()?.dataset['state']).toBe('damaged');
        expect(dialog()?.querySelector('.pdf-pages-status-title')?.textContent).toBe('The pages of this PDF can\'t be saved.');
        expect(dialog()?.querySelector('.pdf-pages-status-detail')?.textContent).toBe('The file is damaged, or it isn\'t a PDF.');
        expect(tiles()).toEqual([]);
    });

    it('says so when the file can\'t be read', async () => {
        const file = pdfFile();
        vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new DOMException('Gone', 'NotFoundError'));
        await openDialogAsync({ file });

        expect(dialog()?.querySelector('.pdf-pages-status-detail')?.textContent).toBe('The file could not be read from disk.');
    });

    it('reads the PDF before anything can be typed or saved', async () => {
        const { closed } = await openDialogAsync({ openSourceAsync: async () => await new Promise<PdfPagesSource>(() => {}) });

        expect(dialog()?.dataset['state']).toBe('loading');
        expect(dialog()?.querySelector('.pdf-pages-status')?.textContent).toBe('Reading the PDF…');
        expect(dialog()?.querySelector<HTMLElement>('.pdf-pages-form')?.hidden).toBe(true);
        expect(saveButton().disabled).toBe(true);

        keyDown(document.body, 'Escape');

        expect(await closed).toBe(false);
    });

    it('opens the PDF itself when the preview has none open, and closes it after', async () => {
        const { closed } = await openDialogAsync({ open: null, loadEngineAsync: async () => fake.engine });
        bringNear([0]);
        await fake.finishDrawsAsync();
        await settleAsync();

        expect(fake.openAsync).toHaveBeenCalledTimes(1);
        expect(fake.openAsync.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
        expect(tiles()[0]?.dataset['state']).toBe('drawn');

        keyDown(document.body, 'Escape');
        await closed;

        expect(fakePdf.destroy).toHaveBeenCalledTimes(1);
    });

    it('leaves a document the preview opened alone when it closes', async () => {
        const { closed } = await openDialogAsync();
        bringNear([0]);
        await fake.finishDrawsAsync();
        keyDown(document.body, 'Escape');
        await closed;

        expect(fake.openAsync).not.toHaveBeenCalled();
        expect(fakePdf.destroy).not.toHaveBeenCalled();
    });

    it('shows the first tiles of a very long selection and says how many it leaves out', async () => {
        await openDialogAsync();
        type(pagesInput(), Array.from({ length: 75 }, () => '1-8').join(', '));
        await waitForPreviewAsync();

        expect(summary()).toBe('600 pages');
        expect(tiles()).toHaveLength(PREVIEW_TILE_LIMIT);
        expect(dialog()?.querySelector('.pdf-pages-more')?.textContent).toBe('The preview shows the first 500 of 600 pages.');
    });

    it('labels the Save button for a file picker', async () => {
        await openDialogAsync({ saveLabel: 'Save as…', destinationHint: 'You choose where it goes.' });

        expect(saveButton().textContent).toBe('Save as…');
        expect([...(dialog()?.querySelectorAll('.modal-hint') ?? [])].map((hint) => hint.textContent)).toContain('You choose where it goes.');
    });
});
