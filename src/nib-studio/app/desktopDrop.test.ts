import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_MIME } from '../explorer/dragDrop.js';
import { dragEvent, dropFixtures, fakeDataTransfer } from '../testing/fakeDataTransfer.js';
import { flushAsync } from '../testing/testHelpers.js';
import { registerDesktopDrop, type DesktopDropHandle } from './desktopDrop.js';
import type { DroppedItem } from './droppedItems.js';

interface Page {
    readonly header: HTMLElement;
    readonly sidebar: HTMLElement;
    readonly main: HTMLElement;
    readonly first: HTMLElement;
    readonly second: HTMLElement;
}

let page: Page;
let handle: DesktopDropHandle;
let canImport: boolean;
let opened: Array<Promise<DroppedItem[]>>;
let cleared: number;

function buildPage(): Page {
    const header = document.createElement('header');
    const sidebar = document.createElement('aside');
    const main = document.createElement('main');
    const first = document.createElement('div');
    const second = document.createElement('div');
    main.append(first, second);
    document.body.append(header, sidebar, main);

    return { header, sidebar, main, first, second };
}

function fileTransfer(): DataTransfer {
    return fakeDataTransfer([new File(['x'], 'x.txt')]).transfer;
}

function enter(target: EventTarget, transfer = fileTransfer()): Event {
    const event = dragEvent('dragenter', transfer);
    target.dispatchEvent(event);

    return event;
}

function leave(target: EventTarget, options: Parameters<typeof dragEvent>[2] = {}, transfer = fileTransfer()): void {
    target.dispatchEvent(dragEvent('dragleave', transfer, options));
}

function hints(): { open: string | undefined; importHint: string | undefined } {
    return {
        open: page.main.dataset['dropHint'],
        importHint: page.sidebar.dataset['dropHint'],
    };
}

const SHOWN = { open: 'Drop to open', importHint: 'Drop on a folder to import' };
const CLEARED = { open: undefined, importHint: undefined };

beforeEach(() => {
    page = buildPage();
    canImport = true;
    opened = [];
    cleared = 0;
    handle = registerDesktopDrop({
        sidebar: page.sidebar,
        main: page.main,
        canImport: () => canImport,
        onOpen: (items) => opened.push(items),
        onClear: () => {
            cleared += 1;
        },
    });
});

afterEach(() => {
    handle.dispose();
    document.body.replaceChildren();
});

describe('registerDesktopDrop hints', () => {
    it('shows where a drop opens and where it imports while files are dragged over the window', () => {
        enter(page.first);

        expect(hints()).toEqual(SHOWN);
    });

    it('leaves the import hint out when there is no workspace to import into', () => {
        canImport = false;

        enter(page.first);

        expect(hints()).toEqual({ ...SHOWN, importHint: undefined });
    });

    it('ignores drags that carry no files, such as tree rows', () => {
        const transfer = { types: [INTERNAL_MIME], dropEffect: 'none', getData: () => '[]' };

        const event = enter(page.first, transfer as unknown as DataTransfer);
        page.first.dispatchEvent(dragEvent('dragover', transfer));

        expect(hints()).toEqual(CLEARED);
        expect(event.defaultPrevented).toBe(false);
    });

    it('keeps the hints while the pointer moves between elements, even when the leave has no related target', () => {
        enter(page.first);

        enter(page.second);
        leave(page.first);

        expect(hints()).toEqual(SHOWN);
    });

    it('clears the hints when the pointer leaves the window', () => {
        enter(page.first);
        enter(page.second);
        leave(page.first, { relatedTarget: page.second });

        leave(page.second);

        expect(hints()).toEqual(CLEARED);
        expect(cleared).toBe(1);
    });

    it('clears the hints when a leave lands outside the window, even if an enter went unmatched', () => {
        enter(page.first);
        enter(page.second);

        leave(page.second, { clientX: -1, clientY: 40 });

        expect(hints()).toEqual(CLEARED);
    });

    it('clears the hints on dragend and on Esc', () => {
        enter(page.first);
        window.dispatchEvent(new Event('dragend'));

        expect(hints()).toEqual(CLEARED);

        enter(page.first);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(hints()).toEqual(CLEARED);
    });

    it('starts counting afresh after a clear', () => {
        enter(page.first);
        enter(page.second);
        window.dispatchEvent(new Event('dragend'));

        enter(page.first);
        leave(page.first);

        expect(hints()).toEqual(CLEARED);
    });
});

describe('registerDesktopDrop drops', () => {
    it('cancels the browser default on dragover and drop anywhere in the page', () => {
        const transfer = fileTransfer();
        const over = dragEvent('dragover', transfer);
        page.header.dispatchEvent(over);

        const drop = dropFixtures(page.header, [new File(['x'], 'x.txt')]);

        expect(over.defaultPrevented).toBe(true);
        expect(transfer.dropEffect).toBe('copy');
        expect(drop.defaultPrevented).toBe(true);
    });

    it('opens files dropped outside the tree and the diff drop zones', async () => {
        enter(page.header);

        dropFixtures(page.header, [new File(['x'], 'x.txt')]);

        expect(hints()).toEqual(CLEARED);
        expect(opened).toHaveLength(1);
        expect((await opened[0])?.map((item) => item.name)).toEqual(['x.txt']);
    });

    it('clears the hints even when the element under the pointer stops the drop', async () => {
        page.second.addEventListener('drop', (event) => event.stopPropagation());
        enter(page.second);

        const drop = dropFixtures(page.second, [new File(['x'], 'x.txt')]);
        await flushAsync();

        expect(hints()).toEqual(CLEARED);
        expect(drop.defaultPrevented).toBe(true);
        expect(opened).toHaveLength(0);
    });

    it('stops listening once disposed', () => {
        const onOpen = vi.fn();
        handle.dispose();
        handle = registerDesktopDrop({ sidebar: page.sidebar, main: page.main, canImport: () => true, onOpen });
        handle.dispose();

        enter(page.first);
        dropFixtures(page.first, [new File(['x'], 'x.txt')]);

        expect(hints()).toEqual(CLEARED);
        expect(onOpen).not.toHaveBeenCalled();
    });
});
