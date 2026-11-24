import { afterEach, describe, expect, it } from 'vitest';
import { createExplorerDrawer, type ExplorerDrawer } from './explorerDrawer.js';

interface FakeMedia {
    matches: boolean;
    listeners: Array<() => void>;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
}

let drawer: ExplorerDrawer | null = null;

afterEach(() => {
    drawer?.dispose();
    drawer = null;
    document.body.replaceChildren();
});

function fakeMedia(matches: boolean): FakeMedia {
    const media: FakeMedia = {
        matches,
        listeners: [],
        addEventListener: (_type, listener) => media.listeners.push(listener),
        removeEventListener: (_type, listener) => {
            media.listeners = media.listeners.filter((item) => item !== listener);
        },
    };

    return media;
}

function setup(narrow: boolean): { media: FakeMedia; sidebar: HTMLElement; backdrop: HTMLElement; opener: HTMLElement } {
    const sidebar = document.createElement('aside');
    sidebar.id = 'studio-explorer';
    const tree = document.createElement('div');
    tree.className = 'tree';
    tree.tabIndex = 0;
    sidebar.append(tree);
    const backdrop = document.createElement('div');
    const opener = document.createElement('div');
    document.body.append(sidebar, backdrop, opener);
    const media = fakeMedia(narrow);
    drawer = createExplorerDrawer({ sidebar, backdrop, opener, media: media as unknown as MediaQueryList });

    return { media, sidebar, backdrop, opener };
}

describe('createExplorerDrawer', () => {
    it('opens from the reopen strip in the narrow layout', () => {
        const { opener } = setup(true);

        opener.click();

        expect(document.body.dataset['explorerDrawer']).toBe('open');
        expect(opener.getAttribute('aria-expanded')).toBe('true');
        expect(opener.getAttribute('aria-controls')).toBe('studio-explorer');
    });

    it('ignores the strip on wide screens', () => {
        const { opener } = setup(false);

        opener.click();

        expect(drawer?.isOpen()).toBe(false);
    });

    it('closes when the backdrop is tapped', () => {
        const { backdrop } = setup(true);
        drawer?.open();

        backdrop.click();

        expect(drawer?.isOpen()).toBe(false);
        expect(document.body.dataset['explorerDrawer']).toBeUndefined();
    });

    it('closes on Escape', () => {
        setup(true);
        drawer?.open();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(drawer?.isOpen()).toBe(false);
    });

    it('leaves Escape to an open dialog', () => {
        setup(true);
        drawer?.open();
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.dataset['open'] = 'true';
        document.body.append(modal);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(drawer?.isOpen()).toBe(true);
    });

    it('closes when the window grows past the narrow breakpoint', () => {
        const { media } = setup(true);
        drawer?.open();

        media.matches = false;
        media.listeners.forEach((listener) => listener());

        expect(drawer?.isOpen()).toBe(false);
    });

    it('toggles open and closed', () => {
        setup(true);

        drawer?.toggle();
        expect(drawer?.isOpen()).toBe(true);

        drawer?.toggle();
        expect(drawer?.isOpen()).toBe(false);
    });
});
