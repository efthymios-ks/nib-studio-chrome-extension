import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestPdf } from '../../common/pdf/testing/pdfBuilder.js';
import { createFakeAnimationClock, setClientSize, type FakeAnimationClock } from '../testing/fakeAnimationClock.js';
import { createFakeEngine, createFakeObservers, createFakePdf, type FakeEngine, type FakeObservers, type FakePdf } from '../testing/fakePdf.js';
import { settleAsync } from '../testing/testHelpers.js';
import { CSS_PIXELS_PER_POINT, fitPageScale } from '../../common/pdf/pdfPageLayout.js';
import { PDF_FIND_CURRENT_HIGHLIGHT } from './pdfFind.js';
import { mountPdfPreview } from './pdfPreview.js';
import type { PreviewHandle } from './previewHandle.js';
import { CONTENT_PADDING } from './previewZoom.js';
import { requestPreviewFind } from './previewFindRequests.js';

const LETTER: readonly [number, number] = [612, 792];

let host: HTMLElement;
let observers: FakeObservers;
let handles: PreviewHandle[] = [];
let time: FakeAnimationClock;

function pdfFile(name = 'report.pdf'): File {
    return new File([buildTestPdf({ info: { Title: 'Report' } }).slice()], name, { type: 'application/pdf', lastModified: Date.UTC(2026, 0, 1) });
}

async function mountAsync(fake: FakeEngine, file = pdfFile()): Promise<PreviewHandle> {
    time = createFakeAnimationClock();
    const handle = mountPdfPreview(host, {
        file,
        fileName: file.name,
        memoryKey: `documents/${file.name}`,
        loadEngineAsync: async () => fake.engine,
        createObserver: observers.factory,
        devicePixelRatio: () => 1,
        clock: time.clock,
        prefersReducedMotion: () => true,
    });
    setClientSize(host.querySelector('.preview-viewport') as HTMLElement, 800, 600);
    handles.push(handle);
    await settleAsync();

    return handle;
}

function frame(): HTMLElement {
    return host.querySelector('.preview-frame') as HTMLElement;
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

function passwordInput(): HTMLInputElement {
    return host.querySelector('.password-panel-input') as HTMLInputElement;
}

async function submitPasswordAsync(password: string): Promise<void> {
    passwordInput().value = password;
    host.querySelector('.password-panel')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settleAsync();
}

function keyDown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);

    return event;
}

beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    observers = createFakeObservers();
    handles = [];
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
});

