import { h } from '../app/dom.js';

// The popover under a diff toolbar button, such as Rules (n) and Compare rules: one open at a time,
// closed by Esc, a click outside or the button again, with Tab and the arrow keys kept inside it.

export interface DiffPopoverOptions {
    readonly button: HTMLButtonElement;
    // Names the popover for assistive technology, such as `Compare rules`.
    readonly label: string;
    // Draws what the popover holds; refresh draws it again in place, keeping focus on the same control.
    readonly build: (refresh: () => void) => ReadonlyArray<HTMLElement>;
    // A popover open for the same owner stays open when the diff draws again, moving under the new button.
    readonly owner?: object;
}

// A control by what it is and by where it sits, to focus it again once the content is drawn anew.
interface FocusMemory {
    readonly identity: string;
    readonly index: number;
}

interface OpenPopover {
    readonly element: HTMLElement;
    readonly owner: object | null;
    button: HTMLButtonElement;
    build: DiffPopoverOptions['build'];
    // The control that last had focus, to go back to once a dialog over the popover closes.
    lastFocus: FocusMemory | null;
    readonly detach: () => void;
}

const POPOVER_MARGIN_PIXELS = 8;

const POPOVER_WIDTH_PIXELS = 380;

const POPOVER_GAP_PIXELS = 4;

const MIN_ROOM_PIXELS = 160;

const CONTROL_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

const STEP_KEYS: Readonly<Record<string, number>> = Object.freeze({
    ArrowDown: 1,
    ArrowUp: -1,
});

let open: OpenPopover | null = null;

export function attachDiffPopover(options: DiffPopoverOptions): void {
    const { button } = options;
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
        if (open?.button === button) {
            close(open, true);

            return;
        }

        openPopover(options);
    });

    const current = open;

    if (current != null && current.owner != null && current.owner === options.owner) {
        adopt(current, options);

        return;
    }

    button.setAttribute('aria-expanded', 'false');
    closeDiffPopover();
}

// Closes the open popover, such as before a rule it lists is edited.
export function closeDiffPopover(): void {
    if (open != null) {
        close(open, false);
    }
}

function openPopover(options: DiffPopoverOptions): void {
    closeDiffPopover();

    const element = h('div', {
        class: 'diff-rules-popover',
        attrs: { role: 'dialog', 'aria-label': options.label },
    });
    const observer = new MutationObserver(() => {
        // The button left the page, such as when another tab is shown.
        if (!current.button.isConnected) {
            close(current, false);
        }
    });
    const onOutside = (event: Event): void => {
        const target = event.target as Node | null;

        if (!element.contains(target) && !current.button.contains(target) && !isInDialog(target)) {
            close(current, false);
        }
    };
    const onKey = (event: KeyboardEvent): void => handleKey(current, event);
    const onFocus = (event: FocusEvent): void => {
        current.lastFocus = rememberFocus(element, event.target as HTMLElement);
    };
    const onResize = (): void => place(current);
    const current: OpenPopover = {
        element,
        owner: options.owner ?? null,
        button: options.button,
        build: options.build,
        lastFocus: null,
        detach: () => {
            observer.disconnect();
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onResize);
        },
    };

    open = current;
    element.addEventListener('focusin', onFocus);
    element.append(...current.build(() => refresh(current)));
    document.body.append(element);
    place(current);
    options.button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    observer.observe(document.body, { childList: true, subtree: true });
    tabStopsOf(element)[0]?.focus();
}

function close(current: OpenPopover, returnFocus: boolean): void {
    if (open !== current) {
        return;
    }

    open = null;
    current.detach();
    current.element.remove();
    current.button.setAttribute('aria-expanded', 'false');

    if (returnFocus && current.button.isConnected) {
        current.button.focus();
    }
}

// The diff drew again for the popover's owner: it follows the new button and draws its content with the new callbacks.
function adopt(current: OpenPopover, options: DiffPopoverOptions): void {
    current.button = options.button;
    current.build = options.build;
    options.button.setAttribute('aria-expanded', 'true');
    refresh(current);
    // The new button is on the page once the diff is drawn.
    queueMicrotask(() => {
        if (open === current && current.button.isConnected) {
            place(current);
        }
    });
}

