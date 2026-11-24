import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastToast, pressEnter, stubClipboard } from '../testing/toolCardHarness.js';
import { settleAsync } from '../testing/testHelpers.js';
import {
    buildDigestList,
    buildFormatSelect,
    buildHint,
    buildLabel,
    buildMessage,
    buildToolCard,
    describeError,
    runOnEnter,
    selectAllOnCopyKey,
    selectError,
    showMessage,
    toolId,
} from './toolCard.js';

function pressCopyKey(element: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event);

    return event;
}

afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe('buildToolCard', () => {
    it('is a section named by its heading, with the tools in the header', () => {
        const tool = document.createElement('select');
        const body = document.createElement('p');
        const card = buildToolCard({ id: 'demo', title: 'Demo', tools: [tool], children: [body, null] });

        expect(card.tagName).toBe('SECTION');
        expect(card.dataset['card']).toBe('demo');
        expect(card.getAttribute('aria-labelledby')).toBe(toolId('demo', 'title'));
        expect(card.querySelector(`#${toolId('demo', 'title')}`)?.textContent).toBe('Demo');
        expect(card.querySelector('.tool-card-header select')).toBe(tool);
        expect(card.lastElementChild).toBe(body);
    });

    it('builds labels for a field and a hint with an id', () => {
        expect(buildLabel('field', 'Text').htmlFor).toBe('field');
        expect(buildHint('hint', 'Enter to run').id).toBe('hint');
    });
});

describe('runOnEnter', () => {
    it('runs on Enter and Ctrl+Enter, but leaves Shift+Enter its new line', () => {
        const field = document.createElement('textarea');
        const run = vi.fn();
        runOnEnter(field, run);

        const enter = pressEnter(field);
        pressEnter(field, { ctrlKey: true });
        const shiftEnter = pressEnter(field, { shiftKey: true });
        pressEnter(field, { altKey: true });

        expect(run).toHaveBeenCalledTimes(2);
        expect(enter.defaultPrevented).toBe(true);
        expect(shiftEnter.defaultPrevented).toBe(false);
    });

    it('ignores other keys', () => {
        const field = document.createElement('input');
        const run = vi.fn();
        runOnEnter(field, run);

        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

        expect(run).not.toHaveBeenCalled();
    });
});

describe('selectAllOnCopyKey', () => {
    it('selects the whole output on Ctrl+C and leaves the copy to the browser', () => {
        const block = document.createElement('pre');
        block.textContent = '{ "a": 1 }';
        document.body.append(block);
        selectAllOnCopyKey(block);
        window.getSelection()?.removeAllRanges();

        const event = pressCopyKey(block);

        expect(window.getSelection()?.toString()).toBe('{ "a": 1 }');
        expect(event.defaultPrevented).toBe(false);
    });

    it('selects only the content it is given', () => {
        const value = document.createElement('span');
        value.textContent = 'abc';
        const row = document.createElement('li');
        row.append('MD5 ', value);
        document.body.append(row);
        selectAllOnCopyKey(row, value);

        pressCopyKey(row);

        expect(window.getSelection()?.toString()).toBe('abc');
    });

    it('keeps a selection made inside the output, and ignores other keys', () => {
        const block = document.createElement('pre');
        block.textContent = 'abcdef';
        document.body.append(block);
        selectAllOnCopyKey(block);
        const range = document.createRange();
        range.setStart(block.firstChild!, 1);
        range.setEnd(block.firstChild!, 3);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);

        pressCopyKey(block);
        block.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));

        expect(window.getSelection()?.toString()).toBe('bc');
    });
});

