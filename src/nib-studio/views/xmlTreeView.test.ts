import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleAsync } from '../testing/testHelpers.js';
import { renderXmlTreeView } from './xmlTreeView.js';

const ORDERS = '<orders><order id="1"><item>a</item></order><order id="2"><item>b</item><item>c</item></order><note>  </note></orders>';

describe('renderXmlTreeView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('renders the root element with its name', () => {
        renderXmlTreeView(container, '<root><child>hello</child></root>');

        const rootName = container.querySelector('.xml-name');
        expect(rootName?.textContent).toBe('root');
    });

    it('renders children as nested rows', () => {
        renderXmlTreeView(container, '<root><a/><b/></root>');

        const names = container.querySelectorAll('.xml-name');
        expect(Array.from(names).map((node) => node.textContent)).toEqual(['root', 'a', 'b']);
    });

    it('renders attributes inline', () => {
        renderXmlTreeView(container, '<root id="7" name="x"/>');

        const attrs = container.querySelectorAll('.xml-attr');
        expect(Array.from(attrs).map((node) => node.textContent?.trim())).toEqual([
            '@id="7"',
            '@name="x"',
        ]);
    });

    it('renders the parse error when input is invalid', () => {
        renderXmlTreeView(container, '<unclosed>');

        const placeholder = container.querySelector('.editor-placeholder h2');
        expect(placeholder?.textContent).toBe('Not valid XML');
    });

    function node(path: string): HTMLElement {
        const match = [...container.querySelectorAll<HTMLElement>('[data-node-path]')]
            .find((candidate) => candidate.dataset['nodePath'] === path);

        if (match == null) {
            throw new Error(`No node for ${path}`);
        }

        return match;
    }

    function shownPath(): string {
        return container.querySelector('.path-bar-path')?.textContent ?? '';
    }

    function tickAnyPosition(): void {
        const box = container.querySelector<HTMLInputElement>('.path-bar-option input')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
    }

    it('shows the XPath of a clicked element, with positions only for repeated siblings', () => {
        renderXmlTreeView(container, ORDERS);

        node('/orders/order[2]/item[1]').querySelector<HTMLElement>('.xml-name')!.click();

        expect(shownPath()).toBe('/orders/order[2]/item[1]');
        expect(node('/orders/order[2]/item[1]').dataset['selected']).toBe('true');

        node('/orders/note').click();

        expect(shownPath()).toBe('/orders/note');
        expect(node('/orders/order[2]/item[1]').dataset['selected']).toBeUndefined();
    });

    it('shows the XPath of a clicked attribute and its form without positions', () => {
        renderXmlTreeView(container, ORDERS);
        const attribute = container.querySelectorAll<HTMLElement>('.xml-attr')[1]!;

        attribute.click();

        expect(attribute.dataset['selected']).toBe('true');
        expect(shownPath()).toBe('/orders/order[2]/@id');

        tickAnyPosition();

        expect(shownPath()).toBe('/orders/order/@id');
    });

    it('shows text() for the text of an element', () => {
        renderXmlTreeView(container, '<root>lead<a>x</a></root>');

        container.querySelector<HTMLElement>('.xml-row .xml-text')!.click();

        expect(shownPath()).toBe('/root/a/text()');

        node('/root/text()').click();

        expect(shownPath()).toBe('/root/text()');
    });

    it('keeps rows focusable and selects the focused row on Enter', () => {
        renderXmlTreeView(container, ORDERS);
        const row = node('/orders/order[1]');

        expect(row.getAttribute('tabindex')).toBe('0');

        row.focus();
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(row.dataset['selected']).toBe('true');
        expect(shownPath()).toBe('/orders/order[1]');
    });

    it('folds a node from its twist without selecting it', () => {
        renderXmlTreeView(container, ORDERS);

        node('/orders/order[2]').querySelector<HTMLElement>('.xml-twist')!.click();

        expect(container.querySelector('[data-selected]')).toBeNull();
        expect(container.querySelector('.path-bar')?.getAttribute('data-empty')).toBe('true');
    });

    it('copies the shown XPath', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        renderXmlTreeView(container, ORDERS);

        node('/orders/order[1]/@id').click();
        container.querySelector<HTMLButtonElement>('[data-action="copy-path"]')!.click();
        await settleAsync();

        expect(writeText).toHaveBeenCalledWith('/orders/order[1]/@id');
        expect(document.querySelector('.toast')?.textContent).toBe('XPath copied.');
        vi.unstubAllGlobals();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    it('hands the shown XPath to Use in XPath', () => {
        const onUseInXPath = vi.fn();
        renderXmlTreeView(container, ORDERS, { onUseInXPath });

        node('/orders/order[2]/item[2]').click();
        container.querySelector<HTMLButtonElement>('[data-action="use-path"]')!.click();

        expect(onUseInXPath).toHaveBeenCalledWith('/orders/order[2]/item[2]');
    });

    it('offers no Use in XPath without a handler', () => {
        renderXmlTreeView(container, ORDERS);

        expect(container.querySelector('[data-action="use-path"]')).toBeNull();
    });

    it('selects and flashes the node to reveal', () => {
        renderXmlTreeView(container, ORDERS, { reveal: '/orders/order[2]/item[2]' });

        const target = node('/orders/order[2]/item[2]');
        expect(target.dataset['selected']).toBe('true');
        expect(target.dataset['flash']).toBe('true');
        expect(shownPath()).toBe('/orders/order[2]/item[2]');
    });

    it('reveals the element when its text is not drawn', () => {
        renderXmlTreeView(container, ORDERS, { reveal: '/orders/note/text()' });

        expect(node('/orders/note').dataset['flash']).toBe('true');
    });
});
