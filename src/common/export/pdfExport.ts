import { buildStandaloneHtml } from './htmlExport.js';

export interface PdfExportOptions {
    readonly title: string;
    readonly bodyHtml: string;
}

// How long printing waits for the document's images before it prints without the ones still loading.
const IMAGE_WAIT_MS = 10_000;

export async function printToPdfAsync(options: PdfExportOptions): Promise<void> {
    const html = buildStandaloneHtml({
        title: options.title,
        bodyHtml: options.bodyHtml,
    });

    const frame = document.createElement('iframe');
    frame.className = 'print-frame';
    frame.setAttribute('aria-hidden', 'true');
    document.body.append(frame);

    try {
        await new Promise<void>((resolve, reject) => {
            frame.addEventListener('load', () => {
                resolve();
            }, { once: true });
            frame.addEventListener('error', () => {
                reject(new Error('Failed to prepare the print document.'));
            }, { once: true });
            frame.srcdoc = html;
        });

        const printable = frame.contentWindow;

        if (printable == null) {
            throw new Error('The print document has no window.');
        }

        await waitForImagesAsync(frame.contentDocument, IMAGE_WAIT_MS);
        printable.focus();
        printable.print();
    }
    finally {
        setTimeout(() => frame.remove(), 1000);
    }
}

// Waits until every image of the page has loaded and decoded, or failed to, or the time is up.
export async function waitForImagesAsync(page: Document | null, timeoutMs: number): Promise<void> {
    if (page == null) {
        return;
    }

    const decoded = Promise.all([...page.querySelectorAll('img')].map(async (image) => {
        try {
            await image.decode();
        }
        catch {
            // An image that can't load prints as the browser shows it.
        }
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
    });

    await Promise.race([decoded, timeUp]);
    clearTimeout(timer);
}
