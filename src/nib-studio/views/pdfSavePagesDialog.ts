import { pageCountLabel, parsePageSelection, type PageSelection } from '../../common/pdf/pageSelection.js';
import { pdfFileNameProblem } from '../../common/pdf/pagesFileName.js';
import type { PdfPagesSource } from '../../common/pdf/pdfPagesBuilder.js';
import { focusableWithin, trapTabWithin } from '../app/dialog.js';
import { focusedElement, h, returnFocus } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { canvasToPngAsync } from './imageClipboard.js';
import type { PageObserverFactory } from './pdfDocumentView.js';
import { loadPdfEngineAsync, type PdfDocument, type PdfEngine } from './pdfEngine.js';

// A PDF the preview already has open in pdf.js,
// whose pages the dialog draws small rather than opening it again.
export interface OpenPdf {
    readonly document: PdfDocument;
    readonly engine: PdfEngine;
}

export interface SavePagesDialogOptions {
    readonly file: File;
    readonly fileName: string;
    // The name offered for the new PDF.
    readonly suggestedName: string;
    // Where the new PDF goes, shown under its name.
    readonly destinationHint: string;
    // "Save", or "Save as…" when a file picker asks where.
    readonly saveLabel: string;
    readonly open?: OpenPdf | null;
    // The app's own checks of a name, after the dialog's check that it ends in .pdf.
    readonly validateName: (name: string) => string | null;
    // Writes the new PDF; false when nothing was written, such as when a file picker is closed,
    // which keeps the dialog open.
    // A failure is shown in the dialog.
    readonly saveAsync: (name: string, bytes: Uint8Array) => Promise<boolean>;
    // pdf.js and pdf-lib, unless a test gives stand-ins.
    readonly loadEngineAsync?: () => Promise<PdfEngine>;
    readonly openSourceAsync?: (bytes: Uint8Array) => Promise<PdfPagesSource>;
    readonly createObserver?: PageObserverFactory;
    readonly devicePixelRatio?: () => number;
}

type ReadySource = Extract<PdfPagesSource, { kind: 'ready' }>;
type DialogState = 'loading' | 'ready' | 'saving' | 'encrypted' | 'damaged';

interface Tile {
    readonly element: HTMLElement;
    readonly image: HTMLImageElement;
    readonly index: number;
}

// A thumbnail fits this box, in CSS pixels; the stylesheet gives each tile the same.
const THUMBNAIL_WIDTH = 104;
const THUMBNAIL_HEIGHT = 136;
// Tiles past this many are left out of the preview, and the pages drawn are only those near the view.
export const PREVIEW_TILE_LIMIT = 500;
const PREVIEW_DELAY_MS = 200;
const DRAWS_AT_ONCE = 2;
const NEAR_VIEW_MARGIN = '160px 0px';

export const ENCRYPTED_MESSAGE = 'Pages of a password-protected PDF can\'t be saved.';

const BROWSER_OBSERVER: PageObserverFactory = (callback, options) => new IntersectionObserver(callback, options);

export interface SavePagesButton {
    readonly element: HTMLButtonElement;
    // The button shows only while a document is open, as the page box does.
    setAvailable(isAvailable: boolean): void;
}

// Save pages… in the PDF preview's toolbar, beside the page box.
export function createSavePagesButton(onClick: () => void): SavePagesButton {
    const element = h('button', {
        class: 'button',
        text: 'Save pages…',
        dataset: { action: 'save-pages' },
        attrs: { type: 'button', title: 'Save some of the pages, in any order, as a new PDF', hidden: true },
        on: { click: onClick },
    });

    return {
        element,
        setAvailable: (isAvailable) => {
            element.hidden = !isAvailable;
        },
    };
}

// Save pages: the pages typed, in any order and with repeats, previewed as thumbnails in their new order,
// then written as a new PDF. Resolves once the dialog closes, with whether a PDF was saved.
export async function showSavePagesDialogAsync(options: SavePagesDialogOptions): Promise<boolean> {
    return await new Promise<boolean>((resolve) => mountDialog(options, resolve));
}

