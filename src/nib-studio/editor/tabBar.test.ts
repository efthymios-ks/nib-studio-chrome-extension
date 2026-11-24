import { describe, expect, it, vi } from 'vitest';
import { createDiffTab } from '../app/diffTabs.js';
import type { OpenTab } from '../app/store.js';
import { DIFF_TAB_GLYPH, renderTabBar, type TabBarCallbacks } from './tabBar.js';
import { openFileFixture } from '../testing/testHelpers.js';

function callbacks(patch: Partial<TabBarCallbacks> = {}): TabBarCallbacks {
    return { onActivate: vi.fn(), onClose: vi.fn(), ...patch };
}

function tabs(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.tab')];
}

describe('renderTabBar', () => {
    it('renders one tab per open tab with name, tooltip and close label', () => {
        const container = document.createElement('div');
        renderTabBar(container, [openFileFixture('docs/a.json'), openFileFixture('b.md')], null, callbacks());
        const [first, second] = tabs(container);

        expect(tabs(container)).toHaveLength(2);
        expect(first?.dataset['path']).toBe('docs/a.json');
        expect(first?.getAttribute('title')).toBe('docs/a.json');
        expect(first?.querySelector('.tab-name')?.textContent).toBe('a.json');
        expect(first?.querySelector('.tab-close')?.getAttribute('aria-label')).toBe('Close a.json');
        expect(first?.querySelector<HTMLElement>('.tab-icon')?.dataset['type']).toBeTruthy();
        expect(second?.querySelector('.tab-name')?.textContent).toBe('b.md');
    });

    it('marks active, dirty and preview tabs', () => {
        const container = document.createElement('div');
        renderTabBar(container, [
            openFileFixture('a.json', '', { dirty: true }),
            openFileFixture('b.json', '', { preview: true }),
        ], 'b.json', callbacks());
        const [dirty, preview] = tabs(container);

        expect(dirty?.dataset['dirty']).toBe('true');
        expect(dirty?.dataset['active']).toBeUndefined();
        expect(dirty?.dataset['preview']).toBeUndefined();
        expect(preview?.dataset['active']).toBe('true');
        expect(preview?.dataset['preview']).toBe('true');
        expect(preview?.dataset['dirty']).toBeUndefined();
    });

    it('renders diff tabs with the compare glyph and kind', () => {
        const container = document.createElement('div');
        const diff = createDiffTab(
            { label: 'a.json', path: 'a.json', source: 'file' },
            { label: 'b.json', path: 'b.json', source: 'file' },
        );
        renderTabBar(container, [diff], diff.id, callbacks());
        const [tab] = tabs(container);

        expect(tab?.dataset['kind']).toBe('diff');
        expect(tab?.dataset['path']).toBe(diff.id);
        expect(tab?.dataset['active']).toBe('true');
        expect(tab?.querySelector('.tab-icon')?.textContent).toBe(DIFF_TAB_GLYPH);
        expect(tab?.querySelector<HTMLElement>('.tab-icon')?.dataset['type']).toBe('diff');
        expect(tab?.querySelector('.tab-name')?.textContent).toContain('a.json');
        expect(tab?.getAttribute('title')).toContain('b.json');
    });

    it('activates on click and closes without activating', () => {
        const container = document.createElement('div');
        const handlers = callbacks();
        renderTabBar(container, [openFileFixture('a.json')], null, handlers);
        const [tab] = tabs(container);
        tab?.click();

        expect(handlers.onActivate).toHaveBeenCalledWith('a.json');

        tab?.querySelector<HTMLButtonElement>('.tab-close')?.click();

        expect(handlers.onClose).toHaveBeenCalledWith('a.json');
        expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    });

    it('promotes on double click', () => {
        const container = document.createElement('div');
        const onPromote = vi.fn();
        renderTabBar(container, [openFileFixture('a.json', '', { preview: true })], null, callbacks({ onPromote }));
        tabs(container)[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(onPromote).toHaveBeenCalledWith('a.json');
    });

    it('opens the context menu callback and prevents the native menu', () => {
        const container = document.createElement('div');
        const onContextMenu = vi.fn();
        renderTabBar(container, [openFileFixture('a.json')], null, callbacks({ onContextMenu }));
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        tabs(container)[0]?.dispatchEvent(event);

        expect(onContextMenu).toHaveBeenCalledWith(event, 'a.json');
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the native context menu alone without a callback', () => {
        const container = document.createElement('div');
        renderTabBar(container, [openFileFixture('a.json')], null, callbacks());
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        tabs(container)[0]?.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('shows a new compare button only when the callback is given', () => {
        const container = document.createElement('div');
        renderTabBar(container, [openFileFixture('a.json')], null, callbacks());

        expect(container.querySelector('.tab-new')).toBeNull();

        const onNewCompare = vi.fn();
        renderTabBar(container, [openFileFixture('a.json')], null, callbacks({ onNewCompare }));
        const button = container.querySelector<HTMLButtonElement>('.tab-new');

        expect(button?.dataset['action']).toBe('new-compare');
        expect(button?.getAttribute('aria-label')).toBe('New compare');
        expect(container.lastElementChild).toBe(button);

        button?.click();

        expect(onNewCompare).toHaveBeenCalledTimes(1);
        expect(onNewCompare.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
    });

    it('replaces previous tabs on re-render', () => {
        const container = document.createElement('div');
        const all: OpenTab[] = [openFileFixture('a.json'), openFileFixture('b.json')];
        renderTabBar(container, all, null, callbacks());
        renderTabBar(container, all.slice(1), null, callbacks());

        expect(tabs(container).map((tab) => tab.dataset['path'])).toEqual(['b.json']);
    });
});
