import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestPdf } from '../../common/pdf/testing/pdfBuilder.js';
import { createFakeAnimationClock, setClientSize } from '../testing/fakeAnimationClock.js';
import { createFakeEngine, createFakeObservers, createFakePdf, type FakeEngine } from '../testing/fakePdf.js';
import { settleAsync } from '../testing/testHelpers.js';
import { mountPdfPreview, type PdfPreviewOptions } from './pdfPreview.js';
import type { PreviewHandle } from './previewHandle.js';

const LETTER: readonly [number, number] = [612, 792];

let host: HTMLElement;
let handles: PreviewHandle[];

function pdfFile(): File {
    return new File([buildTestPdf().slice()], 'report.pdf', { type: 'application/pdf' });
}

async function mountAsync(fake: FakeEngine, overrides: Partial<PdfPreviewOptions> = {}): Promise<PreviewHandle> {
    const file = pdfFile();
    const handle = mountPdfPreview(host, {
        file,
        fileName: file.name,
        memoryKey: `documents/${file.name}`,
        loadEngineAsync: async () => fake.engine,
        createObserver: createFakeObservers().factory,
        devicePixelRatio: () => 1,
        clock: createFakeAnimationClock().clock,
        prefersReducedMotion: () => true,
        ...overrides,
    });
    setClientSize(host.querySelector('.preview-viewport') as HTMLElement, 800, 600);
    handles.push(handle);
    await settleAsync();

    return handle;
}

function savePagesButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('.preview-toolbar [data-action="save-pages"]');
}

beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    handles = [];
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
});

describe('mountPdfPreview Save pages', () => {
    it('puts Save pages… beside the page box once the PDF is open, and hands it the open document', async () => {
        const onSavePages = vi.fn();
        const pdf = createFakePdf({ pages: [LETTER, LETTER] });
        const fake = createFakeEngine(pdf);
        await mountAsync(fake, { onSavePages });
        const button = savePagesButton();

        expect(button?.textContent).toBe('Save pages…');
        expect(button?.hidden).toBe(false);
        expect(button?.previousElementSibling?.classList.contains('pdf-page-box')).toBe(true);

        button?.click();

        expect(onSavePages).toHaveBeenCalledWith({ document: pdf.document, engine: fake.engine });
    });

    it('hides Save pages… while the password is asked for, and shows it once the PDF opens', async () => {
        const onSavePages = vi.fn();
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] }), 'abc'), { onSavePages });

        expect(savePagesButton()?.hidden).toBe(true);

        (host.querySelector('.password-panel-input') as HTMLInputElement).value = 'abc';
        host.querySelector('.password-panel')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await settleAsync();

        expect(savePagesButton()?.hidden).toBe(false);
    });

    it('hides Save pages… for a PDF that can\'t be shown', async () => {
        const fake = createFakeEngine(createFakePdf({ pages: [LETTER] }));
        fake.openAsync.mockRejectedValue(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }));
        await mountAsync(fake, { onSavePages: vi.fn() });

        expect(savePagesButton()?.hidden).toBe(true);
    });

    it('has no Save pages… without somewhere to save', async () => {
        await mountAsync(createFakeEngine(createFakePdf({ pages: [LETTER] })));

        expect(savePagesButton()).toBeNull();
    });
});
