import { sidesOfChange, type DiffChange } from '../../common/diff/diffDocument.js';
import type { DiffNavigationChange } from './diffNavigationBar.js';

// The changes of a diff document as the bar steps through them, top to bottom.

export interface NavigationChangesOptions {
    // The rows or cells that show a change; empty while it is not drawn.
    readonly locate: (change: DiffChange) => ReadonlyArray<HTMLElement>;
    // Names each change in the position's tooltip by its id, such as `items[3].price`.
    readonly labelled: boolean;
}

export function navigationChangesOf(
    changes: ReadonlyArray<DiffChange>,
    options: NavigationChangesOptions,
): DiffNavigationChange[] {
    return changes.map((change) => ({
        id: change.id,
        sides: sidesOfChange(change.kind),
        ...(options.labelled ? { label: change.id } : {}),
        locate: () => options.locate(change),
    }));
}
