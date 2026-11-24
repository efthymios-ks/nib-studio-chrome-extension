import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from './toast.js';

function stacks(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.toast-stack')];
}

describe('toast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();

        for (const stack of stacks()) {
            stack.remove();
        }
    });

    it('shows a message in a polite live region with the info tone by default', () => {
        toast('Saved.');
        const [stack] = stacks();
        const node = stack?.querySelector<HTMLElement>('.toast');

        expect(stack?.getAttribute('aria-live')).toBe('polite');
        expect(node?.textContent).toBe('Saved.');
        expect(node?.dataset['tone']).toBe('info');
    });

    it('uses the given tone and stacks messages in one container', () => {
        toast('First', 'ok');
        toast('Second', 'fail');

        expect(stacks()).toHaveLength(1);

        const tones = [...document.querySelectorAll<HTMLElement>('.toast')].map((node) => node.dataset['tone']);

        expect(tones).toEqual(['ok', 'fail']);
    });

    it('removes a message after its duration', () => {
        toast('Going away', 'warn');
        vi.advanceTimersByTime(3599);

        expect(document.querySelectorAll('.toast')).toHaveLength(1);

        vi.advanceTimersByTime(1);

        expect(document.querySelectorAll('.toast')).toHaveLength(0);
    });

    it('recreates the stack when it was detached from the document', () => {
        toast('One');
        stacks()[0]?.remove();
        toast('Two');

        expect(stacks()).toHaveLength(1);
        expect(stacks()[0]?.textContent).toBe('Two');
    });
});
