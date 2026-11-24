import { afterEach, describe, expect, it } from 'vitest';
import { showDialogAsync } from './dialog.js';
import { clickDialogButton, waitForFrameAsync } from '../testing/testHelpers.js';

afterEach(() => {
    for (const node of document.querySelectorAll('.modal-backdrop')) {
        node.remove();
    }
});

function currentBackdrop(): HTMLElement | null {
    return document.querySelector('.modal-backdrop');
}

describe('showDialogAsync', () => {
    it('resolves yes when the primary yes-no button is clicked', async () => {
        const pending = showDialogAsync({
            title: 'Keep it?',
            body: 'Pick one.',
            kind: { kind: 'yes-no' },
        });
        await waitForFrameAsync();
        clickDialogButton('Yes');
        const result = await pending;

        expect(result).toEqual({ outcome: 'yes' });
    });

    it('resolves cancel when Escape is pressed', async () => {
        const pending = showDialogAsync({
            title: 'Question',
            kind: { kind: 'yes-no' },
        });
        await waitForFrameAsync();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const result = await pending;

        expect(result).toEqual({ outcome: 'cancel' });
    });

    it('resolves cancel when the backdrop is clicked', async () => {
        const pending = showDialogAsync({
            title: 'Question',
            kind: { kind: 'yes-no' },
        });
        await waitForFrameAsync();
        const backdrop = currentBackdrop();

        if (backdrop == null) {
            throw new Error('Backdrop not mounted');
        }

        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const result = await pending;

        expect(result).toEqual({ outcome: 'cancel' });
    });

    it('emits input values and runs validation', async () => {
        const pending = showDialogAsync({
            title: 'Rename',
            kind: {
                kind: 'input',
                initialValue: 'bad',
                validate: (value) => value === 'bad' ? 'Pick a different name.' : null,
            },
        });
        await waitForFrameAsync();
        const input = document.querySelector<HTMLInputElement>('.modal-body .input')!;

        // Hitting OK with an invalid value shows the error without closing.
        clickDialogButton('OK');
        const error = document.querySelector<HTMLElement>('.modal-error');

        expect(error?.textContent).toBe('Pick a different name.');
        expect(currentBackdrop()).not.toBeNull();

        // Submitting a valid value resolves the promise.
        input.value = 'good';
        clickDialogButton('OK');
        const result = await pending;

        expect(result).toEqual({ outcome: 'input', value: 'good' });
    });

    it('exposes buttons by id for custom-button dialogs', async () => {
        const pending = showDialogAsync({
            title: 'Choose',
            kind: {
                kind: 'buttons',
                buttons: [
                    { id: 'skip', label: 'Skip' },
                    { id: 'replace', label: 'Replace', tone: 'danger', primary: true },
                ],
            },
        });
        await waitForFrameAsync();
        clickDialogButton('Replace');
        const result = await pending;

        expect(result).toEqual({ outcome: 'button', id: 'replace' });
    });

    it('resolves cancel when the header X is clicked', async () => {
        const pending = showDialogAsync({
            title: 'With close X',
            kind: {
                kind: 'two-button',
                confirmLabel: 'Move',
                cancelLabel: 'Copy',
            },
        });
        await waitForFrameAsync();
        document.querySelector<HTMLButtonElement>('.modal-close')?.click();
        const result = await pending;

        expect(result).toEqual({ outcome: 'cancel' });
    });

    it('renders a paths block when paths are provided', async () => {
        const pending = showDialogAsync({
            title: 'Delete',
            paths: [{ label: 'From', path: 'src/a.ts' }, { label: 'To', path: '' }],
            kind: { kind: 'yes-no' },
        });
        await waitForFrameAsync();
        const rows = document.querySelectorAll('.dialog-paths-row');

        expect(rows).toHaveLength(2);
        expect(rows[1]?.querySelector('.dialog-paths-path')?.textContent).toBe('(workspace root)');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await pending;
    });
});

describe('showDialogAsync focus', () => {
    function focusedRow(): HTMLElement {
        const row = document.createElement('div');
        row.tabIndex = 0;
        row.className = 'tree-row';
        document.body.append(row);
        row.focus();

        return row;
    }

    afterEach(() => {
        for (const node of document.querySelectorAll('.tree-row')) {
            node.remove();
        }
    });

    it.each<[string, () => void]>([
        ['Escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
        ['Cancel', () => clickDialogButton('Cancel')],
        ['×', () => document.querySelector<HTMLElement>('.modal-close')!.click()],
        ['OK', () => clickDialogButton('OK')],
    ])('gives the focus back to the element that had it after %s', async (_, closeDialog) => {
        const row = focusedRow();
        const pending = showDialogAsync({
            title: 'Rename',
            kind: { kind: 'input', initialValue: 'notes.txt' },
        });
        await waitForFrameAsync();
        expect(document.activeElement).toBe(document.querySelector('.modal input'));

        closeDialog();
        await pending;

        expect(document.activeElement).toBe(row);
    });

    it('gives the focus back after a confirmation, before the caller acts on the answer', async () => {
        const row = focusedRow();
        const pending = showDialogAsync({
            title: 'Delete',
            kind: { kind: 'two-button', confirmLabel: 'Delete', cancelLabel: 'Cancel' },
        });
        await waitForFrameAsync();

        clickDialogButton('Delete');
        const focusedOnAnswer = document.activeElement;
        await pending;

        expect(focusedOnAnswer).toBe(row);
    });

    it('leaves the focus alone when the element that had it is gone', async () => {
        const row = focusedRow();
        const pending = showDialogAsync({ title: 'Question', kind: { kind: 'yes-no' } });
        await waitForFrameAsync();
        row.remove();

        clickDialogButton('Yes');
        await pending;

        expect(document.activeElement).toBe(document.body);
    });
});

