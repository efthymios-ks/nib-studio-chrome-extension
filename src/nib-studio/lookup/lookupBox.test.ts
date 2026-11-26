import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupProgress } from '../../common/lookup/lookupIndex.js';
import type { LookupResult, LookupResults } from '../../common/lookup/lookupResults.js';
import { waitForFrameAsync } from '../testing/testHelpers.js';
import { createLookupBox, progressLabel, resultCountLabel, type LookupBox, type LookupBoxCallbacks } from './lookupBox.js';
import type { LookupClient, LookupUpdate } from './lookupClient.js';

interface FakeClient {
    readonly client: LookupClient;
    readonly searches: string[];
    emit(update: LookupUpdate): void;
}

function fakeClient(): FakeClient {
    const listeners = new Set<(update: LookupUpdate) => void>();
    const searches: string[] = [];
    let progress: LookupProgress | null = null;

    return {
        searches,
        client: {
            search: (query) => searches.push(query),
            refresh: vi.fn(),
            applyChanges: vi.fn(),
            setOpenTexts: vi.fn(),
            setUnlocked: vi.fn(),
            progress: () => progress,
            subscribe: (listener) => {
                listeners.add(listener);

                return () => {
                    listeners.delete(listener);
                };
            },
            dispose: vi.fn(),
        },
        emit: (update) => {
            if (update.kind === 'progress') {
                progress = update.progress;
            }

            for (const listener of [...listeners]) {
                listener(update);
            }
        },
    };
}

function result(path: string, overrides: Partial<LookupResult> = {}): LookupResult {
    const slash = path.lastIndexOf('/');

    return {
        path,
        name: path.slice(slash + 1),
        folder: slash < 0 ? '' : path.slice(0, slash),
        target: 'name',
        tier: 5,
        nameRanges: [],
        preview: null,
        ...overrides,
    };
}

function results(query: string, list: ReadonlyArray<LookupResult>, total = list.length): LookupResults {
    return { query, results: list, total };
}

let fake: FakeClient;
let box: LookupBox;
let callbacks: { [Key in keyof LookupBoxCallbacks]: ReturnType<typeof vi.fn> & LookupBoxCallbacks[Key] };

function input(): HTMLInputElement {
    return box.element.querySelector('.lookup-input') as HTMLInputElement;
}

function panel(): HTMLElement | null {
    return document.querySelector('.lookup-panel');
}

function rowNames(): string[] {
    return [...document.querySelectorAll('.lookup-row .lookup-row-name')].map((name) => name.textContent ?? '');
}

function selectedName(): string | null {
    return document.querySelector('.lookup-row[aria-selected="true"] .lookup-row-name')?.textContent ?? null;
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    input().dispatchEvent(event);

    return event;
}

async function typeAsync(text: string): Promise<void> {
    input().focus();
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await waitForFrameAsync();
}

beforeEach(() => {
    fake = fakeClient();
    callbacks = {
        connect: vi.fn(() => fake.client),
        onOpen: vi.fn(),
        onReveal: vi.fn(),
        onLeave: vi.fn(),
    } as unknown as typeof callbacks;
    box = createLookupBox(callbacks);
    box.setAvailable(true);
    document.body.append(box.element);
});

afterEach(() => {
    box.dispose();
    box.element.remove();
    vi.useRealTimers();
});

