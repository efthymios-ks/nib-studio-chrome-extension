import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEXT_COMPARE_RULES, type TextCompareRules } from '../../common/text/textCompareRules.js';
import type { DiffSide } from '../app/store.js';
import { closeDiffPopover } from './diffPopover.js';
import { createTextDiffViewState, type DiffViewCallbacks, type TextDiffViewState } from './diffViewState.js';
import { currentTextDiffDocument, renderTextDiffView } from './textDiffView.js';
import { flushAsync, pressKey } from '../testing/testHelpers.js';

const callbacks: DiffViewCallbacks = {
    onSetSide: () => {},
    onSwap: () => {},
};

function fileSide(path: string, text: string): DiffSide {
    return { label: path, path, source: 'file', text };
}

describe('renderTextDiffView', () => {
    let container: HTMLElement;
    let state: TextDiffViewState;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        state = createTextDiffViewState();
    });

    afterEach(() => {
        closeDiffPopover();
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    function render(original: string, modified: string, tabState = state): void {
        renderTextDiffView(container, { original: fileSide('a.ts', original), modified: fileSide('b.ts', modified), state: tabState, callbacks });
    }

    function rulesButton(): HTMLButtonElement {
        return container.querySelector<HTMLButtonElement>('.editor-toolbar [data-action="compare-rules"]')!;
    }

    function popover(): HTMLElement | null {
        return document.querySelector<HTMLElement>('.diff-rules-popover');
    }

    function openRules(): HTMLElement {
        rulesButton().click();

        return popover()!;
    }

    function control(rule: string): HTMLInputElement {
        return popover()!.querySelector<HTMLInputElement>(`[data-rule="${rule}"] input`)!;
    }

    function toggle(rule: string): void {
        const input = control(rule);
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
    }

    function position(): string {
        return container.querySelector('.diff-bar-position')?.textContent ?? '';
    }

    function markedLines(markers: string): string[] {
        const selector = markers.split(' ').map((marker) => `.text-diff-text[data-marker="${marker}"]`).join(', ');

        return Array.from(container.querySelectorAll<HTMLElement>(selector), (cell) => `${cell.dataset['marker']}:${cell.textContent}`);
    }

    async function addPatternAsync(pattern: string): Promise<void> {
        popover()!.querySelector<HTMLButtonElement>('[data-action="add-pattern"]')!.click();
        document.querySelector<HTMLInputElement>('.modal input')!.value = pattern;
        document.querySelector<HTMLButtonElement>('.modal [data-role="primary"]')!.click();
        await flushAsync();
    }

    it('gives the diff the full width, with Compare rules in the toolbar and no rules panel or totals', () => {
        render('a\n', 'b\n');

        const body = container.querySelector('.text-diff-body');
        expect(Array.from(body?.children ?? [], (child) => child.className)).toEqual(['text-diff-panel diff-bar-host']);
        expect(container.querySelector('aside, .text-diff-rail, .rules-panel, .rules-panel-header')).toBeNull();
        expect(container.querySelector('[data-count="add"], [data-count="del"], .diff-count-pill')).toBeNull();
        expect(container.querySelector('.editor-toolbar')?.textContent).not.toMatch(/[+−]\d/);
        expect(rulesButton().textContent).toBe('Compare rules');
        expect(rulesButton().className).toBe('button diff-rules-button');
        expect(rulesButton().getAttribute('aria-haspopup')).toBe('dialog');
        expect(rulesButton().getAttribute('aria-expanded')).toBe('false');
    });

    it('shows Compare rules while a side is still missing', () => {
        renderTextDiffView(container, { original: fileSide('a.ts', 'only\n'), modified: null, state, callbacks });

        expect(rulesButton().textContent).toBe('Compare rules');
    });

    it('counts the rules that differ from the defaults on the button', () => {
        state.rules = { ...DEFAULT_TEXT_COMPARE_RULES, ignoreCase: true, ignorePatterns: ['^#'] };
        render('a\n', 'a\n');

        expect(rulesButton().textContent).toBe('Compare rules · 2');
        expect(rulesButton().querySelector('.diff-rules-count')?.textContent).toBe(' · 2');
    });

    it('opens every rule in a popover, and closes it on Esc, a click outside or the button, with focus back on the button', () => {
        render('a\n', 'b\n');

        const opened = openRules();
        expect(opened.getAttribute('role')).toBe('dialog');
        expect(opened.getAttribute('aria-label')).toBe('Compare rules');
        expect(rulesButton().getAttribute('aria-expanded')).toBe('true');
        expect(Array.from(opened.querySelectorAll('[data-rule="whitespace"] label'), (label) => label.textContent))
            .toEqual(['Don\'t ignore', 'Trailing whitespace', 'Changes in amount', 'All whitespace']);
        expect(Array.from(opened.querySelectorAll('label[data-rule]'), (label) => label.textContent)).toEqual([
            'Ignore case',
            'Ignore blank lines',
            'Normalise line endings (CRLF / LF)',
            'Trim each line',
            'Sort lines before comparing',
            'Unique lines only',
        ]);
        expect(opened.querySelector('[data-rule="ignorePatterns"]')?.textContent).toContain('Ignore lines matching');
        expect(control('normalizeLineEndings').checked).toBe(true);
        expect(document.activeElement).toBe(opened.querySelector('[data-rule="whitespace"] input[value="none"]'));

        pressKey(document.activeElement!, 'Escape');
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(rulesButton());

        openRules();
        rulesButton().click();
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(rulesButton());

        openRules();
        container.querySelector('.text-diff-scroller')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(popover()).toBeNull();
        expect(rulesButton().getAttribute('aria-expanded')).toBe('false');
    });

    interface RuleCase {
        readonly rule: string;
        readonly original: string;
        readonly modified: string;
        readonly apply: () => void;
        readonly expected: Partial<TextCompareRules>;
    }

    const RULE_CASES: ReadonlyArray<RuleCase> = [
        {
            rule: 'whitespace',
            original: 'Value  \n',
            modified: 'Value\n',
            apply: () => popover()!.querySelector<HTMLInputElement>('[data-rule="whitespace"] input[value="trailing"]')!.click(),
            expected: { whitespace: 'trailing' },
        },
        { rule: 'ignoreCase', original: 'Hello\n', modified: 'hello\n', apply: () => toggle('ignoreCase'), expected: { ignoreCase: true } },
        { rule: 'ignoreBlankLines', original: 'a\n\nb\n', modified: 'a\nb\n', apply: () => toggle('ignoreBlankLines'), expected: { ignoreBlankLines: true } },
        { rule: 'trimLines', original: '  a\n', modified: 'a\n', apply: () => toggle('trimLines'), expected: { trimLines: true } },
        { rule: 'sortLines', original: 'b\na\n', modified: 'a\nb\n', apply: () => toggle('sortLines'), expected: { sortLines: true } },
    ];

    it.each(RULE_CASES)('applies $rule at once and compares again behind the open popover', (ruleCase) => {
        render(ruleCase.original, ruleCase.modified);
        expect(position()).not.toBe('No changes');
        const opened = openRules();

        ruleCase.apply();

        expect(state.rules).toEqual({ ...DEFAULT_TEXT_COMPARE_RULES, ...ruleCase.expected });
        expect(position()).toBe('No changes');
        expect(markedLines('add del')).toEqual([]);
        expect(popover()).toBe(opened);
        expect(rulesButton().getAttribute('aria-expanded')).toBe('true');
        expect(rulesButton().textContent).toBe('Compare rules · 1');
    });

    it('keeps focus on the rule just changed while the diff draws again', () => {
        render('Hello\n', 'hello\n');
        openRules();
        control('ignoreCase').focus();

        toggle('ignoreCase');

        expect(document.activeElement).toBe(control('ignoreCase'));
        expect(control('ignoreCase').checked).toBe(true);
    });

    it('compares line endings once Normalise line endings is off', () => {
        render('a\r\nb\r\n', 'a\nb\n');
        expect(position()).toBe('No changes');
        openRules();

        toggle('normalizeLineEndings');

        expect(state.rules.normalizeLineEndings).toBe(false);
        expect(position()).toBe('– / 1');
        expect(rulesButton().textContent).toBe('Compare rules · 1');
    });

    it('enables Unique lines only once sorting is on, and counts it then', () => {
        render('a\na\nb\n', 'a\nb\n');
        openRules();

        expect(control('uniqueLines').disabled).toBe(true);
        toggle('sortLines');
        expect(control('uniqueLines').disabled).toBe(false);
        expect(position()).toBe('– / 1');

        toggle('uniqueLines');

        expect(position()).toBe('No changes');
        expect(rulesButton().textContent).toBe('Compare rules · 2');
    });

    it('adds an ignore pattern through the dialog, greys the lines it leaves out without counting them, and removes it again', async () => {
        render('id: 1\n# 2024\n', 'id: 1\n# 2026\n');
        openRules();
        expect(popover()?.querySelector('.diff-rules-empty')?.textContent).toContain('No patterns.');

        const add = popover()!.querySelector<HTMLButtonElement>('[data-action="add-pattern"]')!;
        add.focus();
        add.click();
        const input = document.querySelector<HTMLInputElement>('.modal input')!;
        const ok = document.querySelector<HTMLButtonElement>('.modal [data-role="primary"]')!;
        input.value = '(';
        ok.click();
        expect(document.querySelector('.modal-error')?.textContent).not.toBe('');
        expect(document.querySelector('.modal')).not.toBeNull();
        expect(popover()).not.toBeNull();

        input.value = '^#';
        ok.click();
        await flushAsync();

        expect(state.rules.ignorePatterns).toEqual(['^#']);
        expect(popover()?.querySelector('[data-rule="ignorePatterns"] .rule-summary')?.textContent).toContain('^#');
        expect(document.activeElement).toBe(popover()?.querySelector('[data-action="add-pattern"]'));
        expect(position()).toBe('No changes');
        expect(markedLines('ignored')).toEqual(['ignored:# 2024', 'ignored:# 2026']);
        expect(container.querySelector('.editor-toolbar [data-count]')).toBeNull();
        expect(container.querySelector('.editor-toolbar')?.textContent).not.toContain('ignored');
        expect(state.cache?.document.summary.lines?.ignored).toBe(2);
        expect(rulesButton().textContent).toBe('Compare rules · 1');

        popover()!.querySelector<HTMLButtonElement>('[data-rule="ignorePatterns"] [data-action="remove"]')!.click();

        expect(state.rules.ignorePatterns).toEqual([]);
        expect(position()).toBe('– / 1');
        expect(markedLines('ignored')).toEqual([]);
        expect(popover()?.contains(document.activeElement)).toBe(true);
    });

    it('edits a pattern in place and keeps one copy of a pattern added twice', async () => {
        state.rules = { ...DEFAULT_TEXT_COMPARE_RULES, ignorePatterns: ['^#'] };
        render('a\n', 'a\n');
        openRules();

        popover()!.querySelector<HTMLButtonElement>('[data-rule="ignorePatterns"] [data-action="edit"]')!.click();
        expect(document.querySelector<HTMLInputElement>('.modal input')?.value).toBe('^#');
        document.querySelector<HTMLInputElement>('.modal input')!.value = '^//';
        document.querySelector<HTMLButtonElement>('.modal [data-role="primary"]')!.click();
        await flushAsync();
        expect(state.rules.ignorePatterns).toEqual(['^//']);

        await addPatternAsync('^//');

        expect(state.rules.ignorePatterns).toEqual(['^//']);
    });

    it('goes back to the popover when the pattern dialog is cancelled', async () => {
        render('a\n', 'b\n');
        openRules();
        const add = popover()!.querySelector<HTMLButtonElement>('[data-action="add-pattern"]')!;
        add.focus();
        add.click();

        document.querySelector<HTMLButtonElement>('.modal-footer .button:not([data-role])')!.click();
        await flushAsync();

        expect(document.querySelector('.modal')).toBeNull();
        expect(popover()).not.toBeNull();
        expect(document.activeElement).toBe(popover()!.querySelector('[data-action="add-pattern"]'));
        expect(state.rules).toBe(DEFAULT_TEXT_COMPARE_RULES);
    });

    it('wraps Tab inside the popover and steps between rules with the arrow keys', () => {
        render('a\n', 'b\n');
        openRules();
        const add = popover()!.querySelector<HTMLButtonElement>('[data-action="add-pattern"]')!;

        add.focus();
        pressKey(add, 'Tab');
        expect(document.activeElement).toBe(popover()!.querySelector('input[value="none"]'));

        control('ignoreCase').focus();
        pressKey(control('ignoreCase'), 'ArrowDown');
        expect(document.activeElement).toBe(control('ignoreBlankLines'));
        pressKey(control('ignoreBlankLines'), 'ArrowUp');
        pressKey(control('ignoreCase'), 'ArrowUp');
        expect(document.activeElement).toBe(popover()!.querySelector('input[value="none"]'));
    });

    it('keeps each tab\'s rules in its own state, and closes a popover left open when another tab is drawn', () => {
        const other = createTextDiffViewState();
        render('Hello\n', 'hello\n');
        openRules();
        toggle('ignoreCase');

        render('Hello\n', 'hello\n', other);

        expect(popover()).toBeNull();
        expect(rulesButton().textContent).toBe('Compare rules');
        expect(position()).toBe('– / 1');
        expect(other.rules).toBe(DEFAULT_TEXT_COMPARE_RULES);

        render('Hello\n', 'hello\n');

        expect(rulesButton().textContent).toBe('Compare rules · 1');
        expect(position()).toBe('No changes');
        expect(openRules().querySelector<HTMLInputElement>('[data-rule="ignoreCase"] input')?.checked).toBe(true);
    });

    it('shows the real lines on each side, not the normalized ones', () => {
        render('Value  \n', 'value\n');
        openRules();
        toggle('ignoreCase');
        popover()!.querySelector<HTMLInputElement>('[data-rule="whitespace"] input[value="trailing"]')!.click();

        const originalText = container.querySelector('.text-diff-text[data-side="original"]')?.textContent;
        const modifiedText = container.querySelector('.text-diff-text[data-side="modified"]')?.textContent;
        expect(originalText).toBe('Value  ');
        expect(modifiedText).toBe('value');
        expect(container.querySelector('.text-diff-row [data-marker]')).toBeNull();
    });

    it('labels both sides with an Original and a Modified header over the side-by-side lines, with no Inline mode', () => {
        render('a\n', 'b\n');

        const headers = Array.from(container.querySelectorAll('.text-diff-panel > .aligned-headers .diff-side-header'));
        expect(headers.map((header) => header.querySelector('.diff-side-badge')?.textContent)).toEqual(['Original', 'Modified']);
        expect(headers[0]?.querySelector('.diff-side-name')?.textContent).toBe('a.ts');
        expect(container.querySelector('[data-mode], .view-tabs, .diff-sides-bar')).toBeNull();
        expect(container.textContent).not.toContain('Inline');
    });

    it('aligns both sides row for row, with hatched placeholders where a side has no line', () => {
        render('keep\nold one\nold two\nend\n', 'keep\nnew one\nend\nextra\n');

        const rows = Array.from(container.querySelectorAll<HTMLElement>('.text-diff-scroller .text-diff-row'));
        const cellText = (cell: HTMLElement): string => cell.dataset['placeholder'] === 'true'
            ? '·'
            : `${cell.dataset['marker'] ?? '='}:${cell.textContent}`;
        const describeRow = (row: HTMLElement): string => Array
            .from(row.querySelectorAll<HTMLElement>('.text-diff-text'), cellText)
            .join(' | ');
        expect(rows.map(describeRow)).toEqual([
            '=:keep | =:keep',
            'del:old one | add:new one',
            'del:old two | ·',
            '=:end | =:end',
            '· | add:extra',
        ]);
        expect(rows.map((row) => row.dataset['only'] ?? '')).toEqual(['', '', 'original', '', 'modified']);
        expect(rows.every((row) => row.children.length === 4)).toBe(true);
        expect(Array.from(rows[2]!.querySelectorAll('.text-diff-number'), (cell) => cell.textContent)).toEqual(['3', '']);
    });

    it('groups each change in a hunk the bar steps to from top to bottom, and keeps to the chosen view', () => {
        const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        render('a\nb\nc\nd\n', 'a\nB\nc\nd\nadded\n');
        const hunks = Array.from(container.querySelectorAll<HTMLElement>('.text-diff-hunk'));

        expect(hunks.map((hunk) => hunk.dataset['sides'])).toEqual(['both', 'modified']);
        expect(position()).toBe('– / 2');

        container.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();
        expect(position()).toBe('1 / 2');
        expect(hunks[0]?.dataset['flash']).toBe('true');
        expect(scrollIntoView).toHaveBeenCalled();

        pressKey(container.querySelector('.text-diff-scroller')!, 'n');
        expect(position()).toBe('2 / 2');

        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="before"]')!.click();
        expect(container.querySelector('.text-diff-panel')?.getAttribute('data-diff-view')).toBe('before');
        expect(state.navigation.view).toBe('before');
        expect(position()).toBe('– / 1');
    });

    it('names clipboard and pasted sides instead of a file', () => {
        renderTextDiffView(container, {
            original: { label: 'Clipboard', source: 'clipboard', text: 'a' },
            modified: { label: 'Pasted text', source: 'paste', text: 'b' },
            state,
            callbacks,
        });

        const names = Array.from(container.querySelectorAll('.diff-side-name')).map((name) => name.textContent);
        expect(names).toEqual(['Clipboard', 'Pasted text']);
    });

    it('keeps rules, the bar view, the current change and the computed result in the tab state across renders', () => {
        render('A\nb\n', 'A\nB\n');
        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="after"]')!.click();
        container.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();
        openRules();
        toggle('trimLines');
        const document = state.cache?.document;

        closeDiffPopover();
        container.replaceChildren();
        render('A\nb\n', 'A\nB\n');

        expect(state.rules.trimLines).toBe(true);
        expect(state.cache?.document).toBe(document);
        expect(container.querySelector('.text-diff-panel')?.getAttribute('data-diff-view')).toBe('after');
        expect(position()).toBe('1 / 1');
    });

    it('shows the text of the chosen side and a drop zone for the missing one, with no bar', () => {
        renderTextDiffView(container, { original: fileSide('a.ts', 'only\n'), modified: null, state, callbacks });

        expect(container.querySelector('[data-pane="original"] .diff-side-text')?.textContent).toBe('only\n');
        expect(container.querySelector('[data-pane="modified"] .editor-placeholder')?.textContent).toContain('Pick the modified file');
        expect(container.querySelector('.diff-bar')).toBeNull();
    });

    it('fills an empty side from the drop zone', () => {
        const filled: Array<[string, DiffSide]> = [];
        renderTextDiffView(container, {
            original: fileSide('a.ts', 'a'),
            modified: null,
            state,
            callbacks: {
                ...callbacks,
                onSetSide: (side, target) => filled.push([side, target]),
                targetDropZone: (onTarget) => {
                    const zone = document.createElement('button');
                    zone.className = 'fake-zone';
                    zone.addEventListener('click', () => onTarget({ label: 'Clipboard', source: 'clipboard', text: 'x' }));

                    return zone;
                },
            },
        });

        container.querySelector<HTMLButtonElement>('[data-pane="modified"] .fake-zone')!.click();

        expect(filled[0]?.[0]).toBe('modified');
        expect(filled[0]?.[1].source).toBe('clipboard');
    });

    it('asks the tab to swap its sides', () => {
        let swapped = 0;
        renderTextDiffView(container, { original: fileSide('a.ts', 'a'), modified: fileSide('b.ts', 'b'), state, callbacks: { ...callbacks, onSwap: () => { swapped += 1; } } });

        container.querySelector<HTMLButtonElement>('[data-action="swap"]')!.click();

        expect(swapped).toBe(1);
    });

    it('builds the diff document once, again once the rules or a side change, and not before both sides are chosen', () => {
        const input = { original: fileSide('a.ts', 'a\n'), modified: fileSide('b.ts', 'b\n'), state };
        const document = currentTextDiffDocument(input);

        expect(currentTextDiffDocument(input)).toBe(document);
        expect(document?.kind).toBe('text');
        expect(document?.modified).toEqual({ name: 'b.ts', source: 'file', path: 'b.ts' });

        state.rules = { ...DEFAULT_TEXT_COMPARE_RULES, ignoreCase: true };
        expect(currentTextDiffDocument(input)?.options.ignoreCase).toBe(true);
        expect(currentTextDiffDocument({ ...input, modified: { label: 'Pasted text', source: 'paste', text: 'b\n', pastedAt: 1 } })?.modified)
            .toEqual({ name: 'Pasted text', source: 'pasted' });
        expect(currentTextDiffDocument({ ...input, modified: null })).toBeNull();
    });
});
