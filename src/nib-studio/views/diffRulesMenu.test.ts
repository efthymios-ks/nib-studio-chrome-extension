import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDiffPopover } from './diffPopover.js';
import { buildRulesMenu, type DiffRule } from './diffRulesMenu.js';
import { pressKey } from '../testing/testHelpers.js';

const RULES: ReadonlyArray<DiffRule> = [
    { path: '$.items[*]', matchBy: ['id'], sortBy: [] },
    { path: '$.tags[*]', sortBy: ['name'] },
];

describe('buildRulesMenu', () => {
    afterEach(() => {
        closeDiffPopover();
        document.body.replaceChildren();
    });

    function popover(): HTMLElement | null {
        return document.querySelector<HTMLElement>('.diff-rules-popover');
    }

    it('shows nothing without rules', () => {
        expect(buildRulesMenu({ target: 'array', rules: [], onEdit: vi.fn(), onRemove: vi.fn() })).toBeNull();
    });

    it('counts the rules and lists each with its fields in a popover', () => {
        const button = buildRulesMenu({ target: 'array', rules: RULES, onEdit: vi.fn(), onRemove: vi.fn() })!;
        document.body.append(button);

        expect(button.textContent).toBe('Rules (2)');
        expect(button.getAttribute('aria-expanded')).toBe('false');

        button.click();

        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popover()?.getAttribute('aria-label')).toBe('Array rules');
        expect(Array.from(popover()!.querySelectorAll('.rule-summary-path'), (path) => path.textContent)).toEqual(['$.items[*]', '$.tags[*]']);
        expect(popover()?.querySelector('.rule-summary')?.textContent).toContain('id');

        button.click();
        expect(popover()).toBeNull();
    });

    it('edits or removes a rule from the popover, closing it', () => {
        const onEdit = vi.fn();
        const onRemove = vi.fn();
        const button = buildRulesMenu({ target: 'element', rules: RULES, onEdit, onRemove })!;
        document.body.append(button);

        button.click();
        popover()!.querySelector<HTMLButtonElement>('.rule-summary[data-path="$.tags[*]"] [data-action="edit"]')!.click();
        expect(onEdit).toHaveBeenCalledWith(RULES[1]);
        expect(popover()).toBeNull();

        button.click();
        expect(popover()?.getAttribute('aria-label')).toBe('Element rules');
        popover()!.querySelector<HTMLButtonElement>('[data-action="remove"]')!.click();
        expect(onRemove).toHaveBeenCalledWith(RULES[0]);
        expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes a popover left open when the diff draws its menu again', () => {
        const onRemove = vi.fn();
        const first = buildRulesMenu({ target: 'array', rules: RULES, onEdit: vi.fn(), onRemove })!;
        document.body.append(first);
        first.click();

        buildRulesMenu({ target: 'array', rules: RULES, onEdit: vi.fn(), onRemove: vi.fn() });

        expect(popover()).toBeNull();
        expect(first.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on Escape, with focus back on the button, and on a click elsewhere', () => {
        const button = buildRulesMenu({ target: 'array', rules: RULES, onEdit: vi.fn(), onRemove: vi.fn() })!;
        document.body.append(button);

        button.click();
        expect(document.activeElement).toBe(popover()?.querySelector('[data-action="edit"]'));
        pressKey(document.activeElement!, 'Escape');
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(button);

        button.click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(popover()).toBeNull();
    });
});
