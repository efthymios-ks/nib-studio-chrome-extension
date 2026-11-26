import { showContextMenu, type ContextMenuItem } from '../explorer/contextMenu.js';
import { h } from '../app/dom.js';
import { observeResize } from './observeResize.js';

// The strip of sheet tabs along the bottom of a workbook's table, as in Excel: one tab per sheet in workbook order,
// the active one highlighted, arrows to scroll when they don't fit, and a menu to show the hidden sheets.

export interface SheetTabsSheet {
    readonly name: string;
    readonly hidden: boolean;
}

export interface SheetTabsOptions {
    readonly sheets: ReadonlyArray<SheetTabsSheet>;
    readonly onSelect: (index: number) => void;
    // Shows a hidden sheet as a tab, or puts it away again.
    readonly onToggleHidden: (index: number) => void;
}

export interface SheetTabsHandle {
    readonly element: HTMLElement;
    // Highlights the active sheet and shows the hidden sheets chosen to show.
    update(active: number, shown: ReadonlySet<number>): void;
    // Moves the focus to the active tab.
    focusActive(): void;
}

// How far one press of an arrow scrolls, as a share of the strip's width, and at least.
const SCROLL_SHARE = 0.8;
const MIN_SCROLL_PX = 40;

// The tab a key moves to from `current`, among the tabs on the strip, or null for another key.
const TAB_KEYS: ReadonlyArray<{ readonly key: string; readonly target: (current: number, count: number) => number }> = [
    { key: 'ArrowRight', target: (current, count) => (current + 1) % count },
    { key: 'ArrowLeft', target: (current, count) => (current - 1 + count) % count },
    { key: 'Home', target: () => 0 },
    { key: 'End', target: (_, count) => count - 1 },
];

export function createSheetTabs(options: SheetTabsOptions): SheetTabsHandle {
    const list = h('div', { class: 'sheet-tabs-list', attrs: { role: 'tablist', 'aria-label': 'Sheets' } });
    const back = h('button', {
        class: 'sheet-tabs-scroll',
        text: '‹',
        dataset: { direction: 'back' },
        attrs: { type: 'button', title: 'Scroll the sheet tabs left', 'aria-label': 'Scroll the sheet tabs left' },
    });
    const forward = h('button', {
        class: 'sheet-tabs-scroll',
        text: '›',
        dataset: { direction: 'forward' },
        attrs: { type: 'button', title: 'Scroll the sheet tabs right', 'aria-label': 'Scroll the sheet tabs right' },
    });
    const hiddenIndexes = options.sheets.flatMap((sheet, index) => (sheet.hidden ? [index] : []));
    const hiddenLabel = hiddenIndexes.length === 1 ? '1 hidden sheet' : `${hiddenIndexes.length} hidden sheets`;
    const hiddenButton = h('button', {
        class: 'sheet-tabs-hidden',
        text: `⋯ ${hiddenIndexes.length} hidden`,
        attrs: { type: 'button', title: `${hiddenLabel}: show one`, 'aria-label': `${hiddenLabel}: show one`, 'aria-haspopup': 'menu' },
    });
    hiddenButton.hidden = hiddenIndexes.length === 0;
    const root = h('div', { class: 'sheet-tabs', children: [back, list, forward, hiddenButton] });
    let active = 0;
    let shown: ReadonlySet<number> = new Set();

    const tabs = options.sheets.map((sheet, index) => h('button', {
        class: 'sheet-tab',
        text: sheet.name,
        dataset: sheet.hidden ? { index: String(index), hiddenSheet: 'true' } : { index: String(index) },
        attrs: {
            type: 'button',
            role: 'tab',
            title: sheet.hidden ? `${sheet.name}, a hidden sheet` : sheet.name,
        },
        on: { click: () => options.onSelect(index) },
    }));
    list.append(...tabs);

    const onStrip = (): number[] => options.sheets.flatMap((sheet, index) => (!sheet.hidden || shown.has(index) ? [index] : []));

    const updateScroll = (): void => {
        const overflowing = list.scrollWidth > list.clientWidth + 1;
        back.hidden = !overflowing;
        forward.hidden = !overflowing;
        back.disabled = list.scrollLeft <= 0;
        forward.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
    };

    // Scrolls the strip just enough to show the active tab whole.
    const revealActive = (): void => {
        const tab = tabs[active];

        if (tab == null || list.clientWidth === 0) {
            return;
        }

        if (tab.offsetLeft < list.scrollLeft) {
            list.scrollLeft = tab.offsetLeft;
        }
        else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
            list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
        }

        updateScroll();
    };

    const scrollBy = (direction: number): void => {
        list.scrollBy({ left: direction * Math.max(MIN_SCROLL_PX, list.clientWidth * SCROLL_SHARE), behavior: 'smooth' });
    };

    back.addEventListener('click', () => scrollBy(-1));
    forward.addEventListener('click', () => scrollBy(1));
    list.addEventListener('scroll', updateScroll, { passive: true });

    list.addEventListener('keydown', (event) => {
        const move = TAB_KEYS.find((entry) => entry.key === event.key);
        const strip = onStrip();
        const position = strip.indexOf(active);

        if (move == null || event.ctrlKey || event.altKey || event.metaKey || position < 0) {
            return;
        }

        event.preventDefault();
        const target = strip[move.target(position, strip.length)];

        if (target != null && target !== active) {
            options.onSelect(target);
        }

        tabs[active]?.focus();
    });

    hiddenButton.addEventListener('click', (event) => {
        const items: ContextMenuItem[] = hiddenIndexes.map((index) => {
            const name = options.sheets[index]?.name ?? '';

            return {
                label: shown.has(index) ? `Hide ${name} again` : `Show ${name}`,
                onSelect: () => options.onToggleHidden(index),
            };
        });

        showContextMenu(event, [{ items: [{ label: hiddenLabel, header: true, onSelect: () => undefined }, ...items] }]);
    });

    // A strip taken off the page shrinks to nothing, which ends the watching.
    const stopObserving = observeResize(list, () => {
        if (!root.isConnected) {
            stopObserving();

            return;
        }

        revealActive();
    });

    return {
        element: root,
        update: (nextActive, nextShown) => {
            active = nextActive;
            shown = nextShown;

            tabs.forEach((tab, index) => {
                const isActive = index === active;
                tab.hidden = options.sheets[index]?.hidden === true && !shown.has(index);
                tab.setAttribute('aria-selected', String(isActive));
                tab.tabIndex = isActive ? 0 : -1;

                if (isActive) {
                    tab.dataset['active'] = 'true';
                }
                else {
                    delete tab.dataset['active'];
                }
            });

            revealActive();
        },
        focusActive: () => tabs[active]?.focus(),
    };
}
