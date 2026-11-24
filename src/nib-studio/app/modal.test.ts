import { afterEach, describe, expect, it } from 'vitest';
import { showTextInputModalAsync } from './modal.js';
import { clickDialogButton, waitForFrameAsync } from '../testing/testHelpers.js';

function input(): HTMLInputElement {
    const element = document.querySelector<HTMLInputElement>('.modal-body .input');

    if (element == null) {
        throw new Error('Input not mounted');
    }

    return element;
}

afterEach(() => {
    for (const node of document.querySelectorAll('.modal-backdrop')) {
        node.remove();
    }
});

describe('showTextInputModalAsync', () => {
    it('prefills the input and resolves the entered text', async () => {
        const pending = showTextInputModalAsync({ title: 'Rename', label: 'New name', initialValue: 'old.json' });
        await waitForFrameAsync();

        expect(document.querySelector('.modal')?.textContent).toContain('Rename');
        expect(document.querySelector('.modal-body')?.textContent).toContain('New name');
        expect(input().value).toBe('old.json');

        input().value = 'new.json';
        clickDialogButton('OK');

        await expect(pending).resolves.toBe('new.json');
    });

    it('shows the hint instead of the label when one is given', async () => {
        const pending = showTextInputModalAsync({ title: 'New file', label: 'Name', hint: 'Use a relative path.' });
        await waitForFrameAsync();

        expect(document.querySelector('.modal-body')?.textContent).toContain('Use a relative path.');
        expect(document.querySelector('.modal-body')?.textContent).not.toContain('Name');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await pending;
    });

    it('keeps the dialog open while validation fails', async () => {
        const pending = showTextInputModalAsync({
            title: 'New folder',
            label: 'Folder name',
            validate: (value) => value.includes('/') ? 'No slashes.' : null,
        });
        await waitForFrameAsync();
        input().value = 'a/b';
        clickDialogButton('OK');

        expect(document.querySelector('.modal-error')?.textContent).toBe('No slashes.');
        expect(document.querySelector('.modal-backdrop')).not.toBeNull();

        input().value = 'docs';
        clickDialogButton('OK');

        await expect(pending).resolves.toBe('docs');
    });

    it('resolves null when cancelled', async () => {
        const pending = showTextInputModalAsync({ title: 'Rename', label: 'Name' });
        await waitForFrameAsync();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        await expect(pending).resolves.toBeNull();
    });
});
