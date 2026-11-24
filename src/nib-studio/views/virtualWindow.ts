export interface VirtualWindowInput {
    readonly scrollTop: number;
    readonly viewportHeight: number;
    readonly rowHeight: number;
    readonly rowCount: number;
    readonly overscan: number;
    // Browsers cap element height, so very long lists map the scroll position onto rows proportionally.
    readonly maxScrollHeight: number;
}

export interface VirtualWindow {
    readonly start: number;
    readonly end: number;
    readonly topPadding: number;
    readonly bottomPadding: number;
    readonly totalHeight: number;
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
    const fullHeight = input.rowCount * input.rowHeight;
    const totalHeight = Math.min(fullHeight, input.maxScrollHeight);
    const visibleRows = Math.max(1, Math.ceil(input.viewportHeight / input.rowHeight));
    const scaled = fullHeight > input.maxScrollHeight;
    let first: number;

    if (!scaled) {
        first = Math.floor(input.scrollTop / input.rowHeight);
    }
    else {
        const scrollable = Math.max(1, totalHeight - input.viewportHeight);
        const ratio = Math.min(1, Math.max(0, input.scrollTop / scrollable));
        first = Math.round(ratio * Math.max(0, input.rowCount - visibleRows));
    }

    first = Math.min(Math.max(0, first), Math.max(0, input.rowCount - 1));
    const start = Math.max(0, first - input.overscan);
    const end = Math.min(input.rowCount, first + visibleRows + input.overscan);
    const renderedHeight = (end - start) * input.rowHeight;
    const topPadding = scaled
        ? Math.max(0, Math.min(input.scrollTop - (first - start) * input.rowHeight, totalHeight - renderedHeight))
        : start * input.rowHeight;
    const bottomPadding = Math.max(0, totalHeight - topPadding - renderedHeight);

    return { start, end, topPadding, bottomPadding, totalHeight };
}

export function scrollTopForRow(
    position: number,
    input: Omit<VirtualWindowInput, 'scrollTop' | 'overscan'>,
): number {
    const fullHeight = input.rowCount * input.rowHeight;

    if (fullHeight <= input.maxScrollHeight) {
        return position * input.rowHeight;
    }

    const visibleRows = Math.max(1, Math.ceil(input.viewportHeight / input.rowHeight));
    const scrollable = Math.max(1, input.maxScrollHeight - input.viewportHeight);

    return (position / Math.max(1, input.rowCount - visibleRows)) * scrollable;
}
