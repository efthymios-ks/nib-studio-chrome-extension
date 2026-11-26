import type { TableCopy } from '../../common/clipboard/tableClipboard.js';

// A table on screen, as a copy reads it: the rows as shown, sorted, filtered and searched,
// with the columns shown, in their order.
export interface ShownTable {
    // How many rows show in all, not only those drawn so far.
    readonly rowCount: () => number;
    // Why the rows can't be read as shown yet, such as while a large file is still being read; null when they can.
    readonly busyReason: () => string | null;
    // The first `limit` rows as shown.
    readonly readRowsAsync: (limit: number) => Promise<TableCopy>;
}

const SHOWN_TABLE_ATTRIBUTE = 'data-shown-table';

const shownTables = new WeakMap<Element, ShownTable>();

// Lets a copy find the table this element shows, while it stays on the page.
export function registerShownTable(element: HTMLElement, table: ShownTable): void {
    element.setAttribute(SHOWN_TABLE_ATTRIBUTE, 'true');
    shownTables.set(element, table);
}

// The table on screen within `scope`: a sheet's rows, or a query's result in their place; null while none shows,
// such as while a workbook waits for its password.
export function findShownTable(scope: ParentNode): ShownTable | null {
    for (const element of scope.querySelectorAll(`[${SHOWN_TABLE_ATTRIBUTE}]`)) {
        const table = shownTables.get(element);

        if (table != null && element.isConnected) {
            return table;
        }
    }

    return null;
}
