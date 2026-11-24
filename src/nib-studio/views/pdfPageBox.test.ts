import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { pressKey } from '../testing/testHelpers.js';
import { createPageBox, parsePageNumber, type PageBox } from './pdfPageBox.js';

describe('parsePageNumber', () => {
    it('reads a page number as an index within the document', () => {
        expect(parsePageNumber('3', 12)).toBe(2);
        expect(parsePageNumber(' 12 ', 12)).toBe(11);
        expect(parsePageNumber('40', 12)).toBe(11);
        expect(parsePageNumber('0', 12)).toBe(0);
    });

    it('is null for anything that isn\'t a whole number, or an empty document', () => {
        for (const text of ['', 'three', '2.5', '-1', '1e2', '3 4']) {
            expect(parsePageNumber(text, 12), text).toBeNull();
        }

        expect(parsePageNumber('1', 0)).toBeNull();
    });
});

describe('createPageBox', () => {
    let box: PageBox;
    let onGo: Mock<(index: number) => void>;
    let input: HTMLInputElement;

    beforeEach(() => {
        onGo = vi.fn<(index: number) => void>();
        box = createPageBox({ onGo });
        document.body.append(box.element);
        input = box.element.querySelector('.pdf-page-input') as HTMLInputElement;
    });

    afterEach(() => {
        box.element.remove();
    });

    it('reads "3 / 12", and is hidden until a document has pages', () => {
        expect(input.disabled).toBe(true);
        expect(box.element.hidden).toBe(true);
        box.setCount(12);
        box.setCurrent(2);

        expect(input.disabled).toBe(false);
        expect(box.element.hidden).toBe(false);
        expect(input.value).toBe('3');
        expect(box.element.querySelector('.pdf-page-count')?.textContent).toBe('/ 12');
        expect(input.size).toBe(2);
        expect(input.getAttribute('aria-label')).toBe('Page number');
    });

    it('goes to a typed page on Enter, kept within the document', () => {
        box.setCount(12);
        input.value = '7';
        const enter = pressKey(input, 'Enter');

        expect(onGo).toHaveBeenLastCalledWith(6);
        expect(enter.defaultPrevented).toBe(true);
        input.value = '99';
        pressKey(input, 'Enter');

        expect(onGo).toHaveBeenLastCalledWith(11);
        expect(input.value).toBe('12');
    });

    it('puts the current page back for text that isn\'t a page, and on Escape', () => {
        box.setCount(12);
        box.setCurrent(4);
        input.value = 'abc';
        pressKey(input, 'Enter');

        expect(onGo).not.toHaveBeenCalled();
        expect(input.value).toBe('5');
        input.value = '9';
        pressKey(input, 'Escape');

        expect(input.value).toBe('5');
    });

    it('leaves the box alone while it is being typed in, and catches up when it loses focus', () => {
        box.setCount(12);
        input.focus();
        input.value = '1';
        box.setCurrent(8);

        expect(input.value).toBe('1');
        input.blur();

        expect(input.value).toBe('9');
    });
});
