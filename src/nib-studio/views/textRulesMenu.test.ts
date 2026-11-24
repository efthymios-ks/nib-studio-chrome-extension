import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEXT_COMPARE_RULES, type TextCompareRules } from '../../common/text/textCompareRules.js';
import { flushAsync } from '../testing/testHelpers.js';
import { closeDiffPopover } from './diffPopover.js';
import { buildTextRulesMenu } from './textRulesMenu.js';

afterEach(() => {
    closeDiffPopover();
    document.body.replaceChildren();
});

function mount(rules: TextCompareRules = DEFAULT_TEXT_COMPARE_RULES): {
    button: HTMLButtonElement;
    state: { rules: TextCompareRules };
    onChange: ReturnType<typeof vi.fn>;
} {
    const state = { rules };
    const onChange = vi.fn();
    const button = buildTextRulesMenu({ state, onChange });
    document.body.append(button);

    return { button, state, onChange };
}

function popover(): HTMLElement {
    return document.querySelector<HTMLElement>('.diff-rules-popover')!;
}

async function answerDialogAsync(value: string): Promise<void> {
    document.querySelector<HTMLInputElement>('.modal input')!.value = value;
    document.querySelector<HTMLButtonElement>('.modal [data-role="primary"]')!.click();
    await flushAsync();
}

describe('buildTextRulesMenu', () => {
    it('reads Compare rules with no count while every rule is at its default', () => {
        const { button } = mount();

        expect(button.textContent).toBe('Compare rules');
        expect(button.querySelector('.diff-rules-count')).toBeNull();
        expect(button.getAttribute('title')).toBe('What counts as a difference');
    });

    it('applies a whitespace choice to the state and asks to compare again', () => {
        const { button, state, onChange } = mount();
        button.click();

        popover().querySelector<HTMLInputElement>('[data-rule="whitespace"] input[value="all"]')!.click();

        expect(state.rules).toEqual({ ...DEFAULT_TEXT_COMPARE_RULES, whitespace: 'all' });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(popover().querySelector<HTMLInputElement>('input[value="all"]')?.checked).toBe(true);
    });

    it('lists each ignore pattern with Edit and Remove, and Remove takes it out', () => {
        const { button, state, onChange } = mount({ ...DEFAULT_TEXT_COMPARE_RULES, ignorePatterns: ['^#', '^//'] });
        button.click();
        const rows = [...popover().querySelectorAll<HTMLElement>('.rule-summary')];

        expect(rows.map((row) => row.dataset['pattern'])).toEqual(['^#', '^//']);
        expect(popover().querySelector('.diff-rules-empty')).toBeNull();

        rows[0]!.querySelector<HTMLButtonElement>('[data-action="remove"]')!.click();

        expect(state.rules.ignorePatterns).toEqual(['^//']);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('merges a pattern edited into one already listed', async () => {
        const { button, state, onChange } = mount({ ...DEFAULT_TEXT_COMPARE_RULES, ignorePatterns: ['^#', '^//'] });
        button.click();

        popover().querySelector<HTMLButtonElement>('.rule-summary[data-pattern="^#"] [data-action="edit"]')!.click();
        expect(document.querySelector('.modal')?.textContent).toContain('Edit ignore pattern');
        await answerDialogAsync('^//');

        expect(state.rules.ignorePatterns).toEqual(['^//']);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('adds a pattern at the end of the list', async () => {
        const { button, state, onChange } = mount({ ...DEFAULT_TEXT_COMPARE_RULES, ignorePatterns: ['^#'] });
        button.click();

        popover().querySelector<HTMLButtonElement>('[data-action="add-pattern"]')!.click();
        expect(document.querySelector('.modal')?.textContent).toContain('Add ignore pattern');
        await answerDialogAsync('^\\s*$');

        expect(state.rules.ignorePatterns).toEqual(['^#', '^\\s*$']);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
