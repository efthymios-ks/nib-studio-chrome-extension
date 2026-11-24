export interface SelectionState {
    readonly selectedPaths: ReadonlySet<string>;
    readonly anchorPath: string | null;
}

export const EMPTY_SELECTION: SelectionState = {
    selectedPaths: new Set<string>(),
    anchorPath: null,
};

// Returns a selection with just the given path; the anchor moves with it.
// Used by plain left-click and by context-menu selection fallback.
export function selectOnly(_state: SelectionState, path: string): SelectionState {
    return {
        selectedPaths: new Set([path]),
        anchorPath: path,
    };
}

// Toggles the path in the selection and makes it the new anchor.
// Removing the current anchor resets the anchor to null.
export function toggle(state: SelectionState, path: string): SelectionState {
    const next = new Set(state.selectedPaths);

    if (next.has(path)) {
        next.delete(path);

        return {
            selectedPaths: next,
            anchorPath: state.anchorPath === path ? null : state.anchorPath,
        };
    }

    next.add(path);

    return {
        selectedPaths: next,
        anchorPath: path,
    };
}

// Selects every visible path between `from` and `to` inclusive,
// using the caller-supplied visible ordering.
// Missing endpoints fall back to clamping; the anchor is left on `from`.
export function selectRange(
    state: SelectionState,
    orderedPaths: ReadonlyArray<string>,
    from: string | null,
    to: string,
): SelectionState {
    if (orderedPaths.length === 0) {
        return state;
    }

    const toIndex = orderedPaths.indexOf(to);

    if (toIndex < 0) {
        return state;
    }

    const anchor = from ?? to;
    let fromIndex = orderedPaths.indexOf(anchor);

    if (fromIndex < 0) {
        fromIndex = toIndex;
    }

    const low = Math.min(fromIndex, toIndex);
    const high = Math.max(fromIndex, toIndex);
    const next = new Set<string>();

    for (let index = low; index <= high; index += 1) {
        const path = orderedPaths[index];

        if (path != null) {
            next.add(path);
        }
    }

    return {
        selectedPaths: next,
        anchorPath: anchor,
    };
}

// Resets the selection to nothing selected and no anchor.
export function clear(_state: SelectionState): SelectionState {
    return EMPTY_SELECTION;
}

// Replaces the selection with every provided path, picking the last one as anchor.
export function selectAll(_state: SelectionState, allPaths: ReadonlyArray<string>): SelectionState {
    if (allPaths.length === 0) {
        return EMPTY_SELECTION;
    }

    return {
        selectedPaths: new Set(allPaths),
        anchorPath: allPaths[allPaths.length - 1] ?? null,
    };
}

// Returns the selected paths in the order they appear in `orderedPaths`.
// Paths not in `orderedPaths` are skipped.
export function orderedSelection(
    state: SelectionState,
    orderedPaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
    const result: string[] = [];

    for (const path of orderedPaths) {
        if (state.selectedPaths.has(path)) {
            result.push(path);
        }
    }

    return result;
}

// The row that takes the focus when some rows go, as after a delete: the first row after the first removed one
// that stays, or else the last one before it that stays; null when nothing was removed or nothing stays.
export function rowAfterRemoval(visiblePaths: ReadonlyArray<string>, isRemoved: (path: string) => boolean): string | null {
    const firstRemoved = visiblePaths.findIndex((path) => isRemoved(path));

    if (firstRemoved < 0) {
        return null;
    }

    const after = visiblePaths.slice(firstRemoved).find((path) => !isRemoved(path));

    return after ?? visiblePaths.slice(0, firstRemoved).findLast((path) => !isRemoved(path)) ?? null;
}

