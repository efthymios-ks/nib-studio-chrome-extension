import { clear, h } from '../app/dom.js';

export interface ContextMenuItem {
    readonly label: string;
    readonly shortcut?: string;
    readonly tone?: 'default' | 'fail';
    // An item that doesn't apply is left out of the menu, not greyed out.
    readonly disabled?: boolean;
    // A line of text that can't be picked, such as the "Compare with…" title over its entries.
    readonly header?: boolean;
    readonly onSelect: () => void;
}

export interface ContextMenuGroup {
    readonly items: ReadonlyArray<ContextMenuItem>;
}

let instance: ContextMenu | null = null;

class ContextMenu {
    readonly element: HTMLElement;

    constructor() {
        // A press on the menu keeps the focus where it was, such as on the tree, so a dialog an item opens
        // gives it back there.
        this.element = h('div', {
            class: 'context-menu',
            attrs: { role: 'menu' },
            on: { mousedown: (event) => event.preventDefault() },
        });
        document.body.append(this.element);

        document.addEventListener('click', (event) => {
            if (!this.element.contains(event.target as Node)) {
                this.close();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.close();
            }
        });

        window.addEventListener('scroll', () => this.close(), true);
        window.addEventListener('resize', () => this.close());
    }

    open(event: MouseEvent, groups: ReadonlyArray<ContextMenuGroup>): void {
        event.preventDefault();

        // A menu opened by a left click must not see that same click reach the
        // document-level outside-click handler, which would close it at once.
        if (event.type === 'click') {
            event.stopPropagation();
        }

        clear(this.element);
        const shownGroups = groups
            .map((group) => group.items.filter((item) => item.disabled !== true))
            .filter((items) => items.length > 0);

        if (shownGroups.length === 0) {
            this.close();

            return;
        }

        shownGroups.forEach((items, index) => {
            if (index > 0) {
                this.element.append(h('div', { class: 'context-menu-separator' }));
            }

            for (const item of items) {
                this.element.append(item.header === true ? this.buildHeader(item) : this.buildItem(item));
            }
        });

        this.element.dataset.open = 'true';
        this.element.style.visibility = 'hidden';
        this.element.style.top = '0';
        this.element.style.left = '0';
        requestAnimationFrame(() => this.clampInsideViewport(event.clientX, event.clientY));
    }

    private clampInsideViewport(x: number, y: number): void {
        const margin = 8;
        const rect = this.element.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width - margin;
        const maxTop = window.innerHeight - rect.height - margin;
        const left = Math.min(Math.max(margin, x), Math.max(margin, maxLeft));
        const top = Math.min(Math.max(margin, y), Math.max(margin, maxTop));
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.style.visibility = 'visible';
    }

    close(): void {
        this.element.dataset.open = 'false';
    }

    private buildHeader(item: ContextMenuItem): HTMLElement {
        return h('div', {
            class: 'context-menu-item',
            attrs: { role: 'presentation' },
            dataset: { kind: 'header' },
            children: [h('span', { text: item.label })],
        });
    }

    private buildItem(item: ContextMenuItem): HTMLElement {
        return h('div', {
            class: 'context-menu-item',
            attrs: { role: 'menuitem' },
            dataset: item.tone === 'fail' ? { tone: 'fail' } : {},
            children: [
                h('span', { text: item.label }),
                item.shortcut == null
                    ? null
                    : h('span', { class: 'context-menu-shortcut', text: item.shortcut }),
            ],
            on: {
                click: () => {
                    this.close();
                    item.onSelect();
                },
            },
        });
    }
}

export function showContextMenu(event: MouseEvent, groups: ReadonlyArray<ContextMenuGroup>): void {
    if (instance == null) {
        instance = new ContextMenu();
    }

    instance.open(event, groups);
}
