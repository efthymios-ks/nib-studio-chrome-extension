import { CSS_PIXELS_PER_POINT, fitPageScale, pageCentre, pageIndexAt } from '../../common/pdf/pdfPageLayout.js';
import type { PdfMatch } from '../../common/pdf/pdfTextSearch.js';
import { passwordOfUnlockedPdf, rememberUnlockedPdf } from '../../common/pdf/unlockedPdfs.js';
import {
    describePdfError,
    isTaggedMarkInfo,
    PDF_TYPE_LABEL,
    pdfMetadataGroups,
} from '../../common/pdf/pdfDetails.js';
import { fileMetadataGroup } from '../../common/preview/metadataGroups.js';
import {
    createPdfDocumentView,
    type PageObserverFactory,
    type PdfDocumentView,
    type PdfLinkDestination,
    type PdfPageSize,
} from './pdfDocumentView.js';
import {
    loadPdfEngineAsync,
    PdfPasswordCancelledError,
    readTextItemsAsync,
    type PasswordReason,
    type PdfDocument,
    type PdfEngine,
} from './pdfEngine.js';
import { createPageTextCache, createPdfFind, matchRange } from './pdfFind.js';
import { createPageBox } from './pdfPageBox.js';
import { attachPdfPaging } from './pdfPaging.js';
import { attachPdfPan } from './pdfPan.js';
import { createPasswordCancelled, createPasswordForm } from './passwordPanel.js';
import { listenForPreviewFind, takePreviewFind } from './previewFindRequests.js';
import { createSavePagesButton, type OpenPdf } from './pdfSavePagesDialog.js';
import { centreTargetOf, jumpScroll, type ScrollJump } from './pdfScroll.js';
import {
    createPreviewFrame,
    previewMemoryFor,
    type PreviewFrame,
    type PreviewMemory,
} from './previewFrame.js';
import type { PreviewHandle } from './previewHandle.js';
import { CONTENT_PADDING, type Point } from './previewZoom.js';
import { prefersReducedMotion, type AnimationClock, type ViewerFit } from './previewZoomController.js';

export interface PdfPreviewOptions {
    readonly file: File;
    readonly fileName: string;
    readonly memoryKey: string;
    // pdf.js, unless a test gives a stand-in.
    readonly loadEngineAsync?: () => Promise<PdfEngine>;
    readonly createObserver?: PageObserverFactory;
    readonly devicePixelRatio?: () => number;
    readonly clock?: AnimationClock;
    readonly prefersReducedMotion?: () => boolean;
    // Save pages… in the toolbar, given the open document; without it the toolbar has no such button.
    readonly onSavePages?: (open: OpenPdf) => void;
}

// Documents up to this many pages are measured page by page before they show; longer ones show at once
// with every page the size of the first, and are measured in the background.
const MEASURED_UP_FRONT = 100;
const MEASURE_BATCH = 50;

// Pages within half a pixel of the first count as the same size.
const SAME_SIZE_TOLERANCE = 0.5;

// Where each tab's PDF was being read, as a content point, so a tab left fitted to the width still comes back
// at the same place; it goes with the tab's preview memory.
const readingPoints = new WeakMap<PreviewMemory, Point>();

const PDF_PASSWORD_TITLE = 'This PDF is protected with a password';

// The fixed zooms of the zoom menu, after Fit page, Fit width and Actual size.
const ZOOM_MENU_STEPS: ReadonlyArray<number> = [0.5, 0.75, 1.25, 1.5, 2];