describe('mountPdfPreview', () => {
    it('opens the PDF in the frame with its badges, the zoom and the page box, and nothing else', async () => {
        const pdf = createFakePdf({ pages: [LETTER, LETTER, LETTER] });
        await mountAsync(createFakeEngine(pdf));

        expect(frame().dataset['viewer']).toBe('pdf');
        expect(frame().dataset['state']).toBe('ready');
        expect([...host.querySelectorAll('.preview-toolbar .badge')].map((badge) => badge.textContent)).toEqual(['PDF', 'View only']);
        expect([...host.querySelectorAll('.preview-toolbar button')].map((button) => button.textContent)).toEqual(['−', 'Fit width', '+', 'Reset', 'Info']);
        expect(host.querySelector('.preview-controls .document-find-input')?.getAttribute('placeholder')).toBe('Find in document…');
        expect((host.querySelector('.pdf-page-input') as HTMLInputElement).value).toBe('1');
        expect(host.querySelector('.pdf-page-count')?.textContent).toBe('/ 3');
        expect(host.querySelectorAll('.preview-layer .pdf-page')).toHaveLength(3);
        expect(host.querySelector('.preview-viewport')?.getAttribute('aria-label')).toBe('PDF preview of report.pdf');
    });

    it('fills the Info panel from the document', async () => {
        const pdf = createFakePdf({
            pages: [LETTER, LETTER],
            info: { Title: 'Quarterly report', Author: 'Ada Lovelace', CreationDate: 'D:20240312101522' },
            markInfo: new Map([['Marked', true]]),
        });
        await mountAsync(createFakeEngine(pdf));

        expect(rows()).toMatchObject({
            'File/Name': 'report.pdf',
            'File/Type': 'PDF document',
            'Document/Title': 'Quarterly report',
            'Document/Author': 'Ada Lovelace',
            'History/Created': '2024-03-12 10:15:22',
            'PDF/Version': '1.7',
            'PDF/Pages': '2',
            'PDF/Page size': '215.9 × 279.4 mm (8.5 × 11 in), Letter',
            'PDF/Tagged': 'Yes',
            'Security/Encrypted': 'No',
        });
    });

    it('measures a long document after showing it, and notes pages that differ', async () => {
        const pages = Array.from({ length: 120 }, (_, index): readonly [number, number] => (index === 109 ? [792, 612] : LETTER));
        await mountAsync(createFakeEngine(createFakePdf({ pages })));
        await settleAsync();
        const odd = host.querySelector('.pdf-page[data-page-number="110"]') as HTMLElement;

        expect(odd.style.getPropertyValue('--pdf-page-width')).toBe(String(792 * (96 / 72)));
        expect(rows()['PDF/Page size']).toBe('215.9 × 279.4 mm (8.5 × 11 in), Letter; the first page, others differ');
    });

    it('asks for a password, says when it is wrong, and opens with the right one', async () => {
        const pdf = createFakePdf({ pages: [LETTER], info: { EncryptFilterName: 'Standard' } });
        await mountAsync(createFakeEngine(pdf, 'abc'));

        expect(host.querySelector('.password-panel')?.getAttribute('data-reason')).toBe('needed');
        expect(rows()['File/Name']).toBe('report.pdf');
        await submitPasswordAsync('wrong');

        expect(host.querySelector('.password-panel')?.getAttribute('data-reason')).toBe('incorrect');
        expect(host.querySelector('.password-panel-message')?.textContent).toBe('That password is incorrect. Try again.');
        await submitPasswordAsync('abc');

        expect(host.querySelector('.password-panel')).toBeNull();
        expect(host.querySelectorAll('.pdf-page')).toHaveLength(1);
        expect(rows()).toMatchObject({ 'Security/Encrypted': 'Yes', 'Security/Password': 'Needed to open' });
    });

    it('opens a locked PDF again without asking when its tab comes back, until the file changes on disk', async () => {
        const file = pdfFile('locked.pdf');
        const first = await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] }), 'abc'), file);
        await submitPasswordAsync('wrong');
        await submitPasswordAsync('abc');
        first.destroy();

        const again = createFakeEngine(createFakePdf({ pages: [LETTER] }), 'abc');
        const second = await mountAsync(again, file);

        expect(host.querySelector('.password-panel')).toBeNull();
        expect(host.querySelectorAll('.pdf-page')).toHaveLength(1);
        expect(again.openAsync).toHaveBeenCalledTimes(1);
        expect(rows()['Security/Password']).toBe('Needed to open');
        expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('abc');

        second.update(pdfFile('locked.pdf'));
        await settleAsync();

        expect(host.querySelector('.password-panel')?.getAttribute('data-reason')).toBe('needed');
    });

    it('leaves a clear message on Cancel, with a way back to the password box', async () => {
        const fake = createFakeEngine(createFakePdf({ pages: [LETTER] }), 'abc');
        await mountAsync(fake);
        (host.querySelector('[data-action="password-cancel"]') as HTMLButtonElement).click();
        await settleAsync();

        expect(host.querySelector('.password-panel')?.getAttribute('data-reason')).toBe('cancelled');
        expect(host.querySelector('.password-panel')?.textContent).toContain('It stays closed until its password is entered.');
        expect((host.querySelector('[data-action="zoom-in"]') as HTMLButtonElement).disabled).toBe(true);
        (host.querySelector('[data-action="password-retry"]') as HTMLButtonElement).click();
        await settleAsync();

        expect(fake.openAsync).toHaveBeenCalledTimes(2);
        expect(host.querySelector('.password-panel')?.getAttribute('data-reason')).toBe('needed');
    });

    it('says when a file is damaged or not a PDF, and still lists the file', async () => {
        const fake = createFakeEngine(createFakePdf({ pages: [LETTER] }));
        fake.openAsync.mockRejectedValueOnce(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }));
        await mountAsync(fake);

        expect(frame().dataset['state']).toBe('message');
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This PDF can\'t be shown');
        expect(host.querySelector('.preview-status p')?.textContent).toBe('The file is damaged, or it isn\'t a PDF.');
        expect(rows()['File/Type']).toBe('PDF document');
    });

    it('keeps the document through updates of the same snapshot, and reloads a new one', async () => {
        const documents: FakePdf[] = [];
        const fake = createFakeEngine(() => {
            const pdf = createFakePdf({ pages: documents.length === 0 ? [LETTER] : [LETTER, LETTER] });
            documents.push(pdf);

            return pdf;
        });
        const file = pdfFile();
        const handle = await mountAsync(fake, file);
        handle.update(file);
        handle.update(null);
        await settleAsync();

        expect(fake.openAsync).toHaveBeenCalledTimes(1);
        handle.update(pdfFile());
        await settleAsync();

        expect(fake.openAsync).toHaveBeenCalledTimes(2);
        expect(documents[0]?.destroy).toHaveBeenCalled();
        expect(host.querySelector('.pdf-page-count')?.textContent).toBe('/ 2');
    });

    it('closes the document and leaves the page when destroyed', async () => {
        const pdf = createFakePdf({ pages: [LETTER] });
        const handle = await mountAsync(createFakeEngine(pdf));
        handle.destroy();
        handles = [];

        expect(pdf.destroy).toHaveBeenCalled();
        expect(host.querySelector('.preview-frame')).toBeNull();
    });

    it('keeps Ctrl+wheel and Ctrl+plus from zooming the browser page, and zooms the PDF instead', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] })));
        const toolbar = host.querySelector('.preview-toolbar') as HTMLElement;
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true });
        Object.defineProperty(wheel, 'ctrlKey', { value: true });
        toolbar.dispatchEvent(wheel);
        const level = (): string | null => host.querySelector('.preview-zoom-level')?.textContent ?? null;
        const before = level();
        const plus = keyDown(host.querySelector('.preview-viewport') as HTMLElement, { key: '=', ctrlKey: true });

        expect(wheel.defaultPrevented).toBe(true);
        expect(plus.defaultPrevented).toBe(true);
        expect(level()).not.toBe(before);
        keyDown(host.querySelector('.preview-viewport') as HTMLElement, { key: '0', ctrlKey: true });

        expect(level()).toBe(before);
    });

    it('selects only the document\'s text with Ctrl+A in the pages', async () => {
        const fake = createFakeEngine(createFakePdf({ pages: [LETTER, LETTER] }));
        await mountAsync(fake);
        observers.report('100%', [...host.querySelectorAll('.pdf-page')].map((element) => ({ element, isIntersecting: true })));
        await fake.finishDrawsAsync();
        const select = keyDown(host.querySelector('.preview-viewport') as HTMLElement, { key: 'a', ctrlKey: true });

        expect(select.defaultPrevented).toBe(true);
        expect(window.getSelection()?.toString()).toContain('Text of page 1');
        expect(window.getSelection()?.toString()).not.toContain('Info');
    });

    it('leaves Ctrl+A to the password box, where there are no pages to select', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] }), 'abc'));

        expect(keyDown(passwordInput(), { key: 'a', ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('goes to the page typed in the page box', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER, LETTER] })));
        const viewport = host.querySelector('.preview-viewport') as HTMLElement;
        const pages = host.querySelector('.pdf-document') as HTMLElement;
        Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 10_000 });
        vi.spyOn(pages, 'getBoundingClientRect').mockReturnValue({ top: 16, left: 0, height: 3 * 1056 + 24, width: 816 } as DOMRect);
        const input = host.querySelector('.pdf-page-input') as HTMLInputElement;
        input.value = '3';
        keyDown(input, { key: 'Enter' });

        expect(viewport.scrollTop).toBe(16 + 2 * (1056 + 12) - 6);
    });
});

