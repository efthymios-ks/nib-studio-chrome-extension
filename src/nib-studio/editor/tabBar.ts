import { basename } from '../../common/fs/fileEntry.js';
import { resolveFileType } from '../../common/fs/fileTypes.js';
import { clear, h } from '../app/dom.js';
import { diffTabTitle, diffTabTooltip } from '../app/diffTabs.js';
import { attachLongPress } from '../app/longPress.js';
import { isDiffTab, tabId, type OpenFile, type OpenTab } from '../app/store.js';

export interface TabBarCallbacks {
    // Each callback gets the tab id: a file path, or a diff tab id.
    readonly onActivate: (id: string) => void;
    readonly onClose: (id: string) => void;
    readonly onContextMenu?: (event: MouseEvent, id: string) => void;
    readonly onPromote?: (id: string) => void;
    // Shows the "+" button after the last tab; the click places its menu of new tabs: the compares, then Paste from clipboard.
    readonly onNewCompare?: (event: MouseEvent) => void;
}

export const DIFF_TAB_GLYPH = '⇄';

export function renderTabBar(
    container: HTMLElement,
    tabs: ReadonlyArray<OpenTab>,
    activeId: string | null,
    callbacks: TabBarCallbacks,
): void {
    clear(container);

    for (const tab of tabs) {
        container.append(renderTab(tab, activeId, callbacks));
    }

    const onNewCompare = callbacks.onNewCompare;

    if (onNewCompare != null) {
        container.append(h('button', {
            class: 'tab-new',
            text: '+',
            dataset: { action: 'new-compare' },
            attrs: { type: 'button', title: 'New tab', 'aria-label': 'New tab' },
            on: { click: (event) => onNewCompare(event as MouseEvent) },
        }));
    }
}

interface TabLook {
    readonly name: string;
    readonly tooltip: string;
    readonly glyph: string;
    readonly type: string;
}

function lookOf(tab: OpenTab): TabLook {
    if (isDiffTab(tab)) {
        return { name: diffTabTitle(tab), tooltip: diffTabTooltip(tab), glyph: DIFF_TAB_GLYPH, type: 'diff' };
    }

    const name = basename(tab.path);
    const fileType = resolveFileType(name);

    return { name, tooltip: tooltipOf(tab, name), glyph: fileType.glyph, type: fileType.id };
}

function tooltipOf(tab: OpenFile, name: string): string {
    if (tab.external == null) {
        return tab.path;
    }

    if (tab.external.pasted === true) {
        return `${name}, pasted from the clipboard. Save asks where to save it.`;
    }

    return tab.external.handle == null
        ? `${name}, outside the workspace. Save asks where to save it.`
        : `${name}, outside the workspace. Save writes back to this file.`;
}

function renderTab(tab: OpenTab, activeId: string | null, callbacks: TabBarCallbacks): HTMLElement {
    const id = tabId(tab);
    const look = lookOf(tab);
    const dataset: Record<string, string> = { path: id };

    if (id === activeId) {
        dataset['active'] = 'true';
    }

    // A paste belongs to no folder either, but it never had a file outside the workspace, so it carries no arrow.
    const isPasted = !isDiffTab(tab) && tab.external?.pasted === true;
    const isExternal = !isDiffTab(tab) && tab.external != null && !isPasted;

    if (isDiffTab(tab)) {
        dataset['kind'] = 'diff';
    }
    else {
        if (tab.dirty) {
            dataset['dirty'] = 'true';
        }

        if (tab.preview) {
            dataset['preview'] = 'true';
        }

        if (isExternal) {
            dataset['external'] = 'true';
        }

        if (isPasted) {
            dataset['pasted'] = 'true';
        }
    }

    const element = h('div', {
        class: 'tab',
        dataset,
        attrs: { title: look.tooltip },
        children: [
            h('span', {
                class: 'tab-icon',
                text: look.glyph,
                dataset: { type: look.type },
            }),
            h('span', { class: 'tab-name', text: look.name }),
            isExternal
                ? h('span', { class: 'tab-external', text: '↗', attrs: { 'aria-label': 'Outside the workspace' } })
                : null,
            h('button', {
                class: 'tab-close',
                text: '×',
                attrs: { type: 'button', title: `Close ${look.name}`, 'aria-label': `Close ${look.name}` },
                on: {
                    click: (event) => {
                        event.stopPropagation();
                        callbacks.onClose(id);
                    },
                },
            }),
        ],
        on: {
            click: () => callbacks.onActivate(id),
            dblclick: (event) => {
                event.stopPropagation();
                callbacks.onPromote?.(id);
            },
            contextmenu: (event) => {
                if (callbacks.onContextMenu == null) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                callbacks.onContextMenu(event as MouseEvent, id);
            },
        },
    });

    if (callbacks.onContextMenu != null) {
        attachLongPress(element);
    }

    return element;
}
