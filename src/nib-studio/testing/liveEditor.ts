// Mounts Markdown editors in the Interactive view for tests, with the caret or selection written into the text.
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { LocalImageContext } from '../../common/markdown/localImages.js';
import { mountEditor, type EditorHostHandle, type EditorMode } from '../editor/editorHost.js';

export interface LiveEditorOptions {
    readonly withBar?: boolean;
    readonly livePreview?: boolean;
    readonly imageContext?: LocalImageContext;
    // Markdown unless set; `html` mounts the HTML Interactive view.
    readonly mode?: EditorMode;
}

const CARET = '‸';

const mounted: EditorHostHandle[] = [];

// `‸` marks the caret, and `«` and `»` a selection, anchor first; neither is Markdown syntax.
export function mountLiveEditor(textWithCaret: string, options: LiveEditorOptions = {}): EditorHostHandle {
    const { text, anchor, head } = parseMarkedText(textWithCaret);
    const container = document.createElement('div');
    const barSlot = options.withBar === true ? document.createElement('div') : undefined;

    if (barSlot != null) {
        document.body.append(barSlot);
    }

    document.body.append(container);
    const handle = mountEditor(container, {
        initialText: text,
        mode: options.mode ?? 'markdown',
        livePreview: options.livePreview ?? true,
        imageContext: options.imageContext,
        barSlot,
    });
    ensureSyntaxTree(handle.view.state, handle.view.state.doc.length, 5000);
    handle.view.dispatch({ selection: { anchor, head } });
    mounted.push(handle);

    return handle;
}

export function destroyLiveEditors(): void {
    for (const handle of mounted.splice(0)) {
        handle.destroy();
    }
}

function parseMarkedText(marked: string): { text: string; anchor: number; head: number } {
    const selectionStart = marked.indexOf('«');

    if (selectionStart >= 0) {
        const withoutStart = marked.replace('«', '');
        const selectionEnd = withoutStart.indexOf('»');

        return { text: withoutStart.replace('»', ''), anchor: selectionStart, head: selectionEnd };
    }

    const caret = marked.indexOf(CARET);

    return caret < 0
        ? { text: marked, anchor: marked.length, head: marked.length }
        : { text: marked.replace(CARET, ''), anchor: caret, head: caret };
}

// The text with `‸` at the caret, or `«` and `»` around the selection.
export function markedText(view: EditorView): string {
    const { from, to, empty } = view.state.selection.main;
    const text = view.state.doc.toString();

    if (empty) {
        return `${text.slice(0, from)}${CARET}${text.slice(from)}`;
    }

    return `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

// Types as the browser does: the editor's input handlers first, then the plain insert over [from, to).
export function typeAt(
    view: EditorView,
    text: string,
    from = view.state.selection.main.from,
    to = from === view.state.selection.main.from ? view.state.selection.main.to : from,
): void {
    const insert = () => view.state.update({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: 'input.type',
    });
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, insert));

    if (!handled) {
        view.dispatch(insert());
    }
}

// What the editor shows: the text of its lines, without what the Interactive view hides.
export function shownLines(view: EditorView): string[] {
    return [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '');
}
