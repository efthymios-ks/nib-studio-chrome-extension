import { describe, expect, it } from 'vitest';
import { FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { fakeDataTransfer } from '../testing/fakeDataTransfer.js';
import { readDroppedItemsAsync, type DroppedItem } from './droppedItems.js';

function desktop(): FakeDirectoryHandle {
    const folder = new FakeDirectoryHandle('desktop');
    folder.addFile('notes.txt', 'notes');
    folder.addFile('photos/a.png', new Uint8Array([1, 2, 3]));
    folder.addFile('photos/b.png', new Uint8Array([4]));
    folder.addFile('photos/raw/c.raw', new Uint8Array([5, 6]));

    return folder;
}

// Every path in the dropped items, folders with a trailing slash.
async function listPathsAsync(items: ReadonlyArray<DroppedItem>, prefix = ''): Promise<string[]> {
    const paths: string[] = [];

    for (const item of items) {
        const path = `${prefix}${item.name}`;

        if (item.kind === 'file') {
            paths.push(path);
            continue;
        }

        paths.push(`${path}/`);
        paths.push(...await listPathsAsync(await item.listAsync(), `${path}/`));
    }

    return paths;
}

// Starts reading the way a drop handler does, then ends the transfer as the browser does after the event.
async function readAsync(...args: Parameters<typeof fakeDataTransfer>): Promise<DroppedItem[]> {
    const fake = fakeDataTransfer(...args);
    const pending = readDroppedItemsAsync(fake.transfer);
    fake.end();

    return await pending;
}

describe('readDroppedItemsAsync', () => {
    it('reads files and folders through their handles', async () => {
        const folder = desktop();
        const items = await readAsync([folder.find('notes.txt')!, folder.find('photos')!]);

        expect(items.map((item) => [item.kind, item.name, item.handle])).toEqual([
            ['file', 'notes.txt', folder.find('notes.txt')],
            ['directory', 'photos', folder.find('photos')],
        ]);
        expect(await listPathsAsync(items)).toEqual([
            'notes.txt',
            'photos/',
            'photos/a.png',
            'photos/b.png',
            'photos/raw/',
            'photos/raw/c.raw',
        ]);
    });

    it('leaves Chrome\'s temporary .crswap files out of a dropped folder, through handles and entries alike', async () => {
        const folder = desktop();
        folder.addFile('photos/a.png.crswap', new Uint8Array([9]));

        for (const handles of [true, false]) {
            const items = await readAsync([folder.find('photos')!], { handles });

            expect(await listPathsAsync(items)).toEqual(['photos/', 'photos/a.png', 'photos/b.png', 'photos/raw/', 'photos/raw/c.raw']);
        }
    });

    it('reads the bytes of a dropped file', async () => {
        const folder = desktop();
        const [item] = await readAsync([folder.find('photos/a.png')!]);

        expect(item?.kind).toBe('file');
        const file = item?.kind === 'file' ? await item.readAsync() : null;
        expect([...new Uint8Array(await file!.arrayBuffer())]).toEqual([1, 2, 3]);
    });

    it('walks a folder through its entry when the browser gives no handles', async () => {
        const folder = desktop();
        const items = await readAsync([folder.find('photos')!], { handles: false });

        expect(items[0]).toMatchObject({ kind: 'directory', name: 'photos', handle: null });
        expect(await listPathsAsync(items)).toEqual([
            'photos/',
            'photos/a.png',
            'photos/b.png',
            'photos/raw/',
            'photos/raw/c.raw',
        ]);
    });

    it('reads a file from the files list when the browser gives no handles or entries', async () => {
        const items = await readAsync([new File(['plain'], 'plain.txt')], { handles: false, entries: false });

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: 'file', name: 'plain.txt', handle: null });
        const file = items[0]?.kind === 'file' ? await items[0].readAsync() : null;
        expect(await file?.text()).toBe('plain');
    });

    it('falls back to the entry for an item the browser has no handle for', async () => {
        const items = await readAsync([new File(['loose'], 'loose.txt')]);

        expect(items[0]).toMatchObject({ kind: 'file', name: 'loose.txt', handle: null });
    });

    it('reads nothing once the drop event is over', async () => {
        const fake = fakeDataTransfer([desktop().find('notes.txt')!]);
        fake.end();

        expect(await readDroppedItemsAsync(fake.transfer)).toEqual([]);
    });
});
