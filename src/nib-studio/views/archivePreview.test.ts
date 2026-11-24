import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountArchivePreview } from './archivePreview.js';
import type { PreviewHandle } from './previewHandle.js';

let host: HTMLElement;
let handles: PreviewHandle[];

function archiveFile(name = 'photos.zip', content = 'PK\u0003\u0004binary', lastModified = Date.UTC(2026, 0, 1)): File {
    return new File([content], name, { lastModified });
}

function mount(file: File = archiveFile()): PreviewHandle {
    const handle = mountArchivePreview(host, { file, fileName: file.name, memoryKey: `backups/${file.name}` });
    handles.push(handle);

    return handle;
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    handles = [];
    localStorage.clear();
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
    vi.restoreAllMocks();
});

describe('mountArchivePreview', () => {
    it('says archives have no preview and where to open one, under an Archive badge with only Info', () => {
        mount();
        const frame = host.querySelector<HTMLElement>('.preview-frame');

        expect(frame?.dataset['state']).toBe('message');
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This archive has no preview');
        expect(host.querySelector('.preview-status p')?.textContent)
            .toBe('Its contents aren\'t listed here. Open it with an archive tool, such as File Explorer or 7-Zip.');
        expect([...host.querySelectorAll('.preview-toolbar .badge')].map((badge) => badge.textContent)).toEqual(['Archive', 'View only']);
        expect([...host.querySelectorAll('.preview-toolbar button')].map((button) => button.textContent)).toEqual(['Info']);
        expect(host.querySelector('.preview-zoom')).toBeNull();
        expect(host.querySelector('.preview-viewport')?.getAttribute('aria-label')).toBe('Archive preview of photos.zip');
    });

    it('lists the File group in Info, naming the archive\'s format', () => {
        mount(archiveFile('site.tar.gz', 'x'.repeat(2048)));

        expect(rows()).toMatchObject({
            'File/Name': 'site.tar.gz',
            'File/Type': 'Gzip-compressed tar archive',
            'File/Size': '2 KB (2,048 bytes)',
        });
        expect(rows()['File/Modified']).toMatch(/^2026-01-01/);
        expect([...host.querySelectorAll('.preview-info-title')].map((title) => title.textContent)).toEqual(['File']);
    });

    it('never reads the file, as text or as bytes', () => {
        const reads = [
            vi.spyOn(Blob.prototype, 'text'),
            vi.spyOn(Blob.prototype, 'arrayBuffer'),
            vi.spyOn(Blob.prototype, 'stream'),
            vi.spyOn(Blob.prototype, 'slice'),
        ];
        const handle = mount(archiveFile('backup.7z'));
        handle.update(archiveFile('backup.7z', 'changed'));

        expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0, 0, 0]);
    });

    it('lists a new snapshot of the file, and ignores the same one or none', () => {
        const file = archiveFile('backup.7z', 'abc');
        const handle = mount(file);
        handle.update(file);
        handle.update(null);

        expect(rows()['File/Size']).toBe('3 bytes');

        handle.update(archiveFile('backup.7z', 'abcdef'));

        expect(rows()['File/Size']).toBe('6 bytes');
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This archive has no preview');
    });

    it('takes itself out of the page once destroyed', () => {
        const handle = mount();
        handle.destroy();

        expect(host.querySelector('.preview-frame')).toBeNull();
    });
});
