import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { htmlToMarkdown } from './htmlToMarkdown.js';
import { shortcutLetter } from '../app/shortcutKey.js';

// How long after Ctrl+Shift+V the paste it starts counts as a plain-text paste.
const PLAIN_PASTE_WINDOW_MS = 1000;

const plainPasteRequests = new WeakMap<EditorView, number>();

// Pastes HTML from the clipboard, such as a web page, Word or Google Docs selection, as Markdown.
// Plain text pastes as is, and Ctrl+Shift+V always pastes plain text.
export function markdownPasteHandling(): Extension {
    return EditorView.domEventHandlers({
        keydown: (event, view) => {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && shortcutLetter(event) === 'v') {
                plainPasteRequests.set(view, Date.now());
            }

            return false;
        },
        paste: (event, view) => pasteAsMarkdown(event, view),
    });
}

// Returns whether the paste was handled; when not, the editor pastes the clipboard's plain text.
function pasteAsMarkdown(event: ClipboardEvent, view: EditorView): boolean {
    const requestedAt = plainPasteRequests.get(view);
    plainPasteRequests.delete(view);

    if (requestedAt != null && Date.now() - requestedAt <= PLAIN_PASTE_WINDOW_MS) {
        return false;
    }

    const html = event.clipboardData?.getData('text/html') ?? '';

    if (view.state.readOnly || html.trim() === '') {
        return false;
    }

    const markdown = htmlToMarkdown(html);

    if (markdown == null) {
        return false;
    }

    event.preventDefault();
    view.dispatch(view.state.replaceSelection(markdown), { userEvent: 'input.paste', scrollIntoView: true });

    return true;
}