function findInput(): HTMLInputElement {
    return host.querySelector('.document-find-input') as HTMLInputElement;
}

async function findAsync(text: string): Promise<void> {
    findInput().value = text;
    findInput().dispatchEvent(new Event('input'));
    await settleAsync();
}

function zoomLevel(): HTMLButtonElement {
    return host.querySelector('.preview-zoom-level') as HTMLButtonElement;
}

function chooseZoom(action: string): void {
    zoomLevel().click();
    (host.querySelector(`.preview-zoom-menu [data-action="${action}"]`) as HTMLButtonElement).click();
}

// Lays the three Letter pages out on screen as a browser would at 100%, below the padding and moving with the scroll.
function layOutPages(): HTMLElement {
    const viewport = host.querySelector('.preview-viewport') as HTMLElement;
    const pages = host.querySelector('.pdf-document') as HTMLElement;
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 10_000 });
    vi.spyOn(pages, 'getBoundingClientRect').mockImplementation(() => ({ top: 16 - viewport.scrollTop, left: 0, height: 3 * 1056 + 24, width: 816 }) as DOMRect);

    return viewport;
}

// The scroll position that centres a page of the three laid out by layOutPages in the 600-pixel-high view.
function centredOn(index: number): number {
    return 16 + index * (1056 + 12) + 528 - 300;
}

