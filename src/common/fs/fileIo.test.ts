import { describe, expect, it } from 'vitest';
import {
    copyEntryAsync,
    entryKindAsync,
    getDirectoryAsync,
    listChildEntriesAsync,
    listChildNamesAsync,
    moveEntryAsync,
    readFileAsync,
    renameEntryAsync,
    writeBytesAsync,
    writeHandleAsync,
} from './fileIo.js';
import { FakeDirectoryHandle, asRoot, bytesOf } from './testing/fakeFileSystem.js';

// Bytes that are not valid UTF-8, as found inside xlsx, docx and image files.
const BINARY = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0xc3]);

describe('fileIo', () => {
    describe('readFileAsync', () => {
        it('reads a file in the encoding it is in, such as Greek in Windows-1253, and says which', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('old.txt', Uint8Array.of(0xca, 0xe1, 0xeb, 0xe7, 0xec, 0xdd, 0xf1, 0xe1));
            root.addFile('new.txt', 'Καλημέρα');

            await expect(readFileAsync(asRoot(root), 'old.txt')).resolves.toMatchObject({ text: 'Καλημέρα', encoding: 'windows-1253' });
            await expect(readFileAsync(asRoot(root), 'new.txt')).resolves.toMatchObject({ text: 'Καλημέρα', encoding: 'utf-8' });
        });
    });

    describe('writeBytesAsync', () => {
        it('writes a dropped file byte for byte', async () => {
            const root = new FakeDirectoryHandle('root');
            await writeBytesAsync(asRoot(root), 'images/logo.png', new Blob([BINARY]));

            expect(bytesOf(root, 'images/logo.png')).toEqual([...BINARY]);
        });
    });

    describe('copyEntryAsync', () => {
        it('copies a binary file without corrupting it', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('report.xlsx', BINARY);
            await root.getDirectoryHandle('archive', { create: true });

            await copyEntryAsync(asRoot(root), 'report.xlsx', 'archive/report.xlsx');

            expect(bytesOf(root, 'archive/report.xlsx')).toEqual([...BINARY]);
            expect(bytesOf(root, 'report.xlsx')).toEqual([...BINARY]);
        });

        it('refuses to copy a folder into itself', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/a.md', BINARY);

            await expect(copyEntryAsync(asRoot(root), 'docs', 'docs/inner')).rejects.toThrow();
        });
    });

    describe('moveEntryAsync', () => {
        it('moves a folder tree into another folder', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/guide/photo.jpg', BINARY);
            root.addFile('docs/readme.md', new TextEncoder().encode('# Docs'));
            await root.getDirectoryHandle('archive', { create: true });

            await moveEntryAsync(asRoot(root), 'docs', 'archive/docs');

            expect(root.find('docs')).toBeNull();
            expect(bytesOf(root, 'archive/docs/guide/photo.jpg')).toEqual([...BINARY]);
            expect(new TextDecoder().decode(new Uint8Array(bytesOf(root, 'archive/docs/readme.md')))).toBe('# Docs');
        });
    });

    describe('renameEntryAsync', () => {
        it('renames a binary file without native move', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('data/old.docx', BINARY);

            const newPath = await renameEntryAsync(asRoot(root), 'data/old.docx', 'new.docx');

            expect(newPath).toBe('data/new.docx');
            expect(root.find('data/old.docx')).toBeNull();
            expect(bytesOf(root, 'data/new.docx')).toEqual([...BINARY]);
        });

        it('renames a folder recursively', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/guide/photo.jpg', BINARY);
            root.addFile('docs/readme.md', BINARY);

            const newPath = await renameEntryAsync(asRoot(root), 'docs', 'notes');

            expect(newPath).toBe('notes');
            expect(root.find('docs')).toBeNull();
            expect(bytesOf(root, 'notes/guide/photo.jpg')).toEqual([...BINARY]);
            expect(bytesOf(root, 'notes/readme.md')).toEqual([...BINARY]);
        });

        it('uses the native move when the browser has it', async () => {
            const root = new FakeDirectoryHandle('root');
            const file = root.addFile('a.txt', BINARY);
            file.enableNativeMove();

            await renameEntryAsync(asRoot(root), 'a.txt', 'b.txt');

            expect(root.find('b.txt')).toBe(file);
            expect(root.find('a.txt')).toBeNull();
        });

        it('refuses to overwrite an existing entry', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('a.txt', BINARY);
            root.addFile('b.txt', new Uint8Array([1]));

            await expect(renameEntryAsync(asRoot(root), 'a.txt', 'b.txt')).rejects.toThrow();
            expect(bytesOf(root, 'b.txt')).toEqual([1]);
        });

        it('handles a case-only rename through a temporary name', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('readme.md', BINARY);

            await renameEntryAsync(asRoot(root), 'readme.md', 'README.md');

            expect([...root.children.keys()]).toEqual(['README.md']);
            expect(bytesOf(root, 'README.md')).toEqual([...BINARY]);
        });
    });

    describe('listChildNamesAsync', () => {
        it('lists the names directly inside a folder, files and folders alike', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/a.txt', 'a');
            root.addFile('docs/nested/b.txt', 'b');

            expect([...await listChildNamesAsync(asRoot(root), 'docs')].sort()).toEqual(['a.txt', 'nested']);
            expect([...await listChildNamesAsync(asRoot(root), '')]).toEqual(['docs']);
        });

        it('leaves out Chrome\'s temporary .crswap files, so they never take a name', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/a.txt', 'a');
            root.addFile('docs/a.txt.crswap', '');

            expect([...await listChildNamesAsync(asRoot(root), 'docs')]).toEqual(['a.txt']);
            expect([...await listChildEntriesAsync(asRoot(root), 'docs')]).toEqual([['a.txt', 'file']]);
        });

        it('rejects a folder that does not exist', async () => {
            await expect(listChildNamesAsync(asRoot(new FakeDirectoryHandle('root')), 'missing')).rejects.toThrow();
        });
    });

    describe('listChildEntriesAsync', () => {
        it('lists each entry directly inside a folder with its kind', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/a.txt', 'a');
            root.addFile('docs/nested/b.txt', 'b');

            const entries = await listChildEntriesAsync(asRoot(root), 'docs');

            expect([...entries].sort()).toEqual([['a.txt', 'file'], ['nested', 'directory']]);
        });
    });

    describe('getDirectoryAsync', () => {
        it('walks a folder path down from the root to the folder\'s own handle', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('reports/2026/summary.txt', 'summary');

            const folder = await getDirectoryAsync(asRoot(root), 'reports/2026');

            expect(folder).toBe(root.find('reports/2026'));
            expect(folder.name).toBe('2026');
            expect(await getDirectoryAsync(asRoot(root), '')).toBe(asRoot(root));
        });

        it('rejects a missing folder, and a file, without creating anything', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/a.txt', 'a');

            await expect(getDirectoryAsync(asRoot(root), 'docs/missing')).rejects.toThrow();
            await expect(getDirectoryAsync(asRoot(root), 'docs/a.txt')).rejects.toThrow();
            expect([...await listChildNamesAsync(asRoot(root), 'docs')]).toEqual(['a.txt']);
        });
    });

    describe('entryKindAsync', () => {
        it('tells a file from a folder and reports a missing entry', async () => {
            const root = new FakeDirectoryHandle('root');
            root.addFile('docs/a.txt', 'a');

            expect(await entryKindAsync(asRoot(root), 'docs/a.txt')).toBe('file');
            expect(await entryKindAsync(asRoot(root), 'docs')).toBe('directory');
            expect(await entryKindAsync(asRoot(root), 'docs/missing.txt')).toBeNull();
            expect(await entryKindAsync(asRoot(root), 'missing/a.txt')).toBeNull();
        });
    });

    describe('writeHandleAsync', () => {
        it('writes straight to a file handle', async () => {
            const root = new FakeDirectoryHandle('root');
            const file = root.addFile('notes.txt', 'old');

            await writeHandleAsync(file as unknown as FileSystemFileHandle, 'new');

            expect(file.text).toBe('new');
        });
    });
});
