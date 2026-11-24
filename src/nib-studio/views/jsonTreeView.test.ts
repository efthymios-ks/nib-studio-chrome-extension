import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleAsync } from '../testing/testHelpers.js';
import { jsonTreeOf } from '../../common/json/jsonTree.js';
import { renderJsonDataTree, renderJsonTreeView } from './jsonTreeView.js';

const SAMPLE = '{"user":{"name":"Ada","age":36,"admin":true,"manager":null},"tags":["a","b"]}';

describe('renderJsonTreeView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    function item(path: string): HTMLElement {
        return container.querySelector<HTMLElement>(`li[data-json-path="${path}"]`)!;
    }

    function twistOf(path: string): HTMLElement {
        return item(path).querySelector<HTMLElement>(':scope > .json-row > .json-twist')!;
    }

    function childrenOf(path: string): HTMLElement {
        return item(path).querySelector<HTMLElement>(':scope > .json-children')!;
    }

    it('names the items of a root array by a label of their own, and only those', () => {
        renderJsonDataTree(container, jsonTreeOf([{ list: [1] }, 'two']), { rootItemLabel: (index) => `Document ${index + 1}` });

        expect([...container.querySelectorAll('.json-key')].map((key) => key.textContent)).toEqual([
            'Document 1',
            '"list"',
            '0',
            'Document 2',
        ]);
        expect(item('$[1]').querySelector('.json-key')?.getAttribute('data-label')).toBe('true');
    });

    it('shows an empty state with the parse position for invalid JSON', () => {
        renderJsonTreeView(container, '{"a": }');

        expect(container.querySelector('.json-tree')).toBeNull();
        expect(container.textContent).toContain('Not valid JSON');
        expect(container.textContent).toMatch(/line 1, column \d+/);
    });

    it('renders keys, typed values and container counts', () => {
        renderJsonTreeView(container, SAMPLE);

        expect(container.querySelector('.json-tree')).not.toBeNull();
        expect(item('$.user.name').querySelector('.json-key')?.textContent).toBe('"name"');
        expect(item('$.user.name').querySelector('.json-string')?.textContent).toBe('"Ada"');
        expect(item('$.user.age').querySelector('.json-number')?.textContent).toBe('36');
        expect(item('$.user.admin').querySelector('.json-boolean')?.textContent).toBe('true');
        expect(item('$.user.manager').querySelector('.json-null')?.textContent).toBe('null');
        expect(item('$.user').querySelector('.json-count')?.textContent).toBe('4 keys');
        expect(item('$.tags').querySelector('.json-count')?.textContent).toBe('2 items');
    });

    it('counts one key or one item in the singular', () => {
        renderJsonTreeView(container, '{"only": [1]}');

        expect(item('$').querySelector('.json-count')?.textContent).toBe('1 key');
        expect(item('$.only').querySelector('.json-count')?.textContent).toBe('1 item');
    });

    it('replaces the previous content on re-render', () => {
        renderJsonTreeView(container, SAMPLE);
        renderJsonTreeView(container, '[1]');

        expect(container.querySelectorAll('.json-tree')).toHaveLength(1);
        expect(container.querySelectorAll('.tree-toolbar')).toHaveLength(1);
    });

    it('collapses and expands a container when its twist is clicked', () => {
        renderJsonTreeView(container, SAMPLE);

        twistOf('$.user').click();

        expect(twistOf('$.user').dataset['state']).toBe('collapsed');
        expect(twistOf('$.user').textContent).toBe('▸');
        expect(childrenOf('$.user').hidden).toBe(true);

        twistOf('$.user').click();

        expect(twistOf('$.user').dataset['state']).toBe('expanded');
        expect(childrenOf('$.user').hidden).toBe(false);
    });

    it('collapses and expands every node from the toolbar', () => {
        renderJsonTreeView(container, SAMPLE);

        container.querySelector<HTMLButtonElement>('[aria-label="Collapse all nodes"]')!.click();

        const states = (): string[] => [...container.querySelectorAll<HTMLElement>('.json-twist[data-state]')].map((twist) => twist.dataset['state'] ?? '');
        expect(states().every((state) => state === 'collapsed')).toBe(true);

        container.querySelector<HTMLButtonElement>('[aria-label="Expand all nodes"]')!.click();

        expect(states().every((state) => state === 'expanded')).toBe(true);
    });

    function row(path: string): HTMLElement {
        return item(path).querySelector<HTMLElement>(':scope > .json-row')!;
    }

    function shownPath(): string {
        return container.querySelector('.path-bar-path')?.textContent ?? '';
    }

    it('shows the JSONPath of a clicked key or value', () => {
        renderJsonTreeView(container, SAMPLE);

        row('$.user.name').querySelector<HTMLElement>('.json-key')!.click();

        expect(shownPath()).toBe('$.user.name');
        expect(row('$.user.name').dataset['selected']).toBe('true');

        row('$.user').querySelector<HTMLElement>('.json-count')!.click();

        expect(shownPath()).toBe('$.user');
        expect(row('$.user.name').dataset['selected']).toBeUndefined();
    });

    it('shows the JSONPath of an item in nested arrays, and its form for any item', () => {
        renderJsonTreeView(container, '{"grid":[[1,2],[3,[4,5]]]}');

        row('$.grid[1][1][0]').querySelector<HTMLElement>('.json-number')!.click();

        expect(shownPath()).toBe('$.grid[1][1][0]');

        const box = container.querySelector<HTMLInputElement>('.path-bar-option input')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));

        expect(shownPath()).toBe('$.grid[*][*][*]');
    });

    it('shows the root as $ and brackets keys that are not identifiers', () => {
        renderJsonTreeView(container, '{"first name":"Ada"}');

        row('$').click();

        expect(shownPath()).toBe('$');

        container.querySelectorAll<HTMLElement>('.json-row')[1]!.click();

        expect(shownPath()).toBe('$["first name"]');
    });

    it('folds a node from its twist without selecting it', () => {
        renderJsonTreeView(container, SAMPLE);

        twistOf('$.user').click();

        expect(container.querySelector('[data-selected]')).toBeNull();
    });

    it('keeps rows focusable and selects the focused row on Enter', () => {
        renderJsonTreeView(container, SAMPLE);

        expect(row('$.tags[1]').getAttribute('tabindex')).toBe('0');

        row('$.tags[1]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(shownPath()).toBe('$.tags[1]');
    });

    it('copies the shown JSONPath', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        renderJsonTreeView(container, SAMPLE);

        row('$.tags[0]').click();
        container.querySelector<HTMLButtonElement>('[data-action="copy-path"]')!.click();
        await settleAsync();

        expect(writeText).toHaveBeenCalledWith('$.tags[0]');
        expect(document.querySelector('.toast')?.textContent).toBe('JSONPath copied.');
        vi.unstubAllGlobals();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    it('reveals a node by its JSONPath: selects, flashes and focuses it, and shows it in the path bar', () => {
        vi.useFakeTimers();
        renderJsonTreeView(container, SAMPLE, { reveal: '$.tags[1]' });

        expect(row('$.tags[1]').dataset['selected']).toBe('true');
        expect(row('$.tags[1]').dataset['flash']).toBe('true');
        expect(shownPath()).toBe('$.tags[1]');
        expect(document.activeElement).toBe(row('$.tags[1]'));

        vi.advanceTimersByTime(2000);

        expect(row('$.tags[1]').dataset['flash']).toBeUndefined();
        vi.useRealTimers();
    });

    it('reveals nothing for a path the tree does not have', () => {
        renderJsonTreeView(container, SAMPLE, { reveal: '$.missing' });

        expect(container.querySelector('[data-selected]')).toBeNull();
        expect(shownPath()).toBe('Click a node to see its JSONPath.');
    });

    it('hands the shown JSONPath to Use in JSONPath', () => {
        const onUseInJsonPath = vi.fn();
        renderJsonTreeView(container, SAMPLE, { onUseInJsonPath });

        row('$.user.age').click();
        container.querySelector<HTMLButtonElement>('[data-action="use-path"]')!.click();

        expect(onUseInJsonPath).toHaveBeenCalledWith('$.user.age');
    });
});
