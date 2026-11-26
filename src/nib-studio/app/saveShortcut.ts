import { shortcutLetter } from './shortcutKey.js';

// Ctrl+S never opens the browser's Save as dialog in the studio. The editors save with it themselves;
// anywhere else onSave runs, which saves the active file when its Save button can,
// and does nothing in a preview, a table or a diff tab.
// On a window, it runs after the page's own key handlers, so a page that takes Ctrl+S keeps it.
// Returns the function that removes the guard.
export function registerSaveShortcutGuard(target: Document | Window, onSave: () => void = () => {}): () => void {
    const onKeyDown = (event: Event): void => {
        const press = event as KeyboardEvent;

        if (!isSaveShortcut(press)) {
            return;
        }

        const isHandled = press.defaultPrevented;
        press.preventDefault();

        if (!isHandled && !press.repeat) {
            onSave();
        }
    };
    target.addEventListener('keydown', onKeyDown);

    return () => target.removeEventListener('keydown', onKeyDown);
}

function isSaveShortcut(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) && !event.altKey && shortcutLetter(event) === 's';
}
