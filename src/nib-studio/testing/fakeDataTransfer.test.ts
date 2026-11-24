import { describe, expect, it } from 'vitest';
import { FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { dragEvent, dropFixtures, fakeDataTransfer } from './fakeDataTransfer.js';

interface FakeItem {
    readonly kind: string;
    readonly getAsFile: () => File | null;
    readonly getAsFileSystemHandle?: () => Promise<unknown>;
    readonly webkitGetAsEntry?: () => FakeEntry | null;
}

interface FakeEntry {
    readonly name: string;
    readonly isDirectory: boolean;
    readonly createReader: () => { readEntries: (success: (entries: FakeEntry[]) => void) => void };
}

function desktop(): FakeDirectoryHandle {
    const folder = new FakeDirectoryHandle('desktop');
    folder.addFile('notes.txt', 'notes');
    folder.addFile('photos/a.png', new Uint8Array([1, 2]));
    folder.addFile('photos/b.png', new Uint8Array([3]));
    folder.addFile('photos/c.png', new Uint8Array([4]));

    return folder;
}

function itemsOf(transfer: DataTransfer): FakeItem[] {
    return Array.from(transfer.items as unknown as ArrayLike<FakeItem>);
}

async function readBatchAsync(reader: ReturnType<FakeEntry['createReader']>): Promise<string[]> {
    const batch = await new Promise<FakeEntry[]>((resolve) => reader.readEntries(resolve));

    return batch.map((entry) => entry.name);
}

describe('fakeDataTransfer', () => {
    it('carries files only, with one item and one file per dropped fixture', () => {
        const folder = desktop();
        const fake = fakeDataTransfer([folder.find('notes.txt')!, folder.find('photos')!, new File(['plain'], 'plain.txt')]);

        expect(Array.from(fake.transfer.types)).toEqual(['Files']);
        expect(itemsOf(fake.transfer).map((item) => item.kind)).toEqual(['file', 'file', 'file']);
        expect(Array.from(fake.transfer.files).map((file) => [file.name, file.size])).toEqual([
            ['notes.txt', 5],
            ['photos', 0],
            ['plain.txt', 5],
        ]);
    });

    it('hands out the fake handle, and none for a plain File', async () => {
        const folder = desktop();
        const notes = folder.find('notes.txt')!;
        const [handleItem, plainItem] = itemsOf(fakeDataTransfer([notes, new File([''], 'plain.txt')]).transfer);

        await expect(handleItem!.getAsFileSystemHandle!()).resolves.toBe(notes);
        await expect(plainItem!.getAsFileSystemHandle!()).resolves.toBeNull();
    });

    it('leaves out handles or entries when asked to', () => {
        const [item] = itemsOf(fakeDataTransfer([desktop().find('notes.txt')!], { handles: false, entries: false }).transfer);

        expect(item!.getAsFileSystemHandle).toBeUndefined();
        expect(item!.webkitGetAsEntry).toBeUndefined();
        expect(item!.getAsFile()?.name).toBe('notes.txt');
    });

    it('reads a folder entry in batches, ending with an empty one', async () => {
        const [item] = itemsOf(fakeDataTransfer([desktop().find('photos')!]).transfer);
        const entry = item!.webkitGetAsEntry!()!;
        const reader = entry.createReader();

        expect(entry.isDirectory).toBe(true);
        expect(await readBatchAsync(reader)).toEqual(['a.png', 'b.png']);
        expect(await readBatchAsync(reader)).toEqual(['c.png']);
        expect(await readBatchAsync(reader)).toEqual([]);
    });

    it('empties its items and files once the drop is over', async () => {
        const fake = fakeDataTransfer([desktop().find('notes.txt')!]);
        const [item] = itemsOf(fake.transfer);

        fake.end();

        expect(fake.transfer.items).toHaveLength(0);
        expect(fake.transfer.files).toHaveLength(0);
        expect(item!.getAsFile()).toBeNull();
        expect(item!.webkitGetAsEntry!()).toBeNull();
        await expect(item!.getAsFileSystemHandle!()).resolves.toBeNull();
    });
});

describe('dragEvent', () => {
    it('builds a cancelable bubbling event with the transfer, related target and position', () => {
        const transfer = fakeDataTransfer([]).transfer;
        const related = document.createElement('div');

        const event = dragEvent('dragleave', transfer, { relatedTarget: related, clientX: 4, clientY: 9 }) as DragEvent;

        expect(event).toMatchObject({ type: 'dragleave', bubbles: true, cancelable: true, clientX: 4, clientY: 9 });
        expect(event.dataTransfer).toBe(transfer);
        expect(event.relatedTarget).toBe(related);
    });
});

describe('dropFixtures', () => {
    it('dispatches a drop whose items are readable during the event and gone after it', () => {
        const target = document.createElement('div');
        const seen: string[] = [];
        target.addEventListener('drop', (event) => {
            seen.push(...Array.from((event as DragEvent).dataTransfer!.files).map((file) => file.name));
        });

        const event = dropFixtures(target, [new File(['x'], 'x.txt')]) as DragEvent;

        expect(seen).toEqual(['x.txt']);
        expect(event.dataTransfer!.files).toHaveLength(0);
    });
});
