import { afterEach, describe, expect, it } from 'vitest';
import { history, isolateHistory, undoDepth } from '@codemirror/commands';
import { Annotation, EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { asUndoStep, changesKeepingCaret, dispatchCommand, expandToWord } from './liveTransactions.js';

const madeOnPurpose = Annotation.define<boolean>();

const views: EditorView[] = [];

function mountView(doc: string, extensions = EditorState.readOnly.of(false)): EditorView {
    const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent: document.body });
    views.push(view);

    return view;
}

afterEach(() => {
    for (const view of views.splice(0)) {
        view.destroy();
    }

    document.body.replaceChildren();
});

describe('asUndoStep', () => {
    it('keeps the change and adds its user event, scrolling and a history break', () => {
        const spec = asUndoStep({ changes: { from: 0, insert: '**' } }, 'input.format');
        const transaction = EditorState.create({ doc: 'bold' }).update(spec);

        expect(transaction.state.doc.toString()).toBe('**bold');
        expect(transaction.isUserEvent('input.format')).toBe(true);
        expect(transaction.scrollIntoView).toBe(true);
        expect(transaction.annotation(isolateHistory)).toBe('full');
    });

    it('carries the annotations it is given', () => {
        const transaction = EditorState.create({ doc: 'text' }).update(asUndoStep({}, 'input.html', madeOnPurpose.of(true)));

        expect(transaction.annotation(madeOnPurpose)).toBe(true);
        expect(transaction.annotation(isolateHistory)).toBe('full');
        expect(transaction.annotation(Transaction.userEvent)).toBe('input.html');
    });

    it('makes its own undo step, never merged with the typing before it', () => {
        let state = EditorState.create({ doc: '', extensions: history() });
        state = state.update({ changes: { from: 0, insert: 'a' }, userEvent: 'input.type' }).state;
        state = state.update(asUndoStep({ changes: { from: 1, insert: 'b' } }, 'input.type')).state;

        expect(undoDepth(state)).toBe(2);
    });
});

describe('changesKeepingCaret', () => {
    it('keeps the caret beside the same text, after anything inserted where it is', () => {
        const state = EditorState.create({ doc: '<p>text</p>' });
        const spec = changesKeepingCaret(state, [{ from: 1, to: 2, insert: 'h1' }, { from: 9, to: 10, insert: 'h1' }], 5);
        const transaction = state.update(spec);

        expect(transaction.state.doc.toString()).toBe('<h1>text</h1>');
        expect(transaction.state.selection.main.head).toBe(6);
    });

    it('puts the caret after text inserted at it', () => {
        const state = EditorState.create({ doc: 'ab' });
        const transaction = state.update(changesKeepingCaret(state, { from: 1, insert: '<li>' }, 1));

        expect(transaction.state.doc.toString()).toBe('a<li>b');
        expect(transaction.state.selection.main.head).toBe(5);
    });
});

describe('dispatchCommand', () => {
    const insertX = (state: EditorState): TransactionSpec => ({ changes: { from: state.doc.length, insert: 'x' } });

    it('dispatches the change the command gives', () => {
        const view = mountView('a');

        expect(dispatchCommand(view, insertX)).toBe(true);
        expect(view.state.doc.toString()).toBe('ax');
    });

    it('lets the key go on when the command has nothing to do', () => {
        const view = mountView('a');

        expect(dispatchCommand(view, () => null)).toBe(false);
        expect(view.state.doc.toString()).toBe('a');
    });

    it('does nothing in a read-only view', () => {
        const view = mountView('a', EditorState.readOnly.of(true));
        let isRun = false;

        expect(dispatchCommand(view, (state) => {
            isRun = true;

            return insertX(state);
        })).toBe(false);
        expect(isRun).toBe(false);
        expect(view.state.doc.toString()).toBe('a');
    });
});

describe('expandToWord', () => {
    const state = EditorState.create({ doc: 'one two  three' });

    it('gives the word around a caret', () => {
        const word = expandToWord(state, EditorSelection.cursor(5));

        expect([word.from, word.to]).toEqual([4, 7]);
    });

    it('keeps a selection as it is', () => {
        const selection = EditorSelection.range(1, 6);

        expect(expandToWord(state, selection)).toBe(selection);
    });

    it('keeps a caret with no word around it', () => {
        const caret = EditorSelection.cursor(8);

        expect(expandToWord(state, caret)).toBe(caret);
    });
});
