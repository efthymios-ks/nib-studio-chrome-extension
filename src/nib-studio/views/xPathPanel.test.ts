import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushAsync } from '../testing/testHelpers.js';
import { renderXPathPanel, type XPathPanelOptions } from './xPathPanel.js';

const CATALOG = '<catalog><book id="1"><title>Alpha &amp; co</title></book><book id="2"><title>Bravo</title></book><shelf/></catalog>';

describe('renderXPathPanel', () => {
    let pane: HTMLElement;
    let writeText: Mock<(text: string) => Promise<void>>;

    beforeEach(() => {
        pane = document.createElement('div');
        document.body.append(pane);
        writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        pane.remove();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    function render(expression: string, overrides: Partial<XPathPanelOptions> = {}): XPathPanelOptions {
        const options: XPathPanelOptions = {
            text: CATALOG,
            expression,
            onRun: vi.fn(),
            onReveal: vi.fn(),
            ...overrides,
        };
        renderXPathPanel(pane, options);

        return options;
    }

    const input = (): HTMLInputElement => pane.querySelector<HTMLInputElement>('.path-query-input')!;
    const status = (): string => pane.querySelector('.path-query-status')?.textContent ?? '';
    const cards = (): HTMLElement[] => [...pane.querySelectorAll<HTMLElement>('.path-card')];

    function summary(): Array<[string, string, string, string]> {
        return cards().map((card) => [
            card.querySelector('.path-card-index')?.textContent ?? '',
            card.querySelector('.path-card-path')?.textContent ?? '',
            card.querySelector('.path-card-type')?.textContent ?? '',
            card.querySelector('.path-card-value')?.textContent ?? '',
        ]);
    }

    it('runs the expression as soon as it opens, counting and listing the matches from 1', () => {
        const options = render('//book/@id');

        expect(input().value).toBe('//book/@id');
        expect(input().getAttribute('placeholder')).toBe('//item/@id');
        expect(status()).toMatch(/^2 matches · /);
        expect(summary()).toEqual([
            ['[1]', '/catalog/book[1]/@id', 'attribute', 'id="1"'],
            ['[2]', '/catalog/book[2]/@id', 'attribute', 'id="2"'],
        ]);
        expect(options.onRun).toHaveBeenCalledWith('//book/@id');
    });

    it('shows element matches as indented, coloured XML', () => {
        render('/catalog/*');

        expect(summary()).toEqual([
            ['[1]', '/catalog/book[1]', 'element · 1 child', '<book id="1">\n  <title>Alpha &amp; co</title>\n</book>'],
            ['[2]', '/catalog/book[2]', 'element · 1 child', '<book id="2">\n  <title>Bravo</title>\n</book>'],
            ['[3]', '/catalog/shelf', 'element', '<shelf/>'],
        ]);

        const value = cards()[0]!.querySelector('.path-card-value')!;
        expect([...value.querySelectorAll('.xml-name')].map((name) => name.textContent)).toEqual(['book', 'title', 'title', 'book']);
        expect(value.querySelector('.xml-attr')?.textContent).toBe('id');
        expect(value.querySelector('.xml-attr-value')?.textContent).toBe('1');
        expect(value.querySelector('.xml-text')?.textContent).toBe('Alpha &amp; co');
    });

    it('shows text matches as the text, unescaped', () => {
        render('//title/text()');

        expect(summary()).toEqual([
            ['[1]', '/catalog/book[1]/title/text()', 'text', 'Alpha & co'],
            ['[2]', '/catalog/book[2]/title/text()', 'text', 'Bravo'],
        ]);
    });

    it('shows the document match as the root element and reveals the root for it', () => {
        const options = render('/');

        expect(summary()[0]?.slice(0, 3)).toEqual(['[1]', '/', 'document']);
        expect(summary()[0]?.[3]).toContain('<catalog>');

        cards()[0]!.querySelector<HTMLButtonElement>('.path-card-reveal')!.click();

        expect(options.onReveal).toHaveBeenCalledWith('/catalog');
    });

    it('puts each element on one line in the compact layout', () => {
        render('/catalog/book', { state: { layout: 'compact', isHelpOpen: false, histories: new Map() } });

        expect(summary().map((row) => row[3])).toEqual([
            '<book id="1"><title>Alpha &amp; co</title></book>',
            '<book id="2"><title>Bravo</title></book>',
        ]);
    });

    it('copies nothing on a click, and the formatted value of a match on Ctrl+C', async () => {
        render('/catalog/book[1]');
        const card = cards()[0]!;

        card.querySelector('.path-card-path')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        card.querySelector('.path-card-value')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        await flushAsync();

        expect(writeText).not.toHaveBeenCalled();

        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
        await flushAsync();

        expect(writeText.mock.calls.map((call) => call[0])).toEqual(['<book id="1">\n  <title>Alpha &amp; co</title>\n</book>']);
        expect([...document.querySelectorAll('.toast')].map((toast) => toast.textContent)).toEqual(['Value copied.']);
    });

    it('shows a match in the tree by its exact XPath, from ↗, double-click and Enter', () => {
        const options = render('//title');

        cards()[1]!.querySelector<HTMLButtonElement>('.path-card-reveal')!.click();
        cards()[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        cards()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect((options.onReveal as Mock).mock.calls.map((call) => call[0])).toEqual([
            '/catalog/book[2]/title',
            '/catalog/book[1]/title',
            '/catalog/book[2]/title',
        ]);
    });

    it('copies every match with Copy all: elements as XML, attributes and text as their values', async () => {
        render('//book');
        pane.querySelector<HTMLButtonElement>('.path-copy-all')!.click();
        await flushAsync();

        expect(writeText).toHaveBeenLastCalledWith(
            '<book id="1">\n  <title>Alpha &amp; co</title>\n</book>\n\n<book id="2">\n  <title>Bravo</title>\n</book>',
        );

        pane.replaceChildren();
        render('//@id');
        pane.querySelector<HTMLButtonElement>('.path-copy-all')!.click();
        await flushAsync();

        expect(writeText).toHaveBeenLastCalledWith('1\n\n2');

        pane.replaceChildren();
        render('//title/text()', { state: { layout: 'compact', isHelpOpen: false, histories: new Map() } });
        pane.querySelector<HTMLButtonElement>('.path-copy-all')!.click();
        await flushAsync();

        expect(writeText).toHaveBeenLastCalledWith('Alpha & co\nBravo');
    });

    it.each([
        ['/catalog/book[1', "Invalid XPath: Expected ']' at character 16.", ''],
        ['/catalog/', 'Invalid XPath: Expected a name at character 10.', ' '],
        ['count(//book)', "Invalid XPath: Unexpected '(' at character 6.", '('],
    ])('explains why %j is not a valid expression and marks where', (expression, message, marked) => {
        render(expression);

        expect(status()).toBe(message);
        expect(cards()).toHaveLength(0);
        expect(pane.querySelector('.path-query-excerpt mark')?.textContent).toBe(marked === '' ? ' ' : marked);
    });

    it('says when the document is not valid XML', () => {
        render('/catalog', { text: '<catalog>' });

        expect(status()).toMatch(/^Document is not valid XML: .+ \(line 1, column \d+\)\.$/);
        expect(pane.querySelector<HTMLElement>('.path-query-excerpt')?.hidden).toBe(true);
    });

    it('offers examples built from the document\'s element names', () => {
        render('/*');
        pane.querySelector<HTMLButtonElement>('.path-help-button')!.click();
        const expressions = [...pane.querySelectorAll('.path-help-example-code')].map((code) => code.textContent);

        expect(expressions).toContain('//book');
        expect(expressions).toContain("//book[@id='1']");
        expect(pane.querySelector('.path-help h3:last-of-type')?.textContent).toBe('XPath syntax');

        [...pane.querySelectorAll<HTMLButtonElement>('.path-help-example')].find((example) => example.textContent?.endsWith('//book'))!.click();

        expect(input().value).toBe('//book');
        expect(status()).toMatch(/^2 matches/);
    });
});