// Shows a PDF in the preview frame: pages drawn as they come into view, selectable text,
// Ctrl+wheel zoom with Fit page, Fit width and fixed zooms, a page box, Find, and the Info panel.
// Nothing in the PDF runs: no scripts, no forms, no links out of the document.
export function mountPdfPreview(host: HTMLElement, options: PdfPreviewOptions): PreviewHandle {
    const loadEngineAsync = options.loadEngineAsync ?? loadPdfEngineAsync;
    const reducedMotion = options.prefersReducedMotion ?? prefersReducedMotion;
    const memory = previewMemoryFor(options.memoryKey);
    let current = options.file;
    let view: PdfDocumentView | null = null;
    let shown: PdfDocument | null = null;
    let shownEngine: PdfEngine | null = null;
    let generation = 0;
    let abort: AbortController | null = null;
    let refreshFrame: number | null = null;
    let isDestroyed = false;
    let jump: ScrollJump | null = null;
    // The page being read, which Fit page shows whole.
    let currentIndex = 0;
    let revealGeneration = 0;

    const isFitPage = (): boolean => frame.getZoomMode() === 'fit-page';

    const jumpTo = (target: Point): void => {
        jump?.cancel();
        jump = jumpScroll(frame.viewport, target, {
            prefersReducedMotion: reducedMotion(),
            clock: options.clock,
            onDone: () => {
                jump = null;
                view?.refresh();
            },
        });
    };

    // A page typed in the box or a link's target comes to the top of the view in one short, eased scroll;
    // in Fit page the whole page comes to the middle.
    const goTo = (destination: PdfLinkDestination): void => {
        if (isFitPage()) {
            paging.goTo(destination.index);

            return;
        }

        const target = view?.scrollTargetFor(destination);

        if (target != null) {
            jumpTo(target);
        }
    };

    // Fit page shows the page being read whole: its full height in the view, or its full width when that is tighter.
    // After a resize it is the page that was in the middle, whatever the page box read while the view was changing.
    const fitPage: ViewerFit = (viewSize, middle) => {
        const layout = view?.getLayout();
        const index = layout == null || middle == null ? currentIndex : pageIndexAt(layout, middle.y);
        const page = layout?.pages[index];
        const centre = layout == null ? null : pageCentre(layout, index);

        if (page == null || centre == null) {
            return null;
        }

        return { scale: fitPageScale(page, viewSize, CONTENT_PADDING), point: centre };
    };

    const pageBox = createPageBox({ onGo: (index) => goTo({ index, within: null }) });
    const savePages = options.onSavePages == null ? null : createSavePagesButton(() => {
        if (shown != null && shownEngine != null) {
            options.onSavePages?.({ document: shown, engine: shownEngine });
        }
    });
    const frame: PreviewFrame = createPreviewFrame({
        memoryKey: options.memoryKey,
        typeLabel: 'PDF',
        zoom: true,
        wheelZoom: 'ctrl-wheel',
        fitMode: 'width',
        allowUpscaleOnFit: false,
        dragToPan: false,
        actions: savePages == null ? [pageBox.element] : [pageBox.element, savePages.element],
        zoomMenu: { fitPage, steps: ZOOM_MENU_STEPS },
        onZoomModeChange: (mode) => {
            if (mode !== 'fit-page') {
                paging.stop();
            }
        },
        onZoomSettled: (scale) => {
            view?.setScale(scale);
            view?.refresh();
        },
        label: `PDF preview of ${options.fileName}`,
        clock: options.clock,
        prefersReducedMotion: options.prefersReducedMotion,
    });
    frame.element.dataset['viewer'] = 'pdf';
    host.append(frame.element);
    const paging = attachPdfPaging({
        viewport: frame.viewport,
        isOn: () => view != null && isFitPage(),
        pageCount: () => view?.getLayout().pages.length ?? 0,
        currentPage: () => currentIndex,
        targetFor: (index) => view?.centreTargetFor(index) ?? null,
        prefersReducedMotion: reducedMotion,
        clock: options.clock,
        onLanded: () => view?.refresh(),
    });
    const detachPan = attachPdfPan(frame.viewport, {
        prefersReducedMotion: reducedMotion,
        onSpaceTap: (direction) => paging.turnBySpace(direction),
    });
    const detachSelectAll = attachSelectAll(frame);

    // Fit page brings the match's page whole into view. Otherwise the match comes to the middle of the view
    // once its page's text is laid out, which happens first for a page far away, so its highlight is there on arrival.
    const revealAsync = async (match: PdfMatch): Promise<void> => {
        revealGeneration += 1;
        const token = revealGeneration;
        const documentView = view;

        if (documentView == null) {
            return;
        }

        if (isFitPage()) {
            paging.goTo(match.page);

            return;
        }

        const spans = await documentView.showTextAsync(match.page);

        if (token !== revealGeneration || view !== documentView) {
            return;
        }

        const box = spans == null ? null : matchRange(match, spans)?.getBoundingClientRect();

        if (box == null || (box.width === 0 && box.height === 0)) {
            goTo({ index: match.page, within: null });

            return;
        }

        jumpTo(centreTargetOf(frame.viewport, box));
    };

    const find = createPdfFind({
        shortcutScope: frame.element,
        memory,
        onReveal: (match) => void revealAsync(match),
    });
    // Find sits in the bar under the toolbar, as in the Word preview.
    frame.setControls(find.element);

    // A phrase asked for from outside, such as the match Lookup opened the PDF at, is found once the PDF is open.
    const findRequested = (): void => {
        const text = shown == null ? null : takePreviewFind(options.memoryKey);

        if (text != null) {
            find.find(text);
        }
    };
    const stopListening = listenForPreviewFind(options.memoryKey, findRequested);

    const scheduleRefresh = (): void => {
        refreshFrame ??= requestAnimationFrame(() => {
            refreshFrame = null;
            view?.refresh();
        });
    };
    frame.viewport.addEventListener('scroll', scheduleRefresh, { passive: true });

    const releaseDocument = (): void => {
        paging.stop();
        view?.destroy();
        view = null;
        void shown?.loadingTask.destroy();
        shown = null;
        shownEngine = null;
        savePages?.setAvailable(false);
        find.setDocument(null);
    };

    // The password box and the closed state stand in place of the pages, with the zoom, the page box and Find hidden,
    // as none of them applies until the PDF opens.
    const showWithoutZoom = (element: HTMLElement): void => {
        releaseDocument();
        frame.showPanel(element);
        pageBox.setCount(0);
    };

    const askPasswordAsync = async (file: File, reason: PasswordReason): Promise<string | null> =>
        await new Promise((resolve) => {
            const form = createPasswordForm({
                title: PDF_PASSWORD_TITLE,
                fileName: options.fileName,
                reason,
                onSubmit: (password) => {
                    frame.showLoading('Unlocking…');
                    resolve(password);
                },
                onCancel: () => resolve(null),
            });
            showWithoutZoom(form.element);
            frame.setMetadata([fileMetadataGroup(file, PDF_TYPE_LABEL)]);
            form.focus();
        });

    const loadAsync = async (file: File): Promise<void> => {
        generation += 1;
        const token = generation;
        const isCurrent = (): boolean => token === generation && !isDestroyed;
        abort?.abort();
        abort = new AbortController();
        const signal = abort.signal;
        let needsPassword = false;
        // The password that opened this snapshot before is tried first, so coming back to the tab doesn't ask again.
        let known = passwordOfUnlockedPdf(file);
        let given: string | null = null;

        if (view == null) {
            frame.showLoading('Opening the PDF…');
        }

        frame.setMetadata(null);

        try {
            const engine = await loadEngineAsync();
            const data = new Uint8Array(await file.arrayBuffer());

            if (!isCurrent()) {
                return;
            }

            const pdf = await engine.openAsync(data, {
                signal,
                promptPasswordAsync: async (reason) => {
                    needsPassword = true;
                    given = known ?? (isCurrent() ? await askPasswordAsync(file, reason) : null);
                    known = null;

                    return given;
                },
            });

            if (!isCurrent()) {
                void pdf.loadingTask.destroy();

                return;
            }

            if (given != null) {
                rememberUnlockedPdf(file, given);
            }

            await showDocumentAsync({ pdf, engine, file, needsPassword, isCurrent });
        }
        catch (error) {
            if (!isCurrent()) {
                return;
            }

            if (error instanceof PdfPasswordCancelledError) {
                showWithoutZoom(createPasswordCancelled({
                    title: PDF_PASSWORD_TITLE,
                    fileName: options.fileName,
                    onRetry: () => void loadAsync(current),
                }));
            }
            else {
                releaseDocument();
                pageBox.setCount(0);
                frame.showMessage('This PDF can\'t be shown', describePdfError(error));
            }

            frame.setMetadata([fileMetadataGroup(file, PDF_TYPE_LABEL)]);
        }
    };

    const showDocumentAsync = async (input: {
        readonly pdf: PdfDocument;
        readonly engine: PdfEngine;
        readonly file: File;
        readonly needsPassword: boolean;
        readonly isCurrent: () => boolean;
    }): Promise<void> => {
        const { pdf, engine, file } = input;
        const pageCount = pdf.numPages;
        const measured = await measurePagesAsync(pdf, 0, Math.min(pageCount, MEASURED_UP_FRONT));
        const first = measured[0];

        if (!input.isCurrent() || first == null) {
            void pdf.loadingTask.destroy();

            if (first == null && input.isCurrent()) {
                throw new Error('The PDF has no pages.');
            }

            return;
        }

        // A reload after the file changed on disk keeps the place being read.
        const keepPoint = view?.readingPoint() ?? readingPoints.get(memory) ?? null;
        releaseDocument();
        shown = pdf;
        shownEngine = engine;
        const sizes = Array.from({ length: pageCount }, (_, index) => measured[index] ?? first);
        const documentView = createPdfDocumentView({
            document: pdf,
            engine,
            viewport: frame.viewport,
            sizes,
            scale: 1,
            onCurrentPage: (index) => {
                currentIndex = index;
                pageBox.setCurrent(index);
            },
            onScroll: (point) => readingPoints.set(memory, point),
            onNavigate: goTo,
            onTextLayer: (index, spans) => find.setTextLayer(index, spans),
            devicePixelRatio: options.devicePixelRatio,
            createObserver: options.createObserver,
        });
        view = documentView;
        const layout = documentView.getLayout();
        // A tab left at Fit page comes back with the same page whole in view.
        currentIndex = keepPoint == null ? 0 : pageIndexAt(layout, keepPoint.y);
        frame.setContent(documentView.element, { width: layout.width, height: layout.height });
        documentView.setScale(frame.getScale());
        pageBox.setCount(pageCount);
        pageBox.setCurrent(currentIndex);
        savePages?.setAvailable(true);

        if (memory.scale == null && keepPoint != null && !isFitPage()) {
            frame.scrollContentTo(keepPoint, { smooth: false });
        }

        find.setDocument(createPageTextCache(pageCount, async (index) => await readTextItemsAsync(await pdf.getPage(index + 1))));
        findRequested();

        scheduleRefresh();
        const details = {
            pdf,
            file,
            needsPassword: input.needsPassword,
            firstSize: first,
            isCurrent: input.isCurrent,
        };
        const isComplete = measured.length >= pageCount;
        void describeAsync({ ...details, hasMixedPageSizes: isComplete ? hasMixedSizes(measured) : null });

        if (!isComplete) {
            void measureRestAsync({ ...details, documentView, sizes: measured });
        }
    };

    const measureRestAsync = async (input: {
        readonly pdf: PdfDocument;
        readonly file: File;
        readonly needsPassword: boolean;
        readonly firstSize: PdfPageSize;
        readonly documentView: PdfDocumentView;
        readonly sizes: ReadonlyArray<PdfPageSize>;
        readonly isCurrent: () => boolean;
    }): Promise<void> => {
        const sizes = [...input.sizes];

        try {
            while (sizes.length < input.pdf.numPages) {
                const batchEnd = Math.min(input.pdf.numPages, sizes.length + MEASURE_BATCH);
                const batch = await measurePagesAsync(input.pdf, sizes.length, batchEnd);

                if (!input.isCurrent() || view !== input.documentView) {
                    return;
                }

                sizes.push(...batch);
            }
        }
        catch {
            // Pages that can't be measured keep the first page's size.
            return;
        }

        const isMixed = hasMixedSizes(sizes);

        if (isMixed) {
            const point = input.documentView.readingPoint();
            const layout = input.documentView.updateSizes(sizes);
            frame.updateContentSize({ width: layout.width, height: layout.height });

            if (point != null && !isFitPage()) {
                frame.scrollContentTo(point, { smooth: false });
            }
        }

        void describeAsync({ ...input, hasMixedPageSizes: isMixed });
    };

    const describeAsync = async (input: {
        readonly pdf: PdfDocument;
        readonly file: File;
        readonly needsPassword: boolean;
        readonly firstSize: PdfPageSize;
        readonly hasMixedPageSizes: boolean | null;
        readonly isCurrent: () => boolean;
    }): Promise<void> => {
        const { pdf, file } = input;
        const firstPageSize = {
            width: input.firstSize.width / CSS_PIXELS_PER_POINT,
            height: input.firstSize.height / CSS_PIXELS_PER_POINT,
        };

        try {
            const [metadata, permissions, isTagged] = await Promise.all([
                pdf.getMetadata(),
                orNullAsync(pdf.getPermissions()),
                readIsTaggedAsync(pdf),
            ]);

            if (!input.isCurrent() || shown !== pdf) {
                return;
            }

            frame.setMetadata(pdfMetadataGroups(file, {
                info: metadata.info as Readonly<Record<string, unknown>>,
                xmp: metadata.metadata ?? null,
                pageCount: pdf.numPages,
                firstPageSize,
                hasMixedPageSizes: input.hasMixedPageSizes,
                permissions,
                isTagged,
                needsPassword: input.needsPassword,
            }));
        }
        catch {
            if (input.isCurrent()) {
                frame.setMetadata([fileMetadataGroup(file, PDF_TYPE_LABEL)]);
            }
        }
    };

    void loadAsync(current);

    return {
        element: frame.element,
        update: (file) => {
            if (file == null || file === current) {
                return;
            }

            current = file;
            void loadAsync(file);
        },
        destroy: () => {
            isDestroyed = true;
            generation += 1;
            abort?.abort();
            jump?.cancel();
            releaseDocument();
            stopListening();
            find.destroy();
            paging.detach();
            detachPan();
            detachSelectAll();
            frame.viewport.removeEventListener('scroll', scheduleRefresh);

            if (refreshFrame != null) {
                cancelAnimationFrame(refreshFrame);
            }

            frame.destroy();
            frame.element.remove();
        },
    };
}

