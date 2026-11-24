import { afterEach, describe, expect, it } from 'vitest';
import { showCollisionDialogAsync } from './collisionDialog.js';
import { clickDialogButton, waitForFrameAsync } from '../testing/testHelpers.js';

function applyToAllCheckbox(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('#collision-apply-all');
}

afterEach(() => {
    for (const node of document.querySelectorAll('.modal-backdrop')) {
        node.remove();
    }
});

describe('showCollisionDialogAsync', () => {
    it('names the folder and offers skip, keep both and replace', async () => {
        const pending = showCollisionDialogAsync({ name: 'a.json', targetFolder: 'docs', offerApplyToAll: false });
        await waitForFrameAsync();
        const labels = [...document.querySelectorAll('.modal-footer button')].map((button) => button.textContent);

        expect(document.querySelector('.modal-body')?.textContent).toContain('An item named "a.json" already exists in docs/.');
        expect(labels).toEqual(expect.arrayContaining(['Skip', 'Keep both', 'Replace']));
        expect(applyToAllCheckbox()).toBeNull();

        clickDialogButton('Keep both');

        await expect(pending).resolves.toEqual({ choice: 'keep-both', applyToAll: false });
    });

    it('describes the workspace root when the target folder is empty', async () => {
        const pending = showCollisionDialogAsync({ name: 'readme.md', targetFolder: '', offerApplyToAll: false });
        await waitForFrameAsync();

        expect(document.querySelector('.modal-body')?.textContent).toContain('already exists at the workspace root.');

        clickDialogButton('Skip');

        await expect(pending).resolves.toEqual({ choice: 'skip', applyToAll: false });
    });

    it('reports apply to all when the checkbox is ticked', async () => {
        const pending = showCollisionDialogAsync({ name: 'a.json', targetFolder: 'docs', offerApplyToAll: true });
        await waitForFrameAsync();
        const checkbox = applyToAllCheckbox();

        expect(checkbox).not.toBeNull();

        checkbox!.checked = true;
        checkbox!.dispatchEvent(new Event('change'));
        clickDialogButton('Replace');

        await expect(pending).resolves.toEqual({ choice: 'replace', applyToAll: true });
    });

    it('resolves cancel when dismissed', async () => {
        const pending = showCollisionDialogAsync({ name: 'a.json', targetFolder: 'docs', offerApplyToAll: true });
        await waitForFrameAsync();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        await expect(pending).resolves.toEqual({ choice: 'cancel', applyToAll: false });
    });
});
