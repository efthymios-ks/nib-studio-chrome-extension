import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
    countJsonLines,
    describeJsonValue,
    formatJsonValue,
    jsonValueKind,
    jsonValueText,
} from '../../common/paths/valueFormat.js';
import { flushAsync } from '../testing/testHelpers.js';
import {
    COLLAPSED_LINES,
    createPathResultsState,
    RESULTS_PAGE_SIZE,
    renderPathResults,
    type PathQueryLanguage,
    type PathQueryOutcome,
    type PathResultMatch,
    type PathResultsOptions,
    type PathResultsState,
} from './pathResults.js';

// A language whose expression names one of the fixtures below, such as `items`.
const FIXTURES: Readonly<Record<string, ReadonlyArray<unknown>>> = {
    items: [{ id: 7, name: 'Mug', tags: ['a', 'b'] }, 'plain', 42, null],
    long: [Array.from({ length: 60 }, (_, index) => index)],
    medium: [Array.from({ length: 20 }, (_, index) => index)],
    many: Array.from({ length: 450 }, (_, index) => index),
    script: ['<img src=x onerror="alert(1)">'],
    none: [],
};

function toMatch(value: unknown, index: number): PathResultMatch {
    return {
        path: `$[${index}]`,
        type: describeJsonValue(value),
        kind: jsonValueKind(value),
        format: (layout, limits) => formatJsonValue(value, layout, limits),
        lineCount: (layout) => countJsonLines(value, layout),
        copyText: (layout) => jsonValueText(value, layout),
        reveal: value === 'plain' ? null : `$.at[${index}]`,
    };
}

function evaluate(expression: string): PathQueryOutcome {
    if (expression === 'broken document') {
        return { ok: false, message: 'Document is not valid JSON.', span: null, isDocumentError: true };
    }

    const values = FIXTURES[expression.trim()];

    if (values == null) {
        return { ok: false, message: `Unknown name at character 3.`, span: { start: 2, end: 4 } };
    }

    return { ok: true, matches: values.map(toMatch), copyAll: (layout) => jsonValueText(values, layout) };
}

const LANGUAGE: PathQueryLanguage = {
    name: 'JSONPath',
    placeholder: '$.x',
    firstIndex: 0,
    copyAllTitle: 'Copy all values as a JSON array',
    evaluate,
    examples: () => [{ title: 'Every item', expression: 'items' }, { title: 'A long one', expression: 'long' }],
    syntax: [{ syntax: '$', description: 'The whole document.' }],
};

