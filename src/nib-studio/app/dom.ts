export type AttributeValue = string | number | boolean | null | undefined;

export interface ElementOptions {
    readonly class?: string;
    readonly text?: string;
    readonly html?: string;
    readonly attrs?: Readonly<Record<string, AttributeValue>>;
    readonly dataset?: Readonly<Record<string, string>>;
    readonly on?: Readonly<Record<string, EventListener>>;
    readonly aria?: Readonly<Record<string, string>>;
    readonly children?: ReadonlyArray<Node | string | null | undefined>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: ElementOptions,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (options?.class != null) {
        element.className = options.class;
    }

    if (options?.text != null) {
        element.textContent = options.text;
    }

    if (options?.html != null) {
        element.innerHTML = options.html;
    }

    if (options?.attrs != null) {
        for (const [name, value] of Object.entries(options.attrs)) {
            applyAttribute(element, name, value);
        }
    }

    if (options?.dataset != null) {
        for (const [name, value] of Object.entries(options.dataset)) {
            element.dataset[name] = value;
        }
    }

    if (options?.aria != null) {
        for (const [name, value] of Object.entries(options.aria)) {
            element.setAttribute(`aria-${name}`, value);
        }
    }

    if (options?.on != null) {
        for (const [event, handler] of Object.entries(options.on)) {
            element.addEventListener(event, handler);
        }
    }

    if (options?.children != null) {
        for (const child of options.children) {
            if (child == null) {
                continue;
            }

            if (typeof child === 'string') {
                element.append(document.createTextNode(child));
            }
            else {
                element.append(child);
            }
        }
    }

    return element;
}

export function clear(element: Element): void {
    while (element.firstChild != null) {
        element.removeChild(element.firstChild);
    }
}

// The element that has the keyboard, kept by a dialog or popover to give it back when it closes; null for none.
export function focusedElement(): HTMLElement | null {
    const active = document.activeElement;

    return active instanceof HTMLElement && active !== document.body ? active : null;
}

// Gives the keyboard to the first of the elements still on the page, such as where it was before a dialog opened.
export function returnFocus(...candidates: ReadonlyArray<HTMLElement | null | undefined>): void {
    const target = candidates.find((element) => element != null && element !== document.body && element.isConnected);
    target?.focus({ preventScroll: true });
}

function applyAttribute(element: HTMLElement, name: string, value: AttributeValue): void {
    if (value === null || value === undefined || value === false) {
        element.removeAttribute(name);

        return;
    }

    if (value === true) {
        element.setAttribute(name, '');

        return;
    }

    element.setAttribute(name, String(value));
}