function mountDialog(options: SavePagesDialogOptions, resolve: (saved: boolean) => void): void {
    const loadEngineAsync = options.loadEngineAsync ?? loadPdfEngineAsync;
    const openSourceAsync = options.openSourceAsync ?? openPdfLibSourceAsync;
    const createObserver = options.createObserver ?? BROWSER_OBSERVER;
    const pixelRatio = options.devicePixelRatio ?? (() => window.devicePixelRatio ?? 1);
    const idSuffix = Math.random().toString(36).slice(2, 10);
    const focused = focusedElement();
    let state: DialogState = 'loading';
    let source: ReadySource | null = null;
    let bytes: Uint8Array | null = null;
    let selection: PageSelection | null = null;
    let isClosed = false;
    let previewTimer: number | null = null;
    let observer: ReturnType<PageObserverFactory> | null = null;
    let ownDocument: PdfDocument | null = null;
    let pdfPending: Promise<OpenPdf | null> | null = null;
    let tiles: Tile[] = [];
    const tileByElement = new Map<Element, Tile>();
    const nearView = new Set<Element>();
    // Each source page is drawn once: its thumbnail's blob URL, or null when it can't be drawn.
    const thumbnails = new Map<number, string | null>();
    const drawing = new Set<number>();
    const queue: number[] = [];

    const titleId = `pdf-pages-title-${idSuffix}`;
    const pagesId = `pdf-pages-input-${idSuffix}`;
    const pagesHelpId = `pdf-pages-help-${idSuffix}`;
    const pagesErrorId = `pdf-pages-error-${idSuffix}`;
    const nameId = `pdf-pages-name-${idSuffix}`;
    const nameErrorId = `pdf-pages-name-error-${idSuffix}`;

    const intro = h('p', { class: 'modal-hint', text: `From ${options.fileName}.` });
    const status = h('div', {
        class: 'pdf-pages-status',
        attrs: { role: 'status' },
        children: [h('p', { class: 'pdf-pages-status-title', text: 'Reading the PDF…' })],
    });
    const pagesInput = h('input', {
        class: 'input input-mono pdf-pages-input',
        attrs: {
            id: pagesId,
            type: 'text',
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-describedby': `${pagesHelpId} ${pagesErrorId}`,
        },
    });
    const pagesError = h('p', { class: 'modal-error', attrs: { id: pagesErrorId, role: 'alert', hidden: true } });
    const summary = h('output', { class: 'pdf-pages-summary', attrs: { for: pagesId, 'aria-live': 'polite' } });
    const grid = h('ol', { class: 'pdf-pages-grid', attrs: { 'aria-label': 'Pages of the new PDF' } });
    const more = h('p', { class: 'pdf-pages-more', attrs: { hidden: true } });
    const scroller = h('div', {
        class: 'pdf-pages-scroller',
        attrs: { tabindex: '0', role: 'region', 'aria-label': 'Preview of the new PDF' },
        children: [grid, more],
    });
    const preview = h('div', { class: 'pdf-pages-preview', dataset: { stale: 'false' }, children: [summary, scroller] });
    const nameInput = h('input', {
        class: 'input pdf-pages-name',
        attrs: {
            id: nameId,
            type: 'text',
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-describedby': nameErrorId,
        },
    });
    nameInput.value = options.suggestedName;
    const nameError = h('p', { class: 'modal-error', attrs: { id: nameErrorId, role: 'alert', hidden: true } });
    const saveError = h('p', { class: 'modal-error', attrs: { role: 'alert', hidden: true } });
    const form = h('div', {
        class: 'pdf-pages-form',
        attrs: { hidden: true },
        children: [
            h('label', { class: 'form-label', attrs: { for: pagesId }, text: 'Pages' }),
            pagesInput,
            h('p', {
                class: 'pdf-pages-help',
                attrs: { id: pagesHelpId },
                text: 'Pages and ranges in any order, with repeats, such as 1, 2, 6-8, 1. A range can run backwards, as 8-6 does; '
                    + '6- runs to the last page and -3 from the first.',
            }),
            pagesError,
            preview,
            h('label', { class: 'form-label', attrs: { for: nameId }, text: 'File name' }),
            nameInput,
            nameError,
            h('p', { class: 'modal-hint', text: options.destinationHint }),
            saveError,
        ],
    });
    const cancelButton = h('button', { class: 'button', text: 'Cancel', attrs: { type: 'button' } });
    const saveButton = h('button', {
        class: 'button button-primary',
        text: options.saveLabel,
        dataset: { role: 'primary' },
        attrs: { type: 'button', disabled: true },
    });
    const closeButton = h('button', {
        class: 'modal-close',
        text: '×',
        attrs: { type: 'button', 'aria-label': 'Close' },
        on: { click: () => cancel() },
    }) as HTMLButtonElement;
    const modal = h('div', {
        class: 'modal pdf-pages-modal',
        dataset: { state },
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        children: [
            h('div', {
                class: 'modal-header',
                children: [
                    h('h2', { attrs: { id: titleId }, text: 'Save pages' }),
                    closeButton,
                ],
            }),
            h('div', { class: 'modal-body pdf-pages-body', children: [intro, status, form] }),
            h('div', { class: 'modal-footer', children: [cancelButton, saveButton] }),
        ],
    });
    const backdrop = h('div', {
        class: 'modal-backdrop',
        dataset: { open: 'true', role: 'save-pages' },
        children: [modal],
    });

    const setState = (next: DialogState): void => {
        state = next;
        modal.dataset['state'] = next;
        const isSaving = next === 'saving';
        pagesInput.disabled = isSaving;
        nameInput.disabled = isSaving;
        cancelButton.disabled = isSaving;
        closeButton.disabled = isSaving;
        saveButton.textContent = isSaving ? 'Saving…' : options.saveLabel;
        updateSaveButton();
    };

    const nameProblem = (): string | null => {
        const name = nameInput.value.trim();

        return pdfFileNameProblem(name) ?? options.validateName(name);
    };

    const canSave = (): boolean => state === 'ready' && selection?.ok === true && nameProblem() == null;

    const updateSaveButton = (): void => {
        saveButton.disabled = !canSave();
    };

    // The status stands in for the form when the pages can't be saved; Close is then the only way on.
    const showMessage = (next: 'encrypted' | 'damaged', title: string, detail: string): void => {
        status.replaceChildren(
            h('p', { class: 'pdf-pages-status-title', text: title }),
            h('p', { class: 'pdf-pages-status-detail', text: detail }),
        );
        status.dataset['tone'] = 'fail';
        status.hidden = false;
        form.hidden = true;
        saveButton.hidden = true;
        cancelButton.textContent = 'Close';
        setState(next);
        cancelButton.focus();
    };

    const updatePages = (): void => {
        if (source == null) {
            return;
        }

        selection = parsePageSelection(pagesInput.value, source.pageCount);

        if (selection.ok) {
            pagesError.hidden = true;
            pagesInput.removeAttribute('aria-invalid');
            summary.textContent = pageCountLabel(selection.pages.length);
        }
        else {
            pagesError.textContent = selection.message;
            pagesError.hidden = false;
            pagesInput.setAttribute('aria-invalid', 'true');
            summary.textContent = '';
            preview.dataset['stale'] = 'true';
        }

        updateSaveButton();
    };

    const schedulePreview = (): void => {
        if (previewTimer != null) {
            window.clearTimeout(previewTimer);
        }

        previewTimer = window.setTimeout(() => {
            previewTimer = null;
            showPreview();
        }, PREVIEW_DELAY_MS);
    };

    const showPreview = (): void => {
        if (selection?.ok !== true || isClosed) {
            return;
        }

        preview.dataset['stale'] = 'false';
        renderTiles(selection.pages);
    };

    const updateName = (): void => {
        const problem = nameProblem();
        nameError.textContent = problem ?? '';
        nameError.hidden = problem == null;

        if (problem == null) {
            nameInput.removeAttribute('aria-invalid');
        }
        else {
            nameInput.setAttribute('aria-invalid', 'true');
        }

        updateSaveButton();
    };

    const renderTiles = (pages: ReadonlyArray<number>): void => {
        observer?.disconnect();
        nearView.clear();
        tileByElement.clear();
        const shown = pages.slice(0, PREVIEW_TILE_LIMIT);
        tiles = shown.map((page, position) => createTile(page, position, pages.length));
        grid.replaceChildren(...tiles.map((tile) => tile.element));
        more.hidden = pages.length <= PREVIEW_TILE_LIMIT;
        more.textContent = more.hidden
            ? ''
            : `The preview shows the first ${PREVIEW_TILE_LIMIT.toLocaleString('en-US')} of ${pageCountLabel(pages.length)}.`;

        for (const tile of tiles) {
            tileByElement.set(tile.element, tile);
            showThumbnail(tile);
        }

        observer = createObserver((entries) => {
            for (const entry of entries) {
                const tile = tileByElement.get(entry.target);

                if (tile == null) {
                    continue;
                }

                if (entry.isIntersecting) {
                    nearView.add(entry.target);
                    request(tile.index);
                }
                else {
                    nearView.delete(entry.target);
                }
            }

            pump();
        }, { root: scroller, rootMargin: NEAR_VIEW_MARGIN });

        for (const tile of tiles) {
            observer.observe(tile.element);
        }
    };

    const showThumbnail = (tile: Tile): void => {
        if (!thumbnails.has(tile.index)) {
            tile.element.dataset['state'] = 'waiting';

            return;
        }

        const url = thumbnails.get(tile.index) ?? null;

        if (url == null) {
            tile.element.dataset['state'] = 'failed';

            return;
        }

        tile.image.src = url;
        tile.element.dataset['state'] = 'drawn';
    };

    const request = (index: number): void => {
        if (thumbnails.has(index) || drawing.has(index) || queue.includes(index)) {
            return;
        }

        queue.push(index);
    };

    const isWanted = (index: number): boolean => tiles.some((tile) => tile.index === index && nearView.has(tile.element));

    // Draws the next pages near the view, a few at a time; pages scrolled past before their turn are skipped.
    const pump = (): void => {
        while (drawing.size < DRAWS_AT_ONCE) {
            const index = queue.shift();

            if (index == null) {
                return;
            }

            if (!thumbnails.has(index) && isWanted(index)) {
                void drawAndShowAsync(index);
            }
        }
    };

    const drawAndShowAsync = async (index: number): Promise<void> => {
        drawing.add(index);
        const url = await drawThumbnailAsync(index);
        drawing.delete(index);

        if (isClosed) {
            if (url != null) {
                URL.revokeObjectURL(url);
            }

            return;
        }

        thumbnails.set(index, url);

        for (const tile of tiles) {
            if (tile.index === index) {
                showThumbnail(tile);
            }
        }

        pump();
    };

    const drawThumbnailAsync = async (index: number): Promise<string | null> => {
        const open = await openPdfOnceAsync();

        if (open == null || isClosed || index >= open.document.numPages) {
            return null;
        }

        try {
            const page = await open.document.getPage(index + 1);
            const size = page.getViewport({ scale: 1 });
            const fit = Math.min(THUMBNAIL_WIDTH / size.width, THUMBNAIL_HEIGHT / size.height);
            const canvas = document.createElement('canvas');
            await open.engine.drawPage(page, canvas, fit * pixelRatio()).promise;
            const blob = await canvasToPngAsync(canvas);
            canvas.width = 0;
            canvas.height = 0;

            return URL.createObjectURL(blob);
        }
        catch {
            return null;
        }
    };

    const openPdfOnceAsync = async (): Promise<OpenPdf | null> => {
        pdfPending ??= openPdfAsync();

        return await pdfPending;
    };

    // The preview's open document, or the dialog's own,
    // opened from the same bytes and closed with the dialog.
    const openPdfAsync = async (): Promise<OpenPdf | null> => {
        if (options.open != null) {
            return options.open;
        }

        if (bytes == null) {
            return null;
        }

        try {
            const engine = await loadEngineAsync();
            const document = await engine.openAsync(bytes.slice(), { promptPasswordAsync: async () => null });

            if (isClosed) {
                void document.loadingTask.destroy();

                return null;
            }

            ownDocument = document;

            return { document, engine };
        }
        catch {
            return null;
        }
    };

    const createTile = (page: number, position: number, total: number): Tile => {
        const image = h('img', { class: 'pdf-pages-image', attrs: { alt: '', draggable: 'false' } });

        return {
            index: page - 1,
            image,
            element: h('li', {
                class: 'pdf-pages-tile',
                dataset: { page: String(page), state: 'waiting' },
                attrs: {
                    title: `Page ${page.toLocaleString('en-US')} of ${options.fileName}, `
                        + `page ${(position + 1).toLocaleString('en-US')} of ${total.toLocaleString('en-US')} in the new PDF`,
                },
                children: [
                    h('div', { class: 'pdf-pages-thumb', children: [image] }),
                    h('span', { class: 'pdf-pages-label', text: `p. ${page}` }),
                ],
            }),
        };
    };

    // Enter with an entry that can't be saved points at what is wrong.
    const showProblem = (): void => {
        if (selection != null && !selection.ok) {
            pagesInput.focus();
            pagesInput.setSelectionRange(selection.start, Math.max(selection.start, selection.end));

            return;
        }

        if (nameProblem() != null) {
            nameInput.focus();
            nameInput.select();
        }
    };

    const saveAsync = async (): Promise<void> => {
        if (state !== 'ready') {
            return;
        }

        if (!canSave() || source == null || selection?.ok !== true) {
            showProblem();

            return;
        }

        const pages = selection.pages;
        const name = nameInput.value.trim();
        saveError.hidden = true;
        setState('saving');

        try {
            const built = await source.buildAsync(pages);

            if (isClosed) {
                return;
            }

            if (await options.saveAsync(name, built)) {
                close(true);

                return;
            }
        }
        catch (error) {
            saveError.textContent = `The pages could not be saved: ${errorMessage(error)}`;
            saveError.hidden = false;
        }

        if (!isClosed) {
            setState('ready');
            saveButton.focus();
        }
    };

    const cancel = (): void => {
        if (state !== 'saving') {
            close(false);
        }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();

            return;
        }

        // Enter that ends an IME composition only commits the text.
        const isEnter = event.key === 'Enter' && !event.isComposing;

        if (isEnter && (event.target === pagesInput || event.target === nameInput)) {
            event.preventDefault();
            void saveAsync();

            return;
        }

        if (event.key === 'Tab') {
            trapTabWithin(event, modal);
        }
    };

    // Focus that leaves the dialog comes back to it.
    const onFocusIn = (event: FocusEvent): void => {
        if (!backdrop.contains(event.target as Node | null)) {
            focusableWithin(modal)[0]?.focus();
        }
    };

    const close = (saved: boolean): void => {
        if (isClosed) {
            return;
        }

        isClosed = true;

        if (previewTimer != null) {
            window.clearTimeout(previewTimer);
        }

        observer?.disconnect();
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('focusin', onFocusIn, true);
        backdrop.remove();

        for (const url of thumbnails.values()) {
            if (url != null) {
                URL.revokeObjectURL(url);
            }
        }

        if (ownDocument != null) {
            void ownDocument.loadingTask.destroy();
        }

        returnFocus(focused);

        resolve(saved);
    };

    const startAsync = async (): Promise<void> => {
        let opened: PdfPagesSource;

        try {
            bytes = new Uint8Array(await options.file.arrayBuffer());
            opened = await openSourceAsync(bytes);
        }
        catch {
            opened = { kind: 'damaged', reason: 'The file could not be read from disk.' };
        }

        if (isClosed) {
            return;
        }

        if (opened.kind === 'encrypted') {
            showMessage('encrypted', ENCRYPTED_MESSAGE, 'Save a copy without the password in the app that set it, then save pages of that copy.');

            return;
        }

        if (opened.kind === 'damaged') {
            showMessage('damaged', 'The pages of this PDF can\'t be saved.', opened.reason);

            return;
        }

        source = opened;
        intro.textContent = `From ${options.fileName}, ${pageCountLabel(opened.pageCount)}.`;
        pagesInput.value = opened.pageCount === 1 ? '1' : `1-${opened.pageCount}`;
        status.hidden = true;
        form.hidden = false;
        setState('ready');
        updatePages();
        updateName();
        showPreview();
        pagesInput.focus();
        pagesInput.select();
    };

    pagesInput.addEventListener('input', () => {
        updatePages();
        schedulePreview();
    });
    nameInput.addEventListener('input', updateName);
    cancelButton.addEventListener('click', cancel);
    saveButton.addEventListener('click', () => void saveAsync());
    backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
            cancel();
        }
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.body.append(backdrop);
    cancelButton.focus();
    void startAsync();
}

async function openPdfLibSourceAsync(bytes: Uint8Array): Promise<PdfPagesSource> {
    const { openPdfPagesSourceAsync } = await import('../../common/pdf/pdfPagesBuilder.js');

    return await openPdfPagesSourceAsync(bytes);
}