describe('renderPathResults', () => {
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

    function render(expression: string, overrides: Partial<PathResultsOptions> = {}): PathResultsOptions {
        const options: PathResultsOptions = {
            language: LANGUAGE,
            expression,
            state: createPathResultsState(),
            onRun: vi.fn(),
            onReveal: vi.fn(),
            ...overrides,
        };
        renderPathResults(pane, options);

        return options;
    }

    const input = (): HTMLInputElement => pane.querySelector<HTMLInputElement>('.path-query-input')!;
    const status = (): string => pane.querySelector('.path-query-status')?.textContent ?? '';
    const cards = (): HTMLElement[] => [...pane.querySelectorAll<HTMLElement>('.path-card')];
    const card = (index: number): HTMLElement => cards()[index]!;
    const valueOf = (index: number): string => card(index).querySelector('.path-card-value')?.textContent ?? '';
    const toastText = (): string[] => [...document.querySelectorAll('.toast')].map((toast) => toast.textContent ?? '');
    const button = (selector: string): HTMLButtonElement => pane.querySelector<HTMLButtonElement>(selector)!;

    function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);

        return event;
    }

    function click(target: Element, detail = 1): void {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    }

    describe('query form', () => {
        it('runs the expression as soon as it opens, with the count and time in the status line', () => {
            const options = render('items');

            expect(input().value).toBe('items');
            expect(input().getAttribute('aria-label')).toBe('JSONPath expression');
            expect(status()).toMatch(/^4 matches · (< 1|\d+) ms$/);
            expect(cards()).toHaveLength(4);
            expect(options.onRun).toHaveBeenCalledWith('items');
        });

        it('says Enter runs an edited expression, and runs it on Enter, with no Run button', () => {
            const options = render('items');
            input().value = 'medium';
            input().dispatchEvent(new Event('input', { bubbles: true }));

            expect(status()).toBe('Enter to run');
            expect(cards()).toHaveLength(4);

            press(input(), 'Enter');

            expect(status()).toMatch(/^1 match · /);
            expect(options.onRun).toHaveBeenLastCalledWith('medium');
            expect([...pane.querySelectorAll('button')].some((element) => element.textContent === 'Run')).toBe(false);
        });

        it('keeps the result in the status line while the expression is unchanged', () => {
            render('items');
            input().dispatchEvent(new Event('input', { bubbles: true }));

            expect(status()).toMatch(/^4 matches · /);
        });

        it('says when nothing matches and hides the results tools', () => {
            render('none');

            expect(status()).toMatch(/^No matches · /);
            expect(cards()).toHaveLength(0);
            expect(pane.querySelector<HTMLElement>('.path-results-tools')?.hidden).toBe(true);
        });

        it('asks for an expression when the box is blank, without running it', () => {
            const evaluateSpy = vi.fn(evaluate);
            render('   ', { language: { ...LANGUAGE, evaluate: evaluateSpy } });

            expect(status()).toBe('Type an expression, then press Enter to run it.');
            expect(evaluateSpy).not.toHaveBeenCalled();
        });

        it('explains an invalid expression and marks the part at fault', () => {
            render('wrong');

            expect(status()).toBe('Unknown name at character 3.');
            expect(pane.querySelector<HTMLElement>('.path-query-status')?.dataset['tone']).toBe('fail');
            expect(input().getAttribute('aria-invalid')).toBe('true');

            const excerpt = pane.querySelector<HTMLElement>('.path-query-excerpt')!;
            expect(excerpt.hidden).toBe(false);
            expect(excerpt.textContent).toBe('wrong');
            expect(excerpt.querySelector('mark')?.textContent).toBe('on');
        });

        it('marks an empty place when the fault is at the end of the expression', () => {
            render('ab', { language: { ...LANGUAGE, evaluate: () => ({ ok: false, message: 'Expected more.', span: { start: 2, end: 3 } }) } });

            expect(pane.querySelector('.path-query-excerpt mark')?.textContent).toBe(' ');
        });

        it('shows a document error without marking the expression', () => {
            render('broken document');

            expect(status()).toBe('Document is not valid JSON.');
            expect(input().hasAttribute('aria-invalid')).toBe(false);
            expect(pane.querySelector<HTMLElement>('.path-query-excerpt')?.hidden).toBe(true);
        });

        it('clears the error once a valid expression runs', () => {
            render('wrong');
            input().value = 'items';
            press(input(), 'Enter');

            expect(input().hasAttribute('aria-invalid')).toBe(false);
            expect(pane.querySelector<HTMLElement>('.path-query-excerpt')?.hidden).toBe(true);
            expect(pane.querySelector<HTMLElement>('.path-query-status')?.dataset['tone']).toBeUndefined();
        });
    });

    describe('result cards', () => {
        it('shows each match\'s index, path, type and formatted value', () => {
            render('items');

            expect(card(0).querySelector('.path-card-index')?.textContent).toBe('[0]');
            expect(card(0).querySelector('.path-card-path')?.textContent).toBe('$[0]');
            expect(card(0).querySelector('.path-card-path')?.getAttribute('title')).toBe('$[0]');
            expect(card(0).querySelector('.path-card-type')?.textContent).toBe('object · 3 keys');
            expect(card(0).querySelector('.path-card-type')?.classList.contains('badge')).toBe(true);
            expect(valueOf(0)).toBe(JSON.stringify({ id: 7, name: 'Mug', tags: ['a', 'b'] }, null, 2));
            expect(card(0).dataset['kind']).toBe('object');
            expect(valueOf(1)).toBe('"plain"');
            expect(card(1).querySelector('.path-card-type')?.textContent).toBe('string');
            expect(card(3).querySelector('.path-card-type')?.textContent).toBe('null');
        });

        it('counts from the language\'s first index', () => {
            render('items', { language: { ...LANGUAGE, firstIndex: 1 } });

            expect(card(0).querySelector('.path-card-index')?.textContent).toBe('[1]');
        });

        it('colours the value with the JSON tree\'s classes', () => {
            render('items');
            const value = card(0).querySelector('.path-card-value')!;

            expect(value.querySelector('.json-key')?.textContent).toBe('"id"');
            expect(value.querySelector('.json-number')?.textContent).toBe('7');
            expect(value.querySelector('.json-string')?.textContent).toBe('"Mug"');
            expect(card(3).querySelector('.json-null')?.textContent).toBe('null');
        });

        it('keeps document content as text, never as markup', () => {
            render('script');

            expect(pane.querySelector('img')).toBeNull();
            expect(valueOf(0)).toBe(JSON.stringify('<img src=x onerror="alert(1)">'));
        });

        it('collapses a long value after 20 lines, with Show all and Show less', () => {
            render('long');
            const value = card(0).querySelector<HTMLElement>('.path-card-value')!;

            expect(valueOf(0).split('\n')).toHaveLength(COLLAPSED_LINES);
            expect(value.dataset['collapsed']).toBe('true');

            const showAll = card(0).querySelector<HTMLButtonElement>('[data-action="show-all"]')!;
            expect(showAll.textContent).toBe('Show all 62 lines');
            showAll.click();

            expect(valueOf(0)).toBe(JSON.stringify(FIXTURES['long']?.[0], null, 2));
            expect(value.dataset['collapsed']).toBe('false');

            card(0).querySelector<HTMLButtonElement>('[data-action="show-less"]')!.click();

            expect(valueOf(0).split('\n')).toHaveLength(COLLAPSED_LINES);
        });

        it('shows a value of a few more than 20 lines whole', () => {
            render('medium');

            expect(valueOf(0).split('\n')).toHaveLength(22);
            expect(card(0).querySelector('[data-action="show-all"]')).toBeNull();
        });

        it('copies nothing when the path or the value is clicked, so both select like plain text', async () => {
            render('items');
            click(card(2).querySelector('.path-card-path')!);
            click(card(0).querySelector('.path-card-value .json-key')!);
            await flushAsync();

            expect(writeText).not.toHaveBeenCalled();
            expect(toastText()).toEqual([]);
            expect(card(0).querySelector('.path-card-value')?.hasAttribute('title')).toBe(false);
        });

        it('shows the match in the tree on double-click, without copying', async () => {
            const options = render('items');
            const value = card(2).querySelector('.path-card-value')!;
            click(value, 1);
            click(value, 2);
            value.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            await flushAsync();

            expect(options.onReveal).toHaveBeenCalledWith('$.at[2]');
            expect(writeText).not.toHaveBeenCalled();
        });

        it('shows the match in the tree from its ↗ button', () => {
            const options = render('items');
            const reveal = card(0).querySelector<HTMLButtonElement>('.path-card-reveal')!;

            expect(reveal.getAttribute('aria-label')).toBe('Show in tree');
            reveal.click();

            expect(options.onReveal).toHaveBeenCalledWith('$.at[0]');
        });

        it('offers no Show in tree for a match the tree has no node for', () => {
            const options = render('items');

            expect(card(1).querySelector('.path-card-reveal')).toBeNull();

            card(1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            press(card(1), 'Enter');

            expect(options.onReveal).not.toHaveBeenCalled();
        });
    });

    describe('results tools', () => {
        it('switches between formatted and compact values and remembers the choice', () => {
            const state: PathResultsState = createPathResultsState();
            render('items', { state });
            const formatted = button('.path-layout-option[data-layout="formatted"]');
            const compact = button('.path-layout-option[data-layout="compact"]');

            expect(formatted.getAttribute('aria-pressed')).toBe('true');
            expect(formatted.dataset['active']).toBe('true');
            expect(compact.getAttribute('aria-pressed')).toBe('false');
            expect(formatted.classList.contains('view-tab')).toBe(true);

            compact.click();

            expect(state.layout).toBe('compact');
            expect(compact.getAttribute('aria-pressed')).toBe('true');
            expect(compact.dataset['active']).toBe('true');
            expect(formatted.dataset['active']).toBe('false');
            expect(pane.querySelector<HTMLElement>('.path-results')?.dataset['layout']).toBe('compact');
            expect(valueOf(0)).toBe('{"id":7,"name":"Mug","tags":["a","b"]}');

            pane.replaceChildren();
            render('long', { state });

            expect(valueOf(0)).toBe(JSON.stringify(FIXTURES['long']?.[0]));
            expect(card(0).querySelector('[data-action="show-all"]')).toBeNull();

            button('.path-layout-option[data-layout="formatted"]').click();

            expect(valueOf(0).split('\n')).toHaveLength(COLLAPSED_LINES);
        });

        it('copies the value in the layout shown on Ctrl+C', async () => {
            render('items', { state: { layout: 'compact', isHelpOpen: false, histories: new Map() } });
            press(card(0), 'c', { ctrlKey: true });
            await flushAsync();

            expect(writeText).toHaveBeenCalledWith('{"id":7,"name":"Mug","tags":["a","b"]}');
        });

        it('copies every match with Copy all', async () => {
            render('items');
            const copyAll = button('.path-copy-all');

            expect(copyAll.getAttribute('aria-label')).toBe('Copy all values as a JSON array');

            copyAll.click();
            await flushAsync();

            expect(writeText).toHaveBeenCalledWith(JSON.stringify(FIXTURES['items'], null, 2));
            expect(toastText()).toEqual(['4 matches copied.']);
        });

        it('renders the first 200 matches, then more on Show more', () => {
            render('many');

            expect(cards()).toHaveLength(RESULTS_PAGE_SIZE);
            expect(pane.querySelector('.path-results-count')?.textContent).toBe('200 of 450 shown');

            button('[data-action="show-more"]').click();

            expect(cards()).toHaveLength(400);
            expect(button('[data-action="show-more"]').textContent).toBe('Show 50 more');

            button('[data-action="show-more"]').click();

            expect(cards()).toHaveLength(450);
            expect(pane.querySelector('[data-action="show-more"]')).toBeNull();
            expect(card(449).querySelector('.path-card-index')?.textContent).toBe('[449]');
        });
    });

    describe('help', () => {
        it('opens from ? with the examples and the syntax, and runs a clicked example', () => {
            const state = createPathResultsState();
            const options = render('none', { state });
            const help = pane.querySelector<HTMLElement>('.path-help')!;
            const helpButton = button('.path-help-button');

            expect(help.hidden).toBe(true);
            expect(helpButton.getAttribute('aria-expanded')).toBe('false');

            helpButton.click();

            expect(help.hidden).toBe(false);
            expect(state.isHelpOpen).toBe(true);
            expect([...help.querySelectorAll('.path-help-example')].map((example) => example.textContent)).toEqual(['Every itemitems', 'A long onelong']);
            expect(help.querySelector('dt')?.textContent).toBe('$');
            expect(help.querySelector('dd')?.textContent).toBe('The whole document.');

            help.querySelector<HTMLButtonElement>('.path-help-example')!.click();

            expect(input().value).toBe('items');
            expect(options.onRun).toHaveBeenLastCalledWith('items');
            expect(cards()).toHaveLength(4);
            expect(help.hidden).toBe(true);
            expect(state.isHelpOpen).toBe(false);
            expect(document.activeElement).toBe(input());
        });

        it('stays open across renders while the state says so', () => {
            render('items', { state: { layout: 'formatted', isHelpOpen: true, histories: new Map() } });

            expect(pane.querySelector<HTMLElement>('.path-help')?.hidden).toBe(false);
            expect(button('.path-help-button').getAttribute('aria-expanded')).toBe('true');
        });
    });

    describe('keyboard', () => {
        it('moves from the box to the cards and between cards with the arrow keys, Home and End', () => {
            render('items');

            press(input(), 'ArrowDown');
            expect(document.activeElement).toBe(card(0));

            press(card(0), 'ArrowDown');
            expect(document.activeElement).toBe(card(1));

            press(card(1), 'ArrowUp');
            expect(document.activeElement).toBe(card(0));

            press(card(0), 'ArrowUp');
            expect(document.activeElement).toBe(card(0));

            press(card(0), 'End');
            expect(document.activeElement).toBe(card(3));

            press(card(3), 'ArrowDown');
            expect(document.activeElement).toBe(card(3));

            press(card(3), 'Home');
            expect(document.activeElement).toBe(card(0));
        });

        it('shows the focused card in the tree on Enter', () => {
            const options = render('items');
            card(2).focus();
            const event = press(card(2), 'Enter');

            expect(options.onReveal).toHaveBeenCalledWith('$.at[2]');
            expect(event.defaultPrevented).toBe(true);
        });

        it('copies the focused card\'s value on Ctrl+C', async () => {
            render('items');
            const event = press(card(2), 'c', { ctrlKey: true });
            await flushAsync();

            expect(writeText).toHaveBeenCalledWith('42');
            expect(event.defaultPrevented).toBe(true);
            expect(toastText()).toEqual(['Value copied.']);
        });

        it('leaves Ctrl+C to the browser when text is selected', async () => {
            render('items');
            const range = document.createRange();
            range.selectNodeContents(card(0).querySelector('.path-card-path')!);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            const event = press(card(2), 'c', { ctrlKey: true });
            await flushAsync();

            expect(writeText).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
            window.getSelection()?.removeAllRanges();
        });

        it('says when the clipboard refuses', async () => {
            writeText.mockRejectedValueOnce(new Error('Document is not focused.'));
            render('items');
            press(card(0), 'c', { ctrlKey: true });
            await flushAsync();

            expect(document.querySelector('.toast[data-tone="fail"]')?.textContent).toBe('Could not copy: Document is not focused.');
        });

        it('keeps cards focusable and the ↗ button out of the tab order', () => {
            render('items');

            expect(card(0).getAttribute('tabindex')).toBe('0');
            expect(card(0).querySelector('.path-card-reveal')?.getAttribute('tabindex')).toBe('-1');
        });
    });
});
