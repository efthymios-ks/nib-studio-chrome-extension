import { afterEach, describe, expect, it } from 'vitest';
import { attachTextBoxHistory, createTextBoxHistory, setTextBoxValue, type TextBoxHistory } from './textBoxHistory.js';

let now = 0;

function makeBox(value = '', history: TextBoxHistory = createTextBoxHistory()): HTMLTextAreaElement {
    const box = document.createElement('textarea');
    box.value = value;
    document.body.append(box);
    attachTextBoxHistory(box, history, { now: () => now });

    return box;
}

// Changes the box as the browser does for an edit of this kind: the value first, then an input event.
function edit(box: HTMLTextAreaElement, value: string, inputType = 'insertText'): void {
    box.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
    box.value = value;
    box.setSelectionRange(value.length, value.length);
    box.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
}

function type(box: HTMLTextAreaElement, text: string): void {
    for (const character of text) {
        now += 50;
        edit(box, box.value + character);
    }
}

function press(box: HTMLTextAreaElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    box.dispatchEvent(event);

    return event;
}

function undo(box: HTMLTextAreaElement): KeyboardEvent {
    return press(box, { key: 'z', code: 'KeyZ', ctrlKey: true });
}

function redo(box: HTMLTextAreaElement): KeyboardEvent {
    return press(box, { key: 'y', code: 'KeyY', ctrlKey: true });
}

afterEach(() => {
    now = 0;
    document.body.replaceChildren();
});

describe('attachTextBoxHistory', () => {
    it('undoes a run of typing in one step, and a paste in one of its own', () => {
        const box = makeBox('{');
        type(box, '"a"');
        now += 50;
        edit(box, '{"a": 1}', 'insertFromPaste');

        expect(undo(box).defaultPrevented).toBe(true);
        expect(box.value).toBe('{"a"');

        undo(box);
        expect(box.value).toBe('{');
    });

    it('starts a new step after a pause, and when typing gives way to deleting', () => {
        const box = makeBox('');
        type(box, 'ab');
        now += 5_000;
        type(box, 'cd');
        now += 50;
        edit(box, 'abc', 'deleteContentBackward');

        undo(box);
        expect(box.value).toBe('abcd');

        undo(box);
        expect(box.value).toBe('ab');

        undo(box);
        expect(box.value).toBe('');
    });

    it('redoes what was undone with Ctrl+Y and Ctrl+Shift+Z, until a new edit', () => {
        const box = makeBox('');
        type(box, 'one');
        now += 5_000;
        type(box, ' two');
        undo(box);
        undo(box);

        expect(redo(box).defaultPrevented).toBe(true);
        expect(box.value).toBe('one');

        press(box, { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
        expect(box.value).toBe('one two');

        undo(box);
        now += 5_000;
        type(box, '!');
        redo(box);
        expect(box.value).toBe('one!');
    });

    it('tells the box\'s own listeners about each undo, as an input event', () => {
        const box = makeBox('');
        const inputTypes: string[] = [];
        box.addEventListener('input', (event) => inputTypes.push((event as InputEvent).inputType));
        type(box, 'a');

        undo(box);
        redo(box);

        expect(inputTypes).toEqual(['insertText', 'historyUndo', 'historyRedo']);
    });

    it('takes the browser\'s own Undo and Redo, such as from the context menu', () => {
        const box = makeBox('');
        type(box, 'abc');
        const event = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });

        box.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(box.value).toBe('');
    });

    it('works with a second keyboard layout such as Greek', () => {
        const box = makeBox('');
        type(box, 'abc');

        press(box, { key: 'ζ', code: 'KeyZ', ctrlKey: true });

        expect(box.value).toBe('');
    });

    it('reaches back past a new box drawn with the same history, as after a trip to another view', () => {
        const history = createTextBoxHistory();
        const first = makeBox('{}', history);
        type(first, ' ');
        first.remove();

        const second = makeBox(first.value, history);
        now += 5_000;
        type(second, 'x');
        undo(second);
        undo(second);

        expect(second.value).toBe('{}');
    });

    it('undoes back to the text a box had before its text was set from outside', () => {
        const history = createTextBoxHistory();
        const first = makeBox('$.a', history);
        type(first, 'b');
        first.remove();

        const second = makeBox('$.items[*].name', history);
        undo(second);

        expect(second.value).toBe('$.ab');
    });

    it('undoes a value set by the view itself, such as a picked example', () => {
        const history = createTextBoxHistory();
        const box = makeBox('$.a', history);

        setTextBoxValue(box, history, '$..name');
        undo(box);

        expect(box.value).toBe('$.a');
    });
});
