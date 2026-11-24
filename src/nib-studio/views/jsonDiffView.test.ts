import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffSide } from '../app/store.js';
import { createJsonDiffViewState, type DiffViewCallbacks, type JsonDiffViewState } from './diffViewState.js';
import { collectArrayItemFields, currentJsonDiffDocument, renderJsonDiffView } from './jsonDiffView.js';
import { waitForFrameAsync } from '../testing/testHelpers.js';

const callbacks: DiffViewCallbacks = {
    onSetSide: () => {},
    onSwap: () => {},
};

function side(path: string, text: string): DiffSide {
    return { label: path, path, source: 'file', text };
}

describe('renderJsonDiffView', () => {
    let container: HTMLElement;
    let state: JsonDiffViewState;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        state = createJsonDiffViewState();
    });

    afterEach(() => {
        container.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function render(original: string | null, modified: string | null): void {
        renderJsonDiffView(container, {
            original: original == null ? null : side('data/a.json', original),
            modified: modified == null ? null : side('data/b.json', modified),
            state,
            callbacks,
        });
    }

    function column(which: 'original' | 'modified'): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>(`.aligned-cell[data-side="${which}"]`));
    }

    function position(): string {
        return container.querySelector('.diff-bar-position')?.textContent ?? '';
    }

    function step(direction: 1 | -1): void {
        container.querySelector<HTMLButtonElement>(`.diff-bar [data-step="${direction}"]`)!.click();
    }


    function cell(which: 'original' | 'modified', path: string): HTMLElement | undefined {
        return column(which).find((candidate) => candidate.dataset['path'] === path);
    }

    function stubFrames(): void {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);

            return 0;
        });
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    }

    it('fills the empty side from a drop zone under the grid, with no bar until both sides are in', () => {
        render('{"a":1}', null);

        expect(container.querySelector('.aligned-drop[data-side="modified"] .editor-placeholder')?.textContent).toBe('Pick the modified JSON file.');
        expect(container.querySelector('.diff-side-header[data-side="modified"]')?.getAttribute('data-empty')).toBe('true');
        expect(container.querySelector('.diff-bar')).toBeNull();
    });

    it('labels both sides with an Original and a Modified header showing name and path', () => {
        render('{"a":1}', '{"a":2}');

        const header = container.querySelector('.diff-side-header[data-side="modified"]');
        expect(header?.querySelector('.diff-side-badge')?.textContent).toBe('Modified');
        expect(header?.querySelector('.diff-side-name')?.textContent).toBe('b.json');
        expect(header?.querySelector('.diff-side-path')?.textContent).toBe('data/b.json');
        expect(container.querySelector('.diff-side-header[data-side="original"] .diff-side-badge')?.textContent).toBe('Original');
    });

    it('gives the aligned grid the full width, with no differences panel beside it', () => {
        render('{"a":1,"b":1}', '{"a":2}');

        expect(container.querySelector('.json-diff-body')?.children).toHaveLength(1);
        expect(container.querySelector('.json-diff-rail, .diff-list, .diff-chip, .diff-list-search')).toBeNull();
        expect(container.textContent).not.toContain('Recompute');
        expect(container.querySelector('.aligned-diff > .diff-bar [data-action="recompute"]')?.getAttribute('title')).toBe('Recompute');
    });

    it('counts every change in the bar alone, with no totals in the toolbar', () => {
        render('{"a":"x","b":2,"c":3}', '{"a":1,"b":5,"d":1}');

        expect(container.querySelector('.diff-count-pills, .diff-count-pill')).toBeNull();
        expect(container.querySelector('.editor-toolbar')?.textContent).not.toMatch(/All \d|Added \d|Removed \d|Changed \d/);
        expect(position()).toBe('– / 4');
    });

    it('treats null as a missing value: a value in its place is added, and null in place of a value is removed', () => {
        render('{"a":null,"b":"x","c":1}', '{"a":5,"b":null,"c":1}');

        expect(state.cache!.document.changes.map((change) => `${change.kind} ${change.id}`)).toEqual(['added a', 'removed b']);
        expect(cell('modified', '$.a')?.dataset['diff']).toBe('added');
        expect(cell('original', '$.a')?.dataset['diff']).toBeUndefined();
        expect(cell('original', '$.a')?.textContent).toContain('null');
        expect(cell('original', '$.b')?.dataset['diff']).toBe('removed');
        expect(position()).toBe('– / 2');

        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="before"]')!.click();
        expect(position()).toBe('– / 1');
        step(1);
        expect(state.navigation.current).toBe('b');
    });

    it('aligns both sides row for row, with placeholders where a side lacks a key', () => {
        state.expansion.set('$.b', true);
        state.expansion.set('r:$.c', true);
        render('{"a":1,"b":{"x":1}}', '{"a":2,"c":[1,2]}');

        const original = column('original');
        const modified = column('modified');
        expect(original).toHaveLength(modified.length);
        const placeholdersLeft = original.filter((candidate) => candidate.dataset['placeholder'] === 'true').length;
        const placeholdersRight = modified.filter((candidate) => candidate.dataset['placeholder'] === 'true').length;
        // c, its two items and its closing bracket on the left; b, its x and its closing brace on the right.
        expect(placeholdersLeft).toBe(4);
        expect(placeholdersRight).toBe(3);
    });

    it('sorts keys by default and shows file order when Sort keys is off', () => {
        render('{"b":1,"a":1,"C":1}', '{"b":1,"a":1,"C":1}');

        const keys = (): string[] => column('original')
            .map((candidate) => candidate.querySelector('.aligned-key')?.textContent ?? '')
            .filter((key) => key !== '');
        expect(keys()).toEqual(['a', 'b', 'C']);

        const toggle = container.querySelector<HTMLInputElement>('[data-action="sort-keys"] input')!;
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));

        expect(state.sortKeys).toBe(false);
        expect(keys()).toEqual(['b', 'a', 'C']);
    });

    it('expands and collapses a node on both sides together, and remembers it', () => {
        render('{"o":{"x":1}}', '{"o":{"x":1}}');
        const rows = (): number => container.querySelectorAll('.aligned-row').length;
        const before = rows();

        container.querySelector<HTMLButtonElement>('.aligned-row[data-id="$.o"] .aligned-cell[data-side="modified"] .aligned-twist')!.click();

        expect(rows()).toBe(before - 2);
        expect(state.expansion.get('$.o')).toBe(false);
        expect(column('original')).toHaveLength(column('modified').length);
    });

    it('steps through the differences from top to bottom as the grid shows them, flashing each', () => {
        state.sortKeys = false;
        render('{"z":1,"m":{"k":1},"a":1}', '{"z":2,"m":{"k":2},"a":2}');

        step(1);
        expect(state.navigation.current).toBe('z');
        step(1);
        expect(state.navigation.current).toBe('m.k');
        expect(container.querySelector('.aligned-row[data-id="$.m.k"]')?.getAttribute('data-flash')).toBe('true');
        step(1);
        expect(position()).toBe('3 / 3');
        step(1);
        expect(position()).toBe('3 / 3');
    });

    it('makes a change clicked in the grid the current one', () => {
        render('{"a":1,"b":1,"c":1}', '{"a":2,"b":2,"c":2}');

        cell('modified', '$.b')!.click();

        expect(state.navigation.current).toBe('b');
        expect(position()).toBe('2 / 3');
    });

    it('opens a collapsed node to show the change the bar steps to', () => {
        stubFrames();
        state.expansion.set('$.deep', false);
        render('{"deep":{"x":1}}', '{"deep":{"x":2}}');
        expect(container.querySelector('.aligned-row[data-id="$.deep.x"]')).toBeNull();

        step(1);

        expect(state.expansion.get('$.deep')).toBe(true);
        expect(container.querySelector('.aligned-row[data-id="$.deep.x"]')?.getAttribute('data-flash')).toBe('true');
        expect(position()).toBe('1 / 1');
    });

    it('keeps the bar view and the current change in the tab state across renders', () => {
        render('{"a":1,"b":1,"c":1}', '{"a":2,"b":2}');
        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="after"]')!.click();
        step(1);
        step(1);

        container.replaceChildren();
        render('{"a":1,"b":1,"c":1}', '{"a":2,"b":2}');

        expect(container.querySelector('.aligned-diff')?.getAttribute('data-diff-view')).toBe('after');
        expect(container.querySelector('.diff-bar [data-view="after"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(position()).toBe('2 / 2');
        expect(state.navigation.current).toBe('b');
    });

    it('steps with the keys while the grid has focus', () => {
        render('{"a":1,"b":1}', '{"a":2,"b":2}');

        container.querySelector('.aligned-scroller')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));

        expect(position()).toBe('1 / 2');
    });

    it('lists the array rules under Rules (n), and compares again when one is removed there', () => {
        state.rules = [{ path: '$.items[*]', matchBy: ['id'] }];
        render('{"items":[{"id":1,"v":1},{"id":2,"v":1}]}', '{"items":[{"id":2,"v":1},{"id":1,"v":2}]}');
        expect(position()).toBe('– / 1');

        const button = container.querySelector<HTMLButtonElement>('[data-action="rules"]')!;
        expect(button.textContent).toBe('Rules (1)');
        button.click();
        document.querySelector<HTMLButtonElement>('.diff-rules-popover [data-action="remove"]')!.click();

        expect(state.rules).toEqual([]);
        expect(container.querySelector('[data-action="rules"]')).toBeNull();
        // Paired by position now: both ids differ, and the second value too.
        expect(position()).toBe('– / 3');
        document.querySelectorAll('.toast').forEach((toast) => toast.remove());
    });

    it('compares again from the bar', async () => {
        render('{"a":1}', '{"a":2}');
        const before = state.cache;

        container.querySelector<HTMLButtonElement>('.diff-bar [data-action="recompute"]')!.click();
        await waitForFrameAsync();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(state.cache).not.toBe(before);
        expect(state.cache?.document.changes).toHaveLength(1);
    });

    it('builds the diff document once, and again once the key order or a side name changes', () => {
        const input = { original: side('data/a.json', '{"b":1,"a":1}'), modified: side('data/b.json', '{"b":2,"a":1}'), state };
        const document = currentJsonDiffDocument(input);

        expect(currentJsonDiffDocument(input)).toBe(document);
        expect(document?.original).toEqual({ name: 'a.json', source: 'file', path: 'data/a.json' });

        state.sortKeys = false;
        const unsorted = currentJsonDiffDocument(input);
        expect(unsorted).not.toBe(document);
        expect(unsorted?.options.sortKeys).toBe(false);

        const renamed = currentJsonDiffDocument({ ...input, modified: side('data/c.json', '{"b":2,"a":1}') });
        expect(renamed?.modified.name).toBe('c.json');
    });

    it('has no diff document until both sides are chosen', () => {
        expect(currentJsonDiffDocument({ original: side('a.json', '{}'), modified: null, state })).toBeNull();
    });
});

describe('collectArrayItemFields', () => {
    it('collects the field names of the array items on both sides, de-duplicated and sorted', () => {
        const left = { items: [{ sku: 'a', price: 1 }, { sku: 'b', Name: 'x' }] };
        const right = { items: [{ sku: 'a', qty: 2 }, 'not an object'] };

        expect(collectArrayItemFields([left, right], ['items'])).toEqual(['Name', 'price', 'qty', 'sku']);
    });

    it('treats index steps as any item, matching the [*] rule path', () => {
        const value = { orders: [{ lines: [{ id: 1 }] }, { lines: [{ code: 'c' }] }] };

        expect(collectArrayItemFields([value], ['orders', 0, 'lines'])).toEqual(['code', 'id']);
    });
});
