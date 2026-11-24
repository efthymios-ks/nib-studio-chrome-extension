import { afterEach, describe, expect, it, vi } from 'vitest';
import { asRoot, FakeDirectoryHandle, FakeFileHandle } from '../fs/testing/fakeFileSystem.js';
import { buildStandardEncryptedAsync, buildTinyXlsx } from '../office/testing/encryptionFixtures.js';
import { MAX_FILE_BYTES } from './lookupExtractors.js';
import { createLookupIndex, type LookupHost, type LookupIndex, type LookupProgress, type PdfReadOutcome } from './lookupIndex.js';

const indexes: LookupIndex[] = [];

afterEach(() => {
    for (const index of indexes.splice(0)) {
        index.dispose();
    }
});

interface Harness {
    readonly index: LookupIndex;
    readonly progress: LookupProgress[];
    readonly host: { -readonly [Key in keyof LookupHost]: LookupHost[Key] };
}

function start(folder: FakeDirectoryHandle, host: Partial<LookupHost> = {}): Harness {
    const progress: LookupProgress[] = [];
    const fullHost = {
        readPdfTextAsync: host.readPdfTextAsync ?? (async (): Promise<PdfReadOutcome> => ({ kind: 'name-only' })),
        readUnlockedBytesAsync: host.readUnlockedBytesAsync ?? (async (): Promise<Uint8Array | null> => null),
        onChange: (current: LookupProgress) => progress.push(current),
    };
    const index = createLookupIndex({ root: asRoot(folder), codePage: 1253, host: fullHost });
    indexes.push(index);

    return { index, progress, host: fullHost };
}

async function readAllAsync(index: LookupIndex): Promise<void> {
    await vi.waitFor(() => expect(index.progress().isDone).toBe(true));
}

function found(index: LookupIndex, query: string): string[] {
    return index.search(query).results.map((result) => result.path);
}

function touch(handle: FakeFileHandle | FakeDirectoryHandle | null, text: string): void {
    const file = handle as FakeFileHandle;
    file.data = new TextEncoder().encode(text);
    file.lastModified += 1;
}

describe('createLookupIndex listing', () => {
    it('lists every file, hidden ones too, leaving out .git, node_modules, bin, obj and the studio\'s configuration file', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('notes.txt', 'alpha');
        folder.addFile('.hidden.txt', 'beta');
        folder.addFile('docs/deep/plan.md', 'gamma');
        folder.addFile('.nib-studio-configuration.json', '{}');

        for (const skipped of ['.git', 'node_modules', 'bin', 'obj', 'docs/bin']) {
            folder.addFile(`${skipped}/skipped.txt`, 'delta');
        }

        const { index } = start(folder);
        await readAllAsync(index);

        expect(found(index, '').sort()).toEqual(['.hidden.txt', 'docs/deep/plan.md', 'notes.txt']);
        expect(index.search('plan').results[0]?.folder).toBe('docs/deep');
        expect(found(index, 'delta')).toEqual([]);
    });

    it('leaves out Chrome\'s temporary .crswap files, as listed and as the watcher reports them', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('notes.txt', 'alpha');
        folder.addFile('notes.txt.crswap', 'alpha in progress');
        const { index } = start(folder);
        await readAllAsync(index);

        folder.addFile('docs/plan.md.crswap', 'beta in progress');
        folder.addFile('docs/plan.md', 'beta');
        index.applyChanges([
            { kind: 'created', path: 'docs/plan.md.crswap' },
            { kind: 'created', path: 'docs/plan.md' },
        ]);

        await vi.waitFor(() => expect(found(index, '').sort()).toEqual(['docs/plan.md', 'notes.txt']));
        await readAllAsync(index);
        expect(found(index, 'progress')).toEqual([]);
    });

    it('reads every file\'s contents in the background and says how far it has got', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('a.txt', 'the quarterly report');
        folder.addFile('b.md', 'nothing');
        folder.addFile('README', 'pineapple without an extension');
        folder.addFile('blob', Uint8Array.of(0, 1, 2, 0, 3, 4));
        folder.addFile('photo.png', 'quarterly');
        const { index, progress } = start(folder);
        await readAllAsync(index);

        expect(found(index, 'quarterly')).toEqual(['a.txt']);
        expect(found(index, 'pineapple')).toEqual(['README']);
        expect(index.progress()).toEqual({ read: 5, total: 5, isListing: false, isDone: true });
        expect(progress.at(-1)?.isDone).toBe(true);
    });

    it('reads Windows-1253 text in the code page given', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('old.txt', Uint8Array.of(0xc7, 0x20, 0xcc, 0xe1, 0xf1, 0xdf, 0xe1));
        const { index } = start(folder);
        await readAllAsync(index);

        expect(found(index, 'μαρια')).toEqual(['old.txt']);
    });

    it('keeps only the name of a file over 20 MB', async () => {
        const folder = new FakeDirectoryHandle('space');
        const bytes = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x20);
        bytes.set(new TextEncoder().encode('needle'), 0);
        folder.addFile('huge.txt', bytes);
        const { index } = start(folder);
        await readAllAsync(index);

        expect(found(index, 'needle')).toEqual([]);
        expect(found(index, 'huge')).toEqual(['huge.txt']);
    });

    it('asks the page for a PDF\'s text, and gives a line number only to text files', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('invoice.pdf', '%PDF-1.4');
        folder.addFile('notes.txt', 'first\nTotal 1,250');
        const readPdfTextAsync = vi.fn(async (): Promise<PdfReadOutcome> => ({ kind: 'text', text: 'Customer: Anna Smith Total: 1,250.00', isUnlocked: false }));
        const { index } = start(folder, { readPdfTextAsync });
        await readAllAsync(index);
        const results = index.search('total 1250').results;

        expect(readPdfTextAsync).toHaveBeenCalledWith('invoice.pdf', expect.any(File));
        expect(results.map((result) => result.path)).toEqual(['notes.txt', 'invoice.pdf']);
        expect(results.map((result) => result.preview?.line ?? null)).toEqual([2, null]);
    });
});

