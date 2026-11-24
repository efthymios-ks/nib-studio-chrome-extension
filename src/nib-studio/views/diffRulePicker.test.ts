import { afterEach, describe, expect, it } from 'vitest';
import { createFieldPicker, showRuleDialogAsync, sortFieldNames } from './diffRulePicker.js';

function order(element: HTMLElement): string[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.rule-picker-item')).map((item) => item.dataset['field'] ?? '');
}

function check(element: HTMLElement, field: string): void {
    const checkbox = element.querySelector<HTMLInputElement>(`input[value="${field}"]`);

    if (checkbox == null) {
        throw new Error(`no checkbox for ${field}`);
    }

    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
}

function press(element: HTMLElement, field: string, action: string): void {
    element.querySelector<HTMLButtonElement>(`.rule-picker-item[data-field="${field}"] [data-action="${action}"]`)?.click();
}

describe('sortFieldNames', () => {
    it('sorts by name regardless of case', () => {
        expect(sortFieldNames(['b', 'A', 'c', '@id'])).toEqual(['@id', 'A', 'b', 'c']);
    });
});

describe('createFieldPicker', () => {
    it('lists every field as a checkbox in name order, with the picked ones checked', () => {
        const picker = createFieldPicker({ title: 'Match', hint: '', fields: ['sku', 'id', 'Name'], selected: ['sku'] });
        const boxes = Array.from(picker.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

        expect(boxes.map((box) => box.value)).toEqual(['id', 'Name', 'sku']);
        expect(boxes.filter((box) => box.checked).map((box) => box.value)).toEqual(['sku']);
    });

    it('appends checked fields in the order they are picked', () => {
        const picker = createFieldPicker({ title: 'Match', hint: '', fields: ['a', 'b', 'c'], selected: [] });

        check(picker.element, 'c');
        check(picker.element, 'a');

        expect(picker.getSelected()).toEqual(['c', 'a']);
        expect(order(picker.element)).toEqual(['c', 'a']);
    });

    it('reorders with up and down and removes a field', () => {
        const picker = createFieldPicker({ title: 'Sort', hint: '', fields: ['a', 'b', 'c'], selected: ['a', 'b', 'c'] });

        press(picker.element, 'c', 'up');
        expect(picker.getSelected()).toEqual(['a', 'c', 'b']);

        press(picker.element, 'a', 'down');
        expect(picker.getSelected()).toEqual(['c', 'a', 'b']);

        press(picker.element, 'a', 'remove');
        expect(picker.getSelected()).toEqual(['c', 'b']);
        expect(picker.element.querySelector<HTMLInputElement>('input[value="a"]')?.checked).toBe(false);
    });

    it('disables moving the first field up and the last one down', () => {
        const picker = createFieldPicker({ title: 'Sort', hint: '', fields: ['a', 'b'], selected: ['a', 'b'] });

        expect(picker.element.querySelector<HTMLButtonElement>('[data-field="a"] [data-action="up"]')?.disabled).toBe(true);
        expect(picker.element.querySelector<HTMLButtonElement>('[data-field="b"] [data-action="down"]')?.disabled).toBe(true);
    });

    it('unchecking removes a field from the order', () => {
        const picker = createFieldPicker({ title: 'Match', hint: '', fields: ['a', 'b'], selected: ['a', 'b'] });

        check(picker.element, 'a');

        expect(picker.getSelected()).toEqual(['b']);
    });
});

describe('showRuleDialogAsync', () => {
    afterEach(() => {
        document.querySelector('.modal-backdrop')?.remove();
    });

    function footerButton(label: string): HTMLButtonElement {
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-footer button'))
            .find((candidate) => candidate.textContent === label);

        if (button == null) {
            throw new Error(`no ${label} button`);
        }

        return button;
    }

    it('returns the picked match and sort fields in order, both optional', async () => {
        const pending = showRuleDialogAsync({ target: 'array', path: '$.items[*]', fields: ['id', 'sku'], matchBy: [], sortBy: [], existing: false });
        const [matchSection, sortSection] = Array.from(document.querySelectorAll<HTMLElement>('.rule-picker'));

        check(sortSection as HTMLElement, 'sku');
        check(sortSection as HTMLElement, 'id');
        footerButton('Save rule').click();

        expect(matchSection).toBeDefined();
        await expect(pending).resolves.toEqual({ action: 'save', matchBy: [], sortBy: ['sku', 'id'] });
    });

    it('offers Remove only for an existing rule', async () => {
        const pending = showRuleDialogAsync({ target: 'element', path: '/root/line', fields: ['@id'], matchBy: ['@id'], sortBy: [], existing: true });

        footerButton('Remove').click();

        await expect(pending).resolves.toEqual({ action: 'remove' });
    });
});
