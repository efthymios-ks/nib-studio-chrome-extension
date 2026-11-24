import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pressKey } from '../testing/testHelpers.js';
import { createFindBox, type FindBox, type FindBoxOptions } from './findBox.js';

let scope: HTMLElement;
let boxes: FindBox[] = [];

function mount(overrides: Partial<FindBoxOptions> = {}): { box: FindBox; onQuery: ReturnType<typeof vi.fn>; onStep: ReturnType<typeof vi.fn> } {
    const onQuery = vi.fn();
    const onStep = vi.fn();
    const box = createFindBox({ shortcutScope: scope, onQuery, onStep, ...overrides });
    scope.append(box.element);
    boxes.push(box);

    return { box, onQuery, onStep };
}

function input(): HTMLInputElement {
    return scope.querySelector('.document-find-input') as HTMLInputElement;
}

function button(action: string): HTMLButtonElement {
    return scope.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;
}

beforeEach(() => {
    scope = document.createElement('div');
    document.body.append(scope);
    boxes = [];
});

afterEach(() => {
    for (const box of boxes) {
        box.destroy();
    }

    scope.remove();
});

describe('createFindBox', () => {
    it('lays out the box, the arrows and the count like the Word preview, off until enabled', () => {
        mount();

        expect(input().placeholder).toBe('Find in document…');
        expect(input().getAttribute('aria-label')).toBe('Find in document');
        expect(input().disabled).toBe(true);
        expect(button('find-previous').textContent).toBe('↑');
        expect(button('find-previous').title).toBe('Previous match (Shift+Enter)');
        expect(button('find-next').textContent).toBe('↓');
        expect(button('find-next').title).toBe('Next match (Enter)');
        expect(scope.querySelector('.document-find')?.getAttribute('role')).toBe('search');
        expect(scope.querySelector('.document-find-count')?.getAttribute('aria-live')).toBe('polite');
    });

    it('reports the query as it is typed, and steps with Enter, Shift+Enter and the arrows', () => {
        const { box, onQuery, onStep } = mount();
        box.setEnabled(true);
        box.show({ text: '1 of 2', state: 'found' }, true);
        input().value = 'tra';
        input().dispatchEvent(new Event('input'));
        pressKey(input(), 'Enter');
        pressKey(input(), 'Enter', { shiftKey: true });
        button('find-previous').click();
        button('find-next').click();

        expect(onQuery).toHaveBeenCalledWith('tra');
        expect(onStep.mock.calls).toEqual([[1], [-1], [-1], [1]]);
    });

    it('empties the box with Escape, and leaves Escape alone once it is empty', () => {
        const { box, onQuery } = mount();
        box.setEnabled(true);
        box.setQuery('word');

        expect(pressKey(input(), 'Escape').defaultPrevented).toBe(true);
        expect(input().value).toBe('');
        expect(onQuery).toHaveBeenCalledWith('');
        expect(pressKey(input(), 'Escape').defaultPrevented).toBe(false);
    });

    it('shows the count and its state, and turns the arrows on only with matches', () => {
        const { box } = mount();
        box.setEnabled(true);
        box.show({ text: 'No matches', state: 'none' }, false);

        expect(scope.querySelector('.document-find-count')?.textContent).toBe('No matches');
        expect(scope.querySelector<HTMLElement>('.document-find')?.dataset['state']).toBe('none');
        expect(button('find-next').disabled).toBe(true);
        box.show({ text: '2 of 5', state: 'found' }, true);

        expect(button('find-next').disabled).toBe(false);
        box.setEnabled(false);

        expect(button('find-next').disabled).toBe(true);
        expect(input().disabled).toBe(true);
    });

    it('takes Ctrl+F in its preview, only while it is on, and lets it go once destroyed', () => {
        const { box } = mount();
        const inside = document.createElement('button');
        scope.append(inside);

        expect(pressKey(inside, 'f', { ctrlKey: true }).defaultPrevented).toBe(false);
        box.setEnabled(true);
        box.setQuery('kept');
        const event = pressKey(inside, 'F', { ctrlKey: true });

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input());
        expect(pressKey(inside, 'f', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
        scope.hidden = true;

        expect(pressKey(inside, 'f', { ctrlKey: true }).defaultPrevented).toBe(false);
        scope.hidden = false;
        box.destroy();

        expect(pressKey(inside, 'f', { ctrlKey: true }).defaultPrevented).toBe(false);
    });
});
