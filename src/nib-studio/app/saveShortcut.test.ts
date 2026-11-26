import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSaveShortcutGuard } from './saveShortcut.js';

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);

    return event;
}

describe('registerSaveShortcutGuard', () => {
    let remove: (() => void) | null = null;

    afterEach(() => {
        remove?.();
        remove = null;
        document.body.replaceChildren();
    });

    it('keeps Ctrl+S and Cmd+S anywhere in the page from reaching the browser', () => {
        remove = registerSaveShortcutGuard(document);
        const table = document.createElement('div');
        document.body.append(table);

        expect(press(table, { key: 's', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(press(table, { key: 'S', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
        expect(press(document.body, { key: 's', metaKey: true }).defaultPrevented).toBe(true);
    });

    it('keeps Ctrl+S with a second layout such as Greek from reaching the browser', () => {
        let saves = 0;
        remove = registerSaveShortcutGuard(document, () => {
            saves += 1;
        });

        expect(press(document.body, { key: 'σ', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(saves).toBe(1);
    });

    it('leaves other keys, Alt+S and a plain S alone', () => {
        remove = registerSaveShortcutGuard(document);

        expect(press(document.body, { key: 's' }).defaultPrevented).toBe(false);
        expect(press(document.body, { key: 's', ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
        expect(press(document.body, { key: 'f', ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('lets an editor that saves with Ctrl+S see the key first', () => {
        remove = registerSaveShortcutGuard(document);
        const editor = document.createElement('div');
        document.body.append(editor);
        let saved = false;
        editor.addEventListener('keydown', () => {
            saved = true;
        });

        press(editor, { key: 's', ctrlKey: true });

        expect(saved).toBe(true);
    });

    it('runs onSave for Ctrl+S outside an editor, once per press', () => {
        let saves = 0;
        remove = registerSaveShortcutGuard(document, () => {
            saves += 1;
        });

        press(document.body, { key: 's', ctrlKey: true });
        press(document.body, { key: 's', ctrlKey: true, repeat: true });

        expect(saves).toBe(1);
    });

    it('leaves the save to an editor that handled Ctrl+S itself', () => {
        let saves = 0;
        remove = registerSaveShortcutGuard(document, () => {
            saves += 1;
        });
        const editor = document.createElement('div');
        document.body.append(editor);
        editor.addEventListener('keydown', (event) => event.preventDefault());

        press(editor, { key: 's', ctrlKey: true });

        expect(saves).toBe(0);
    });

    it('stops guarding once removed', () => {
        registerSaveShortcutGuard(document)();

        expect(press(document.body, { key: 's', ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('runs on a window after the page\'s own key handlers, which can take Ctrl+S for themselves', () => {
        const onSave = vi.fn();
        remove = registerSaveShortcutGuard(window, onSave);

        expect(press(document.body, { key: 's', ctrlKey: true }).defaultPrevented).toBe(true);

        const takeKey = (event: Event): void => event.preventDefault();
        document.addEventListener('keydown', takeKey);
        press(document.body, { key: 's', ctrlKey: true });
        document.removeEventListener('keydown', takeKey);

        expect(onSave).toHaveBeenCalledTimes(1);
    });
});
