import { extension } from '../../common/fs/fileEntry.js';
import { shownCharacters, type ShownCharacters } from '../../common/font/fontCharacters.js';
import {
    fontFormatLabel,
    fontMetadataGroups,
    readFontInfoAsync,
    type FontInfo,
} from '../../common/font/fontInfo.js';
import type { CodePointRanges, VariationAxis } from '../../common/font/fontTables.js';
import { cachePerFile } from '../../common/preview/fileCache.js';
import { fileMetadataGroup } from '../../common/preview/metadataGroups.js';
import { h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { observeResize } from './observeResize.js';
import { BROWSER_CLOCK, type AnimationClock } from './previewZoomController.js';
import { createPreviewFrame, type PreviewFrame } from './previewFrame.js';
import type { PreviewHandle } from './previewHandle.js';

// The part of document.fonts the preview uses, so tests can stand in for it.
export interface FontFaceRegistry {
    add(face: FontFace): unknown;
    delete(face: FontFace): unknown;
}

export interface FontPreviewOptions {
    readonly file: File;
    readonly fileName: string;
    readonly memoryKey: string;
    readonly fontFaces?: FontFaceRegistry;
    readonly createFontFace?: (family: string, data: ArrayBuffer) => FontFace;
    readonly clock?: AnimationClock;
}

export const DEFAULT_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog';

// The sizes the sample is shown at, in pixels at 100%.
export const SAMPLE_SIZES: ReadonlyArray<number> = [12, 16, 24, 36, 48, 72];

// The glyph grid shows at most this many characters; a large font says how many more it maps.
const GLYPH_GRID_LIMIT = 2000;

// The specimen is laid out this wide at 100%, and the frame fits it to the window's width.
const SHEET_WIDTH = 760;

const ESTIMATED_SHEET_HEIGHT = 1200;

// The sample text is shared by every font tab while the studio is open, and never stored.
let sampleText = DEFAULT_SAMPLE_TEXT;
let familyCounter = 0;

// A font file's bytes, and its tables when they could be read.
interface ReadFont {
    readonly bytes: Uint8Array;
    readonly info: FontInfo | null;
}

// Each File snapshot's bytes and tables are read once while it lives.
const readFontCachedAsync = cachePerFile(readFontAsync);

async function readFontAsync(file: File): Promise<ReadFont> {
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
        return { bytes, info: await readFontInfoAsync(bytes) };
    }
    catch {
        return { bytes, info: null };
    }
}


// A font shown with its own face: a sample at several sizes, the characters it maps, sliders for its variable axes,
// and its name table in the Info panel. The wheel scrolls; Ctrl+wheel and the buttons zoom. Text stays selectable.
export function mountFontPreview(host: HTMLElement, options: FontPreviewOptions): PreviewHandle {
    const fontFaces = options.fontFaces ?? document.fonts;
    const createFontFace = options.createFontFace
        ?? ((family: string, data: ArrayBuffer) => new FontFace(family, data));
    const clock = options.clock ?? BROWSER_CLOCK;
    const frame = createPreviewFrame({
        memoryKey: options.memoryKey,
        typeLabel: 'Font',
        zoom: true,
        wheelZoom: 'ctrl-wheel',
        fitMode: 'width',
        dragToPan: false,
        label: `Font preview of ${options.fileName}`,
        clock: options.clock,
    });
    host.append(frame.element);
    let current = options.file;
    let face: FontFace | null = null;
    let generation = 0;
    let stopFollowing: (() => void) | null = null;

    const release = (): void => {
        stopFollowing?.();
        stopFollowing = null;

        if (face != null) {
            fontFaces.delete(face);
            face = null;
        }
    };

    const loadAsync = async (file: File): Promise<void> => {
        generation += 1;
        const token = generation;
        release();
        frame.setControls(null);
        frame.setNote(null);
        frame.setMetadata(null);
        frame.showLoading('Opening the font…');

        try {
            const { bytes, info } = await readFontCachedAsync(file);

            if (token !== generation) {
                return;
            }

            const typeLabel = info == null ? fallbackTypeLabel(options.fileName) : fontFormatLabel(info);
            frame.setMetadata([fileMetadataGroup(file, typeLabel), ...(info == null ? [] : fontMetadataGroups(info))]);
            familyCounter += 1;
            const family = `nib-font-preview-${familyCounter}`;
            const loaded = createFontFace(family, bytes.slice().buffer);
            await loaded.load();

            if (token !== generation) {
                return;
            }

            fontFaces.add(loaded);
            face = loaded;
            const sheet = buildSheet(family, info);
            frame.setControls(buildControls(sheet, info));
            frame.setContent(sheet, { width: SHEET_WIDTH, height: ESTIMATED_SHEET_HEIGHT });
            stopFollowing = followSheetHeight(sheet, frame, clock);

            if (info == null) {
                frame.setNote('The font shows, but its details could not be read.');
            }
        }
        catch (error) {
            if (token !== generation) {
                return;
            }

            const reason = errorMessage(error);
            frame.showMessage('This font can\'t be shown', `Chrome could not read it as a font: ${reason}`);
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
            frame.destroy();
            frame.element.remove();
        },
    };
}

function fallbackTypeLabel(fileName: string): string {
    return `${extension(fileName).toUpperCase()} font`;
}