function wheel(target: HTMLElement, init: WheelEventInit): WheelEvent {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
    target.dispatchEvent(event);

    return event;
}

describe('mountPdfPreview find', () => {
    const TEXTS = {
        0: ['Intro to the ', 'paper'],
        2: [{ str: 'The trace', hasEOL: false }, { str: 'monkey compiler', hasEOL: true }, 'Trace again'],
    };

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('searches every page, even one not yet drawn, and lays out the text of the page of the match first', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER, LETTER], texts: TEXTS })));

        expect(findInput().disabled).toBe(false);
        await findAsync('TRACEMONKEY');

        expect(host.querySelector('.document-find-count')?.textContent).toBe('1 of 1');
        expect(host.querySelector('.pdf-page[data-page-number="3"] .pdf-text-layer')).not.toBeNull();
        expect(host.querySelector('.pdf-page[data-page-number="3"]')?.getAttribute('data-state')).toBe('empty');
        await findAsync('trace');

        expect(host.querySelector('.document-find-count')?.textContent).toBe('1 of 2');
    });

    it('highlights the current match through the text layer once its page is laid out', async () => {
        const registry = new Map<string, { readonly ranges: Range[] }>();
        vi.stubGlobal('CSS', { highlights: registry });
        vi.stubGlobal('Highlight', class {
            readonly ranges: Range[];

            constructor(...ranges: Range[]) {
                this.ranges = ranges;
            }
        });
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER, LETTER], texts: TEXTS })));
        await findAsync('tracemonkey');

        expect(registry.get(PDF_FIND_CURRENT_HIGHLIGHT)?.ranges.map((range) => range.toString())).toEqual(['tracemonkey']);
    });

    it('finds a phrase asked for from outside once the PDF is open', async () => {
        requestPreviewFind('documents/report.pdf', 'Total');
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER], texts: { 1: ['Total: 1,250.00 EUR'] } })));

        expect(findInput().value).toBe('Total');
        expect(host.querySelector('.document-find-count')?.textContent).toBe('1 of 1');
    });

    it('takes Ctrl+F in the preview to the box', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] })));
        const event = keyDown(host.querySelector('.preview-viewport') as HTMLElement, { key: 'f', ctrlKey: true });

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(findInput());
    });

    it('keeps Ctrl+F from the browser\'s find bar while a message shows in place of the pages, and does nothing with it', async () => {
        const fake = createFakeEngine(createFakePdf({ pages: [LETTER] }));
        fake.openAsync.mockRejectedValueOnce(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }));
        await mountAsync(fake);

        expect(host.querySelector('.document-find')?.closest('[hidden]')).not.toBeNull();
        expect(keyDown(host.querySelector('.preview-viewport') as HTMLElement, { key: 'f', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).not.toBe(findInput());
    });

    it('hides the zoom, the page box and Find while the password is asked for, and brings them back once open', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] }), 'abc'));
        const isHidden = (selector: string): boolean => host.querySelector(selector)?.closest('[hidden]') != null;

        expect(frame().dataset['state']).toBe('panel');
        expect(isHidden('.preview-zoom') && isHidden('.pdf-page-box') && isHidden('.document-find')).toBe(true);
        expect(findInput().disabled).toBe(true);
        expect(keyDown(passwordInput(), { key: 'f', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).not.toBe(findInput());
        await submitPasswordAsync('abc');

        expect(isHidden('.preview-zoom') || isHidden('.pdf-page-box') || isHidden('.document-find')).toBe(false);
        expect(findInput().disabled).toBe(false);
    });
});

