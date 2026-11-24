import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCmap, buildSfnt, sampleFontTables } from '../../common/font/testing/fontBuilder.js';
import { createFakeAnimationClock, setClientSize, type FakeAnimationClock } from '../testing/fakeAnimationClock.js';
import { DEFAULT_SAMPLE_TEXT, mountFontPreview, resetFontSampleText, SAMPLE_SIZES } from './fontPreview.js';
import type { PreviewHandle } from './previewHandle.js';

interface FakeFace {
    readonly family: string;
    readonly data: ArrayBuffer;
    load(): Promise<FakeFace>;
}

let host: HTMLElement;
let handles: PreviewHandle[];
let registered: Set<FakeFace>;
let created: FakeFace[];
let failLoad: boolean;
let time: FakeAnimationClock;

function fontFile(bytes: Uint8Array = buildSfnt(sampleFontTables()), name = 'NibSans.ttf'): File {
    return new File([bytes.slice()], name, { lastModified: Date.UTC(2026, 0, 1) });
}

function mount(file: File = fontFile()): PreviewHandle {
    const handle = mountFontPreview(host, {
        file,
        fileName: file.name,
        memoryKey: `fonts/${file.name}`,
        clock: time.clock,
        fontFaces: {
            add: (face) => registered.add(face as unknown as FakeFace),
            delete: (face) => registered.delete(face as unknown as FakeFace),
        },
        createFontFace: (family, data) => {
            const face: FakeFace = {
                family,
                data,
                load: async () => {
                    if (failLoad) {
                        throw new DOMException('A network error occurred.', 'NetworkError');
                    }

                    return face;
                },
            };
            created.push(face);

            return face as unknown as FontFace;
        },
    });
    setClientSize(host.querySelector('.preview-viewport') as HTMLElement, 800, 600);
    handles.push(handle);

    return handle;
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

function sheet(): HTMLElement {
    return host.querySelector('.font-sheet') as HTMLElement;
}

async function readyAsync(): Promise<void> {
    await vi.waitFor(() => expect(host.querySelector<HTMLElement>('.preview-frame')?.dataset['state']).toMatch(/ready|message/));
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    handles = [];
    registered = new Set();
    created = [];
    failLoad = false;
    time = createFakeAnimationClock();
    resetFontSampleText();
    localStorage.clear();
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
    vi.unstubAllGlobals();
});