describe('createLookupIndex changes', () => {
    it('reads a changed file again, adds a new one and drops a deleted one, as the watcher reports them', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('a.txt', 'old words');
        folder.addFile('gone.txt', 'soon gone');
        const { index } = start(folder);
        await readAllAsync(index);

        touch(folder.find('a.txt'), 'new words');
        folder.addFile('fresh.txt', 'fresh words');
        await folder.removeEntry('gone.txt');
        index.applyChanges([
            { kind: 'modified', path: 'a.txt' },
            { kind: 'created', path: 'fresh.txt' },
            { kind: 'deleted', path: 'gone.txt' },
        ]);

        await vi.waitFor(() => expect(found(index, 'words').sort()).toEqual(['a.txt', 'fresh.txt']));
        await readAllAsync(index);
        expect(found(index, 'old')).toEqual([]);
        expect(found(index, 'gone')).toEqual([]);
    });

    it('lists a new folder and drops a deleted one with everything in it', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('old/one.txt', 'one');
        folder.addFile('old/inner/two.txt', 'two');
        const { index } = start(folder);
        await readAllAsync(index);

        folder.addFile('new/three.txt', 'three');
        await folder.removeEntry('old');
        index.applyChanges([{ kind: 'created', path: 'new' }, { kind: 'deleted', path: 'old' }]);

        await vi.waitFor(() => expect(found(index, '')).toEqual(['new/three.txt']));
    });

    it('lists the workspace again after a move, which tells only where the item went', async () => {
        const folder = new FakeDirectoryHandle('space');
        const moved = folder.addFile('draft.txt', 'moving text');
        const { index } = start(folder);
        await readAllAsync(index);

        moved.enableNativeMove();
        await moved.move?.('final.txt');
        index.applyChanges([{ kind: 'moved', path: 'final.txt' }]);

        await vi.waitFor(() => expect(found(index, 'moving')).toEqual(['final.txt']));
    });

    it('reads again on refresh only the files whose size or last change differ', async () => {
        const folder = new FakeDirectoryHandle('space');
        const same = folder.addFile('same.txt', 'alpha');
        folder.addFile('other.txt', 'delta');
        const { index } = start(folder);
        await readAllAsync(index);

        same.data = new TextEncoder().encode('gamma');
        touch(folder.find('other.txt'), 'omega');
        index.refresh();

        await vi.waitFor(() => expect(found(index, 'omega')).toEqual(['other.txt']));
        expect(found(index, 'alpha')).toEqual(['same.txt']);
        expect(found(index, 'gamma')).toEqual([]);
    });

    it('searches the unsaved text of an open file instead of what is on disk', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('draft.txt', 'saved words');
        const { index } = start(folder);
        await readAllAsync(index);

        index.setOpenTexts(new Map([['draft.txt', 'line one\nunsaved words']]));

        expect(found(index, 'saved words')).toEqual(['draft.txt']);
        expect(index.search('unsaved').results[0]?.preview?.line).toBe(2);
        expect(found(index, 'unsaved')).toEqual(['draft.txt']);

        index.setOpenTexts(new Map());

        expect(found(index, 'unsaved')).toEqual([]);
    });
});

describe('createLookupIndex protected files', () => {
    it('keeps only the name of a protected file until a tab unlocks it, and again once none holds it unlocked', async () => {
        const plain = buildTinyXlsx([['Confidential', 1250]]);
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('salaries.xlsx', await buildStandardEncryptedAsync({ password: '1234', plain }));
        let unlocked: Uint8Array | null = null;
        const readUnlockedBytesAsync = vi.fn(async () => unlocked);
        const { index } = start(folder, { readUnlockedBytesAsync });
        await readAllAsync(index);

        expect(found(index, 'confidential')).toEqual([]);
        expect(found(index, 'salaries')).toEqual(['salaries.xlsx']);

        unlocked = plain;
        index.setUnlocked(new Set(['salaries.xlsx']));

        await vi.waitFor(() => expect(found(index, 'confidential')).toEqual(['salaries.xlsx']));
        expect(readUnlockedBytesAsync).toHaveBeenLastCalledWith('salaries.xlsx', expect.any(File));

        index.setUnlocked(new Set());

        expect(found(index, 'confidential')).toEqual([]);
        expect(index.progress().isDone).toBe(true);
    });

    it('keeps only the name of a PDF that asks for a password', async () => {
        const folder = new FakeDirectoryHandle('space');
        folder.addFile('locked.pdf', '%PDF-1.7');
        const { index } = start(folder, { readPdfTextAsync: async () => ({ kind: 'locked' }) });
        await readAllAsync(index);

        expect(found(index, 'locked')).toEqual(['locked.pdf']);
        expect(index.search('locked').results[0]?.target).toBe('name');
    });
});
