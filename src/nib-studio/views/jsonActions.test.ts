import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenFile } from '../app/store.js';
import { openFileFixture } from '../testing/testHelpers.js';
import { applyJsonTransform } from './jsonActions.js';

function openFile(text: string): OpenFile {
    return openFileFixture('data/sample.json', text, { view: 'text' });
}

function toasts(): Array<{ tone: string; text: string }> {
    return [...document.querySelectorAll<HTMLElement>('.toast')].map((node) => ({
        tone: node.dataset['tone'] ?? '',
        text: node.textContent ?? '',
    }));
}

describe('applyJsonTransform', () => {
    afterEach(() => {
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    it('pretty prints with two-space indentation when formatting', () => {
        const onChange = vi.fn();

        applyJsonTransform(openFile('{"name":"nib","tags":[1,2]}'), { onChange }, 'format');

        expect(onChange).toHaveBeenCalledWith('data/sample.json', '{\n  "name": "nib",\n  "tags": [\n    1,\n    2\n  ]\n}');
    });

    it('removes all whitespace when minifying', () => {
        const onChange = vi.fn();

        applyJsonTransform(openFile('{\n  "name": "nib",\n  "tags": [ 1, 2 ]\n}'), { onChange }, 'minify');

        expect(onChange).toHaveBeenCalledWith('data/sample.json', '{"name":"nib","tags":[1,2]}');
    });

    it('shows a failure toast and leaves the file alone when the text is not JSON', () => {
        const onChange = vi.fn();

        applyJsonTransform(openFile('{"name": '), { onChange }, 'format');

        expect(onChange).not.toHaveBeenCalled();
        expect(toasts()).toHaveLength(1);
        expect(toasts()[0]?.tone).toBe('fail');
        expect(toasts()[0]?.text).toBe('Not valid JSON: Expected a value but found end of input. (line 1, column 10).');
    });
});
