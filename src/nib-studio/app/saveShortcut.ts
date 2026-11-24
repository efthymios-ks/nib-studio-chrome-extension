import { shortcutLetter } from './shortcutKey.js';

// Ctrl+S never opens the browser's Save as dialog in the studio. The editors save with it themselves;
// anywhere else onSave runs, which saves the active file when its Save button can,
// and does nothing in a preview, a table or a diff tab.
// Returns the function that removes the guard.
export function registerSaveShortcutGuard(target: Document, onSave: () => void = () => {}): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || shortcutLetter(event) !== 's') {
            return;
        }

        const isHandled = event.defaultPrevented;
        event.preventDefault();

        if (!isHandled && !event.repeat) {
            onSave();
        }
    };
    target.addEventListener('keydown', onKeyDown);

    return () => target.removeEventListener('keydown', onKeyDown);
}
