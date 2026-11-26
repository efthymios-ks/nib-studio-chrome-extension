import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCodeCopyHandler } from './markdownCodeCopy.js';
import { settleAsync } from '../testing/testHelpers.js';

function encode(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

function copyButton(code: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'md-code-copy';
    button.setAttribute('data-code', code);
    button.innerHTML = '<span aria-hidden="true">⎘</span>';

    return button;
}

describe('attachCodeCopyHandler', () => {
    let container: HTMLElement;
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    afterEach(() => {
        container.remove();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    it('copies the decoded UTF-8 source when the icon inside a copy button is clicked', async () => {
        const button = copyButton(encode('const greeting = "γειά";'));
        container.append(button);
        attachCodeCopyHandler(container);

        button.querySelector('span')!.click();
        await settleAsync();

        expect(writeText).toHaveBeenCalledWith('const greeting = "γειά";');
        expect(document.querySelector('.toast')?.textContent).toBe('Code copied.');
    });

    it('keeps working for buttons added after a re-render', async () => {
        attachCodeCopyHandler(container);
        container.innerHTML = '';
        const button = copyButton(encode('later'));
        container.append(button);

        button.click();
        await settleAsync();

        expect(writeText).toHaveBeenCalledWith('later');
    });

    it('binds only once per container', async () => {
        const button = copyButton(encode('once'));
        container.append(button);
        attachCodeCopyHandler(container);
        attachCodeCopyHandler(container);

        button.click();
        await settleAsync();

        expect(container.dataset['codeCopyBound']).toBe('true');
        expect(writeText).toHaveBeenCalledTimes(1);
    });

    it('ignores clicks outside copy buttons and buttons without code', async () => {
        const other = document.createElement('p');
        container.append(other, copyButton(''));
        attachCodeCopyHandler(container);

        other.click();
        container.querySelector<HTMLButtonElement>('.md-code-copy')!.click();
        await settleAsync();

        expect(writeText).not.toHaveBeenCalled();
    });

    it('reports a failed clipboard write', async () => {
        writeText.mockRejectedValueOnce(new Error('Clipboard blocked.'));
        const button = copyButton(encode('x'));
        container.append(button);
        attachCodeCopyHandler(container);

        button.click();
        await settleAsync();

        const toast = document.querySelector<HTMLElement>('.toast');
        expect(toast?.dataset['tone']).toBe('fail');
        expect(toast?.textContent).toBe('Could not copy: Clipboard blocked.');
    });
});
