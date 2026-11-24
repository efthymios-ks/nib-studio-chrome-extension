import type { DialogPath } from './dialog.js';
import { showDialogAsync } from './dialog.js';
import { h } from './dom.js';

// Wrapper over showDialogAsync that renders the three-way collision prompt.

export type CollisionChoice = 'replace' | 'keep-both' | 'skip';

export interface CollisionDialogOptions {
    readonly name: string;
    readonly targetFolder: string;
    readonly offerApplyToAll: boolean;
    readonly paths?: ReadonlyArray<DialogPath>;
}

export interface CollisionDialogResult {
    readonly choice: CollisionChoice | 'cancel';
    readonly applyToAll: boolean;
}

export async function showCollisionDialogAsync(options: CollisionDialogOptions): Promise<CollisionDialogResult> {
    let applyToAll = false;
    const checkbox = h('input', {
        attrs: { type: 'checkbox', id: 'collision-apply-all' },
        on: {
            change: (event) => {
                applyToAll = (event.target as HTMLInputElement).checked;
            },
        },
    });

    const bodyNode = options.offerApplyToAll
        ? h('label', {
            class: 'form-label',
            attrs: { for: 'collision-apply-all' },
            children: [checkbox, h('span', { text: ' Apply to all' })],
        })
        : undefined;

    const body = options.targetFolder === ''
        ? `An item named "${options.name}" already exists at the workspace root.`
        : `An item named "${options.name}" already exists in ${options.targetFolder}/.`;

    const result = await showDialogAsync({
        title: 'Name already exists',
        body,
        ...(bodyNode != null ? { bodyNode } : {}),
        paths: options.paths,
        kind: {
            kind: 'buttons',
            buttons: [
                { id: 'skip', label: 'Skip' },
                { id: 'keep-both', label: 'Keep both' },
                { id: 'replace', label: 'Replace', tone: 'danger', primary: true },
            ],
        },
    });

    if (result.outcome === 'button') {
        return { choice: result.id as CollisionChoice, applyToAll };
    }

    return { choice: 'cancel', applyToAll };
}
