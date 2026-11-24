import { afterEach, describe, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { createDiffTab } from '../app/diffTabs.js';
import type { DiffKind, DiffSide } from '../app/store.js';
import { renderDiffTabView, type DiffTabCallbacks } from './diffTabView.js';
import { renderTableView } from './tableView.js';
import { flushAsync, ignoreSelectionChange } from '../testing/testHelpers.js';

const callbacks: DiffTabCallbacks = {
    onSetSide: () => {},
    onSwap: () => {},
};

function side(path: string, text: string): DiffSide {
    return { label: path, path, source: 'file', text };
}

const SAMPLES: ReadonlyArray<{ kind: DiffKind; left: string; right: string; leftText: string; rightText: string }> = [
    { kind: 'text', left: 'a.txt', right: 'b.txt', leftText: 'a\n', rightText: 'b\n' },
    { kind: 'json', left: 'a.json', right: 'b.json', leftText: '{"a":1}', rightText: '{"a":2}' },
    { kind: 'xml', left: 'a.xml', right: 'b.xml', leftText: '<r a="1"/>', rightText: '<r a="2"/>' },
    { kind: 'markdown', left: 'a.md', right: 'b.md', leftText: '# A', rightText: '# B' },
    { kind: 'rows', left: 'a.csv', right: 'b.csv', leftText: 'id\n1\n', rightText: 'id\n2\n' },
];

afterEach(() => {
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

describe('renderDiffTabView', () => {
    it.each(SAMPLES)('labels the original and modified sides of a $kind diff', async (sample) => {
        const container = document.createElement('div');
        document.body.append(container);
        const tab = createDiffTab(side(sample.left, sample.leftText), side(sample.right, sample.rightText));
        expect(tab.diffKind).toBe(sample.kind);

        renderDiffTabView(container, tab, callbacks);
        await flushAsync();

        const original = container.querySelector('.diff-side-header[data-side="original"]');
        const modified = container.querySelector('.diff-side-header[data-side="modified"]');
        expect(original?.querySelector('.diff-side-badge')?.textContent).toBe('Original');
        expect(original?.querySelector('.diff-side-name')?.textContent).toBe(sample.left);
        expect(modified?.querySelector('.diff-side-badge')?.textContent).toBe('Modified');
        expect(modified?.querySelector('.diff-side-name')?.textContent).toBe(sample.right);
    });

    it('restores scroll, the bar view and the current change when the tab is rendered again after leaving it', () => {
        const tab = createDiffTab(side('a.txt', 'a\nx\nb\ny\nc\n'), side('b.txt', 'a\nX\nb\nY\nc\n'));
        const first = document.createElement('div');
        document.body.append(first);
        renderDiffTabView(first, tab, callbacks);
        first.querySelector<HTMLButtonElement>('.diff-bar [data-view="after"]')!.click();
        first.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();
        first.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();
        const scroller = first.querySelector<HTMLElement>('[data-scroll-key="lines"]')!;
        scroller.scrollTop = 120;
        scroller.dispatchEvent(new Event('scroll'));
        first.remove();

        const second = document.createElement('div');
        document.body.append(second);
        renderDiffTabView(second, tab, callbacks);

        expect(tab.state.text.navigation.view).toBe('after');
        expect(tab.state.text.scroll['lines']?.top).toBe(120);
        expect(second.querySelector('.diff-bar-host')?.getAttribute('data-diff-view')).toBe('after');
        expect(second.querySelector('.diff-bar [data-view="after"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(second.querySelector('.diff-bar-position')?.textContent).toBe('2 / 2');
    });

    it.each(['text', 'json', 'xml', 'rows'] as const)('floats the shared bar over the %s diff', async (kind) => {
        const sample = SAMPLES.find((candidate) => candidate.kind === kind)!;
        const container = document.createElement('div');
        document.body.append(container);

        renderDiffTabView(container, createDiffTab(side(sample.left, sample.leftText), side(sample.right, sample.rightText)), callbacks);
        await flushAsync();

        const bar = container.querySelector('.diff-bar-host > .diff-bar');
        expect(Array.from(bar?.querySelectorAll('[data-view]') ?? [], (button) => button.textContent)).toEqual(['Diff', 'Before', 'After']);
        expect(bar?.querySelector('.diff-bar-position')?.textContent).toMatch(/^– \/ [1-9]\d*$/);
    });

    it('leaves the Markdown diff to its own bar', () => {
        const container = document.createElement('div');
        document.body.append(container);

        renderDiffTabView(container, createDiffTab(side('a.md', '# A'), side('b.md', '# B')), callbacks);

        expect(container.querySelector('.diff-bar')).toBeNull();
        expect(container.querySelector('.markdown-diff-frame')).not.toBeNull();
    });

    it('leaves a Windows side as it was when its edit is undone before Apply', () => {
        document.addEventListener('selectionchange', ignoreSelectionChange, true);
        const container = document.createElement('div');
        document.body.append(container);
        const setSide = vi.fn();
        renderDiffTabView(container, createDiffTab(side('a.txt', 'one\r\ntwo\r\n'), side('b.txt', 'one\n')), { ...callbacks, onSetSide: setSide });
        container.querySelector<HTMLElement>('.diff-side-header[data-side="original"] [data-side-action="edit"]')!.click();
        const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.diff-side-editor-host .cm-content')!)!;
        view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
        undo(view);

        container.querySelector<HTMLButtonElement>('[data-action="apply-edit"]')!.click();

        expect(setSide).not.toHaveBeenCalled();
        expect(container.querySelector('.diff-side-editor-host')).toBeNull();
    });
});

describe('table view memory', () => {
    it('restores sort, search and columns when a table is rendered again', () => {
        const memory = {};
        const options = {
            columns: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
            getAllRows: () => [['1', 'x'], ['2', 'y']],
            memory,
        };
        const first = document.createElement('div');
        document.body.append(first);
        const handle = renderTableView(first, { ...options, initialSearch: 'y', initialSort: [{ columnId: 'b', direction: 'desc' as const }] });
        handle.refresh();
        first.remove();

        const second = document.createElement('div');
        document.body.append(second);
        const restored = renderTableView(second, options);

        expect(restored.getSort()).toEqual([{ columnId: 'b', direction: 'desc' }]);
        expect(restored.getColumnOrder()).toEqual(['a', 'b']);
        expect((memory as { search?: string }).search).toBe('y');
    });
});
