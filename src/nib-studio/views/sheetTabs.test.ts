import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSheetTabs, type SheetTabsHandle } from './sheetTabs.js';

const SHEETS = [
    { name: 'Q1', hidden: false },
    { name: 'Q2', hidden: false },
    { name: 'North Region', hidden: false },
    { name: 'Rates', hidden: true },
];

function tabs(handle: SheetTabsHandle): HTMLElement[] {
    return [...handle.element.querySelectorAll<HTMLElement>('.sheet-tab')];
}

function scrollButton(handle: SheetTabsHandle, direction: 'back' | 'forward'): HTMLButtonElement {
    return handle.element.querySelector<HTMLButtonElement>(`.sheet-tabs-scroll[data-direction="${direction}"]`) as HTMLButtonElement;
}

function list(handle: SheetTabsHandle): HTMLElement {
    return handle.element.querySelector<HTMLElement>('.sheet-tabs-list') as HTMLElement;
}

// Gives the strip the sizes of a browser, which happy-dom doesn't lay out.
function layOut(element: HTMLElement, sizes: { scrollWidth: number; clientWidth: number; scrollLeft?: number }): void {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: sizes.scrollWidth });
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: sizes.clientWidth });
    element.scrollLeft = sizes.scrollLeft ?? 0;
}

describe('createSheetTabs', () => {
    let host: HTMLElement;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
    });

    afterEach(() => {
        host.remove();
    });

    function create(sheets = SHEETS): { handle: SheetTabsHandle; onSelect: ReturnType<typeof vi.fn>; onToggleHidden: ReturnType<typeof vi.fn> } {
        const onSelect = vi.fn();
        const onToggleHidden = vi.fn();
        const handle = createSheetTabs({ sheets, onSelect, onToggleHidden });
        host.append(handle.element);
        handle.update(0, new Set());

        return { handle, onSelect, onToggleHidden };
    }

    it('lays out one tab per sheet in order, the hidden ones out of sight, the active one selected', () => {
        const { handle } = create();

        expect(tabs(handle).map((tab) => [tab.textContent, tab.hidden, tab.getAttribute('aria-selected'), tab.tabIndex])).toEqual([
            ['Q1', false, 'true', 0],
            ['Q2', false, 'false', -1],
            ['North Region', false, 'false', -1],
            ['Rates', true, 'false', -1],
        ]);
        expect(tabs(handle)[0]?.dataset['active']).toBe('true');
        expect(tabs(handle).every((tab) => tab.getAttribute('role') === 'tab')).toBe(true);
    });

    it('moves the highlight and shows a hidden sheet chosen to show', () => {
        const { handle } = create();

        handle.update(3, new Set([3]));

        expect(tabs(handle).map((tab) => tab.hidden)).toEqual([false, false, false, false]);
        expect(tabs(handle).map((tab) => tab.dataset['active'] ?? '')).toEqual(['', '', '', 'true']);
        expect(tabs(handle)[3]?.dataset['hiddenSheet']).toBe('true');
    });

    it('tells which tab was clicked', () => {
        const { handle, onSelect } = create();

        tabs(handle)[2]?.click();

        expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('steps with the arrows, wrapping round, and jumps with Home and End, over the tabs on the strip', () => {
        const { handle, onSelect } = create();
        const press = (key: string): void => {
            list(handle).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        };

        press('ArrowLeft');
        expect(onSelect).toHaveBeenLastCalledWith(2);

        press('End');
        expect(onSelect).toHaveBeenLastCalledWith(2);

        press('ArrowRight');
        expect(onSelect).toHaveBeenLastCalledWith(1);

        handle.update(2, new Set([3]));
        press('ArrowRight');
        expect(onSelect).toHaveBeenLastCalledWith(3);

        handle.update(1, new Set());
        press('Home');
        expect(onSelect).toHaveBeenLastCalledWith(0);
        expect(onSelect).toHaveBeenCalledTimes(5);
    });

    it('focuses the active tab', () => {
        const { handle } = create();
        handle.update(1, new Set());

        handle.focusActive();

        expect(document.activeElement).toBe(tabs(handle)[1]);
    });

    it('lists the hidden sheets in a menu that shows them or puts them away', () => {
        const { handle, onToggleHidden } = create();
        const hiddenButton = handle.element.querySelector<HTMLButtonElement>('.sheet-tabs-hidden') as HTMLButtonElement;
        const items = (): string[] => [...document.querySelectorAll('.context-menu[data-open="true"] .context-menu-item')].map((item) => item.textContent ?? '');

        hiddenButton.click();

        expect(items()).toEqual(['1 hidden sheet', 'Show Rates']);
        ([...document.querySelectorAll<HTMLElement>('.context-menu-item')].at(-1) as HTMLElement).click();
        expect(onToggleHidden).toHaveBeenCalledWith(3);

        handle.update(3, new Set([3]));
        hiddenButton.click();

        expect(items()).toEqual(['1 hidden sheet', 'Hide Rates again']);
    });

    it('has no hidden-sheets button when every sheet shows', () => {
        const { handle } = create(SHEETS.slice(0, 2));

        expect(handle.element.querySelector<HTMLButtonElement>('.sheet-tabs-hidden')?.hidden).toBe(true);
    });

    it('shows the scroll arrows only when the tabs don\'t fit, each usable towards the tabs out of sight', () => {
        const { handle } = create();

        list(handle).dispatchEvent(new Event('scroll'));
        expect([scrollButton(handle, 'back').hidden, scrollButton(handle, 'forward').hidden]).toEqual([true, true]);

        layOut(list(handle), { scrollWidth: 600, clientWidth: 200 });
        list(handle).dispatchEvent(new Event('scroll'));

        expect([scrollButton(handle, 'back').hidden, scrollButton(handle, 'forward').hidden]).toEqual([false, false]);
        expect([scrollButton(handle, 'back').disabled, scrollButton(handle, 'forward').disabled]).toEqual([true, false]);

        layOut(list(handle), { scrollWidth: 600, clientWidth: 200, scrollLeft: 400 });
        list(handle).dispatchEvent(new Event('scroll'));

        expect([scrollButton(handle, 'back').disabled, scrollButton(handle, 'forward').disabled]).toEqual([false, true]);
    });

    it('scrolls the tabs sideways with the arrows', () => {
        const { handle } = create();
        layOut(list(handle), { scrollWidth: 600, clientWidth: 200 });
        const scrollBy = vi.fn();
        list(handle).scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];

        scrollButton(handle, 'forward').click();
        scrollButton(handle, 'back').click();

        expect(scrollBy.mock.calls.map((call) => (call[0] as ScrollToOptions).left)).toEqual([160, -160]);
    });

    it('scrolls the active tab into view', () => {
        const { handle } = create();
        layOut(list(handle), { scrollWidth: 600, clientWidth: 200 });
        const last = tabs(handle)[2] as HTMLElement;
        Object.defineProperty(last, 'offsetLeft', { configurable: true, value: 380 });
        Object.defineProperty(last, 'offsetWidth', { configurable: true, value: 90 });

        handle.update(2, new Set());

        expect(list(handle).scrollLeft).toBe(270);
    });
});
