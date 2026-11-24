// A stand-in for the DataTransfer of files and folders dragged in from the computer, for the studio tests.
// Like the browser's, its items empty out once the drop event is over, so code that reads them late gets nothing.
import { FakeDirectoryHandle, FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';

// A fake handle drops with its handle, as in Chromium; a plain File drops without one.
export type DroppedFixture = FakeFileHandle | FakeDirectoryHandle | File;

export interface FakeDataTransferOptions {
    // Offer getAsFileSystemHandle on each item; without it only webkitGetAsEntry and the files remain.
    readonly handles?: boolean;
    // Offer webkitGetAsEntry on each item.
    readonly entries?: boolean;
}

export interface FakeTransfer {
    readonly transfer: DataTransfer;
    // Empties the items and files, as the browser does when the drop event is over.
    readonly end: () => void;
}

export interface DragEventOptions {
    readonly relatedTarget?: EventTarget | null;
    readonly clientX?: number;
    readonly clientY?: number;
}

const READ_BATCH_SIZE = 2;

export function fakeDataTransfer(
    dropped: ReadonlyArray<DroppedFixture>,
    options: FakeDataTransferOptions = {},
): FakeTransfer {
    const state = { active: true };
    const items = dropped.map((fixture) => fakeItem(fixture, options, state));
    const files = dropped.map(fileOf);
    const transfer = {
        types: ['Files'],
        dropEffect: 'none',
        effectAllowed: 'all',
        get items(): unknown[] {
            return state.active ? items : [];
        },
        get files(): File[] {
            return state.active ? files : [];
        },
        getData: () => '',
        setData: () => {},
    };

    return {
        transfer: transfer as unknown as DataTransfer,
        end: () => {
            state.active = false;
        },
    };
}

// A drag event carrying `transfer`, which happy-dom cannot build itself.
export function dragEvent(type: string, transfer: unknown, options: DragEventOptions = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    Object.defineProperty(event, 'relatedTarget', { value: options.relatedTarget ?? null });

    if (options.clientX != null) {
        Object.defineProperty(event, 'clientX', { value: options.clientX });
    }

    if (options.clientY != null) {
        Object.defineProperty(event, 'clientY', { value: options.clientY });
    }

    return event;
}

// Drops the fixtures on `target` and ends the transfer straight after, as the browser does.
export function dropFixtures(
    target: EventTarget,
    dropped: ReadonlyArray<DroppedFixture>,
    options: FakeDataTransferOptions = {},
): Event {
    const fake = fakeDataTransfer(dropped, options);
    const event = dragEvent('drop', fake.transfer);
    target.dispatchEvent(event);
    fake.end();

    return event;
}

function fakeItem(
    fixture: DroppedFixture,
    options: FakeDataTransferOptions,
    state: { active: boolean },
): Record<string, unknown> {
    const file = fileOf(fixture);
    const item: Record<string, unknown> = {
        kind: 'file',
        type: file.type,
        getAsFile: () => state.active ? file : null,
        getAsString: () => {},
    };

    if (options.handles ?? true) {
        item['getAsFileSystemHandle'] = async () => state.active && !(fixture instanceof File) ? fixture : null;
    }

    if (options.entries ?? true) {
        item['webkitGetAsEntry'] = () => state.active ? entryOf(fixture) : null;
    }

    return item;
}

// What the browser lists in `files`: a folder shows up as an empty file with the folder's name.
function fileOf(fixture: DroppedFixture): File {
    if (fixture instanceof File) {
        return fixture;
    }

    if (fixture instanceof FakeFileHandle) {
        return new File([new Uint8Array(fixture.data)], fixture.name);
    }

    return new File([], fixture.name);
}

function entryOf(fixture: DroppedFixture): Record<string, unknown> {
    if (fixture instanceof FakeDirectoryHandle) {
        return {
            isFile: false,
            isDirectory: true,
            name: fixture.name,
            createReader: () => directoryReader(fixture),
        };
    }

    return {
        isFile: true,
        isDirectory: false,
        name: fixture.name,
        file: (success: (file: File) => void) => {
            queueMicrotask(() => success(fileOf(fixture)));
        },
    };
}

// Hands out the children a few at a time, then an empty batch, like the browser's reader.
function directoryReader(directory: FakeDirectoryHandle): Record<string, unknown> {
    const pending = [...directory.children.values()];

    return {
        readEntries: (success: (entries: unknown[]) => void) => {
            const batch = pending.splice(0, READ_BATCH_SIZE).map(entryOf);
            queueMicrotask(() => success(batch));
        },
    };
}
