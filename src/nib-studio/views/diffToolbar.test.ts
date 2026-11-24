import { describe, expect, it, vi } from 'vitest';
import { h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewCallbacks, DiffViewInput } from './diffViewState.js';

const SIDE: DiffSide = { label: 'a.json', path: 'a.json', source: 'file' };

function inputWith(callbacks: Partial<DiffViewCallbacks>, original: DiffSide | null = null, modified: DiffSide | null = null): DiffViewInput<unknown> {
    return {
        original,
        modified,
        state: {},
        callbacks: { onSetSide: vi.fn(), onSwap: vi.fn(), ...callbacks },
    };
}

function buttonFor(groups: HTMLElement[], action: string): HTMLButtonElement | null {
    return groups[0]!.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
}

describe('buildDiffToolbarSides', () => {
    it('only offers Swap when the view has no side picker', () => {
        const groups = buildDiffToolbarSides(inputWith({}));

        expect(groups).toHaveLength(1);
        expect(groups[0]!.classList.contains('diff-side-controls')).toBe(true);
        expect(buttonFor(groups, 'pick-original')).toBeNull();
        expect(buttonFor(groups, 'swap')?.textContent).toBe('Swap');
    });

    it('labels the pickers Pick for empty sides and Change for filled ones', () => {
        const groups = buildDiffToolbarSides(inputWith({ onPickSide: vi.fn() }, SIDE, null));

        expect(buttonFor(groups, 'pick-original')?.textContent).toBe('Change original…');
        expect(buttonFor(groups, 'pick-modified')?.textContent).toBe('Pick modified…');
    });

    it('passes the side and the clicked button to the picker', () => {
        const onPickSide = vi.fn();
        const groups = buildDiffToolbarSides(inputWith({ onPickSide }));
        const button = buttonFor(groups, 'pick-modified')!;

        button.click();

        expect(onPickSide).toHaveBeenCalledWith('modified', button);
    });

    it('swaps the sides when Swap is clicked', () => {
        const onSwap = vi.fn();
        const groups = buildDiffToolbarSides(inputWith({ onSwap }));

        buttonFor(groups, 'swap')!.click();

        expect(onSwap).toHaveBeenCalledTimes(1);
    });

    it('appends the extra toolbar control as its own group', () => {
        const extra = h('div', { class: 'extra' });
        const groups = buildDiffToolbarSides(inputWith({ toolbarExtra: () => extra }));

        expect(groups).toEqual([expect.any(HTMLElement), extra]);
    });
});
