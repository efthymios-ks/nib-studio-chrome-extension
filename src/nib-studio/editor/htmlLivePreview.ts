import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { htmlLiveEditing } from './htmlLiveEditing.js';
import { htmlLiveField } from './htmlLiveItems.js';
import { closeLinkPopover } from './linkPopover.js';

// Edits HTML like a document while the file stays HTML, byte for byte apart from the edits.
// Tags are hidden and the caret, the arrow keys and Backspace pass over them;
// text takes the look of its elements,
// list items show bullets or numbers, images show from the workspace, and `<head>`, styles, scripts, comments
// and other elements with no text to edit show as small labelled boxes, edited in the Editor view.
export function htmlLivePreview(): Extension {
    return [
        htmlLiveField,
        htmlLiveEditing(),
        EditorView.editorAttributes.of({ 'data-live-preview': 'true', 'data-live-kind': 'html' }),
        ViewPlugin.define((view) => ({
            destroy: () => closeLinkPopover(view),
        })),
    ];
}