describe('mountPdfPreview zoom modes', () => {
    const PAGE = { width: LETTER[0] * CSS_PIXELS_PER_POINT, height: LETTER[1] * CSS_PIXELS_PER_POINT };

    it('opens at Fit width, and the menu offers Fit page, Fit width, Actual size and fixed zooms', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER] })));

        expect(zoomLevel().textContent).toBe('Fit width');
        zoomLevel().click();
        const items = [...host.querySelectorAll('.preview-zoom-menu [role="menuitemradio"]')];

        expect(items.map((item) => item.textContent)).toEqual(['Fit page', 'Fit width', 'Actual size', '50%', '75%', '125%', '150%', '200%']);
        expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false', 'false', 'false']);
    });

    it('shows one whole page at Fit page, remembers it for the tab, and Actual size shows 100%', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER] })));
        chooseZoom('zoom-fit-page');
        const fit = fitPageScale(PAGE, { width: 800, height: 600 }, CONTENT_PADDING);

        expect(zoomLevel().textContent).toBe('Fit page');
        expect(zoomLevel().title).toBe(`Zoom ${Math.round(fit * 100)}%`);
        expect(Number((host.querySelector('.preview-layer') as HTMLElement).style.getPropertyValue('--preview-scale'))).toBeCloseTo(fit, 6);
        handles.shift()?.destroy();
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER] })));

        expect(zoomLevel().textContent).toBe('Fit page');
        chooseZoom('zoom-actual-size');

        expect(zoomLevel().textContent).toBe('100%');
    });

    it('moves exactly one page for a wheel gesture, PageDown, the arrows and Space in Fit page, centring it', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER, LETTER] })));
        chooseZoom('zoom-fit-page');
        const viewport = layOutPages();
        const notch = wheel(viewport, { deltaY: 100 });

        expect(notch.defaultPrevented).toBe(true);
        expect(viewport.scrollTop).toBe(centredOn(1));
        wheel(viewport, { deltaY: 100 });

        expect(viewport.scrollTop).toBe(centredOn(1));
        time.advance(200);
        keyDown(viewport, { key: 'PageDown' });

        expect(viewport.scrollTop).toBe(centredOn(2));
        keyDown(viewport, { key: 'ArrowDown' });

        expect(viewport.scrollTop).toBe(centredOn(2));
        keyDown(viewport, { key: 'ArrowUp' });
        keyDown(viewport, { key: ' ', code: 'Space', shiftKey: true });
        viewport.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', shiftKey: true, bubbles: true, cancelable: true }));

        expect(viewport.scrollTop).toBe(centredOn(0));
    });

    it('lands the page box on whole pages in Fit page', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER, LETTER] })));
        chooseZoom('zoom-fit-page');
        const viewport = layOutPages();
        const input = host.querySelector('.pdf-page-input') as HTMLInputElement;
        input.value = '3';
        keyDown(input, { key: 'Enter' });

        expect(viewport.scrollTop).toBe(centredOn(2));
    });

    it('leaves Fit page for Ctrl+wheel, after which the wheel and keys scroll as usual', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER, LETTER, LETTER] })));
        chooseZoom('zoom-fit-page');
        const viewport = layOutPages();
        wheel(viewport, { deltaY: -100, ctrlKey: true });
        time.advance(32);

        expect(zoomLevel().textContent).toMatch(/^\d+%$/);
        expect(wheel(viewport, { deltaY: 100 }).defaultPrevented).toBe(false);
        expect(keyDown(viewport, { key: 'PageDown' }).defaultPrevented).toBe(false);
    });
});
