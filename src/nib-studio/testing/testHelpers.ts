// Shared helpers for the studio tests, which run under happy-dom.
import { vi } from 'vitest';
import type { OpenFile } from '../app/store.js';

// Lets queued microtasks and zero-delay timers run so async renders settle.
export async function settleAsync(rounds = 20): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

// Lets queued microtasks run without advancing timers, so it also works under fake timers.
export async function flushAsync(rounds = 20): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

export async function waitForFrameAsync(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

export function clickDialogButton(label: string): void {
    const match = [...document.querySelectorAll<HTMLButtonElement>('.modal-footer button')].find((button) => button.textContent === label);

    if (match == null) {
        throw new Error(`No button labelled "${label}"`);
    }

    match.click();
}

// Happy-dom fires selectionchange inside CodeMirror updates while the editor has focus; browsers do not.
// Register in the capture phase on document to keep CodeMirror from reacting to it.
export function ignoreSelectionChange(event: Event): void {
    event.stopImmediatePropagation();
}

// Moves focus out of a CodeMirror editor so happy-dom stops firing selectionchange for it.
export function blurEditor(): void {
    (document.activeElement as HTMLElement | null)?.blur();
}

export interface FakeMediaQuery {
    readonly query: string;
    matches: boolean;
    // Flips the match and notifies the change listeners, like resizing the window across the breakpoint.
    readonly change: (matches: boolean) => void;
}

// Replaces window.matchMedia so `query` reports `matches`; every other query reports false.
// Undo with vi.unstubAllGlobals().
export function stubMatchMedia(query: string, matches: boolean): FakeMediaQuery {
    const listeners = new Set<() => void>();
    const fake: FakeMediaQuery = {
        query,
        matches,
        change: (next) => {
            fake.matches = next;

            for (const listener of listeners) {
                listener();
            }
        },
    };

    vi.stubGlobal('matchMedia', (requested: string) => ({
        media: requested,
        get matches(): boolean {
            return requested === query && fake.matches;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));

    return fake;
}

export interface FakeClipboardEvent {
    readonly event: Event;
    // What a copy or cut wrote, by type.
    readonly written: Map<string, string>;
}

// A paste, copy or cut event whose clipboardData holds `data` by type, which happy-dom cannot build itself.
export function clipboardEvent(type: 'paste' | 'copy' | 'cut', data: Readonly<Record<string, string>> = {}): FakeClipboardEvent {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const written = new Map<string, string>();
    const clipboardData = {
        types: Object.keys(data),
        getData: (format: string) => data[format] ?? '',
        setData: (format: string, value: string) => {
            written.set(format, value);
        },
        clearData: () => written.clear(),
    };
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });

    return { event, written };
}

// A keydown CodeMirror reads as the shortcut, such as `pressKey(content, 'b', { ctrlKey: true })`.
export function pressKey(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        keyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
        bubbles: true,
        cancelable: true,
        ...modifiers,
    });
    target.dispatchEvent(event);

    return event;
}

const KEY_CODES: Readonly<Record<string, number>> = Object.freeze({
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Escape: 27,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
});

export function openFileFixture(path: string, text = '', overrides: Partial<OpenFile> = {}): OpenFile {
    return { path, text, originalText: text, lineEnding: '\n', dirty: false, view: 'editor', file: null, preview: false, ...overrides };
}

// The text of every toast on the page, oldest first.
export function toastTexts(): string[] {
    return [...document.querySelectorAll('.toast')].map((toast) => toast.textContent ?? '');
}

// The first button in the container whose text is exactly `text`.
export function buttonByText(container: ParentNode, text: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === text);
}

// The labels of the editor toolbar's view tabs, in order.
export function viewTabLabels(container: ParentNode): string[] {
    return [...container.querySelectorAll('.editor-toolbar .view-tab')].map((tab) => tab.textContent ?? '');
}

// The label of the editor toolbar's pressed view tab, or null when none is.
export function activeViewTab(container: ParentNode): string | null {
    return container.querySelector('.editor-toolbar .view-tab[data-active="true"]')?.textContent ?? null;
}
