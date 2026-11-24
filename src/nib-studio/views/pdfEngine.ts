import type { PDFDocumentProxy, PDFPageProxy, PDFWorker } from 'pdfjs-dist';
import { CSS_PIXELS_PER_POINT } from '../../common/pdf/pdfPageLayout.js';
import type { PdfTextItem } from '../../common/pdf/pdfTextSearch.js';
import type { PasswordReason } from './passwordPanel.js';

export type PdfDocument = PDFDocumentProxy;
export type PdfPage = PDFPageProxy;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export type { PasswordReason };

// Asks for a locked PDF's password; null when the viewer would rather not open it.
export type PasswordPrompt = (reason: PasswordReason) => Promise<string | null>;

// A PDF that asks for a password stays closed because none was given.
export class PdfPasswordCancelledError extends Error {
    override readonly name = 'PdfPasswordCancelledError';

    constructor() {
        super('The PDF needs a password to open.');
    }
}

// Work on a page that can be stopped part way, such as drawing it.
export interface PdfTask {
    readonly promise: Promise<void>;
    cancel(): void;
}

// A page's text layer being laid out: one span for each text item of the page, in pdf.js order,
// filled in as it renders; an item with no text has a span that is never put in the page.
export interface PdfTextTask extends PdfTask {
    readonly spans: ReadonlyArray<HTMLElement>;
}

export interface PdfOpenOptions {
    readonly promptPasswordAsync: PasswordPrompt;
    readonly signal?: AbortSignal;
}

// What the preview needs of pdf.js, so tests can stand in for it.
export interface PdfEngine {
    openAsync(data: Uint8Array, options: PdfOpenOptions): Promise<PdfDocument>;
    // Sizes the canvas for the page at `pixelsPerPoint` device pixels per PDF point and draws the page on it.
    drawPage(page: PdfPage, canvas: HTMLCanvasElement, pixelsPerPoint: number): PdfTask;
    // Fills `container` with the page's text as invisible spans that select and copy like text;
    // they follow the --total-scale-factor custom property, so a zoom never lays them out again.
    renderText(page: PdfPage, container: HTMLElement): PdfTextTask;
}

// The text layer and Find read a page's text the same way, so the items Find searches are the text layer's spans.
const TEXT_CONTENT_OPTIONS = Object.freeze({ includeMarkedContent: true });

// A page's text items in pdf.js order, leaving out the marks of the document's structure.
export async function readTextItemsAsync(page: PdfPage): Promise<PdfTextItem[]> {
    const content = await page.getTextContent(TEXT_CONTENT_OPTIONS);

    return content.items.flatMap((item) => ('str' in item ? [{ str: item.str, hasEOL: item.hasEOL }] : []));
}

// pdf.js's worker, CMaps, fonts and image decoders ship in this folder of the extension, next to main.js,
// so a PDF never makes a network request.
const PDFJS_FOLDER = 'pdfjs/';

function packagedUrl(path: string): string {
    return new URL(`${PDFJS_FOLDER}${path}`, import.meta.url).href;
}

let enginePromise: Promise<PdfEngine> | null = null;

// pdf.js loads the first time a PDF opens, not when the studio starts.
export async function loadPdfEngineAsync(): Promise<PdfEngine> {
    enginePromise ??= createEngineAsync();

    try {
        return await enginePromise;
    }
    catch (error) {
        enginePromise = null;

        throw error;
    }
}

// pdf.js's legacy build carries what it needs of newer JavaScript, such as Map.prototype.getOrInsertComputed,
// so it runs on every Chrome the manifest allows.
async function createEngineAsync(): Promise<PdfEngine> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = packagedUrl('pdf.worker.min.mjs');

    return createPdfJsEngine(pdfjs);
}

function createPdfJsEngine(pdfjs: PdfJs): PdfEngine {
    // One worker parses every PDF the studio opens; closing a document frees its part of it.
    let worker: PDFWorker | null = null;
    const sharedWorker = (): PDFWorker => {
        if (worker == null || worker.destroyed) {
            worker = new pdfjs.PDFWorker({ verbosity: pdfjs.VerbosityLevel.ERRORS });
        }

        return worker;
    };

    return {
        // pdf.js 6 compiles nothing with eval, and runs a PDF's scripts only through its viewer's scripting
        // sandbox, which is neither bundled nor shipped, so no PDF code runs and there is no isEvalSupported
        // or enableScripting to set.
        openAsync: async (data, options) => {
            let isCancelled = false;
            const task = pdfjs.getDocument({
                data,
                worker: sharedWorker(),
                cMapUrl: packagedUrl('cmaps/'),
                cMapPacked: true,
                standardFontDataUrl: packagedUrl('standard_fonts/'),
                wasmUrl: packagedUrl('wasm/'),
                // The extension's CSP allows no WebAssembly, so JBIG2 and JPEG 2000 images decode with
                // pdf.js's own JavaScript decoders from wasmUrl, PostScript functions are interpreted,
                // and ICC colour profiles give way to the device colour spaces.
                useWasm: false,
                useWorkerFetch: true,
                enableXfa: false,
                disableWorkerRendering: true,
                verbosity: pdfjs.VerbosityLevel.ERRORS,
            });
            const stop = (): void => {
                void task.destroy();
            };
            const answerAsync = async (update: (password: string) => void, reason: number): Promise<void> => {
                const isIncorrect = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
                const password = await options.promptPasswordAsync(isIncorrect ? 'incorrect' : 'needed');

                if (password == null) {
                    isCancelled = true;
                    stop();

                    return;
                }

                update(password);
            };
            task.onPassword = (update: (password: string) => void, reason: number) => {
                void answerAsync(update, reason);
            };
            options.signal?.addEventListener('abort', stop, { once: true });

            try {
                return await task.promise;
            }
            catch (error) {
                if (isCancelled) {
                    throw new PdfPasswordCancelledError();
                }

                throw error;
            }
            finally {
                options.signal?.removeEventListener('abort', stop);
            }
        },
        drawPage: (page, canvas, pixelsPerPoint) => {
            const viewport = page.getViewport({ scale: pixelsPerPoint });
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const task = page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE });

            return { promise: task.promise, cancel: () => task.cancel() };
        },
        renderText: (page, container) => {
            const layer = new pdfjs.TextLayer({
                textContentSource: page.streamTextContent(TEXT_CONTENT_OPTIONS),
                container,
                viewport: page.getViewport({ scale: CSS_PIXELS_PER_POINT }),
            });

            return { promise: layer.render(), cancel: () => layer.cancel(), spans: layer.textDivs };
        },
    };
}
