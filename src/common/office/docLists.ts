import type { DocListFormat, DocListMark } from './docModel.js';

// The list definitions (PlfLst and its levels) and list instances (PlfLfo) of a Word 97–2003 file.
export interface DocListTables {
    // The mark of a paragraph in list instance `listIndex` (1-based) at `level`, or null when it shows no number or bullet.
    markFor(listIndex: number, level: number): DocListMark | null;
}

interface ListLevel {
    readonly format: DocListFormat | null;
    readonly start: number;
}

const LIST_DEFINITION_SIZE = 28;
const LEVEL_HEADER_SIZE = 28;
const LIST_INSTANCE_SIZE = 16;
const MAX_LISTS = 4096;

// Number formats (nfc) by the list style the preview draws; other formats show as decimal numbers.
const NUMBER_FORMATS: ReadonlyMap<number, DocListFormat | null> = new Map<number, DocListFormat | null>([
    [0, 'decimal'],
    [1, 'upper-roman'],
    [2, 'lower-roman'],
    [3, 'upper-alpha'],
    [4, 'lower-alpha'],
    [23, 'bullet'],
    [255, null],
]);

export const NO_LISTS: DocListTables = Object.freeze({ markFor: () => null });

export function readListTables(
    table: Uint8Array,
    definitions: { readonly offset: number; readonly length: number },
    instances: { readonly offset: number; readonly length: number },
): DocListTables {
    if (definitions.length < 2 || instances.length < 4) {
        return NO_LISTS;
    }

    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const levelsById = readDefinitions(table, view, definitions);
    const listIds = readInstances(view, instances);

    return {
        markFor: (listIndex, level) => {
            const id = listIds[listIndex - 1];
            const levels = id == null ? null : levelsById.get(id);
            const found = levels?.[Math.min(level, levels.length - 1)];

            if (id == null || found == null || found.format == null) {
                return null;
            }

            return { id, level: Math.max(0, Math.min(8, level)), format: found.format, start: found.start };
        },
    };
}

function readDefinitions(
    table: Uint8Array,
    view: DataView,
    definitions: { readonly offset: number; readonly length: number },
): Map<number, ListLevel[]> {
    const levelsById = new Map<number, ListLevel[]>();

    if (definitions.offset + 2 > table.length) {
        return levelsById;
    }

    const count = Math.min(view.getInt16(definitions.offset, true), MAX_LISTS);
    const lists: Array<{ readonly id: number; readonly levelCount: number }> = [];

    for (let index = 0; index < count; index += 1) {
        const at = definitions.offset + 2 + index * LIST_DEFINITION_SIZE;

        if (at + LIST_DEFINITION_SIZE > table.length) {
            break;
        }

        const isSimple = ((table[at + 26] ?? 0) & 1) === 1;
        lists.push({ id: view.getInt32(at, true), levelCount: isSimple ? 1 : 9 });
    }

    // The levels follow the list definitions, nine for each list or one for a simple list.
    let position = definitions.offset + 2 + count * LIST_DEFINITION_SIZE;

    for (const list of lists) {
        const levels: ListLevel[] = [];

        for (let level = 0; level < list.levelCount; level += 1) {
            const read = readLevel(table, view, position);

            if (read == null) {
                return levelsById;
            }

            levels.push(read.level);
            position = read.next;
        }

        levelsById.set(list.id, levels);
    }

    return levelsById;
}

function readLevel(table: Uint8Array, view: DataView, at: number): { readonly level: ListLevel; readonly next: number } | null {
    if (at + LEVEL_HEADER_SIZE + 2 > table.length) {
        return null;
    }

    const start = view.getInt32(at, true);
    const numberFormat = table[at + 4] ?? 0;
    const characterSize = table[at + 24] ?? 0;
    const paragraphSize = table[at + 25] ?? 0;
    const textAt = at + LEVEL_HEADER_SIZE + paragraphSize + characterSize;

    if (textAt + 2 > table.length) {
        return null;
    }

    const textLength = view.getUint16(textAt, true);
    const format = NUMBER_FORMATS.has(numberFormat) ? NUMBER_FORMATS.get(numberFormat) ?? null : 'decimal';

    return { level: { format, start: Number.isFinite(start) && start >= 0 ? start : 1 }, next: textAt + 2 + textLength * 2 };
}

function readInstances(view: DataView, instances: { readonly offset: number; readonly length: number }): number[] {
    if (instances.offset + 4 > view.byteLength) {
        return [];
    }

    const count = Math.min(view.getUint32(instances.offset, true), MAX_LISTS);
    const ids: number[] = [];

    for (let index = 0; index < count; index += 1) {
        const at = instances.offset + 4 + index * LIST_INSTANCE_SIZE;

        if (at + LIST_INSTANCE_SIZE > view.byteLength) {
            break;
        }

        ids.push(view.getInt32(at, true));
    }

    return ids;
}
