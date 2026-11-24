import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from '../app/dom.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { bindPathSelection, createPathBar, pathNodeDataset, revealPath } from './pathBar.js';

function stubClipboard(writeText: (text: string) => Promise<void>): void {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
}

function button(bar: HTMLElement, action: string): HTMLButtonElement {
    return bar.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
}

function anyPositionBox(bar: HTMLElement): HTMLInputElement {
    return bar.querySelector<HTMLInputElement>('.path-bar-option input')!;
}

function shownPath(bar: HTMLElement): string {
    return bar.querySelector('.path-bar-path')?.textContent ?? '';
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
});

describe('createPathBar', () => {
    it('asks for a click and keeps its buttons disabled until a node is shown', () => {
        const bar = createPathBar({ language: 'XPath', onUse: vi.fn() }).element;

        expect(bar.dataset['empty']).toBe('true');
        expect(shownPath(bar)).toBe('Click a node to see its XPath.');
        expect(button(bar, 'copy-path').disabled).toBe(true);
        expect(button(bar, 'use-path').disabled).toBe(true);
    });

    it('shows the exact path, and the path without positions while Any position is ticked', () => {
        const pathBar = createPathBar({ language: 'XPath' });
        pathBar.show({ exact: '/orders/order[2]/@id', anyPosition: '/orders/order/@id' });
        const box = anyPositionBox(pathBar.element);

        expect(shownPath(pathBar.element)).toBe('/orders/order[2]/@id');
        expect(pathBar.element.dataset['empty']).toBeUndefined();
        expect(box.disabled).toBe(false);

        box.checked = true;
        box.dispatchEvent(new Event('change'));

        expect(shownPath(pathBar.element)).toBe('/orders/order/@id');
    });

    it('disables Any position when both forms are the same', () => {
        const pathBar = createPathBar({ language: 'JSONPath' });
        pathBar.show({ exact: '$.user.name', anyPosition: '$.user.name' });

        expect(anyPositionBox(pathBar.element).disabled).toBe(true);
    });

    it('leaves out Use when no handler is given', () => {
        expect(createPathBar({ language: 'XPath' }).element.querySelector('[data-action="use-path"]')).toBeNull();
    });

    it('copies the shown path and confirms with a toast', async () => {
        const writeText = vi.fn(async () => {});
        stubClipboard(writeText);
        const pathBar = createPathBar({ language: 'XPath' });
        document.body.append(pathBar.element);
        pathBar.show({ exact: '/a/b[2]', anyPosition: '/a/b' });

        button(pathBar.element, 'copy-path').click();
        await settleAsync();

        expect(writeText).toHaveBeenCalledWith('/a/b[2]');
        expect(toastTexts()).toContain('XPath copied.');
    });

    it('reports a failed copy', async () => {
        stubClipboard(async () => {
            throw new Error('Clipboard blocked.');
        });
        const pathBar = createPathBar({ language: 'JSONPath' });
        pathBar.show({ exact: '$.a', anyPosition: '$.a' });

        button(pathBar.element, 'copy-path').click();
        await settleAsync();

        expect(toastTexts()).toContain('Clipboard blocked.');
    });

    it('hands the shown path to Use', () => {
        const onUse = vi.fn();
        const pathBar = createPathBar({ language: 'XPath', onUse });
        pathBar.show({ exact: '/a/b[2]', anyPosition: '/a/b' });
        const box = anyPositionBox(pathBar.element);
        box.checked = true;
        box.dispatchEvent(new Event('change'));

        button(pathBar.element, 'use-path').click();

        expect(button(pathBar.element, 'use-path').textContent).toBe('Use in XPath');
        expect(onUse).toHaveBeenCalledWith('/a/b');
    });
});

describe('bindPathSelection and revealPath', () => {
    let tree: HTMLElement;
    let twist: HTMLElement;
    let children: HTMLElement;

    beforeEach(() => {
        twist = h('span', { class: 'twist', dataset: { state: 'collapsed' } });
        children = h('ul', {
            children: [h('li', {
                children: [h('div', {
                    class: 'row',
                    dataset: pathNodeDataset({ exact: '/a/b[2]', anyPosition: '/a/b' }),
                    attrs: { tabindex: '0' },
                })],
            })],
        });
        children.hidden = true;
        twist.addEventListener('click', () => {
            twist.dataset['state'] = 'expanded';
            children.hidden = false;
        });
        tree = h('ul', {
            children: [h('li', {
                children: [
                    h('div', {
                        class: 'row',
                        dataset: pathNodeDataset({ exact: '/a', anyPosition: '/a' }),
                        attrs: { tabindex: '0' },
                        children: [twist],
                    }),
                    children,
                ],
            })],
        });
        document.body.append(tree);
    });

    function row(path: string): HTMLElement {
        return [...tree.querySelectorAll<HTMLElement>('[data-node-path]')].find((node) => node.dataset['nodePath'] === path)!;
    }

    it('selects a clicked node, one at a time, and shows its path', () => {
        const pathBar = createPathBar({ language: 'XPath' });
        bindPathSelection(tree, pathBar);

        row('/a').click();
        row('/a/b[2]').click();

        expect(row('/a').dataset['selected']).toBeUndefined();
        expect(row('/a/b[2]').dataset['selected']).toBe('true');
        expect(shownPath(pathBar.element)).toBe('/a/b[2]');
    });

    it('selects a focused row on Enter and ignores other keys', () => {
        const pathBar = createPathBar({ language: 'XPath' });
        bindPathSelection(tree, pathBar);

        row('/a').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

        expect(row('/a').dataset['selected']).toBeUndefined();

        row('/a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(row('/a').dataset['selected']).toBe('true');
        expect(shownPath(pathBar.element)).toBe('/a');
    });

    it('opens folded parents, then selects, scrolls to and flashes the revealed node', () => {
        vi.useFakeTimers();
        const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        const pathBar = createPathBar({ language: 'XPath' });

        expect(revealPath(tree, '/a/b[2]', pathBar)).toBe(true);

        const target = row('/a/b[2]');
        expect(children.hidden).toBe(false);
        expect(target.dataset['selected']).toBe('true');
        expect(target.dataset['flash']).toBe('true');
        expect(document.activeElement).toBe(target);
        expect(scrollIntoView).toHaveBeenCalled();
        expect(shownPath(pathBar.element)).toBe('/a/b[2]');

        vi.advanceTimersByTime(2000);

        expect(target.dataset['flash']).toBeUndefined();
        scrollIntoView.mockRestore();
    });

    it('reveals nothing for a path no node has', () => {
        expect(revealPath(tree, '/a/c', createPathBar({ language: 'XPath' }))).toBe(false);
        expect(children.hidden).toBe(true);
    });
});
