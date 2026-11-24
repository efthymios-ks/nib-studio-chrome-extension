import { h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { observeResize } from './observeResize.js';

// The floating bar at the bottom right of the text, JSON, XML and row diffs: Diff / Before / After,
// the position of the current change, Previous / Next and Recompute, after the Markdown diff's bar.

export type DiffBarView = 'diff' | 'before' | 'after';

// The sides that show a change: Before leaves out changes only the modified side has, After those only the original has.
export type DiffChangeSides = 'both' | 'original' | 'modified';

export interface DiffNavigationState {
    view: DiffBarView;
    // Id of the change the bar last moved to.
    current: string | null;
    // When the bar last moved, so the position holds while a smooth scroll is on its way.
    movedAt: number;
    // Scroll to and flash the current change once the view is drawn again, such as after opening its parents.
    reveal: boolean;
}

export interface DiffNavigationChange {
    readonly id: string;
    readonly sides: DiffChangeSides;
    // Where the change is, such as `items[3].price`, for the position's tooltip.
    readonly label?: string;
    // The rows or cells that show the change; empty while it is not drawn, such as inside a collapsed node.
    readonly locate: () => ReadonlyArray<HTMLElement>;
}

export interface DiffNavigationOptions {
    // The diff the bar floats over; it carries the chosen view as data-diff-view.
    readonly host: HTMLElement;
    // The shared scroll area of both sides.
    readonly scroller: HTMLElement;
    // Where n, p, ↑ and ↓ step.
    readonly keyScope: HTMLElement;
    readonly state: DiffNavigationState;
    // Every change, top to bottom.
    readonly changes: () => ReadonlyArray<DiffNavigationChange>;
    // A row of the diff, to keep the same content in place when the view changes.
    readonly rowSelector: string;
    // After the bar lands on a change, or a click in the diff picks one.
    readonly onMove?: (change: DiffNavigationChange) => void;
    // Draws a change that is not drawn yet, such as by opening its parents; the bar scrolls to it once the view is back.
    readonly onReveal?: (change: DiffNavigationChange) => void;
    // Runs the comparison again; the bar shows its progress meanwhile.
    readonly onRecompute?: () => void;
}

export interface DiffNavigation {
    readonly bar: HTMLElement;
    readonly step: (direction: number) => void;
    readonly setView: (view: DiffBarView) => void;
}

interface ViewButton {
    readonly view: DiffBarView;
    readonly label: string;
    readonly title: string;
}

interface StepButton {
    readonly direction: number;
    readonly text: string;
    readonly title: string;
    readonly label: string;
}

const VIEWS: ReadonlyArray<ViewButton> = Object.freeze([
    { view: 'diff', label: 'Diff', title: 'Insertions and deletions' },
    { view: 'before', label: 'Before', title: 'Read the original' },
    { view: 'after', label: 'After', title: 'Read the revision' },
]);

const STEPS: ReadonlyArray<StepButton> = Object.freeze([
    { direction: -1, text: '↑', title: 'Previous change (p)', label: 'Previous change' },
    { direction: 1, text: '↓', title: 'Next change (n)', label: 'Next change' },
]);

const STEP_KEYS: Readonly<Record<string, number>> = Object.freeze({
    n: 1,
    ArrowDown: 1,
    p: -1,
    ArrowUp: -1,
});

const TYPING_TAGS: ReadonlyArray<string> = Object.freeze(['INPUT', 'TEXTAREA', 'SELECT']);

// Clicks on these act on their own, so they never pick a change.
const CONTROL_SELECTOR = 'button, a, input, select, textarea, label, [data-clickable]';

const FLASH_MILLISECONDS = 1600;

const POSITION_HOLD_MILLISECONDS = 1000;

// Where the view keeps its content in place: this far into the diff, capped to a third of its height.
const ANCHOR_OFFSET_PIXELS = 120;

// Inputs at least this long compare after a pause, so quick successive option changes compare once.
const LARGE_COMPARE_CHARACTERS = 500_000;

const RECOMPUTE_DELAY_MILLISECONDS = 300;

const BUSY_TEXT = 'Comparing…';

const flashTimers = new WeakMap<HTMLElement, number>();

const pendingRenders = new WeakMap<HTMLElement, number>();

export function createDiffNavigationState(): DiffNavigationState {
    return { view: 'diff', current: null, movedAt: 0, reveal: false };
}

// Makes a change the current one; with reveal, the next draw scrolls to it and flashes it.
export function setCurrentChange(state: DiffNavigationState, id: string, reveal = false): void {
    state.current = id;
    state.movedAt = Date.now();
    state.reveal = reveal;
}


export function isShownInView(sides: DiffChangeSides, view: DiffBarView): boolean {
    if (view === 'before') {
        return sides !== 'modified';
    }

    return view === 'after' ? sides !== 'original' : true;
}

// How much both sides hold, to tell a large compare from a quick one.
export function compareSize(original: DiffSide | null, modified: DiffSide | null): number {
    return [original, modified].reduce((total, side) => total + (side?.text?.length ?? side?.file?.size ?? 0), 0);
}

// Shows in the bar that the comparison is running.
function showDiffBarBusy(root: ParentNode): void {
    const bar = root.querySelector<HTMLElement>('.diff-bar');
    const position = bar?.querySelector('.diff-bar-position');

    if (bar == null || position == null) {
        return;
    }

    bar.dataset['busy'] = 'true';
    bar.setAttribute('aria-busy', 'true');
    position.textContent = BUSY_TEXT;
}

// Draws the diff again after a change that reruns its comparison, such as a rule or an option:
// at once for small inputs, and for large ones after a pause, with progress in the bar.
export function scheduleDiffRender(container: HTMLElement, size: number, render: () => void): void {
    window.clearTimeout(pendingRenders.get(container));
    pendingRenders.delete(container);

    if (size < LARGE_COMPARE_CHARACTERS) {
        render();

        return;
    }

    showDiffBarBusy(container);
    pendingRenders.set(container, window.setTimeout(() => {
        pendingRenders.delete(container);

        // A tab left meanwhile compares when it is shown again.
        if (container.isConnected) {
            render();
        }
    }, RECOMPUTE_DELAY_MILLISECONDS));
}

function isRendered(element: Element): boolean {
    return element.isConnected && element.getClientRects().length > 0;
}

// Flashes the elements the way the Markdown diff flashes a change: a ring that fades out.
function flashElements(elements: ReadonlyArray<HTMLElement>): void {
    for (const element of elements) {
        delete element.dataset['flash'];
        void element.offsetWidth;
        element.dataset['flash'] = 'true';
        window.clearTimeout(flashTimers.get(element));
        flashTimers.set(element, window.setTimeout(() => {
            delete element.dataset['flash'];
        }, FLASH_MILLISECONDS));
    }
}

// Centres the first element that is on screen in its scroll area, then flashes them all.
function revealElements(elements: ReadonlyArray<HTMLElement>, smooth: boolean): void {
    const target = elements.find(isRendered) ?? elements[0];

    target?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    flashElements(elements);
}

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return target.isContentEditable || TYPING_TAGS.includes(target.tagName) || target.closest('.cm-editor') != null;
}

