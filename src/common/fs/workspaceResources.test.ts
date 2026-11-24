import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, type FakeFileHandle } from './testing/fakeFileSystem.js';
import { createWorkspaceResources, type WorkspaceResources } from './workspaceResources.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>';

let folder: FakeDirectoryHandle;
let resources: WorkspaceResources;
let created: Array<{ url: string; blob: Blob }>;
let revoked: string[];

beforeEach(() => {
    folder = new FakeDirectoryHandle('workspace');
    folder.addFile('media/photo.png', PNG);
    folder.addFile('media/Drawing.svg', SVG);
    folder.addFile('media/misnamed.txt', PNG);
    folder.addFile('docs/page.css', 'p { color: red; }');
    resources = createWorkspaceResources(asRoot(folder));
    created = [];
    revoked = [];
    let counter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        counter += 1;
        const url = `blob:test/${counter}`;
        created.push({ url, blob: blob as Blob });

        return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('createWorkspaceResources', () => {
    it('reads an image into a blob URL typed from its bytes', async () => {
        expect(await resources.imageUrlAsync('media/photo.png')).toBe('blob:test/1');
        expect(await resources.imageUrlAsync('media/misnamed.txt')).toBe('blob:test/2');
        expect(await resources.imageUrlAsync('media/drawing.svg')).toBe('blob:test/3');

        expect(created.map((entry) => entry.blob.type)).toEqual(['image/png', 'image/png', 'image/svg+xml']);
        expect([...new Uint8Array(await created[0]!.blob.arrayBuffer())]).toEqual([...PNG]);
    });

    it('reads each image once and tells what it read without waiting', async () => {
        expect(resources.peekImageUrl('media/photo.png')).toBeUndefined();

        const [first, second] = await Promise.all([resources.imageUrlAsync('media/photo.png'), resources.imageUrlAsync('media/photo.png')]);

        expect(first).toBe(second);
        expect(created).toHaveLength(1);
        expect(resources.peekImageUrl('media/photo.png')).toBe('blob:test/1');
    });

    it('gives null for a missing file or a folder, and remembers it', async () => {
        expect(await resources.imageUrlAsync('media/missing.png')).toBeNull();
        expect(await resources.imageUrlAsync('media')).toBeNull();
        expect(resources.peekImageUrl('media/missing.png')).toBeNull();
        expect(created).toHaveLength(0);
    });

    it('revokes the URLs of images a render no longer shows, and keeps the rest', async () => {
        await resources.imageUrlAsync('media/photo.png');
        await resources.imageUrlAsync('media/Drawing.svg');

        resources.keepOnly(['media/photo.png']);

        expect(revoked).toEqual(['blob:test/2']);
        expect(resources.peekImageUrl('media/photo.png')).toBe('blob:test/1');
        expect(resources.peekImageUrl('media/Drawing.svg')).toBeUndefined();
    });

    it('revokes every URL on dispose and reads nothing after it', async () => {
        await resources.imageUrlAsync('media/photo.png');
        await resources.imageUrlAsync('media/Drawing.svg');

        resources.dispose();

        expect(revoked.sort()).toEqual(['blob:test/1', 'blob:test/2']);
        expect(await resources.imageUrlAsync('media/photo.png')).toBeNull();
        expect(created).toHaveLength(2);
    });

    it('forgets changed files, says whether the page used them, and reads them again', async () => {
        await resources.imageUrlAsync('media/photo.png');
        await resources.imageUrlAsync('media/new.png');

        expect(resources.forget(['docs/other.md'])).toBe(false);
        expect(resources.forget(['media/photo.png'])).toBe(true);
        expect(resources.peekImageUrl('media/photo.png')).toBeUndefined();

        (folder.find('media/photo.png') as FakeFileHandle).data = new Uint8Array([...PNG, 1]);
        expect(await resources.imageUrlAsync('media/photo.png')).toBe('blob:test/2');

        resources.keepOnly(['media/photo.png']);
        expect(revoked).toEqual(['blob:test/1']);
    });

    it('refreshes for a file that was missing and appears, and for a changed folder', async () => {
        expect(await resources.imageUrlAsync('media/new.png')).toBeNull();

        folder.addFile('media/new.png', PNG);

        expect(resources.forget(['MEDIA/new.png'])).toBe(true);
        expect(await resources.imageUrlAsync('media/new.png')).toBe('blob:test/1');
        expect(resources.forget(['media'])).toBe(true);
    });

    it('reads a file\'s unsaved tab text instead of the file, found by its path on disk', async () => {
        const unsavedText = vi.fn((path: string) => path === 'docs/page.css' ? 'p { color: blue; }' : null);
        const withTabs = createWorkspaceResources(asRoot(folder), { unsavedText });
        folder.addFile('docs/other.css', 'b { color: green; }');

        expect(await withTabs.textAsync('DOCS/Page.css')).toEqual({ path: 'docs/page.css', text: 'p { color: blue; }' });
        expect(await withTabs.textAsync('docs/other.css')).toEqual({ path: 'docs/other.css', text: 'b { color: green; }' });
        expect(unsavedText).toHaveBeenCalledWith('docs/page.css');
    });

    it('turns TIFF pictures into PNG for image URLs and data URLs, and leaves other files as they are', async () => {
        const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
        const PNG_OUT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
        folder.addFile('media/scan.tif', TIFF);
        const convertImageAsync = vi.fn(async (_decoder: string, _file: Blob) => new Blob([PNG_OUT], { type: 'image/png' }));
        const converting = createWorkspaceResources(asRoot(folder), { convertImageAsync });

        expect(await converting.imageUrlAsync('media/scan.tif')).toBe('blob:test/1');
        expect(created[0]?.blob.type).toBe('image/png');
        expect(new Uint8Array(await created[0]!.blob.arrayBuffer())).toEqual(PNG_OUT);
        expect(await converting.dataUrlAsync('media/scan.tif')).toBe('data:image/png;base64,iVBORw0KGgoBAgM=');
        expect(convertImageAsync.mock.calls[0]?.[0]).toBe('tiff');
        expect(await converting.imageUrlAsync('media/photo.png')).toBe('blob:test/2');
        expect(convertImageAsync).toHaveBeenCalledTimes(2);
    });

    it('keeps why a picture couldn\'t be turned into a PNG, until the file changes', async () => {
        folder.addFile('media/photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]));
        const convertImageAsync = vi.fn(async (_decoder: string, _file: Blob): Promise<Blob> => {
            throw new Error('Nib Studio doesn\'t decode HEIC pictures.');
        });
        const converting = createWorkspaceResources(asRoot(folder), { convertImageAsync });

        expect(await converting.imageUrlAsync('media/photo.heic')).toBeNull();
        expect(convertImageAsync.mock.calls[0]?.[0]).toBe('heic');
        expect(converting.peekImageUrl('media/photo.heic')).toBeNull();
        expect(converting.imageProblem('media/photo.heic')).toBe('Nib Studio doesn\'t decode HEIC pictures.');
        expect(converting.imageProblem('media/photo.png')).toBeNull();
        expect(created).toEqual([]);

        converting.forget(['media/photo.heic']);

        expect(converting.imageProblem('media/photo.heic')).toBeNull();
    });

    it('reads data URLs and text', async () => {
        expect(await resources.dataUrlAsync('media/photo.png')).toBe('data:image/png;base64,iVBORw0KGgoAAAAN');
        expect(await resources.dataUrlAsync('docs/page.css')).toBe('data:application/octet-stream;base64,cCB7IGNvbG9yOiByZWQ7IH0=');
        expect(await resources.textAsync('DOCS/Page.css')).toEqual({ path: 'docs/page.css', text: 'p { color: red; }' });
        expect(await resources.textAsync('docs/missing.css')).toBeNull();
        expect(await resources.dataUrlAsync('docs/missing.css')).toBeNull();
    });
});
