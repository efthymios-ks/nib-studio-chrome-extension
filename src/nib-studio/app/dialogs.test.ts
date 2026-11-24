import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmActionAsync, pickFileFromDiskAsync } from './dialogs.js';
import { clickDialogButton, waitForFrameAsync } from '../testing/testHelpers.js';

function footerLabels(): string[] {
    return [...document.querySelectorAll<HTMLButtonElement>('.modal-footer button')].map((button) => button.textContent ?? '');
}

function setFilePicker(picker: unknown): void {
    Object.defineProperty(window, 'showOpenFilePicker', { value: picker, configurable: true, writable: true });
}

afterEach(() => {
    for (const node of document.querySelectorAll('.modal-backdrop')) {
        node.remove();
    }
});

describe('confirmActionAsync', () => {
    it('accepts a plain string body and uses the default title and labels', async () => {
        const pending = confirmActionAsync('Discard changes?');
        await waitForFrameAsync();

        expect(document.querySelector('.modal')?.textContent).toContain('Confirm');
        expect(document.querySelector('.modal-body')?.textContent).toContain('Discard changes?');
        expect(footerLabels()).toEqual(expect.arrayContaining(['OK', 'Cancel']));

        clickDialogButton('OK');

        await expect(pending).resolves.toBe(true);
    });

    it('resolves false when the cancel button is clicked', async () => {
        const pending = confirmActionAsync({
            title: 'Delete file',
            body: 'Delete a.json?',
            tone: 'danger',
            confirmLabel: 'Delete',
            cancelLabel: 'Keep',
        });
        await waitForFrameAsync();

        expect(document.querySelector('.modal')?.textContent).toContain('Delete file');
        expect(footerLabels()).toEqual(expect.arrayContaining(['Delete', 'Keep']));

        clickDialogButton('Keep');

        await expect(pending).resolves.toBe(false);
    });

    it('resolves false when Escape dismisses the dialog', async () => {
        const pending = confirmActionAsync('Sure?');
        await waitForFrameAsync();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        await expect(pending).resolves.toBe(false);
    });
});

describe('pickFileFromDiskAsync', () => {
    afterEach(() => {
        Reflect.deleteProperty(window, 'showOpenFilePicker');
    });

    it('returns the picked file name and file, unread', async () => {
        const file = new File(['{"a":1}'], 'data.json');
        const text = vi.spyOn(file, 'text');
        const picker = vi.fn(async () => [{ getFile: async () => file }]);
        setFilePicker(picker);
        const picked = await pickFileFromDiskAsync();

        expect(picker).toHaveBeenCalledWith({ multiple: false });
        expect(picked).toEqual({ path: 'data.json', file });
        expect(text).not.toHaveBeenCalled();
    });

    it('returns null when the picker yields no handle', async () => {
        setFilePicker(async () => []);

        await expect(pickFileFromDiskAsync()).resolves.toBeNull();
    });

    it('returns null when the user aborts the picker', async () => {
        setFilePicker(async () => {
            throw new DOMException('User cancelled.', 'AbortError');
        });

        await expect(pickFileFromDiskAsync()).resolves.toBeNull();
    });

    it('rethrows other picker errors', async () => {
        setFilePicker(async () => {
            throw new DOMException('Blocked.', 'SecurityError');
        });

        await expect(pickFileFromDiskAsync()).rejects.toThrow('Blocked.');
    });
});