// Each page as it shows at 100%: turned by its rotation and scaled by its user unit.
async function measurePagesAsync(pdf: PdfDocument, from: number, to: number): Promise<PdfPageSize[]> {
    const numbers = Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset + 1);
    const pages = await Promise.all(numbers.map(async (number) => await pdf.getPage(number)));

    return pages.map((page) => {
        const viewport = page.getViewport({ scale: CSS_PIXELS_PER_POINT });

        return { width: viewport.width, height: viewport.height, userUnit: page.userUnit };
    });
}

function hasMixedSizes(sizes: ReadonlyArray<PdfPageSize>): boolean {
    const first = sizes[0];

    if (first == null) {
        return false;
    }

    return sizes.some((size) => Math.abs(size.width - first.width) > SAME_SIZE_TOLERANCE
        || Math.abs(size.height - first.height) > SAME_SIZE_TOLERANCE);
}

// Null when the MarkInfo can't be read.
async function readIsTaggedAsync(pdf: PdfDocument): Promise<boolean | null> {
    try {
        return isTaggedMarkInfo(await pdf.getMarkInfo());
    }
    catch {
        return null;
    }
}

async function orNullAsync<T>(pending: Promise<T>): Promise<T | null> {
    try {
        return await pending;
    }
    catch {
        return null;
    }
}

// Ctrl+A in the pages selects the document's text rather than the whole studio; elsewhere, such as in the password box,
// it keeps its usual meaning. The frame handles Ctrl with +, - or 0 and Ctrl+wheel for every zooming preview.
function attachSelectAll(frame: PreviewFrame): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
        const pages = frame.viewport.querySelector('.pdf-document');

        if (
            !(event.ctrlKey || event.metaKey)
            || event.altKey
            || event.key.toLowerCase() !== 'a'
            || pages == null
            || !frame.viewport.contains(event.target as Node | null)
        ) {
            return;
        }

        event.preventDefault();
        window.getSelection()?.selectAllChildren(pages);
    };
    frame.element.addEventListener('keydown', onKeyDown);

    return () => frame.element.removeEventListener('keydown', onKeyDown);
}
