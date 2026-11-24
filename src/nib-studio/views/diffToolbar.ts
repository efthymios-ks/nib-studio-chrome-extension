import { h } from '../app/dom.js';
import type { DiffSideName } from './diffSideHeader.js';
import type { DiffViewInput } from './diffViewState.js';

// The toolbar controls every diff view shares: change either side, and swap them.
export function buildDiffToolbarSides(input: DiffViewInput<unknown>): HTMLElement[] {
    const pick = (side: DiffSideName): HTMLElement | null => {
        const onPickSide = input.callbacks.onPickSide;

        if (onPickSide == null) {
            return null;
        }

        const current = side === 'original' ? input.original : input.modified;
        const button = h('button', {
            class: 'button',
            dataset: { action: `pick-${side}` },
            text: current == null
                ? side === 'original' ? 'Pick original…' : 'Pick modified…'
                : side === 'original' ? 'Change original…' : 'Change modified…',
            attrs: { type: 'button' },
        });
        button.addEventListener('click', () => onPickSide(side, button));

        return button;
    };

    const controls = [
        pick('original'),
        pick('modified'),
        h('button', {
            class: 'button',
            dataset: { action: 'swap' },
            text: 'Swap',
            attrs: { type: 'button', title: 'Swap the original and modified sides' },
            on: { click: () => input.callbacks.onSwap() },
        }),
    ];

    const groups: HTMLElement[] = [h('div', { class: 'toolbar-group diff-side-controls', children: controls })];
    const extra = input.callbacks.toolbarExtra?.();

    if (extra != null) {
        groups.push(extra);
    }

    return groups;
}
