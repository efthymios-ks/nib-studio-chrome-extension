import { isolateHistory } from '@codemirror/commands';
import {
    ChangeSet,
    EditorSelection,
    type Annotation,
    type ChangeSpec,
    type EditorState,
    type SelectionRange,
    type TransactionSpec,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// Makes a change one undo step of its own, never merged with typing around it, and scrolls it into view.
// The annotations go along, such as one that tells the view's filters the change is made on purpose.
export function asUndoStep(
    spec: TransactionSpec,
    userEvent: string,
    ...annotations: ReadonlyArray<Annotation<unknown>>
): TransactionSpec {
    return {
        ...spec,
        scrollIntoView: true,
        userEvent,
        annotations: [isolateHistory.of('full'), ...annotations],
    };
}

// The changes, with the caret kept beside the same text, after anything inserted where it is.
export function changesKeepingCaret(state: EditorState, changes: ChangeSpec, caret: number): TransactionSpec {
    const changeSet = ChangeSet.of(changes, state.doc.length);

    return { changes: changeSet, selection: EditorSelection.cursor(changeSet.mapPos(caret, 1)) };
}

// Runs a command on the view's state and dispatches the change it gives;
// false when the view is read-only or the command has nothing to do, so the key goes on to its next binding.
export function dispatchCommand(view: EditorView, command: (state: EditorState) => TransactionSpec | null): boolean {
    if (view.state.readOnly) {
        return false;
    }

    const spec = command(view.state);

    if (spec == null) {
        return false;
    }

    view.dispatch(spec);

    return true;
}

// The word around an empty selection, or the selection itself.
export function expandToWord(state: EditorState, range: SelectionRange): SelectionRange {
    if (!range.empty) {
        return range;
    }

    return state.wordAt(range.head) ?? range;
}