describe('mountFontPreview', () => {
    it('shows the sample at every size and the mapped characters as text, in the font itself', async () => {
        mount();
        await readyAsync();
        const family = created[0]?.family ?? '';

        expect(host.querySelector('.preview-toolbar .badge')?.textContent).toBe('Font');
        expect([...host.querySelectorAll('.preview-toolbar button')].map((button) => button.textContent)).toEqual(['−', '+', 'Reset', 'Info']);
        expect([...host.querySelectorAll<HTMLElement>('.font-sample')].map((sample) => sample.dataset['size'])).toEqual(SAMPLE_SIZES.map(String));
        expect([...host.querySelectorAll('.font-sample-text')].every((line) => line.textContent === DEFAULT_SAMPLE_TEXT)).toBe(true);
        expect([...host.querySelectorAll('.font-glyph')].map((glyph) => glyph.textContent).join('')).toBe('ABCa😀😁');
        expect(host.querySelector('.font-glyph')?.getAttribute('title')).toBe('U+0041');
        expect(host.querySelector('.font-glyphs-summary')?.textContent).toBe('6 characters');
        expect(sheet().style.getPropertyValue('--font-preview-family')).toBe(`"${family}"`);
        expect(family).toMatch(/^nib-font-preview-\d+$/);
        expect([...registered]).toEqual(created);
    });

    it('counts only the characters the grid can show, in the sheet and in Info alike', async () => {
        const cmap = buildCmap([0x09, 0x20, 0x41, 0x42, 0xad]);
        mount(fontFile(buildSfnt({ ...sampleFontTables(), cmap })));
        await readyAsync();

        expect([...host.querySelectorAll('.font-glyph')].map((glyph) => glyph.textContent).join('')).toBe('AB');
        expect(host.querySelector('.font-glyphs-summary')?.textContent).toBe('2 characters');
        expect(rows()['Font/Characters']).toBe('2');
    });

    it('names a single character in the singular', async () => {
        const cmap = buildCmap([0x20, 0x41]);
        mount(fontFile(buildSfnt({ ...sampleFontTables(), cmap })));
        await readyAsync();

        expect(host.querySelector('.font-glyphs-summary')?.textContent).toBe('1 character');
    });

    it('says how many it shows only when the grid\'s limit cuts the list short', async () => {
        const cmap = buildCmap([0x20], [[0x20, 0x20], [0x4e00, 0x4e00 + 2499]]);
        mount(fontFile(buildSfnt({ ...sampleFontTables(), cmap })));
        await readyAsync();

        expect(host.querySelectorAll('.font-glyph')).toHaveLength(2000);
        expect(host.querySelector('.font-glyphs-summary')?.textContent).toBe('2,500 characters, the first 2,000 shown');
    });

    it('lists the file and the font tables in Info', async () => {
        mount();
        await readyAsync();

        expect(rows()['File/Type']).toBe('TrueType font');
        expect(rows()['Font/Family']).toBe('Nib Sans');
        expect(rows()['Variable axes/Heaviness (wght)']).toBe('100 to 900, default 400');
        expect(rows()['Credits/Licence URL']).toBe('https://openfontlicense.org');
    });

    it('updates every sample as the text is typed, keeps it for the next font, and falls back to the pangram', async () => {
        mount();
        await readyAsync();
        const input = host.querySelector<HTMLInputElement>('.font-sample-input') as HTMLInputElement;
        input.value = 'Ηλίου';
        input.dispatchEvent(new Event('input'));

        expect([...host.querySelectorAll('.font-sample-text')].map((line) => line.textContent)).toEqual(SAMPLE_SIZES.map(() => 'Ηλίου'));

        mount();
        await vi.waitFor(() => expect(host.querySelectorAll('.font-sample-input')).toHaveLength(2));
        expect(host.querySelectorAll<HTMLInputElement>('.font-sample-input')[1]?.value).toBe('Ηλίου');

        input.value = '';
        input.dispatchEvent(new Event('input'));
        expect(host.querySelector('.font-sample-text')?.textContent).toBe(DEFAULT_SAMPLE_TEXT);
    });

    it('gives each visible variable axis a slider that changes the samples', async () => {
        mount();
        await readyAsync();
        const sliders = [...host.querySelectorAll<HTMLInputElement>('.font-axis-slider')];

        expect(sliders.map((slider) => [slider.dataset['axis'], slider.min, slider.max, slider.value])).toEqual([
            ['wght', '100', '900', '400'],
            ['wdth', '75', '125', '100'],
        ]);
        expect(sheet().style.getPropertyValue('--font-preview-variations')).toBe('"wght" 400, "wdth" 100');

        const weight = sliders[0] as HTMLInputElement;
        weight.value = '750';
        weight.dispatchEvent(new Event('input'));

        expect(sheet().style.getPropertyValue('--font-preview-variations')).toBe('"wght" 750, "wdth" 100');
        expect(host.querySelector('.font-axis-value')?.textContent).toBe('750');
    });

    it('scrolls with the plain wheel and keeps the characters selectable', async () => {
        mount();
        await readyAsync();
        const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
        host.querySelector('.preview-viewport')?.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(host.querySelector<HTMLElement>('.preview-viewport')?.dataset['pannable']).toBe('false');
    });

    it('lets go of the face when the tab closes, and swaps it for a new snapshot', async () => {
        const handle = mount();
        await readyAsync();
        const first = created[0];
        handle.update(fontFile());
        await vi.waitFor(() => expect(created).toHaveLength(2));
        await vi.waitFor(() => expect([...registered]).toEqual([created[1]]));

        expect(registered.has(first as FakeFace)).toBe(false);
        expect(created[1]?.family).not.toBe(first?.family);

        handle.destroy();
        expect(registered.size).toBe(0);
        expect(host.querySelector('.preview-frame')).toBeNull();
    });

    it('shows a clear message when Chrome can\'t load the font, still listing the file', async () => {
        failLoad = true;
        mount();
        await readyAsync();

        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This font can\'t be shown');
        expect(rows()['File/Name']).toBe('NibSans.ttf');
        expect(registered.size).toBe(0);
    });

    it('still shows a font whose tables it can\'t read, with a note', async () => {
        mount(fontFile(new TextEncoder().encode('opaque font data'), 'odd.woff2'));
        await readyAsync();

        expect(host.querySelector('.preview-note')?.textContent).toBe('The font shows, but its details could not be read.');
        expect(rows()['File/Type']).toBe('WOFF2 font');
        expect(host.querySelector('.font-glyphs-summary')?.textContent).toBe('The font maps no characters the preview can read.');
    });

    it('tells the frame the sheet\'s height once a frame, skipping a height it already has', async () => {
        const observers: Array<() => void> = [];
        vi.stubGlobal('ResizeObserver', class {
            constructor(readonly callback: (entries: ReadonlyArray<{ contentRect: { width: number; height: number } }>) => void) {
                observers.push(() => callback([{ contentRect: { width: 640, height: 900 } }]));
            }

            observe(): void {}

            disconnect(): void {}
        });
        mount();
        await readyAsync();
        Object.defineProperty(sheet(), 'offsetHeight', { configurable: true, get: () => 900 });
        const notify = observers.at(-1) as () => void;
        notify();
        notify();
        time.advance(16);

        expect((host.querySelector('.preview-layer') as HTMLElement).style.height).toBe('900px');
    });
});
