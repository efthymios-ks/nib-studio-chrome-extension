import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushAsync } from '../testing/testHelpers.js';
import { renderJsonPathPanel, type JsonPathPanelOptions } from './jsonPathPanel.js';

const SHOP = JSON.stringify({
    name: 'Corner shop',
    orders: [
        { id: 7, customer: 'Ada', paid: true, note: null, lines: [{ sku: 'X', qty: 2 }] },
        { id: 8, customer: 'Linus', paid: false, note: 'gift', lines: [] },
    ],
});

describe('renderJsonPathPanel', () => {
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

    function render(expression: string, overrides: Partial<JsonPathPanelOptions> = {}): JsonPathPanelOptions {
        const options: JsonPathPanelOptions = {
            text: SHOP,
            expression,
            onRun: vi.fn(),
            onReveal: vi.fn(),
            ...overrides,
        };
        renderJsonPathPanel(pane, options);

        return options;
    }

    const input = (): HTMLInputElement => pane.querySelector<HTMLInputElement>('.path-query-input')!;
    const status = (): string => pane.querySelector('.path-query-status')?.textContent ?? '';
    const cards = (): HTMLElement[] => [...pane.querySelectorAll<HTMLElement>('.path-card')];
    const valueOf = (card: HTMLElement): string => card.querySelector('.path-card-value')?.textContent ?? '';

    it('lists each match from 0 with its normalized path, type and pretty-printed value', () => {
        render('$.orders[*]');

        expect(status()).toMatch(/^2 matches · /);
        expect(cards().map((card) => [
            card.querySelector('.path-card-index')?.textContent,
            card.querySelector('.path-card-path')?.textContent,
            card.querySelector('.path-card-type')?.textContent,
        ])).toEqual([
            ['[0]', "$['orders'][0]", 'object · 5 keys'],
            ['[1]', "$['orders'][1]", 'object · 5 keys'],
        ]);
        expect(valueOf(cards()[0]!)).toBe(JSON.stringify(JSON.parse(SHOP).orders[0], null, 2));
    });

    it('colours values with the JSON tree\'s type classes', () => {
        render('$.orders[0]');
        const value = cards()[0]!.querySelector('.path-card-value')!;

        expect([...value.querySelectorAll('.json-key')].map((key) => key.textContent)).toEqual(['"id"', '"customer"', '"paid"', '"note"', '"lines"', '"sku"', '"qty"']);
        expect(value.querySelector('.json-number')?.textContent).toBe('7');
        expect(value.querySelector('.json-string')?.textContent).toBe('"Ada"');
        expect(value.querySelector('.json-boolean')?.textContent).toBe('true');
        expect(value.querySelector('.json-null')?.textContent).toBe('null');
    });

    it('shows primitives on one line with their type', () => {
        render('$..customer');

        expect(cards().map((card) => [card.querySelector('.path-card-type')?.textContent, valueOf(card)])).toEqual([
            ['string', '"Ada"'],
            ['string', '"Linus"'],
        ]);

        pane.replaceChildren();
        render('$.orders[*].paid');

        expect(cards().map((card) => card.querySelector('.path-card-type')?.textContent)).toEqual(['boolean', 'boolean']);
    });

    it('copies nothing on a click, and the formatted value on Ctrl+C', async () => {
        render('$.orders[0].lines');
        const card = cards()[0]!;

        card.querySelector('.path-card-path')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        card.querySelector('.path-card-value')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        await flushAsync();

        expect(writeText).not.toHaveBeenCalled();

        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
        await flushAsync();

        expect(writeText.mock.calls.map((call) => call[0])).toEqual(['[\n  {\n    "sku": "X",\n    "qty": 2\n  }\n]']);
    });

    it('shows a match in the tree by the path the JSON tree uses', () => {
        const options = render('$..sku');

        cards()[0]!.querySelector<HTMLButtonElement>('.path-card-reveal')!.click();

        expect(options.onReveal).toHaveBeenCalledWith('$.orders[0].lines[0].sku');
    });

    it('offers no Show in tree for a value that is not in the document', () => {
        render('$.orders.length');

        expect(valueOf(cards()[0]!)).toBe('2');
        expect(cards()[0]!.querySelector('.path-card-reveal')).toBeNull();
    });

    it('copies every value as a JSON array with Copy all, in the layout shown', async () => {
        render('$.orders[*].id');
        pane.querySelector<HTMLButtonElement>('.path-copy-all')!.click();
        await flushAsync();

        expect(writeText).toHaveBeenLastCalledWith('[\n  7,\n  8\n]');

        pane.querySelector<HTMLButtonElement>('.path-layout-option[data-layout="compact"]')!.click();
        pane.querySelector<HTMLButtonElement>('.path-copy-all')!.click();
        await flushAsync();

        expect(writeText).toHaveBeenLastCalledWith('[7,8]');
    });

    it('explains an invalid expression with its position and marks it', () => {
        render('$.orders[?(@.id > 1');

        expect(status()).toBe("Invalid JSONPath: Unclosed '(' at character 11.");
        expect(pane.querySelector('.path-query-excerpt mark')?.textContent).toBe('(');
        expect(input().getAttribute('aria-invalid')).toBe('true');
    });

    it('says when the document is not valid JSON, with the line and column', () => {
        render('$', { text: '{"a": }' });

        expect(status()).toMatch(/^Document is not valid JSON: .+ \(line 1, column \d+\)\.$/);
        expect(cards()).toHaveLength(0);
    });

    it('offers examples built from the document\'s keys, each of which runs', () => {
        render('$');
        pane.querySelector<HTMLButtonElement>('.path-help-button')!.click();
        const examples = [...pane.querySelectorAll<HTMLButtonElement>('.path-help-example')];

        expect(examples.map((example) => example.querySelector('code')?.textContent)).toContain('$.orders[*].id');
        expect(pane.querySelector('.path-help dt')?.textContent).toBe('$');
        expect(pane.querySelector('.path-help h3:last-of-type')?.textContent).toBe('JSONPath syntax');

        examples.find((example) => example.querySelector('code')?.textContent === '$.orders[*].id')!.click();

        expect(input().value).toBe('$.orders[*].id');
        expect(status()).toMatch(/^2 matches/);
    });
});
