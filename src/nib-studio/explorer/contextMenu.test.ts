import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showContextMenu, type ContextMenuGroup } from './contextMenu.js';

function menuElement(): HTMLElement {
    return document.querySelector('.context-menu') as HTMLElement;
}

function menuItems(): HTMLElement[] {
    return [...menuElement().querySelectorAll<HTMLElement>('.context-menu-item')];
}

function rightClick(clientX = 10, clientY = 20): MouseEvent {
    return new MouseEvent('contextmenu', { clientX, clientY, cancelable: true, bubbles: true });
}

describe('showContextMenu', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);

            return 0;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders one menu item per entry with separators between groups', () => {
        const groups: ContextMenuGroup[] = [
            { items: [{ label: 'Open', onSelect: () => {} }, { label: 'Rename', shortcut: 'F2', onSelect: () => {} }] },
            { items: [{ label: 'Delete', tone: 'fail', onSelect: () => {} }] },
        ];

        showContextMenu(rightClick(), groups);

        const menu = menuElement();
        expect(menu.getAttribute('role')).toBe('menu');
        expect(menu.dataset.open).toBe('true');
        expect(menuItems().map((item) => item.firstElementChild?.textContent)).toEqual(['Open', 'Rename', 'Delete']);
        expect(menu.querySelectorAll('.context-menu-separator')).toHaveLength(1);
        expect(menuItems()[1]?.querySelector('.context-menu-shortcut')?.textContent).toBe('F2');
        expect(menuItems()[2]?.dataset.tone).toBe('fail');
        expect(menuItems().every((item) => item.getAttribute('role') === 'menuitem')).toBe(true);
    });

    it('prevents the browser menu and reuses one element across openings', () => {
        const event = rightClick();
        showContextMenu(event, [{ items: [{ label: 'First', onSelect: () => {} }] }]);
        showContextMenu(rightClick(), [{ items: [{ label: 'Second', onSelect: () => {} }] }]);

        expect(event.defaultPrevented).toBe(true);
        expect(document.querySelectorAll('.context-menu')).toHaveLength(1);
        expect(menuItems().map((item) => item.textContent)).toEqual(['Second']);
    });

    it('runs the selected item and closes the menu', () => {
        const onSelect = vi.fn();
        showContextMenu(rightClick(), [{ items: [{ label: 'Open', onSelect }] }]);

        menuItems()[0]?.click();

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(menuElement().dataset.open).toBe('false');
    });

    it('keeps the focus where it was when an item is pressed, so a dialog it opens can give it back', () => {
        showContextMenu(rightClick(), [{ items: [{ label: 'Rename', onSelect: () => {} }] }]);
        const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

        menuItems()[0]?.dispatchEvent(press);

        expect(press.defaultPrevented).toBe(true);
    });

    it('leaves out items that do not apply, with the separator of a group left empty', () => {
        showContextMenu(rightClick(), [
            { items: [{ label: 'Open', onSelect: () => {} }, { label: 'Paste', disabled: true, onSelect: () => {} }] },
            { items: [{ label: 'Format JSON', disabled: true, onSelect: () => {} }] },
            { items: [{ label: 'Refresh', onSelect: () => {} }] },
        ]);

        expect(menuItems().map((item) => item.textContent)).toEqual(['Open', 'Refresh']);
        expect(menuElement().querySelectorAll('.context-menu-separator')).toHaveLength(1);
    });

    it('shows a header as a line that cannot be picked', () => {
        const onSelect = vi.fn();
        showContextMenu(rightClick(), [{ items: [{ label: 'Compare with…', header: true, onSelect }, { label: '  Compare with clipboard', onSelect: () => {} }] }]);

        expect(menuItems()[0]?.dataset.kind).toBe('header');
        expect(menuItems()[0]?.getAttribute('role')).toBe('presentation');
        menuItems()[0]?.click();

        expect(onSelect).not.toHaveBeenCalled();
        expect(menuElement().dataset.open).toBe('true');
    });

    it('does not open when no item applies', () => {
        showContextMenu(rightClick(), [{ items: [{ label: 'Paste', disabled: true, onSelect: () => {} }] }]);

        expect(menuElement().dataset.open).toBe('false');
        expect(menuItems()).toHaveLength(0);
    });

    it('closes on Escape and on a click outside the menu', () => {
        showContextMenu(rightClick(), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(menuElement().dataset.open).toBe('false');

        showContextMenu(rightClick(), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);
        document.body.click();
        expect(menuElement().dataset.open).toBe('false');
    });

    it('stays open when the opening left click bubbles to the document', () => {
        const button = document.createElement('button');
        document.body.append(button);
        button.addEventListener('click', (event) => {
            showContextMenu(event, [{ items: [{ label: 'Open', onSelect: () => {} }] }]);
        });

        button.click();

        expect(menuElement().dataset.open).toBe('true');
        button.remove();
    });

    it('places the menu at the pointer and makes it visible', () => {
        showContextMenu(rightClick(40, 50), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);

        expect(menuElement().style.left).toBe('40px');
        expect(menuElement().style.top).toBe('50px');
        expect(menuElement().style.visibility).toBe('visible');
    });

    it('keeps the menu at least 8px inside the viewport edge', () => {
        showContextMenu(rightClick(0, 0), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);

        expect(menuElement().style.left).toBe('8px');
        expect(menuElement().style.top).toBe('8px');
    });

    describe('near the viewport edge', () => {
        const MENU_WIDTH = 200;
        const MENU_HEIGHT = 120;

        beforeEach(() => {
            vi.stubGlobal('innerWidth', 800);
            vi.stubGlobal('innerHeight', 600);
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
                { x: 0, y: 0, left: 0, top: 0, right: MENU_WIDTH, bottom: MENU_HEIGHT, width: MENU_WIDTH, height: MENU_HEIGHT, toJSON: () => ({}) } as DOMRect,
            );
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('opens to the left of a pointer near the right edge', () => {
            showContextMenu(rightClick(780, 100), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);

            expect(menuElement().style.left).toBe(`${800 - MENU_WIDTH - 8}px`);
            expect(menuElement().style.top).toBe('100px');
        });

        it('opens above a pointer near the bottom edge', () => {
            showContextMenu(rightClick(100, 590), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);

            expect(menuElement().style.left).toBe('100px');
            expect(menuElement().style.top).toBe(`${600 - MENU_HEIGHT - 8}px`);
        });

        it('pins the menu to the top-left margin when it is larger than the viewport', () => {
            vi.stubGlobal('innerWidth', 150);
            vi.stubGlobal('innerHeight', 100);

            showContextMenu(rightClick(120, 80), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);

            expect(menuElement().style.left).toBe('8px');
            expect(menuElement().style.top).toBe('8px');
        });

        it('stays hidden until it has been measured and placed', () => {
            const frames: FrameRequestCallback[] = [];
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));

            showContextMenu(rightClick(780, 590), [{ items: [{ label: 'Open', onSelect: () => {} }] }]);

            expect(menuElement().style.visibility).toBe('hidden');

            frames.forEach((callback) => callback(0));

            expect(menuElement().style.visibility).toBe('visible');
            expect(menuElement().style.left).toBe(`${800 - MENU_WIDTH - 8}px`);
            expect(menuElement().style.top).toBe(`${600 - MENU_HEIGHT - 8}px`);
        });
    });
});