function refresh(current: OpenPopover): void {
    if (open !== current) {
        return;
    }

    const { element } = current;
    const active = document.activeElement;
    const hasFocus = active != null && element.contains(active);
    // Focus lost to the page, such as when a dialog over the popover closed, comes back to the popover.
    const isFocusLost = active == null || active === document.body;
    const memory = hasFocus ? rememberFocus(element, active as HTMLElement) : current.lastFocus;

    element.replaceChildren(...current.build(() => refresh(current)));

    if ((!hasFocus && !isFocusLost) || memory == null) {
        return;
    }

    // The same control, or the one now in its place when it is gone, such as a removed pattern's.
    const controls = controlsOf(element);
    const same = controls.find((control) => identityOf(element, control) === memory.identity);
    (same ?? controls[Math.min(memory.index, controls.length - 1)])?.focus();
}

function rememberFocus(element: HTMLElement, control: HTMLElement): FocusMemory | null {
    const index = controlsOf(element).indexOf(control);

    return index < 0 ? null : { identity: identityOf(element, control), index };
}

// The control's kind, value and text, with the data attributes of it and its parents, such as a rule or a pattern.
function identityOf(element: HTMLElement, control: HTMLElement): string {
    const marks: string[] = [];

    for (let node: HTMLElement | null = control; node != null && node !== element; node = node.parentElement) {
        marks.push(JSON.stringify(node.dataset));
    }

    return [control.tagName, (control as HTMLInputElement).value ?? '', control.textContent, ...marks].join('|');
}

function handleKey(current: OpenPopover, event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    // A dialog opened from the popover, such as for a pattern, handles its own keys.
    if (isInDialog(target)) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(current, true);

        return;
    }

    if (target == null || !current.element.contains(target)) {
        return;
    }

    if (event.key === 'Tab') {
        wrapTab(current.element, target, event);

        return;
    }

    const step = STEP_KEYS[event.key];

    // Radios keep their own arrows, which pick the next choice of their group.
    if (step == null || isRadio(target) || event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }

    const stops = tabStopsOf(current.element);
    const index = stops.indexOf(target);

    if (index < 0) {
        return;
    }

    event.preventDefault();
    stops[(index + step + stops.length) % stops.length]?.focus();
}

// Tab past the last control comes back to the first, and Shift+Tab before the first goes to the last.
function wrapTab(element: HTMLElement, target: HTMLElement, event: KeyboardEvent): void {
    const stops = tabStopsOf(element);
    const index = stops.indexOf(target);
    const isAtEdge = event.shiftKey ? index === 0 : index === stops.length - 1;

    if (index < 0 || !isAtEdge) {
        return;
    }

    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
}

function controlsOf(element: HTMLElement): HTMLElement[] {
    return Array
        .from(element.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
        .filter((control) => !(control as HTMLButtonElement).disabled);
}

// The controls Tab stops at: a radio group stops once, at its checked radio, or its first while none is checked.
function tabStopsOf(element: HTMLElement): HTMLElement[] {
    const controls = controlsOf(element);

    return controls.filter((control) => {
        if (!isRadio(control) || control.checked) {
            return true;
        }

        const group = controls.filter((other) => isRadio(other) && other.name === control.name);

        return group[0] === control && !group.some((other) => (other as HTMLInputElement).checked);
    });
}

function isRadio(element: Element): element is HTMLInputElement {
    return element instanceof HTMLInputElement && element.type === 'radio';
}

function isInDialog(target: Node | null): boolean {
    return target instanceof Element && target.closest('.modal-backdrop') != null;
}

// Under the button, right-aligned with it, within the window, and no taller than the room below it.
function place(current: OpenPopover): void {
    const { element } = current;
    const rect = current.button.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH_PIXELS, window.innerWidth - POPOVER_MARGIN_PIXELS * 2);
    const left = Math.min(rect.right - width, window.innerWidth - width - POPOVER_MARGIN_PIXELS);
    const top = rect.bottom + POPOVER_GAP_PIXELS;
    const room = Math.max(MIN_ROOM_PIXELS, window.innerHeight - top - POPOVER_MARGIN_PIXELS);

    element.style.width = `${width}px`;
    element.style.left = `${Math.max(POPOVER_MARGIN_PIXELS, left)}px`;
    element.style.top = `${top}px`;
    element.style.setProperty('--diff-popover-room', `${room}px`);
}
