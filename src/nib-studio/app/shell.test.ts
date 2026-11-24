import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '../../common/fs/workspaceRegistry.js';
import { stubMatchMedia, type FakeMediaQuery } from '../testing/testHelpers.js';
import { NARROW_LAYOUT_QUERY } from './explorerDrawer.js';
import { buildShell, setActiveSurface, updateThemeToggle, type ShellCallbacks, type ShellElements } from './shell.js';

const LAYOUT_KEY = 'nib-studio/explorer-layout';

function workspace(id: string, name: string): WorkspaceRecord {
    return { id, name, handle: {} as FileSystemDirectoryHandle };
}

function createCallbacks(workspaces: ReadonlyArray<WorkspaceRecord> = [], activeId: string | null = null): ShellCallbacks {
    return {
        onSurfaceSwitch: vi.fn(),
        onThemeToggle: vi.fn(),
        onPickWorkspace: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onForgetWorkspace: vi.fn(),
        onCollapseAll: vi.fn(),
        onExpandAll: vi.fn(),
        getWorkspaces: () => workspaces,
        getActiveWorkspaceId: () => activeId,
    };
}

function byLabel(root: HTMLElement, label: string): HTMLButtonElement {
    const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

    if (button == null) {
        throw new Error(`No button labelled "${label}"`);
    }

    return button;
}

function menuLabels(): string[] {
    return [...document.querySelectorAll('.context-menu[data-open="true"] .context-menu-item')].map((item) => item.textContent ?? '');
}

function menuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('.context-menu-item')].find((candidate) => candidate.textContent === label);

    if (item == null) {
        throw new Error(`No menu item "${label}"`);
    }

    return item;
}

function resizer(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>('.split-resizer')!;
}

function mouse(target: EventTarget, type: string, clientX: number): void {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }));
}

function explorerWidth(): string {
    return document.documentElement.style.getPropertyValue('--explorer-width');
}

function storedLayout(): unknown {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
}

