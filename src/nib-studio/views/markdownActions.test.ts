import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { externalTabPath, type OpenFile } from '../app/store.js';
import { openFileFixture } from '../testing/testHelpers.js';

const { downloadHtml, printToPdfAsync } = vi.hoisted(() => ({
    downloadHtml: vi.fn(),
    printToPdfAsync: vi.fn(async (_options: { title: string; bodyHtml: string }) => {}),
}));

vi.mock('../../common/export/htmlExport.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../common/export/htmlExport.js')>(),
    downloadHtml,
}));

vi.mock('../../common/export/pdfExport.js', () => ({ printToPdfAsync }));

const { EXPORT_IMAGE_LIMIT_BYTES, exportMarkdownToHtmlAsync, exportMarkdownToPdfAsync } = await import('./markdownActions.js');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function openFile(text: string, path = 'notes/readme.md'): OpenFile {
    return openFileFixture(path, text, { view: 'preview' });
}

function workspace(): FileSystemDirectoryHandle {
    const folder = new FakeDirectoryHandle('workspace');
    folder.addFile('media/chart.png', PNG);
    folder.addFile('notes/images/dot.png', PNG);

    return asRoot(folder);
}

function downloadedHtml(): string {
    return downloadHtml.mock.calls[0]?.[1] as string;
}

describe('markdownActions', () => {
    beforeEach(() => {
        downloadHtml.mockClear();
        printToPdfAsync.mockClear();
    });

    afterEach(() => {
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    describe('exportMarkdownToHtmlAsync', () => {
        it('downloads a standalone page named after the file and confirms with a toast', async () => {
            await exportMarkdownToHtmlAsync(openFile('# Hello\n\nSome **bold** text.'), null);

            expect(downloadHtml).toHaveBeenCalledTimes(1);
            const [fileName, html] = downloadHtml.mock.calls[0] as [string, string];
            expect(fileName).toBe('readme.md.html');
            expect(html).toContain('<title>readme.md</title>');
            expect(html).toContain('<h1');
            expect(html).toContain('<strong>bold</strong>');
            expect(document.querySelector('.toast')?.textContent).toBe('HTML downloaded.');
        });

        it('keeps remote image URLs as written', async () => {
            await exportMarkdownToHtmlAsync(openFile('![logo](https://example.com/logo.png)'), workspace());

            expect(downloadedHtml()).toContain('<img src="https://example.com/logo.png" alt="logo">');
        });

        it('embeds workspace images as data: URLs, so the page works offline', async () => {
            await exportMarkdownToHtmlAsync(openFile('![Chart](../media/chart.png)\n\n<img src="images/dot.png" width="8">\n\n![Root](/media/chart.png)'), workspace());

            const html = downloadedHtml();
            expect(html).toContain(`<img alt="Chart" src="${PNG_DATA_URL}">`);
            expect(html).toContain(`<img width="8" src="${PNG_DATA_URL}">`);
            expect(html).toContain(`<img alt="Root" src="${PNG_DATA_URL}">`);
            expect(html).not.toContain('data-local-src');
        });

        it('turns a missing image into its placeholder', async () => {
            await exportMarkdownToHtmlAsync(openFile('![Gone](images/gone.png)'), workspace());

            const html = downloadedHtml();
            expect(html).toContain('<span class="md-image-blocked" title="Gone">Image not found: images/gone.png</span>');
            expect(html).not.toContain('<img');
            expect(html).not.toContain('data-image-placeholder');
        });

        it('embeds at most 25 MB of images, and puts a placeholder for one past it', async () => {
            const folder = new FakeDirectoryHandle('workspace');
            const large = new Uint8Array(EXPORT_IMAGE_LIMIT_BYTES + 1);
            large.set(PNG);
            folder.addFile('media/huge.png', large);
            folder.addFile('media/chart.png', PNG);

            await exportMarkdownToHtmlAsync(openFile('![Huge](../media/huge.png) ![Chart](../media/chart.png)'), asRoot(folder));
            const html = downloadedHtml();

            expect(EXPORT_IMAGE_LIMIT_BYTES).toBe(25 * 1024 * 1024);
            expect(html).toContain('Image too large to embed: the page holds at most 25 MB of images (../media/huge.png)');
            expect(html).toContain(`<img alt="Chart" src="${PNG_DATA_URL}">`);
            expect(html.length).toBeLessThan(1024 * 1024);
        });

        it('says Nib Studio doesn\'t decode a HEIC picture', async () => {
            const folder = new FakeDirectoryHandle('workspace');
            folder.addFile('media/photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]));

            await exportMarkdownToHtmlAsync(openFile('![Photo](../media/photo.heic)'), asRoot(folder));

            expect(downloadedHtml()).toContain('<span class="md-image-blocked" title="Photo">Nib Studio doesn\'t decode HEIC pictures.</span>');
        });

        it('shows placeholders for the relative images of a file from outside the workspace', async () => {
            await exportMarkdownToHtmlAsync(openFile('![Chart](chart.png)', externalTabPath(1, 'readme.md')), workspace());

            expect(downloadedHtml()).toContain('Image not shown (file outside the workspace): chart.png');
        });
    });

    describe('exportMarkdownToPdfAsync', () => {
        it('prints the rendered body under the file name', async () => {
            await exportMarkdownToPdfAsync(openFile('# Title'), null);

            expect(printToPdfAsync).toHaveBeenCalledTimes(1);
            const options = printToPdfAsync.mock.calls[0]?.[0] as { title: string; bodyHtml: string };
            expect(options.title).toBe('readme.md');
            expect(options.bodyHtml).toContain('Title');
        });

        it('replaces remote images with an offline label and embeds workspace images', async () => {
            await exportMarkdownToPdfAsync(openFile('![logo](https://example.com/logo.png) ![Chart](../media/chart.png)'), workspace());

            const options = printToPdfAsync.mock.calls[0]?.[0] as { bodyHtml: string };
            expect(options.bodyHtml).toContain('Remote image not loaded (offline): https://example.com/logo.png');
            expect(options.bodyHtml).toContain(`<img alt="Chart" src="${PNG_DATA_URL}">`);
        });
    });
});
