import type { SurfaceId } from '../../common/fs/workspaceConfig.js';
import type { WorkspaceRecord } from '../../common/fs/workspaceRegistry.js';
import { showContextMenu } from '../explorer/contextMenu.js';
import { h } from './dom.js';
import { createExplorerDrawer, type ExplorerDrawer } from './explorerDrawer.js';

export type SurfaceCallback = (surface: SurfaceId) => void;
export type ActionCallback = () => void;

export interface ShellCallbacks {
    readonly onSurfaceSwitch: SurfaceCallback;
    readonly onThemeToggle: ActionCallback;
    readonly onPickWorkspace: ActionCallback;
    readonly onOpenWorkspace: (id: string) => void;
    readonly onForgetWorkspace: (id: string) => void;
    readonly onCollapseAll: ActionCallback;
    readonly onExpandAll: ActionCallback;
    readonly getWorkspaces: () => ReadonlyArray<WorkspaceRecord>;
    readonly getActiveWorkspaceId: () => string | null;
}

export interface ShellElements {
    readonly header: HTMLElement;
    readonly body: HTMLElement;
    readonly sidebar: HTMLElement;
    readonly explorer: HTMLElement;
    readonly explorerHeader: HTMLElement;
    readonly main: HTMLElement;
    readonly status: HTMLElement;
    readonly workspaceLabel: HTMLElement;
    readonly surfaceTabs: HTMLElement;
    readonly themeToggle: HTMLElement;
    readonly explorerDrawer: ExplorerDrawer;
    // Brings the Explorer into view: the drawer slides in on a narrow screen, and on a wider one a hidden Explorer comes back.
    readonly showExplorer: () => void;
}

const SURFACES: ReadonlyArray<{ id: SurfaceId; label: string }> = [
    { id: 'files', label: 'Files' },
    { id: 'hash', label: 'Hash & encode' },
];

