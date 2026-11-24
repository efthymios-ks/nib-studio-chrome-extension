import { shortcutLetter } from '../app/shortcutKey.js';

// An undo history for a plain text box that outlives the box, so a box drawn again, such as after a trip
// to another view, still undoes back through everything typed into the ones before it.
// The browser's own history ends with the element it belongs to.

export interface TextBoxSnapshot {
    readonly value: string;
    readonly start: number;
    readonly end: number;
}

type EditKind = 'typing' | 'deleting' | 'other';

export interface TextBoxHistory {
    // The box as it was before each step, the oldest first.
    readonly done: TextBoxSnapshot[];
    readonly undone: TextBoxSnapshot[];
    // The box as the last change left it.
    present: TextBoxSnapshot | null;
    lastEdit: { readonly kind: EditKind; readonly time: number; readonly caret: number } | null;
}

export interface TextBoxHistoryOptions {
    readonly now?: () => number;
}

type TextBox = HTMLInputElement | HTMLTextAreaElement;

// Typing that pauses longer than this starts a new step, as in the browser's own boxes.
const GROUP_PAUSE_MS = 1_000;

const MAX_STEPS = 500;

const EDIT_KINDS: Readonly<Record<string, EditKind>> = Object.freeze({
    insertText: 'typing',
    insertLineBreak: 'typing',
    insertParagraph: 'typing',
    insertCompositionText: 'typing',
    deleteContentBackward: 'deleting',
    deleteContentForward: 'deleting',
});

// The input events a restored step sends, which the history itself leaves alone.
const HISTORY_INPUT_TYPES = new Set(['historyUndo', 'historyRedo']);

export function createTextBoxHistory(): TextBoxHistory {
    return { done: [], undone: [], present: null, lastEdit: null };
}

// Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, and the browser's own Undo and Redo, step through the history.
// When the box starts with a text other than the one the history last saw, as when a view puts an expression in it,
// the change is a step of its own.
export function attachTextBoxHistory(box: TextBox, history: TextBoxHistory, options: TextBoxHistoryOptions = {}): void {
    const now = options.now ?? (() => Date.now());
    const element: HTMLElement = box;
    recordOutsideChange(box, history);

    element.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) {
            return;
        }

        const letter = shortcutLetter(event);

        if (letter === 'z') {
            event.preventDefault();
            step(box, history, event.shiftKey ? 'redo' : 'undo');

            return;
        }

        if (letter === 'y') {
            event.preventDefault();
            step(box, history, 'redo');
        }
    });

    element.addEventListener('beforeinput', (event) => {
        if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            event.preventDefault();
            step(box, history, event.inputType === 'historyUndo' ? 'undo' : 'redo');

            return;
        }

        // The caret may have moved since the last change, by a click or an arrow key.
        if (history.present?.value === box.value) {
            history.present = snapshotOf(box);
        }
    });

    element.addEventListener('input', (event) => {
        const inputType = event instanceof InputEvent ? event.inputType : '';

        if (HISTORY_INPUT_TYPES.has(inputType)) {
            return;
        }

        const kind = EDIT_KINDS[inputType] ?? 'other';
        const before = history.present ?? snapshotOf(box);
        const time = now();
        const last = history.lastEdit;
        const continues = kind !== 'other'
            && last != null
            && last.kind === kind
            && time - last.time < GROUP_PAUSE_MS
            && before.start === before.end
            && before.start === last.caret;

        if (!continues) {
            pushStep(history, before);
        }

        history.present = snapshotOf(box);
        history.lastEdit = { kind, time, caret: box.selectionStart ?? box.value.length };
    });
}

// Puts a text in the box as one step of its own, such as an example picked from a help list.
export function setTextBoxValue(box: TextBox, history: TextBoxHistory, value: string): void {
    if (box.value === value) {
        return;
    }

    pushStep(history, history.present ?? snapshotOf(box));
    box.value = value;
    box.setSelectionRange(value.length, value.length);
    history.present = snapshotOf(box);
    history.lastEdit = null;
}

function recordOutsideChange(box: TextBox, history: TextBoxHistory): void {
    const present = history.present;

    if (present != null && present.value !== box.value) {
        pushStep(history, present);
    }

    history.present = snapshotOf(box);
    history.lastEdit = null;
}

function pushStep(history: TextBoxHistory, snapshot: TextBoxSnapshot): void {
    history.done.push(snapshot);
    history.undone.length = 0;

    if (history.done.length > MAX_STEPS) {
        history.done.splice(0, history.done.length - MAX_STEPS);
    }
}

function step(box: TextBox, history: TextBoxHistory, direction: 'undo' | 'redo'): void {
    const from = direction === 'undo' ? history.done : history.undone;
    const to = direction === 'undo' ? history.undone : history.done;
    const target = from.pop();

    if (target == null) {
        return;
    }

    to.push(snapshotOf(box));
    box.value = target.value;
    box.setSelectionRange(target.start, target.end);
    history.present = target;
    history.lastEdit = null;
    box.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: direction === 'undo' ? 'historyUndo' : 'historyRedo',
    }));
}

function snapshotOf(box: TextBox): TextBoxSnapshot {
    const end = box.value.length;

    return { value: box.value, start: box.selectionStart ?? end, end: box.selectionEnd ?? end };
}