describe('buildShell', () => {
    let root: HTMLElement;
    let shell: ShellElements | null;

    beforeEach(() => {
        localStorage.clear();
        root = document.createElement('div');
        document.body.append(root);
        shell = null;
    });

    afterEach(() => {
        shell?.explorerDrawer.dispose();
        root.remove();
        delete document.body.dataset['explorerCollapsed'];
        delete document.body.dataset['resizing'];
        document.documentElement.style.removeProperty('--explorer-width');
        document.querySelector('.context-menu')?.setAttribute('data-open', 'false');
    });

    function build(callbacks: ShellCallbacks = createCallbacks()): ShellElements {
        shell = buildShell(root, callbacks);

        return shell;
    }

    it('builds the header, explorer, main area and status bar', () => {
        const elements = build();

        expect(root.children).toHaveLength(3);
        expect(elements.workspaceLabel.textContent).toBe('No workspace');
        expect(elements.explorer.getAttribute('role')).toBe('tree');
        expect(elements.sidebar.id).toBe('studio-explorer');
        expect(elements.main.id).toBe('studio-main');
        expect(elements.status.tagName).toBe('FOOTER');
        expect(elements.surfaceTabs.getAttribute('aria-label')).toBe('Surface');
    });

    it('renders one surface tab per surface and switches on click', () => {
        const callbacks = createCallbacks();
        const elements = build(callbacks);
        const surfaceTabs = [...elements.surfaceTabs.querySelectorAll<HTMLElement>('.app-tab')];

        expect(surfaceTabs.map((tab) => tab.dataset['surface'])).toEqual(['files', 'hash']);
        expect(surfaceTabs.map((tab) => tab.textContent)).toEqual(['Files', 'Hash & encode']);

        surfaceTabs[1]?.click();

        expect(callbacks.onSurfaceSwitch).toHaveBeenCalledWith('hash');
    });

    it('wires the theme, collapse and expand buttons', () => {
        const callbacks = createCallbacks();
        build(callbacks);
        byLabel(root, 'Toggle theme').click();
        byLabel(root, 'Collapse all folders').click();
        byLabel(root, 'Expand all folders').click();

        expect(callbacks.onThemeToggle).toHaveBeenCalledTimes(1);
        expect(callbacks.onCollapseAll).toHaveBeenCalledTimes(1);
        expect(callbacks.onExpandAll).toHaveBeenCalledTimes(1);
    });

    it('closes the explorer drawer from its close button', () => {
        const elements = build();
        elements.explorerDrawer.open();

        expect(elements.explorerDrawer.isOpen()).toBe(true);

        byLabel(root, 'Close the Explorer').click();

        expect(elements.explorerDrawer.isOpen()).toBe(false);
    });

    describe('workspace menu', () => {
        it('lists workspaces, marks the active one and offers forget entries', () => {
            const callbacks = createCallbacks([workspace('w1', 'notes'), workspace('w2', 'site')], 'w2');
            build(callbacks);
            byLabel(root, 'Switch workspace').click();

            expect(menuLabels()).toEqual([
                'notes',
                'site  (active)',
                'Open folder…',
                'Forget "notes"',
                'Forget "site"',
            ]);

            menuItem('notes').click();

            expect(callbacks.onOpenWorkspace).toHaveBeenCalledWith('w1');
        });

        it('forgets a workspace with a failure tone item', () => {
            const callbacks = createCallbacks([workspace('w1', 'notes')], null);
            build(callbacks);
            byLabel(root, 'Switch workspace').click();
            const forget = menuItem('Forget "notes"');

            expect(forget.dataset['tone']).toBe('fail');

            forget.click();

            expect(callbacks.onForgetWorkspace).toHaveBeenCalledWith('w1');
        });

        it('shows a line that cannot be picked when there are no recent workspaces', () => {
            const callbacks = createCallbacks();
            build(callbacks);
            byLabel(root, 'Switch workspace').click();

            expect(menuLabels()).toEqual(['No recent workspaces', 'Open folder…']);
            expect(menuItem('No recent workspaces').dataset['kind']).toBe('header');
            menuItem('No recent workspaces').click();
            expect(callbacks.onPickWorkspace).not.toHaveBeenCalled();

            menuItem('Open folder…').click();

            expect(callbacks.onPickWorkspace).toHaveBeenCalledTimes(1);
        });
    });

    describe('explorer resizer', () => {
        it('applies the default width when nothing is stored', () => {
            build();

            expect(explorerWidth()).toBe('260px');
            expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
        });

        it('restores a stored layout and clamps the width', () => {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 9999, collapsed: false }));
            build();

            expect(explorerWidth()).toBe('560px');
        });

        it('restores a collapsed layout', () => {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 300, collapsed: true }));
            build();

            expect(explorerWidth()).toBe('0px');
            expect(document.body.dataset['explorerCollapsed']).toBe('true');
        });

        it('falls back to the default layout when storage holds bad JSON', () => {
            localStorage.setItem(LAYOUT_KEY, '{not json');
            build();

            expect(explorerWidth()).toBe('260px');
        });

        it('toggles collapse on double click and persists it', () => {
            build();
            resizer(root).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

            expect(document.body.dataset['explorerCollapsed']).toBe('true');
            expect(storedLayout()).toEqual({ width: 260, collapsed: true });

            resizer(root).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

            expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
            expect(explorerWidth()).toBe('260px');
        });

        it('resizes by dragging and saves the width on mouse up', () => {
            build();
            vi.spyOn(root.querySelector('.sidebar')!, 'getBoundingClientRect').mockReturnValue({ width: 260 } as DOMRect);
            mouse(resizer(root), 'mousedown', 260);

            expect(document.body.dataset['resizing']).toBe('horizontal');

            mouse(document, 'mousemove', 340);

            expect(explorerWidth()).toBe('340px');

            mouse(document, 'mouseup', 340);

            expect(document.body.dataset['resizing']).toBeUndefined();
            expect(storedLayout()).toEqual({ width: 340, collapsed: false });
        });

        it('snaps the explorer shut when dragged below the threshold', () => {
            build();
            vi.spyOn(root.querySelector('.sidebar')!, 'getBoundingClientRect').mockReturnValue({ width: 200 } as DOMRect);
            mouse(resizer(root), 'mousedown', 200);
            mouse(document, 'mousemove', 50);
            mouse(document, 'mouseup', 50);

            expect(document.body.dataset['explorerCollapsed']).toBe('true');
            expect(storedLayout()).toEqual({ width: 260, collapsed: true });
        });

        it('ignores jitter smaller than the click tolerance', () => {
            build();
            vi.spyOn(root.querySelector('.sidebar')!, 'getBoundingClientRect').mockReturnValue({ width: 260 } as DOMRect);
            mouse(resizer(root), 'mousedown', 260);
            mouse(document, 'mousemove', 262);

            expect(explorerWidth()).toBe('260px');

            mouse(document, 'mouseup', 262);
        });

        it('reopens a collapsed explorer on a plain click and ignores the following double click', () => {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 300, collapsed: true }));
            build();
            mouse(resizer(root), 'mousedown', 0);
            mouse(document, 'mouseup', 0);

            expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
            expect(explorerWidth()).toBe('300px');

            resizer(root).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

            expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
        });

        it('ignores non-primary mouse buttons', () => {
            build();
            resizer(root).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 10 }));

            expect(document.body.dataset['resizing']).toBeUndefined();
        });
    });

    describe('showExplorer', () => {
        it('brings a hidden Explorer back at its last width and remembers it', () => {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 300, collapsed: true }));
            const elements = build();

            elements.showExplorer();

            expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
            expect(explorerWidth()).toBe('300px');
            expect(storedLayout()).toEqual({ width: 300, collapsed: false });
            expect(document.body.dataset['explorerDrawer']).toBeUndefined();
        });

        it('leaves a shown Explorer as it is', () => {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 340, collapsed: false }));
            const elements = build();
            localStorage.clear();

            elements.showExplorer();

            expect(explorerWidth()).toBe('340px');
            expect(storedLayout()).toBeNull();
        });
    });
});