export function buildShell(root: HTMLElement, callbacks: ShellCallbacks): ShellElements {
    const workspaceLabel = h('span', { text: 'No workspace' });
    const workspaceSwitch = h('button', {
        class: 'workspace-switch',
        attrs: { type: 'button', title: 'Switch workspace', 'aria-label': 'Switch workspace' },
        children: [
            h('span', { class: 'workspace-icon', text: '▣' }),
            h('span', { class: 'workspace-name', children: [workspaceLabel] }),
            h('span', { class: 'workspace-chevron', text: '▾' }),
        ],
        on: {
            click: (event) => openWorkspaceMenu(event as MouseEvent, callbacks),
        },
    });

    const surfaceTabs = h('nav', {
        class: 'app-tabs',
        attrs: { 'aria-label': 'Surface' },
        children: SURFACES.map((surface) => h('button', {
            class: 'app-tab',
            attrs: { type: 'button', title: surface.label },
            dataset: { surface: surface.id },
            children: [
                h('span', { class: 'app-tab-label', text: surface.label }),
            ],
            on: { click: () => callbacks.onSurfaceSwitch(surface.id) },
        })),
    });

    const themeToggle = h('button', {
        class: 'icon-button theme-toggle',
        text: '☾',
        attrs: { type: 'button', title: 'Toggle theme', 'aria-label': 'Toggle theme' },
        on: { click: () => callbacks.onThemeToggle() },
    });

    const header = h('header', {
        class: 'app-header',
        children: [
            h('div', {
                class: 'app-brand',
                attrs: { title: 'Nib Studio' },
                children: [
                    h('img', { class: 'app-brand-mark', attrs: { src: '../icons/icon-32.png', alt: '' } }),
                    h('span', { class: 'app-brand-name', text: 'Nib Studio' }),
                ],
            }),
            workspaceSwitch,
            surfaceTabs,
            h('div', {
                class: 'app-header-right',
                children: [themeToggle],
            }),
        ],
    });

    const explorerHeader = h('div', {
        class: 'sidebar-header',
        children: [
            h('span', { class: 'sidebar-title', text: 'Explorer' }),
            h('div', {
                class: 'sidebar-actions',
                children: [
                    h('button', {
                        class: 'icon-button',
                        text: '⊟',
                        attrs: { type: 'button', title: 'Collapse all folders', 'aria-label': 'Collapse all folders' },
                        on: { click: () => callbacks.onCollapseAll() },
                    }),
                    h('button', {
                        class: 'icon-button',
                        text: '⊞',
                        attrs: { type: 'button', title: 'Expand all folders', 'aria-label': 'Expand all folders' },
                        on: { click: () => callbacks.onExpandAll() },
                    }),
                    h('button', {
                        class: 'icon-button explorer-drawer-close',
                        text: '×',
                        attrs: { type: 'button', title: 'Close the Explorer', 'aria-label': 'Close the Explorer' },
                        on: { click: () => explorerDrawer.close() },
                    }),
                ],
            }),
        ],
    });

    const explorer = h('div', {
        class: 'tree',
        attrs: { role: 'tree', 'aria-label': 'Files' },
    });

    const sidebar = h('aside', {
        class: 'sidebar',
        attrs: { id: 'studio-explorer', 'aria-label': 'Workspace explorer' },
        children: [explorerHeader, explorer],
    });

    const main = h('main', { class: 'main', attrs: { id: 'studio-main' } });

    const sidebarResizer = h('div', {
        class: 'split-resizer split-resizer-vertical',
        attrs: { title: `Drag to resize or hide the Explorer; double-click to toggle` },
    });

    const explorerBackdrop = h('div', { class: 'explorer-backdrop', attrs: { 'aria-hidden': 'true' } });
    const explorerDrawer = createExplorerDrawer({ sidebar, backdrop: explorerBackdrop, opener: sidebarResizer });
    const showSidebar = attachSidebarResizer(sidebarResizer, sidebar, explorerDrawer);
    const showExplorer = (): void => {
        if (explorerDrawer.isNarrow()) {
            explorerDrawer.open();

            return;
        }

        showSidebar();
    };

    const body = h('div', {
        class: 'app-body',
        children: [sidebar, sidebarResizer, main, explorerBackdrop],
    });

    const status = h('footer', { class: 'status-bar' });

    root.append(header, body, status);

    return {
        header,
        body,
        sidebar,
        explorer,
        explorerHeader,
        main,
        status,
        workspaceLabel,
        surfaceTabs,
        themeToggle,
        explorerDrawer,
        showExplorer,
    };
}

export function updateThemeToggle(toggle: HTMLElement, theme: 'light' | 'dark'): void {
    toggle.textContent = theme === 'light' ? '☾' : '☀';
    const label = theme === 'light'
        ? 'Switch to dark theme'
        : 'Switch to light theme';
    toggle.setAttribute('title', label);
    toggle.setAttribute('aria-label', label);
}

export function setActiveSurface(surfaceTabs: HTMLElement, surface: SurfaceId): void {
    for (const tab of surfaceTabs.querySelectorAll<HTMLElement>('.app-tab')) {
        if (tab.dataset['surface'] === surface) {
            tab.dataset['active'] = 'true';
        }
        else {
            delete tab.dataset['active'];
        }
    }
}

const EXPLORER_MIN_WIDTH = 160;
const EXPLORER_MAX_WIDTH = 560;
const EXPLORER_DEFAULT_WIDTH = 260;
// Dragging narrower than this hides the Explorer, the way an editor side bar snaps shut.
const EXPLORER_COLLAPSE_THRESHOLD = 100;
const EXPLORER_LAYOUT_KEY = 'nib-studio/explorer-layout';
const CLICK_MOVE_TOLERANCE_PX = 3;
const REOPEN_DOUBLE_CLICK_GRACE_MS = 500;

interface ExplorerLayout {
    width: number;
    collapsed: boolean;
}

