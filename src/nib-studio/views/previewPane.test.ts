import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountArchivePreview } from './archivePreview.js';
import { mountDocumentPreview } from './documentView.js';
import { mountFontPreview } from './fontPreview.js';
import { mountImagePreview } from './imagePreview.js';
import { mountMediaPreview } from './mediaPreview.js';
import { BINARY_PREVIEW_MESSAGE, mountMessagePreview } from './messagePreview.js';
import { mountPreview } from './previewPane.js';

vi.mock('./imagePreview.js', () => ({ mountImagePreview: vi.fn(() => ({ element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() })) }));
vi.mock('./mediaPreview.js', () => ({ mountMediaPreview: vi.fn(() => ({ element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() })) }));
vi.mock('./fontPreview.js', () => ({ mountFontPreview: vi.fn(() => ({ element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() })) }));
vi.mock('./documentView.js', () => ({ mountDocumentPreview: vi.fn(() => ({ element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() })) }));
vi.mock('./archivePreview.js', () => ({ mountArchivePreview: vi.fn(() => ({ element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() })) }));
vi.mock('./messagePreview.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('./messagePreview.js')>(),
    mountMessagePreview: vi.fn(() => ({ element: document.createElement('div'), update: vi.fn(), destroy: vi.fn() })),
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('mountPreview', () => {
    it('hands images to the image preview', () => {
        const pane = document.createElement('div');
        const file = new File(['x'], 'photo.heic');
        mountPreview(pane, { kind: 'image', file, fileName: 'photo.heic', memoryKey: 'media/photo.heic' });

        expect(mountImagePreview).toHaveBeenCalledWith(pane, { file, fileName: 'photo.heic', memoryKey: 'media/photo.heic' });
        expect(mountMediaPreview).not.toHaveBeenCalled();
    });

    it('hands audio and video to the media preview with their kind', () => {
        const pane = document.createElement('div');
        const file = new File(['x'], 'clip.mov');
        mountPreview(pane, { kind: 'video', file, fileName: 'clip.mov', memoryKey: 'clip.mov' });
        mountPreview(pane, { kind: 'audio', file, fileName: 'clip.mov', memoryKey: 'clip.mov' });

        expect(vi.mocked(mountMediaPreview).mock.calls.map((call) => call[1].kind)).toEqual(['video', 'audio']);
    });

    it('hands fonts to the font preview', () => {
        const pane = document.createElement('div');
        const file = new File(['x'], 'Inter.ttf');
        mountPreview(pane, { kind: 'font', file, fileName: 'Inter.ttf', memoryKey: 'fonts/Inter.ttf' });

        expect(mountFontPreview).toHaveBeenCalledWith(pane, { file, fileName: 'Inter.ttf', memoryKey: 'fonts/Inter.ttf' });
    });

    it('hands Word documents to the document preview', () => {
        const pane = document.createElement('div');
        const file = new File(['x'], 'old.doc');
        mountPreview(pane, { kind: 'document', file, fileName: 'old.doc', memoryKey: 'docs/old.doc' });

        expect(mountDocumentPreview).toHaveBeenCalledWith(pane, { file, fileName: 'old.doc', memoryKey: 'docs/old.doc' });
    });

    it('hands archives to the archive preview', () => {
        const pane = document.createElement('div');
        const file = new File(['PK'], 'site.tar.gz');
        mountPreview(pane, { kind: 'archive', file, fileName: 'site.tar.gz', memoryKey: 'backups/site.tar.gz' });

        expect(mountArchivePreview).toHaveBeenCalledWith(pane, { file, fileName: 'site.tar.gz', memoryKey: 'backups/site.tar.gz' });
        expect(mountMediaPreview).not.toHaveBeenCalled();
    });

    it('hands presentations and OpenDocument text and drawings to a message saying they have no preview', () => {
        const pane = document.createElement('div');
        const file = new File(['PK'], 'deck.pptx');
        mountPreview(pane, { kind: 'office', file, fileName: 'deck.pptx', memoryKey: 'talks/deck.pptx' });

        expect(mountMessagePreview).toHaveBeenCalledWith(pane, {
            file,
            fileName: 'deck.pptx',
            memoryKey: 'talks/deck.pptx',
            message: expect.objectContaining({ title: 'This presentation has no preview', typeLabel: 'PowerPoint presentation' }),
        });
        expect(mountArchivePreview).not.toHaveBeenCalled();
    });

    it('hands a file that isn\'t text to a message saying so', () => {
        const pane = document.createElement('div');
        const file = new File(['\u0000'], 'firmware.bin');
        mountPreview(pane, { kind: 'binary', file, fileName: 'firmware.bin', memoryKey: 'firmware.bin' });

        expect(mountMessagePreview).toHaveBeenCalledWith(pane, { file, fileName: 'firmware.bin', memoryKey: 'firmware.bin', message: BINARY_PREVIEW_MESSAGE });
        expect(mountMediaPreview).not.toHaveBeenCalled();
    });

    it('says so when there is no file to show', () => {
        const pane = document.createElement('div');
        const handle = mountPreview(pane, { kind: 'image', file: null, fileName: 'gone.png', memoryKey: 'gone.png' });

        expect(pane.textContent).toBe('Preview not availableThe file could not be read.');
        expect(() => handle.update(new File(['x'], 'gone.png'))).not.toThrow();
        expect(mountImagePreview).not.toHaveBeenCalled();
    });
});
