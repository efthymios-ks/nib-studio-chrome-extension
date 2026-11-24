import type { MetadataGroup } from '../../common/preview/metadataGroups.js';
import { clear, h } from '../app/dom.js';

const INFO_OPEN_KEY = 'nib-studio/preview-info-open';

// Whether the Info panel was left open, for every preview; it starts closed.
export function readInfoPanelOpen(): boolean {
    try {
        return localStorage.getItem(INFO_OPEN_KEY) === 'true';
    }
    catch {
        return false;
    }
}

export function writeInfoPanelOpen(isOpen: boolean): void {
    try {
        localStorage.setItem(INFO_OPEN_KEY, String(isOpen));
    }
    catch {
        // Storage can be unavailable; the panel then remembers its state for this page only.
    }
}

// Fills the panel with titled groups of label and value rows, as plain selectable text.
// Null means the details are still being read.
export function renderInfoPanel(panel: HTMLElement, groups: ReadonlyArray<MetadataGroup> | null): void {
    clear(panel);

    if (groups == null) {
        panel.append(h('p', { class: 'preview-info-empty', text: 'Reading details…' }));

        return;
    }

    if (groups.length === 0) {
        panel.append(h('p', { class: 'preview-info-empty', text: 'No details to show.' }));

        return;
    }

    for (const group of groups) {
        panel.append(h('section', {
            class: 'preview-info-group',
            children: [
                h('h3', { class: 'preview-info-title', text: group.title }),
                h('dl', {
                    class: 'preview-info-rows',
                    children: group.rows.map((row) => h('div', {
                        class: 'preview-info-row',
                        children: [
                            h('dt', { class: 'preview-info-label', text: row.label }),
                            h('dd', { class: 'preview-info-value', text: row.value }),
                        ],
                    })),
                }),
            ],
        }));
    }
}