// Returns a function that brings a hidden Explorer back at its last width.
function attachSidebarResizer(handle: HTMLElement, sidebar: HTMLElement, drawer: ExplorerDrawer): () => void {
    const layout = readExplorerLayout();
    applyExplorerLayout(layout);

    const setLayout = (next: ExplorerLayout): void => {
        layout.width = next.width;
        layout.collapsed = next.collapsed;
        applyExplorerLayout(layout);
        writeExplorerLayout(layout);
    };

    const toggle = (): void => {
        setLayout({ width: layout.width, collapsed: !layout.collapsed });
    };

    // A plain click on the collapsed strip reopens the Explorer; the double-click that
    // may follow must not close it again straight away.
    let reopenedByClickAt = 0;

    handle.addEventListener('dblclick', () => {
        if (drawer.isNarrow() || Date.now() - reopenedByClickAt < REOPEN_DOUBLE_CLICK_GRACE_MS) {
            return;
        }

        toggle();
    });

    handle.addEventListener('mousedown', (event) => {
        // In the narrow layout the strip only opens the drawer; the drawer handles that click.
        if (event.button !== 0 || drawer.isNarrow()) {
            return;
        }

        event.preventDefault();
        const startX = event.clientX;
        const startedCollapsed = layout.collapsed;
        const startWidth = startedCollapsed ? 0 : sidebar.getBoundingClientRect().width;
        let moved = false;
        document.body.dataset['resizing'] = 'horizontal';

        const onMove = (move: MouseEvent): void => {
            if (Math.abs(move.clientX - startX) < CLICK_MOVE_TOLERANCE_PX && !moved) {
                return;
            }

            moved = true;
            const raw = startWidth + (move.clientX - startX);

            if (raw < EXPLORER_COLLAPSE_THRESHOLD) {
                layout.collapsed = true;
            }
            else {
                layout.collapsed = false;
                layout.width = clampExplorerWidth(raw);
            }

            applyExplorerLayout(layout);
        };

        const onUp = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            delete document.body.dataset['resizing'];

            if (startedCollapsed && !moved) {
                reopenedByClickAt = Date.now();
                setLayout({ width: layout.width, collapsed: false });

                return;
            }

            writeExplorerLayout(layout);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    return () => {
        if (layout.collapsed) {
            setLayout({ width: layout.width, collapsed: false });
        }
    };
}

function applyExplorerLayout(layout: ExplorerLayout): void {
    const width = layout.collapsed ? 0 : layout.width;
    document.documentElement.style.setProperty('--explorer-width', `${width}px`);

    if (layout.collapsed) {
        document.body.dataset['explorerCollapsed'] = 'true';
    }
    else {
        delete document.body.dataset['explorerCollapsed'];
    }
}

function clampExplorerWidth(width: number): number {
    return Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, width));
}

function readExplorerLayout(): ExplorerLayout {
    try {
        const stored = JSON.parse(localStorage.getItem(EXPLORER_LAYOUT_KEY) ?? 'null') as Partial<ExplorerLayout> | null;

        return {
            width: clampExplorerWidth(stored?.width ?? EXPLORER_DEFAULT_WIDTH),
            collapsed: stored?.collapsed === true,
        };
    }
    catch {
        return { width: EXPLORER_DEFAULT_WIDTH, collapsed: false };
    }
}

function writeExplorerLayout(layout: ExplorerLayout): void {
    try {
        localStorage.setItem(EXPLORER_LAYOUT_KEY, JSON.stringify(layout));
    }
    catch {
        // Storage unavailable; the layout just won't survive a reload.
    }
}

function openWorkspaceMenu(event: MouseEvent, callbacks: ShellCallbacks): void {
    const workspaces = callbacks.getWorkspaces();
    const activeId = callbacks.getActiveWorkspaceId();
    const items = workspaces.map((workspace) => ({
        label: workspace.id === activeId
            ? `${workspace.name}  (active)`
            : workspace.name,
        onSelect: () => callbacks.onOpenWorkspace(workspace.id),
    }));

    const groups = [
        {
            items: items.length > 0
                ? items
                : [{ label: 'No recent workspaces', header: true, onSelect: () => {} }],
        },
        {
            items: [
                { label: 'Open folder…', onSelect: () => callbacks.onPickWorkspace() },
            ],
        },
    ];

    if (workspaces.length > 0) {
        groups.push({
            items: workspaces.map((workspace) => ({
                label: `Forget "${workspace.name}"`,
                tone: 'fail' as const,
                onSelect: () => callbacks.onForgetWorkspace(workspace.id),
            })),
        });
    }

    showContextMenu(event, groups);
}