describe('createLookupBox', () => {
    it('opens no panel for an empty box, and opens one under it as you type, searching once for the keys of a frame', async () => {
        input().focus();

        expect(callbacks.connect).toHaveBeenCalledTimes(1);
        expect(panel()).toBeNull();
        expect(input().placeholder).toBe('Look up files…');

        input().value = 'm';
        input().dispatchEvent(new Event('input'));
        input().value = 'my';
        input().dispatchEvent(new Event('input'));
        await waitForFrameAsync();

        expect(panel()).not.toBeNull();
        expect(input().getAttribute('aria-expanded')).toBe('true');
        expect(fake.searches).toEqual(['my']);
    });

    it('lists each file with its name\'s matches marked, its folder and its icon, and previews the selected one', async () => {
        await typeAsync('my name');
        fake.emit({ kind: 'results', results: results('my name', [
            result('docs/MyName.txt', { nameRanges: [{ start: 0, end: 6 }] }),
            result('other.md'),
        ]) });

        expect(rowNames()).toEqual(['MyName.txt', 'other.md']);
        expect([...document.querySelectorAll('.lookup-row .lookup-mark')].map((mark) => mark.textContent)).toEqual(['MyName']);
        expect(document.querySelector('.lookup-row .lookup-row-folder')?.textContent).toBe('docs');
        expect(document.querySelector<HTMLElement>('.lookup-row .tree-icon')?.dataset['type']).toBe('text');
        expect(selectedName()).toBe('MyName.txt');
        expect(input().getAttribute('aria-activedescendant')).toBe('lookup-row-0');
        expect(document.querySelector('.lookup-preview-name')?.textContent).toBe('MyName.txt');
        expect(document.querySelector('.lookup-preview-text')).toBeNull();
        expect(document.querySelector('.lookup-count')?.textContent).toBe('2 matches');
    });

    it('previews a content match: the line, and the text with its matches marked and ellipses where it is cut', async () => {
        await typeAsync('anna');
        fake.emit({ kind: 'results', results: results('anna', [result('notes.txt', {
            target: 'content',
            tier: 3,
            preview: { text: 'Customer: Anna Smith', ranges: [{ start: 10, end: 14 }], hasLead: true, hasTail: true, line: 12, sheet: null, matchText: 'Anna' },
        })]) });

        expect(document.querySelector('.lookup-preview-line')?.textContent).toBe('Line 12');
        expect(document.querySelector('.lookup-preview-text')?.textContent).toBe('…Customer: Anna Smith…');
        expect(document.querySelector('.lookup-preview-text .lookup-mark')?.textContent).toBe('Anna');
        expect(document.querySelector('.lookup-row .lookup-mark')).toBeNull();
    });

    it('names the sheet and row of a match in a workbook', async () => {
        await typeAsync('ironworks');
        fake.emit({ kind: 'results', results: results('ironworks', [result('data/sales.xlsx', {
            target: 'content',
            tier: 3,
            preview: {
                text: 'Thessaly Ironworks Larissa 5400',
                ranges: [{ start: 9, end: 18 }],
                hasLead: false,
                hasTail: false,
                line: null,
                sheet: { name: 'North Region', row: 1203 },
                matchText: 'Ironworks',
            },
        })]) });

        expect(document.querySelector('.lookup-preview-line')?.textContent).toBe('North Region · row 1,203');
    });

    it('ignores the results of a query no longer in the box', async () => {
        await typeAsync('report');
        fake.emit({ kind: 'results', results: results('rep', [result('rep.txt')]) });

        expect(rowNames()).toEqual([]);
        expect(document.querySelector('.lookup-empty')?.textContent).toBe('Looking up…');

        fake.emit({ kind: 'results', results: results('report', []) });

        expect(document.querySelector('.lookup-empty')?.textContent).toBe('No matches');
    });

    it('moves the selection with the arrows and the page keys, keeping them from the caret and from the tree', async () => {
        const tree = document.createElement('div');
        const treeKeys = vi.fn();
        tree.addEventListener('keydown', treeKeys);
        document.body.append(tree);
        await typeAsync('file');
        fake.emit({ kind: 'results', results: results('file', Array.from({ length: 30 }, (_, index) => result(`file-${index}.txt`))) });

        expect(press('ArrowDown').defaultPrevented).toBe(true);
        press('ArrowDown');
        expect(selectedName()).toBe('file-2.txt');
        press('ArrowUp');
        expect(selectedName()).toBe('file-1.txt');
        press('PageDown');
        expect(selectedName()).toBe('file-11.txt');
        press('PageUp');
        press('PageUp');
        expect(selectedName()).toBe('file-0.txt');
        press('ArrowUp');
        expect(selectedName()).toBe('file-0.txt');
        expect(treeKeys).not.toHaveBeenCalled();
        tree.remove();
    });

    it('opens the selected file on Enter, closing the panel and keeping the query', async () => {
        await typeAsync('plan');
        const list = [result('a/plan.txt'), result('b/plan.md')];
        fake.emit({ kind: 'results', results: results('plan', list) });
        press('ArrowDown');
        press('Enter');

        expect(callbacks.onOpen).toHaveBeenCalledWith(list[1], 'plan');
        expect(panel()).toBeNull();
        expect(input().value).toBe('plan');
    });

    it('selects the row a moving pointer is over and previews it, while a still pointer over redrawn rows takes nothing', async () => {
        await typeAsync('plan');
        const list = [result('a/plan.txt'), result('b/plan.md'), result('c/plan.json')];
        fake.emit({ kind: 'results', results: results('plan', list) });
        const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.lookup-row')];
        const move = (row: HTMLElement, x: number, y: number): void => {
            row.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
        };

        move(rows()[2]!, 10, 40);

        expect(selectedName()).toBe('plan.json');
        expect(document.querySelector('.lookup-preview-name')?.textContent).toBe('plan.json');
        expect(document.activeElement).toBe(input());

        press('ArrowUp');
        fake.emit({ kind: 'results', results: results('plan', list) });
        const afterRedraw = selectedName();
        move(rows()[2]!, 10, 40);

        expect(selectedName()).toBe(afterRedraw);

        move(rows()[1]!, 10, 25);

        expect(selectedName()).toBe('plan.md');
    });

    it('opens the file of a row that is clicked', async () => {
        await typeAsync('plan');
        const list = [result('a/plan.txt'), result('b/plan.md')];
        fake.emit({ kind: 'results', results: results('plan', list) });
        (document.querySelectorAll('.lookup-row')[1] as HTMLElement).click();

        expect(callbacks.onOpen).toHaveBeenCalledWith(list[1], 'plan');
    });

    it('reveals the selected file on Ctrl+E and closes the panel', async () => {
        await typeAsync('plan');
        const list = [result('a/plan.txt')];
        fake.emit({ kind: 'results', results: results('plan', list) });

        expect(press('e', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(callbacks.onReveal).toHaveBeenCalledWith(list[0]);
        expect(panel()).toBeNull();
    });

    it('clears the query and closes the panel on Escape, then leaves for the tree on a second Escape, never closing a drawer', async () => {
        const documentKeys = vi.fn();
        document.addEventListener('keydown', documentKeys);
        await typeAsync('plan');
        press('Escape');

        expect(input().value).toBe('');
        expect(panel()).toBeNull();
        expect(callbacks.onLeave).not.toHaveBeenCalled();

        press('Escape');

        expect(callbacks.onLeave).toHaveBeenCalledTimes(1);
        expect(documentKeys).not.toHaveBeenCalled();
        document.removeEventListener('keydown', documentKeys);
    });

    it('closes the panel when the box loses focus or on a press outside, keeping the query, and opens it again on focus', async () => {
        await typeAsync('plan');
        input().blur();

        expect(panel()).toBeNull();
        expect(input().value).toBe('plan');

        input().focus();
        await waitForFrameAsync();

        expect(panel()).not.toBeNull();
        expect(fake.searches).toEqual(['plan', 'plan']);
        expect(callbacks.connect).toHaveBeenCalledTimes(2);

        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        expect(panel()).toBeNull();
    });

    it('says how far the contents have been read, and searches the open query again as more arrive', async () => {
        await typeAsync('plan');
        fake.emit({ kind: 'progress', progress: { read: 1, total: 3, isListing: false, isDone: false } });

        expect(document.querySelector('.lookup-progress')?.textContent).toBe('Reading contents… 1 of 3');

        await vi.waitFor(() => expect(fake.searches).toEqual(['plan', 'plan']));
        fake.emit({ kind: 'progress', progress: { read: 3, total: 3, isListing: false, isDone: true } });

        expect(document.querySelector<HTMLElement>('.lookup-progress')?.hidden).toBe(true);
    });

    it('hides while no workspace is open, and empties for another workspace', async () => {
        expect(createLookupBox(callbacks).element.hidden).toBe(true);

        await typeAsync('plan');
        box.setAvailable(false);

        expect(box.element.hidden).toBe(true);
        expect(panel()).toBeNull();

        box.setAvailable(true);
        box.reset();

        expect(box.element.hidden).toBe(false);
        expect(input().value).toBe('');
    });
});

describe('labels', () => {
    it('counts matches, or files for the list of every file', () => {
        expect(resultCountLabel(results('plan', [], 1))).toBe('1 match');
        expect(resultCountLabel(results('plan', [], 1250))).toBe('1,250 matches');
        expect(resultCountLabel(results('', [], 2))).toBe('2 files');
    });

    it('says how far reading has got, and nothing once it is done', () => {
        expect(progressLabel({ read: 120, total: 480, isListing: false, isDone: false })).toBe('Reading contents… 120 of 480');
        expect(progressLabel({ read: 480, total: 480, isListing: false, isDone: true })).toBeNull();
        expect(progressLabel({ read: 480, total: 480, isListing: true, isDone: false })).toBeNull();
        expect(progressLabel(null)).toBeNull();
    });
});
