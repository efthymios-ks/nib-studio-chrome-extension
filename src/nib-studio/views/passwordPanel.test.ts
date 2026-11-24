import { afterEach, describe, expect, it, vi } from 'vitest';
import { pressKey } from '../testing/testHelpers.js';
import { createPasswordCancelled, createPasswordForm } from './passwordPanel.js';

const TITLE = 'This PDF is protected with a password';

let elements: HTMLElement[] = [];

afterEach(() => {
    for (const element of elements) {
        element.remove();
    }

    elements = [];
});

function mount<T extends { element: HTMLElement } | HTMLElement>(created: T): T {
    elements.push(created instanceof HTMLElement ? created : created.element);
    document.body.append(created instanceof HTMLElement ? created : created.element);

    return created;
}

function submit(form: HTMLElement): void {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('createPasswordForm', () => {
    it('asks for the password with the title and file name, and hands it over once, emptying the box', () => {
        const onSubmit = vi.fn();
        const form = mount(createPasswordForm({ title: TITLE, fileName: 'Συμβόλαιο.pdf', reason: 'needed', onSubmit, onCancel: vi.fn() }));
        const input = form.element.querySelector('.password-panel-input') as HTMLInputElement;

        expect(form.element.querySelector('.password-panel-title')?.textContent).toBe(TITLE);
        expect(form.element.querySelector('.password-panel-file')?.textContent).toBe('Συμβόλαιο.pdf');
        expect(form.element.getAttribute('aria-label')).toBe('Password for Συμβόλαιο.pdf');
        expect(input.type).toBe('password');
        expect(input.getAttribute('autocomplete')).toBe('off');
        input.value = 'secret';
        submit(form.element);

        expect(onSubmit).toHaveBeenCalledWith('secret');
        expect(input.value).toBe('');
    });

    it('sends nothing for an empty box', () => {
        const onSubmit = vi.fn();
        const form = mount(createPasswordForm({ title: TITLE, fileName: 'a.pdf', reason: 'needed', onSubmit, onCancel: vi.fn() }));
        submit(form.element);

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('says a wrong password was wrong, as an alert', () => {
        const form = mount(createPasswordForm({ title: TITLE, fileName: 'a.pdf', reason: 'incorrect', onSubmit: vi.fn(), onCancel: vi.fn() }));
        const message = form.element.querySelector('.password-panel-message') as HTMLElement;

        expect(message.textContent).toBe('That password is incorrect. Try again.');
        expect(message.dataset['tone']).toBe('fail');
        expect(message.getAttribute('role')).toBe('alert');
    });

    it('cancels with the button or Escape', () => {
        const onCancel = vi.fn();
        const form = mount(createPasswordForm({ title: TITLE, fileName: 'a.pdf', reason: 'needed', onSubmit: vi.fn(), onCancel }));
        (form.element.querySelector('[data-action="password-cancel"]') as HTMLButtonElement).click();
        pressKey(form.element.querySelector('.password-panel-input') as HTMLElement, 'Escape');

        expect(onCancel).toHaveBeenCalledTimes(2);
    });

    it('focuses the box', () => {
        const form = mount(createPasswordForm({ title: TITLE, fileName: 'a.pdf', reason: 'needed', onSubmit: vi.fn(), onCancel: vi.fn() }));
        form.focus();

        expect(document.activeElement).toBe(form.element.querySelector('.password-panel-input'));
    });
});

describe('createPasswordCancelled', () => {
    it('says the file stays closed, with a way back to the password box', () => {
        const onRetry = vi.fn();
        const element = mount(createPasswordCancelled({ title: 'This workbook is protected with a password', fileName: 'a.xlsx', onRetry }));
        (element.querySelector('[data-action="password-retry"]') as HTMLButtonElement).click();

        expect(element.dataset['reason']).toBe('cancelled');
        expect(element.querySelector('.password-panel-title')?.textContent).toBe('This workbook is protected with a password');
        expect(element.textContent).toContain('It stays closed until its password is entered.');
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