function buildSheet(family: string, info: FontInfo | null): HTMLElement {
    const samples = SAMPLE_SIZES.map((size) => h('div', {
        class: 'font-sample',
        dataset: { size: String(size) },
        children: [
            h('span', { class: 'font-sample-size', text: `${size} px` }),
            h('p', { class: 'font-specimen font-sample-text', text: sampleText }),
        ],
    }));
    const sheet = h('div', {
        class: 'font-sheet',
        children: [h('section', { class: 'font-samples', children: samples })],
    });
    sheet.style.setProperty('--font-preview-family', `"${family}"`);
    sheet.append(buildGlyphGrid(info?.codePoints ?? []));

    return sheet;
}

function buildGlyphGrid(ranges: CodePointRanges): HTMLElement {
    const characters = shownCharacters(ranges, GLYPH_GRID_LIMIT);
    const grid = h('div', { class: 'font-specimen font-glyph-grid' });
    const cells = document.createDocumentFragment();

    for (const character of characters.shown) {
        const code = character.codePointAt(0) ?? 0;
        const title = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
        cells.append(h('span', { class: 'font-glyph', text: character, attrs: { title } }));
    }

    grid.append(cells);

    return h('section', {
        class: 'font-glyphs',
        children: [
            h('h3', { class: 'font-glyphs-title', text: 'Characters' }),
            h('p', { class: 'font-glyphs-summary', text: glyphSummary(characters) }),
            grid,
        ],
    });
}

// "1 character", "1,614 characters", or "12,000 characters, the first 2,000 shown" when the grid's limit cuts the list short.
function glyphSummary(characters: ShownCharacters): string {
    if (characters.total === 0) {
        return 'The font maps no characters the preview can read.';
    }

    if (characters.total === 1) {
        return '1 character';
    }

    const total = characters.total.toLocaleString('en-US');

    if (characters.total > characters.shown.length) {
        return `${total} characters, the first ${characters.shown.length.toLocaleString('en-US')} shown`;
    }

    return `${total} characters`;
}

// The sample text box and one slider for each variable axis, all applied to the sheet as they change.
function buildControls(sheet: HTMLElement, info: FontInfo | null): HTMLElement {
    const input = h('input', {
        class: 'font-sample-input',
        attrs: { type: 'text', value: sampleText, 'aria-label': 'Sample text', spellcheck: 'false' },
    });
    input.value = sampleText;
    input.addEventListener('input', () => {
        sampleText = input.value === '' ? DEFAULT_SAMPLE_TEXT : input.value;

        for (const line of sheet.querySelectorAll('.font-sample-text')) {
            line.textContent = sampleText;
        }
    });
    const axes = (info?.variations?.axes ?? []).filter((axis) => !axis.isHidden);
    const settings = new Map(axes.map((axis) => [axis.tag, axis.defaultValue]));
    const applySettings = (): void => {
        const value = [...settings.entries()].map(([tag, amount]) => `"${tag}" ${amount}`).join(', ');
        sheet.style.setProperty('--font-preview-variations', value === '' ? 'normal' : value);
    };
    applySettings();

    return h('div', {
        class: 'font-controls',
        children: [
            h('label', {
                class: 'font-control font-sample-control',
                children: [h('span', { class: 'font-control-label', text: 'Sample' }), input],
            }),
            ...axes.map((axis) => axisSlider(axis, (value) => {
                settings.set(axis.tag, value);
                applySettings();
            })),
        ],
    });
}

function axisSlider(axis: VariationAxis, onChange: (value: number) => void): HTMLElement {
    const step = axis.max - axis.min >= 10 ? 1 : 0.01;
    const output = h('output', { class: 'font-axis-value', text: String(axis.defaultValue) });
    const slider = h('input', {
        class: 'font-axis-slider',
        dataset: { axis: axis.tag },
        attrs: { type: 'range', min: axis.min, max: axis.max, step, 'aria-label': `${axis.name} (${axis.tag})` },
    });
    slider.value = String(axis.defaultValue);
    slider.addEventListener('input', () => {
        const value = Number(slider.value);
        output.textContent = String(value);
        onChange(value);
    });

    return h('label', {
        class: 'font-control font-axis',
        attrs: { title: `${axis.tag}: ${axis.min} to ${axis.max}` },
        children: [h('span', { class: 'font-control-label', text: axis.name }), slider, output],
    });
}

// The sheet grows and shrinks with the sample text and the axes, so the frame is told its height at 100%.
// A height it already has is skipped, so the measure never feeds back into itself.
function followSheetHeight(sheet: HTMLElement, frame: PreviewFrame, clock: AnimationClock): () => void {
    let knownHeight = ESTIMATED_SHEET_HEIGHT;

    return observeResize(sheet, () => {
        const scale = Number(sheet.parentElement?.style.getPropertyValue('--preview-scale')) || 1;
        const height = Math.ceil(sheet.offsetHeight / scale);

        if (height > 0 && Math.abs(height - knownHeight) > 1) {
            knownHeight = height;
            frame.updateContentSize({ width: SHEET_WIDTH, height });
        }
    }, { frames: clock });
}

// Puts the shared sample text back to the pangram, for tests that need a fresh start.
export function resetFontSampleText(): void {
    sampleText = DEFAULT_SAMPLE_TEXT;
}
