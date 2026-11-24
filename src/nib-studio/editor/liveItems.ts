import { Decoration } from '@codemirror/view';

// Where a caret on the edge of a hidden range belongs:
// `before` keeps it in front of the range, as after bold text, whose closing `**` follows;
// `after` moves it past the range, as past the `# ` of a heading;
// `both` keeps either edge, as on both sides of a table's column divider or of an image.
export type CaretSide = 'before' | 'after' | 'both';

// A range of source the Interactive view draws differently: hidden, replaced by a widget, marked, or a line style.
export interface LiveItem {
    readonly from: number;
    readonly to: number;
    readonly decoration: Decoration;
    // Set on hidden and replaced ranges, which the caret, arrow keys and deletion treat as one unit.
    readonly side?: CaretSide;
}

export const HIDDEN = Decoration.replace({});

export function hiddenItem(from: number, to: number, side: CaretSide): LiveItem {
    return { from, to, decoration: HIDDEN, side };
}

// The replaced ranges among the items, sorted, for caret and deletion logic.
export function atomicItems(items: ReadonlyArray<LiveItem>): LiveItem[] {
    return items
        .filter((item) => item.side != null && item.to > item.from)
        .sort((left, right) => left.from - right.from || left.to - right.to);
}
