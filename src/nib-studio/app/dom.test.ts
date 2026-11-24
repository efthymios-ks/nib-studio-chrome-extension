import { describe, expect, it, vi } from 'vitest';
import { clear, focusedElement, h, returnFocus } from './dom.js';

describe('h', () => {
    it('creates an element with class and text', () => {
        const element = h('span', { class: 'label strong', text: 'Hello' });

        expect(element.tagName).toBe('SPAN');
        expect(element.className).toBe('label strong');
        expect(element.textContent).toBe('Hello');
    });

    it('creates a bare element when no options are given', () => {
        const element = h('div');

        expect(element.attributes).toHaveLength(0);
        expect(element.childNodes).toHaveLength(0);
    });

    it('sets inner html', () => {
        const element = h('div', { html: '<b>bold</b>' });

        expect(element.querySelector('b')?.textContent).toBe('bold');
    });

    it('maps attribute values to strings, empty for true and removes falsy ones', () => {
        const element = h('input', {
            attrs: { type: 'checkbox', tabindex: 3, disabled: true, hidden: false, title: null, name: undefined },
        });

        expect(element.getAttribute('type')).toBe('checkbox');
        expect(element.getAttribute('tabindex')).toBe('3');
        expect(element.getAttribute('disabled')).toBe('');
        expect(element.hasAttribute('hidden')).toBe(false);
        expect(element.hasAttribute('title')).toBe(false);
        expect(element.hasAttribute('name')).toBe(false);
    });

    it('writes dataset entries and aria attributes', () => {
        const element = h('button', {
            dataset: { path: 'a/b.json', active: 'true' },
            aria: { label: 'Close', expanded: 'false' },
        });

        expect(element.dataset['path']).toBe('a/b.json');
        expect(element.getAttribute('data-active')).toBe('true');
        expect(element.getAttribute('aria-label')).toBe('Close');
        expect(element.getAttribute('aria-expanded')).toBe('false');
    });

    it('wires event listeners', () => {
        const onClick = vi.fn();
        const element = h('button', { on: { click: onClick } });
        element.click();

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('appends node and string children and skips null and undefined', () => {
        const child = h('em', { text: 'two' });
        const element = h('p', { children: ['one ', child, null, undefined, ' three'] });

        expect(element.childNodes).toHaveLength(3);
        expect(element.textContent).toBe('one two three');
        expect(element.querySelector('em')).toBe(child);
    });
});

describe('clear', () => {
    it('removes every child node', () => {
        const element = h('div', { children: ['text', h('span'), h('b')] });
        clear(element);

        expect(element.childNodes).toHaveLength(0);
    });

    it('leaves an empty element alone', () => {
        const element = h('div');
        clear(element);

        expect(element.childNodes).toHaveLength(0);
    });
});

describe('focusedElement', () => {
    it('gives the element that has the keyboard, or null when only the page has it', () => {
        const button = h('button');
        document.body.append(button);
        button.focus();

        expect(focusedElement()).toBe(button);

        button.blur();

        expect(focusedElement()).toBeNull();
        button.remove();
    });
});

describe('returnFocus', () => {
    it('focuses the first element still on the page', () => {
        const gone = h('button');
        const first = h('button');
        const second = h('button');
        document.body.append(first, second);

        returnFocus(null, gone, first, second);

        expect(document.activeElement).toBe(first);
        first.remove();
        second.remove();
    });

    it('leaves the focus alone when none of them is on the page', () => {
        const kept = h('button');
        document.body.append(kept);
        kept.focus();

        returnFocus(undefined, h('button'), document.body);

        expect(document.activeElement).toBe(kept);
        kept.remove();
    });
});