describe('buildShell narrow layout', () => {
    let root: HTMLElement;
    let shell: ShellElements;
    let media: FakeMediaQuery;

    function strip(): HTMLElement {
        return root.querySelector<HTMLElement>('.split-resizer')!;
    }

    function drawerState(): string | undefined {
        return document.body.dataset['explorerDrawer'];
    }

    beforeEach(() => {
        localStorage.clear();
        media = stubMatchMedia(NARROW_LAYOUT_QUERY, true);
        root = document.createElement('div');
        document.body.append(root);
        shell = buildShell(root, createCallbacks());
    });

    afterEach(() => {
        shell.explorerDrawer.dispose();
        root.remove();
        document.querySelector('.modal-backdrop')?.remove();
        delete document.body.dataset['explorerCollapsed'];
        vi.unstubAllGlobals();
    });

    it('opens the drawer from the edge strip', () => {
        strip().click();

        expect(drawerState()).toBe('open');
        expect(strip().getAttribute('aria-expanded')).toBe('true');
        expect(strip().getAttribute('aria-controls')).toBe('studio-explorer');
    });

    it('closes the drawer when the strip is tapped again', () => {
        strip().click();
        strip().click();

        expect(drawerState()).toBeUndefined();
        expect(strip().getAttribute('aria-expanded')).toBe('false');
    });

    it('closes the drawer from the backdrop', () => {
        strip().click();

        root.querySelector<HTMLElement>('.explorer-backdrop')!.click();

        expect(drawerState()).toBeUndefined();
    });

    it('closes the drawer on Escape', () => {
        strip().click();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(drawerState()).toBeUndefined();
    });

    it('leaves Escape to an open dialog', () => {
        strip().click();
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.dataset['open'] = 'true';
        document.body.append(modal);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(drawerState()).toBe('open');
    });

    it('opens the drawer and focuses the tree when the Explorer is shown, leaving the desktop layout alone', () => {
        shell.showExplorer();

        expect(drawerState()).toBe('open');
        expect(strip().getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(shell.explorer);
        expect(storedLayout()).toBeNull();
    });

    it('neither resizes nor collapses the Explorer from the strip', () => {
        strip().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10 }));
        strip().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(document.body.dataset['resizing']).toBeUndefined();
        expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
    });

    it('closes the drawer when the window widens past the breakpoint', () => {
        strip().click();

        media.change(false);

        expect(drawerState()).toBeUndefined();
    });

    it('ignores taps on the strip in the wide layout', () => {
        media.change(false);

        strip().click();

        expect(drawerState()).toBeUndefined();
    });
});

describe('updateThemeToggle', () => {
    it('offers the opposite theme', () => {
        const toggle = document.createElement('button');
        updateThemeToggle(toggle, 'light');

        expect(toggle.textContent).toBe('☾');
        expect(toggle.getAttribute('aria-label')).toBe('Switch to dark theme');
        expect(toggle.getAttribute('title')).toBe('Switch to dark theme');

        updateThemeToggle(toggle, 'dark');

        expect(toggle.textContent).toBe('☀');
        expect(toggle.getAttribute('aria-label')).toBe('Switch to light theme');
    });
});

describe('setActiveSurface', () => {
    it('marks only the matching surface tab active', () => {
        const nav = document.createElement('nav');
        nav.innerHTML = '<button class="app-tab" data-surface="files" data-active="true"></button><button class="app-tab" data-surface="hash"></button>';
        setActiveSurface(nav, 'hash');
        const [files, hash] = [...nav.querySelectorAll<HTMLElement>('.app-tab')];

        expect(files?.dataset['active']).toBeUndefined();
        expect(hash?.dataset['active']).toBe('true');
    });
});
