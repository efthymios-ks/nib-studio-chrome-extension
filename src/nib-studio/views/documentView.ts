import { WORD_PROBLEM_TITLES } from '../../common/office/docReader.js';
import type { OfficeEncryption, PasswordEncryption } from '../../common/office/encryption/officeEncryptionTypes.js';
import { rememberUnlocked, unlockedBytesOf } from '../../common/office/encryption/unlockedFiles.js';
import type { PageGeometry } from '../../common/office/pageGeometry.js';
import { loadWordDocumentAsync, type WordContent, type WordDocumentView } from '../../common/office/wordLoader.js';
import { wordMetadataGroups } from '../../common/office/wordProperties.js';
import { cachePerFile } from '../../common/preview/fileCache.js';
import {
    compactGroups,
    fileMetadataGroup,
    metadataGroup,
    type MetadataGroup,
} from '../../common/preview/metadataGroups.js';
import { h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { createPictureUrls, renderDocBlocks } from './docBlocksView.js';
import { createFindHighlighter, indexText, textNodesOf, type TextIndex } from './documentFind.js';
import { createFindBox, matchSummary } from './findBox.js';
import { observeResize } from './observeResize.js';
import { createPasswordCancelled } from './passwordPanel.js';
import { listenForPreviewFind, takePreviewFind } from './previewFindRequests.js';
import { askForPasswordAsync } from './passwordUnlock.js';
import { createPreviewFrame, type PreviewFrame } from './previewFrame.js';
import type { PreviewHandle } from './previewHandle.js';
import { BROWSER_CLOCK, type AnimationClock } from './previewZoomController.js';
import { convertTiffPicturesAsync } from './tiffPictures.js';

export interface DocumentPreviewOptions {
    readonly file: File;
    readonly fileName: string;
    // Keys the remembered zoom and scroll: the tab's path.
    readonly memoryKey: string;
    readonly clock?: AnimationClock;
    readonly prefersReducedMotion?: () => boolean;
}

// Reading a document is the slow part, so each File snapshot is read once while it lives;
// switching tabs, or a store update that doesn't change the file, never reads it again.
const loadCachedAsync = cachePerFile(async (file: File, fileName: string): Promise<WordDocumentView> => (
    await readViewAsync(new Uint8Array(await file.arrayBuffer()), fileName)
));

// The document a password opened, read once per File snapshot from the plain bytes the password gave.
const loadUnlockedAsync = cachePerFile(async (_: File, plain: Uint8Array, fileName: string): Promise<WordDocumentView> => (
    await readViewAsync(plain, fileName)
));

async function readViewAsync(bytes: Uint8Array, fileName: string): Promise<WordDocumentView> {
    const view = await loadWordDocumentAsync(bytes, fileName);

    if (view.content.kind !== 'blocks') {
        return view;
    }

    return { ...view, content: { ...view.content, blocks: await convertTiffPicturesAsync(view.content.blocks) } };
}

// Pictures get this long to decode before the page is measured; a picture still loading grows the page later.
const IMAGE_WAIT_MS = 1500;

interface ShownPage {
    readonly element: HTMLElement;
    readonly geometry: PageGeometry;
    readonly index: TextIndex;
    readonly dispose: () => void;
}

// A Word document (DOCX, DOC and their template and macro-enabled kinds) on a white page in the preview frame:
// the wheel scrolls, Ctrl+wheel and the buttons zoom, Reset fits the page width, and Find highlights every match.
export function mountDocumentPreview(host: HTMLElement, options: DocumentPreviewOptions): PreviewHandle {
    const clock = options.clock ?? BROWSER_CLOCK;
    const highlighter = createFindHighlighter();
    const frame = createPreviewFrame({
        memoryKey: options.memoryKey,
        typeLabel: 'Word',
        zoom: true,
        wheelZoom: 'ctrl-wheel',
        fitMode: 'width',
        allowUpscaleOnFit: false,
        dragToPan: false,
        label: `Word preview of ${options.fileName}`,
        clock: options.clock,
        prefersReducedMotion: options.prefersReducedMotion,
    });
    let current = options.file;
    let shown: ShownPage | null = null;
    let generation = 0;
    let matches: Range[] = [];
    let matchIndex = -1;

    // Ctrl+F in the preview goes to its own Find box, which knows the zoomed page.
    const findBox = createFindBox({
        shortcutScope: frame.element,
        onQuery: () => runFind(true),
        onStep: (direction) => step(direction),
    });
    // The controls bar hides while the frame shows a message, and Find with it.
    frame.setControls(findBox.element);
    frame.element.dataset['viewer'] = 'document';
    host.append(frame.element);

    const describeMatches = (): void => {
        findBox.setEnabled(shown != null);
        findBox.show(matchSummary(findBox.getQuery(), matches.length, matchIndex), matches.length > 0);
    };

    const reveal = (range: Range): void => {
        if (shown != null) {
            frame.scrollContentTo(contentPointOf(shown, range.getBoundingClientRect()), { align: 'center' });
        }
    };

    const runFind = (shouldReveal: boolean): void => {
        matches = shown?.index.find(findBox.getQuery()) ?? [];
        matchIndex = matches.length > 0 ? 0 : -1;
        highlighter.show(matches, matchIndex);
        describeMatches();
        const first = matches[0];

        if (shouldReveal && first != null) {
            reveal(first);
        }
    };

    const step = (direction: 1 | -1): void => {
        if (matches.length === 0) {
            return;
        }

        matchIndex = (matchIndex + direction + matches.length) % matches.length;
        highlighter.show(matches, matchIndex);
        describeMatches();
        const active = matches[matchIndex];

        if (active != null) {
            reveal(active);
        }
    };

    // A phrase asked for from outside, such as the match Lookup opened the document at, goes in the box once the page shows.
    const findRequested = (): void => {
        const text = shown == null ? null : takePreviewFind(options.memoryKey);

        if (text != null) {
            findBox.setQuery(text);
            runFind(true);
        }
    };
    const stopListening = listenForPreviewFind(options.memoryKey, findRequested);

    const release = (): void => {
        shown?.dispose();
        shown = null;
        matches = [];
        matchIndex = -1;
        highlighter.clear();
    };

    // The plain document behind a password: from this snapshot's earlier unlocking, or by asking for the password.
    // Null after Cancel, which leaves a way back to the password box, or once another load took over.
    const unlockAsync = async (
        file: File,
        encryption: PasswordEncryption,
        isCurrent: () => boolean,
    ): Promise<WordDocumentView | null> => {
        const known = unlockedBytesOf(file);

        if (known != null) {
            return await loadUnlockedAsync(file, known, options.fileName);
        }

        const plain = await askForPasswordAsync({
            title: WORD_PROBLEM_TITLES.encrypted,
            fileName: options.fileName,
            show: (panel) => frame.showPanel(panel),
            showUnlocking: () => frame.showLoading('Unlocking…'),
            tryPasswordAsync: async (password) => await encryption.unlockAsync(password),
            isCurrent,
            clock,
        });

        if (plain == null) {
            if (isCurrent()) {
                frame.showPanel(createPasswordCancelled({
                    title: WORD_PROBLEM_TITLES.encrypted,
                    fileName: options.fileName,
                    onRetry: () => void loadAsync(current),
                }));
            }

            return null;
        }

        rememberUnlocked(file, plain);
        frame.showLoading('Opening the document…');

        return await loadUnlockedAsync(file, plain, options.fileName);
    };

    const showViewAsync = async (view: WordDocumentView, isCurrent: () => boolean): Promise<void> => {
        if (view.content.kind === 'message') {
            frame.showMessage(view.content.title, view.content.message);

            return;
        }

        const page = await showPageAsync(frame, view.content, clock, isCurrent);

        if (page == null) {
            return;
        }

        shown = page;
        frame.setNote(view.note);
        runFind(false);
        findRequested();
    };

    const loadAsync = async (file: File): Promise<void> => {
        generation += 1;
        const token = generation;
        const isCurrent = (): boolean => token === generation;
        release();
        describeMatches();
        frame.setNote(null);
        frame.setMetadata(null);
        frame.showLoading('Opening the document…');

        try {
            const view = await loadCachedAsync(file, options.fileName);

            if (!isCurrent()) {
                return;
            }

            // Info shows what the file tells without its password, while the password is asked for.
            frame.setMetadata(documentMetadata(file, view, view.encryption));
            const unlocked = view.encryption?.kind === 'password' ? await unlockAsync(file, view.encryption, isCurrent) : view;

            if (unlocked == null || !isCurrent()) {
                return;
            }

            if (unlocked !== view) {
                frame.setMetadata(documentMetadata(file, unlocked, view.encryption));
            }

            await showViewAsync(unlocked, isCurrent);
        }
        catch (error) {
            if (!isCurrent()) {
                return;
            }

            frame.showMessage('This document can\'t be shown', errorMessage(error));
            frame.setMetadata([fileMetadataGroup(file, 'Word document')]);
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
            generation += 1;
            release();
            stopListening();
            findBox.destroy();
            frame.destroy();
            frame.element.remove();
        },
    };
}

// The Info panel of a document, with how it is encrypted after the File group when it is.
function documentMetadata(file: File, view: WordDocumentView, encryption: OfficeEncryption | undefined): MetadataGroup[] {
    const [fileGroup, ...others] = wordMetadataGroups(file, view.formatLabel, view.properties);

    return compactGroups([
        fileGroup ?? null,
        ...others,
        encryption == null ? null : metadataGroup('Security', [['Encrypted', encryption.scheme]]),
    ]);
}

// A point in the page at 100%, from a box on screen; the page's own width on screen gives the scale shown,
// even halfway through a zoom.
function contentPointOf(page: ShownPage, box: DOMRect): { readonly x: number; readonly y: number } {
    const pageBox = page.element.getBoundingClientRect();
    const scale = pageBox.width > 0 ? pageBox.width / page.geometry.width : 1;

    return {
        x: (box.left + box.width / 2 - pageBox.left) / scale,
        y: (box.top + box.height / 2 - pageBox.top) / scale,
    };
}

interface BuiltPage {
    readonly element: HTMLElement;
    // Lets go of the page's picture URLs.
    readonly release: () => void;
}

function buildPage(content: Exclude<WordContent, { kind: 'message' }>): BuiltPage {
    const { page } = content;
    const element = h('article', { class: 'document-page', dataset: { source: content.source } });
    const pictureUrls = createPictureUrls();
    element.style.width = `${page.width}px`;
    element.style.minHeight = `${page.height}px`;
    element.style.padding = `${page.marginTop}px ${page.marginRight}px ${page.marginBottom}px ${page.marginLeft}px`;

    if (content.kind === 'html') {
        // The HTML was sanitized when the document was read.
        element.innerHTML = content.html;
    }
    else {
        element.append(renderDocBlocks(content.blocks, pictureUrls.urlOf));
    }

    markBoldHeaderRows(element);

    return { element, release: pictureUrls.revoke };
}

// Word documents often make a table's first row a header by setting it in bold rather than marking it,
// so a first row of bold cells is shaded like a marked header row.
export function markBoldHeaderRows(page: HTMLElement): void {
    for (const table of page.querySelectorAll('table')) {
        const firstRow = table.rows[0];

        if (firstRow == null || table.querySelector('th') != null || firstRow.cells.length < 2) {
            continue;
        }

        if ([...firstRow.cells].every(isBoldCell)) {
            firstRow.dataset['header'] = 'true';
        }
    }
}

function isBoldCell(cell: HTMLTableCellElement): boolean {
    const texts = [...textNodesOf(cell)].filter((node) => node.data.trim() !== '');

    return texts.length > 0 && texts.every((node) => node.parentElement?.closest('strong, b') != null);
}

// Lays the page out at 100% out of sight, once its pictures have decoded, so the frame knows its height from the start
// and a remembered scroll lands where it was; later changes of height, such as a late picture, follow.
async function showPageAsync(
    frame: PreviewFrame,
    content: Exclude<WordContent, { kind: 'message' }>,
    clock: AnimationClock,
    isCurrent: () => boolean,
): Promise<ShownPage | null> {
    const { element, release } = buildPage(content);
    const geometry = content.page;
    const probe = h('div', { class: 'document-measure', attrs: { 'aria-hidden': 'true' }, children: [element] });
    frame.element.append(probe);
    await waitForImagesAsync(element, clock);
    const height = measureHeight(element, geometry);
    probe.remove();

    if (!isCurrent()) {
        release();

        return null;
    }

    frame.setContent(element, { width: geometry.width, height });
    const stopFollowing = followHeight(element, geometry, frame, clock, height);
    const shown: ShownPage = {
        element,
        geometry,
        index: indexText(element),
        dispose: () => {
            stopFollowing();
            release();
        },
    };
    element.addEventListener('click', (event) => followInternalLink(event, shown, frame));
    element.addEventListener('mousedown', keepMiddleClickOnLink);
    element.addEventListener('auxclick', keepMiddleClickOnLink);

    return shown;
}

// A middle click on a link, which never opens a tab here, would start the browser's autoscroll instead,
// so the next click only ended it.
function keepMiddleClickOnLink(event: MouseEvent): void {
    if (event.button === 1 && event.target instanceof Element && event.target.closest('a') != null) {
        event.preventDefault();
    }
}

function measureHeight(element: HTMLElement, geometry: PageGeometry): number {
    const height = Math.ceil(element.offsetHeight);

    // Without layout, as in tests, the page is taken as one sheet of paper.
    return height > 0 ? height : geometry.height;
}

async function waitForImagesAsync(element: HTMLElement, clock: AnimationClock): Promise<void> {
    const images = [...element.querySelectorAll('img')];

    if (images.length === 0) {
        return;
    }

    const decoded = Promise.allSettled(images.map((image) => (
        typeof image.decode === 'function' ? image.decode() : Promise.resolve()
    )));
    let timer = 0;
    const timeout = new Promise<void>((resolve) => {
        timer = clock.setTimer(resolve, IMAGE_WAIT_MS);
    });
    await Promise.race([decoded, timeout]);
    clock.clearTimer(timer);
}

// The page grows when a picture or a font arrives late, so the frame is told its height at 100%.
function followHeight(
    element: HTMLElement,
    geometry: PageGeometry,
    frame: PreviewFrame,
    clock: AnimationClock,
    initial: number,
): () => void {
    let knownHeight = initial;

    return observeResize(element, () => {
        const height = Math.ceil(element.offsetHeight);

        if (height > 0 && Math.abs(height - knownHeight) > 1) {
            knownHeight = height;
            frame.updateContentSize({ width: geometry.width, height });
        }
    }, { frames: clock });
}

// Links inside the document, such as to a footnote or a bookmark, scroll to their target within the page.
function followInternalLink(event: MouseEvent, page: ShownPage, frame: PreviewFrame): void {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;

    if (link == null) {
        return;
    }

    event.preventDefault();
    const id = decodeURIComponent((link.getAttribute('href') ?? '').slice(1));
    const target = [...page.element.querySelectorAll('[id]')].find((candidate) => candidate.id === id);

    if (target != null) {
        frame.scrollContentTo(contentPointOf(page, target.getBoundingClientRect()), { align: 'center' });
    }
}
