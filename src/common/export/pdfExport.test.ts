// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printToPdfAsync, waitForImagesAsync } from './pdfExport.js';

interface FakeFrame extends HTMLElement {
    srcdoc: string;
}

// Swaps the print iframe for a plain element that fires load or error once srcdoc is set,
// since happy-dom does not load frame pages.
function fakeFrame(outcome: 'load' | 'error', contentWindow: unknown, contentDocument: Document | null = null): void {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName !== 'iframe') {
            return createElement(tagName);
        }

        const frame = createElement('div') as unknown as FakeFrame;
        let source = '';
        Object.defineProperty(frame, 'contentWindow', { get: () => contentWindow });
        Object.defineProperty(frame, 'contentDocument', { get: () => contentDocument });
        Object.defineProperty(frame, 'srcdoc', {
            get: () => source,
            set: (value: string) => {
                source = value;
                queueMicrotask(() => frame.dispatchEvent(new Event(outcome)));
            },
        });

        return frame;
    });
}

function findFrame(): FakeFrame | null {
    return document.body.querySelector('[aria-hidden="true"]');
}

describe('printToPdfAsync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('prints the standalone document from a hidden frame', async () => {
        const printable = { focus: vi.fn(), print: vi.fn() };
        fakeFrame('load', printable);

        await printToPdfAsync({ title: 'Report', bodyHtml: '<p>Body</p>' });

        const frame = findFrame() as FakeFrame;
        expect(frame.style.position).toBe('fixed');
        expect(frame.style.width).toBe('0px');
        expect(frame.srcdoc).toContain('<title>Report</title>');
        expect(frame.srcdoc).toContain('<p>Body</p>');
        expect(printable.focus).toHaveBeenCalledTimes(1);
        expect(printable.print).toHaveBeenCalledTimes(1);
    });

    it('removes the frame a second after printing', async () => {
        fakeFrame('load', { focus: vi.fn(), print: vi.fn() });

        await printToPdfAsync({ title: 'Report', bodyHtml: '' });
        vi.advanceTimersByTime(999);
        expect(findFrame()).not.toBeNull();

        vi.advanceTimersByTime(1);
        expect(findFrame()).toBeNull();
    });

    it('rejects when the frame fails to load and still cleans up', async () => {
        fakeFrame('error', null);

        await expect(printToPdfAsync({ title: 'Report', bodyHtml: '' })).rejects.toThrow('Failed to prepare the print document.');

        vi.advanceTimersByTime(1000);
        expect(findFrame()).toBeNull();
    });

    it('prints once the images of the document have loaded', async () => {
        const printable = { focus: vi.fn(), print: vi.fn() };
        const page = document.implementation.createHTMLDocument('print');
        page.body.innerHTML = '<img src="data:image/png;base64,AA"><img src="data:image/png;base64,BB">';
        let finishDecoding = (): void => {};
        const decoding = new Promise<void>((resolve) => {
            finishDecoding = resolve;
        });
        const images = [...page.querySelectorAll('img')];
        images[0]!.decode = () => decoding;
        images[1]!.decode = async () => {
            throw new Error('broken');
        };
        fakeFrame('load', printable, page);

        const printing = printToPdfAsync({ title: 'Report', bodyHtml: '' });
        await vi.advanceTimersByTimeAsync(0);
        expect(printable.print).not.toHaveBeenCalled();

        finishDecoding();
        await printing;

        expect(printable.print).toHaveBeenCalledTimes(1);
    });

    it('prints without the images still loading once the time is up', async () => {
        const page = document.implementation.createHTMLDocument('print');
        page.body.innerHTML = '<img src="data:image/png;base64,AA">';
        page.querySelector('img')!.decode = () => new Promise(() => {});

        const waiting = waitForImagesAsync(page, 5000);
        await vi.advanceTimersByTimeAsync(5000);

        await expect(waiting).resolves.toBeUndefined();
    });

    it('rejects when the frame has no window', async () => {
        fakeFrame('load', null);

        await expect(printToPdfAsync({ title: 'Report', bodyHtml: '' })).rejects.toThrow('The print document has no window.');
    });
});