export function attachDiffNavigation(options: DiffNavigationOptions): DiffNavigation {
    const { host, scroller, state } = options;
    const position = h('span', { class: 'diff-bar-position', attrs: { 'aria-live': 'polite' } });
    let tops: Map<string, number> | null = null;
    let owners: Map<Element, DiffNavigationChange> | null = null;
    let updatePending = false;

    const hasLayout = (): boolean => scroller.clientHeight > 0;

    const visibleChanges = (): DiffNavigationChange[] => options
        .changes()
        .filter((change) => isShownInView(change.sides, state.view));

    const isInView = (change: DiffNavigationChange): boolean => {
        const box = scroller.getBoundingClientRect();

        return change.locate().some((element) => {
            if (!isRendered(element)) {
                return false;
            }

            const rect = element.getBoundingClientRect();

            return rect.bottom > box.top && rect.top < box.bottom;
        });
    };

    // Where each drawn change starts in the scrolled content; measured once per layout.
    const topsOf = (): Map<string, number> => {
        if (tops != null) {
            return tops;
        }

        const box = scroller.getBoundingClientRect();
        const measured = new Map<string, number>();

        for (const change of options.changes()) {
            const element = change.locate().find(isRendered);

            if (element != null) {
                measured.set(change.id, element.getBoundingClientRect().top - box.top + scroller.scrollTop);
            }
        }

        tops = measured;

        return measured;
    };

    // The change nearest above the middle of the scroll area, as the Markdown diff reads the position.
    const spiedIndex = (list: ReadonlyArray<DiffNavigationChange>): number => {
        const known = topsOf();
        const middle = scroller.scrollTop + scroller.clientHeight / 2;
        let found = -1;
        let foundTop = Number.NEGATIVE_INFINITY;

        list.forEach((change, index) => {
            const top = known.get(change.id);

            if (top != null && top <= middle && top > foundTop) {
                found = index;
                foundTop = top;
            }
        });

        return found;
    };

    const currentIndex = (list: ReadonlyArray<DiffNavigationChange>): number => {
        const focused = list.findIndex((change) => change.id === state.current);
        const held = Date.now() - state.movedAt < POSITION_HOLD_MILLISECONDS;

        if (focused >= 0 && (!hasLayout() || held || isInView(list[focused]!))) {
            return focused;
        }

        return hasLayout() ? spiedIndex(list) : -1;
    };

    const updatePosition = (): void => {
        // The progress stays until the comparison draws the diff again.
        if (bar.dataset['busy'] === 'true') {
            return;
        }

        if (options.changes().length === 0) {
            bar.dataset['empty'] = 'true';
            position.textContent = 'No changes';
            position.removeAttribute('title');

            return;
        }

        const list = visibleChanges();
        const at = currentIndex(list);
        const label = list[at]?.label;
        delete bar.dataset['empty'];
        position.textContent = `${at < 0 ? '–' : at + 1} / ${list.length}`;

        if (label == null) {
            position.removeAttribute('title');
        }
        else {
            position.setAttribute('title', label);
        }
    };

    const moveTo = (change: DiffNavigationChange, canRedraw: boolean): void => {
        setCurrentChange(state, change.id);
        const elements = change.locate();

        if (elements.length === 0 && canRedraw && options.onReveal != null) {
            state.reveal = true;
            options.onReveal(change);

            return;
        }

        options.onMove?.(change);
        revealElements(elements, true);
        updatePosition();
    };

    const step = (direction: number): void => {
        const list = visibleChanges();

        if (list.length === 0 || bar.dataset['busy'] === 'true') {
            return;
        }

        const at = currentIndex(list);
        const current = list[at];
        let target = at + direction;

        // Previous first comes back to a current change that scrolled out of sight, as in the Markdown diff.
        if (direction < 0 && current != null && hasLayout() && !isInView(current)) {
            target = at;
        }

        const next = list[Math.max(0, Math.min(list.length - 1, target))];

        if (next != null) {
            moveTo(next, true);
        }
    };

    // The change a click in the diff landed on, among the ones the bar steps through.
    const changeAt = (target: Element): DiffNavigationChange | null => {
        if (owners == null) {
            const found = new Map<Element, DiffNavigationChange>();

            for (const change of visibleChanges()) {
                for (const element of change.locate()) {
                    found.set(element, change);
                }
            }

            owners = found;
        }

        let element: Element | null = target;

        while (element != null && element !== scroller) {
            const change = owners.get(element);

            if (change != null) {
                return change;
            }

            element = element.parentElement;
        }

        return null;
    };

    const anchorRow = (): Element | null => {
        if (!hasLayout() || typeof document.elementFromPoint !== 'function') {
            return null;
        }

        const box = scroller.getBoundingClientRect();
        const offset = Math.min(ANCHOR_OFFSET_PIXELS, scroller.clientHeight / 3);
        const hit = document.elementFromPoint(box.left + 24, box.top + offset);

        return hit != null && scroller.contains(hit) ? hit.closest(options.rowSelector) : null;
    };

    const viewButtons = VIEWS.map((entry) => h('button', {
        class: 'diff-bar-button',
        text: entry.label,
        dataset: { view: entry.view },
        attrs: { type: 'button', title: entry.title, 'aria-pressed': String(entry.view === state.view) },
        on: { click: () => setView(entry.view) },
    }));

    const setView = (view: DiffBarView): void => {
        const anchor = anchorRow();
        const anchorTop = anchor?.getBoundingClientRect().top ?? 0;
        state.view = view;
        host.dataset['diffView'] = view;
        tops = null;
        owners = null;

        for (const button of viewButtons) {
            button.setAttribute('aria-pressed', String(button.dataset['view'] === view));
        }

        if (anchor != null && isRendered(anchor)) {
            scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
        }

        updatePosition();
    };

    const stepButtons = STEPS.map((entry) => h('button', {
        class: 'diff-bar-button diff-bar-step',
        text: entry.text,
        dataset: { step: String(entry.direction) },
        attrs: { type: 'button', title: entry.title, 'aria-label': entry.label },
        on: { click: () => step(entry.direction) },
    }));

    const onRecompute = options.onRecompute;
    const recomputeButton = onRecompute == null
        ? null
        : h('button', {
            class: 'diff-bar-button diff-bar-recompute',
            text: '↻',
            dataset: { action: 'recompute' },
            attrs: { type: 'button', title: 'Recompute', 'aria-label': 'Recompute' },
            on: {
                click: () => {
                    showDiffBarBusy(host);
                    // A frame first, so the progress shows before the comparison holds the page.
                    requestAnimationFrame(() => window.setTimeout(onRecompute, 0));
                },
            },
        });

    const bar = h('div', {
        class: 'diff-bar',
        attrs: { role: 'toolbar', 'aria-label': 'Diff view' },
        children: [
            h('div', { class: 'diff-bar-views', attrs: { role: 'group', 'aria-label': 'Show' }, children: viewButtons }),
            stepButtons[0],
            position,
            stepButtons[1],
            recomputeButton,
        ],
    });

    // Keeps the bar clear of the scroll area's own scrollbars.
    const measure = (): void => {
        tops = null;
        bar.style.setProperty('--diff-bar-scrollbar-x', `${Math.max(0, scroller.offsetWidth - scroller.clientWidth)}px`);
        bar.style.setProperty('--diff-bar-scrollbar-y', `${Math.max(0, scroller.offsetHeight - scroller.clientHeight)}px`);
        updatePosition();
    };

    const scheduleUpdate = (): void => {
        if (updatePending) {
            return;
        }

        updatePending = true;
        requestAnimationFrame(() => {
            updatePending = false;
            updatePosition();
        });
    };


    host.classList.add('diff-bar-host');
    host.dataset['diffView'] = state.view;
    host.append(bar);
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    scroller.addEventListener('click', (event) => {
        const target = event.target as Element | null;

        if (target == null || target.closest(CONTROL_SELECTOR) != null || String(window.getSelection?.() ?? '') !== '') {
            return;
        }

        const change = changeAt(target);

        if (change == null) {
            return;
        }

        setCurrentChange(state, change.id);
        options.onMove?.(change);
        updatePosition();
    });
    options.keyScope.addEventListener('keydown', (event) => {
        const direction = STEP_KEYS[event.key];
        const isModified = event.ctrlKey || event.metaKey || event.altKey;

        if (direction == null || event.defaultPrevented || isModified || isTypingTarget(event.target)) {
            return;
        }

        if (visibleChanges().length === 0) {
            return;
        }

        event.preventDefault();
        step(direction);
    });

    observeResize(scroller, measure);

    updatePosition();

    // Two frames, so the remembered scroll offset is back before the position is read or a change is revealed.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!bar.isConnected) {
            return;
        }

        measure();
        const pending = state.reveal ? options.changes().find((change) => change.id === state.current) : null;

        if (pending == null) {
            return;
        }

        state.reveal = false;

        if (!isShownInView(pending.sides, state.view)) {
            setView('diff');
        }

        moveTo(pending, false);
    }));

    return { bar, step, setView };
}
