// Mounts one Hash & encode card on its own, with fresh state, for the card tests.
import { vi } from 'vitest';
import { createHashSurfaceState, type HashSurfaceState } from '../views/hashSurfaceState.js';
import type { ToolCard, ToolCardContext } from '../views/toolCard.js';

export interface MountedCard {
    readonly state: HashSurfaceState;
    readonly context: ToolCardContext;
    readonly element: HTMLElement;
    readonly unmount: () => void;
}

export function mountCard(build: (context: ToolCardContext) => ToolCard, prepare?: (state: HashSurfaceState) => void): MountedCard {
    const state = createHashSurfaceState();
    prepare?.(state);
    const cards: ToolCard[] = [];
    const context: ToolCardContext = {
        state,
        refresh: () => {
            for (const card of cards) {
                card.update();
            }
        },
    };
    const card = build(context);
    cards.push(card);
    document.body.append(card.element);
    context.refresh();

    return { state, context, element: card.element, unmount: () => card.element.remove() };
}

export function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function pressEnter(field: HTMLElement, modifiers: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers });
    field.dispatchEvent(event);

    return event;
}

// Replaces the clipboard with a spy; undo with vi.unstubAllGlobals().
export function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    return writeText;
}

export function lastToast(): string | null {
    return [...document.querySelectorAll('.toast')].at(-1)?.textContent ?? null;
}

export function digestOf(element: HTMLElement, key: string): string {
    return element.querySelector(`.digest-row[data-key="${key}"] .digest-value`)?.textContent ?? '';
}