describe('messages and errors', () => {
    it('hides an empty message and shows a toned one', () => {
        const message = buildMessage();

        expect(message.hidden).toBe(true);
        expect(message.getAttribute('role')).toBe('status');

        showMessage(message, { text: 'Bad', tone: 'fail' });
        expect(message.hidden).toBe(false);
        expect(message.dataset['tone']).toBe('fail');
        expect(message.textContent).toBe('Bad');

        showMessage(message, null);
        expect(message.hidden).toBe(true);
        expect(message.dataset['tone']).toBeUndefined();
    });

    it('describes an error with its place in the text', () => {
        expect(describeError({ message: 'Bad', position: 2, length: 1 }, 'abc')).toBe('Bad at position 3.');
        expect(describeError({ message: 'Bad', position: 4, length: 1 }, 'ab\ncd')).toBe('Bad at line 2, column 2.');
        expect(describeError({ message: 'Bad', position: null, length: 0 }, 'abc')).toBe('Bad.');
    });

    it('selects the characters at fault', () => {
        const field = document.createElement('input');
        field.value = 'abcdef';
        document.body.append(field);

        selectError(field, { message: 'Bad', position: 2, length: 3 });

        expect([field.selectionStart, field.selectionEnd]).toEqual([2, 5]);
    });
});

describe('buildFormatSelect', () => {
    it('offers hex, HEX and Base64 and reports a change', () => {
        const onChange = vi.fn();
        const wrapper = buildFormatSelect('format', 'hex', onChange);
        const select = wrapper.querySelector('select') as HTMLSelectElement;

        expect([...select.options].map((option) => option.textContent)).toEqual(['hex', 'HEX', 'Base64']);
        expect(wrapper.querySelector('label')?.htmlFor).toBe('format');

        select.value = 'base64';
        select.dispatchEvent(new Event('change'));

        expect(onChange).toHaveBeenCalledWith('base64');
    });
});

describe('buildDigestList', () => {
    const entries = [{ key: 'MD5', label: 'MD5' }, { key: 'SHA-1', label: 'SHA-1' }];

    it('shows a dash and leaves rows without a value out of the tab order', () => {
        const list = buildDigestList(entries);
        list.update(null, new Set());

        const rows = [...list.element.querySelectorAll<HTMLElement>('.digest-row')];

        expect(rows.map((row) => row.querySelector('.digest-value')?.textContent)).toEqual(['—', '—']);
        expect(rows.every((row) => row.dataset['empty'] === 'true' && !row.hasAttribute('tabindex'))).toBe(true);
    });

    it('fills values as text in focusable rows, and marks matches and stale values', () => {
        const list = buildDigestList(entries);
        list.update(new Map([['MD5', 'aa'], ['SHA-1', 'bb']]), new Set(['SHA-1']), true);

        const sha1 = list.element.querySelector<HTMLElement>('.digest-row[data-key="SHA-1"]') as HTMLElement;

        expect(sha1.tagName).toBe('LI');
        expect(list.element.querySelector('button')).toBeNull();
        expect(sha1.querySelector('.digest-value')?.textContent).toBe('bb');
        expect(sha1.dataset['empty']).toBe('false');
        expect(sha1.tabIndex).toBe(0);
        expect(sha1.hasAttribute('title')).toBe(false);
        expect(sha1.dataset['match']).toBe('true');
        expect(list.element.dataset['stale']).toBe('true');
    });

    it('copies nothing on click', async () => {
        const writeText = stubClipboard();
        const list = buildDigestList(entries);
        document.body.append(list.element);
        list.update(new Map([['MD5', 'aa']]), new Set());

        list.element.querySelector<HTMLElement>('.digest-row[data-key="MD5"]')?.click();
        await settleAsync();

        expect(writeText).not.toHaveBeenCalled();
        expect(lastToast()).toBeNull();
    });

    it('selects the digest alone on Ctrl+C in a focused row', () => {
        const list = buildDigestList(entries);
        document.body.append(list.element);
        list.update(new Map([['MD5', 'aa']]), new Set());
        window.getSelection()?.removeAllRanges();

        pressCopyKey(list.element.querySelector<HTMLElement>('.digest-row[data-key="MD5"]') as HTMLElement);

        expect(window.getSelection()?.toString()).toBe('aa');
    });
});
