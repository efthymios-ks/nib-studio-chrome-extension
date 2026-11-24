import { throwIfAborted, yieldToEventLoopAsync } from './csvLimits.js';
import { readCsvRecordsAsync, type CsvRangeOptions, type CsvRecord } from './csvRangeReader.js';

const DEFAULT_BATCH_RECORDS = 20000;
const STRING_OVERHEAD_BYTES = 48;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

export interface CsvScanProgress {
    readonly scannedRows: number;
    readonly totalRows: number;
}

export interface CsvScanOptions extends CsvRangeOptions {
    // Records before this one (the header) are skipped; row numbers count from it.
    readonly firstRecord?: number;
    readonly batchRecords?: number;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: CsvScanProgress) => void;
}

export interface CsvRecordBatch {
    readonly records: ReadonlyArray<CsvRecord>;
    // Row number of the first record in the batch, counted from firstRecord.
    readonly firstRow: number;
    readonly scannedRows: number;
    readonly totalRows: number;
}

// Reads every indexed record once, batch by batch, yielding to the event loop between batches.
// Stopping the iteration early stops reading. Throws an AbortError when the signal fires.
export async function* iterateCsvRecordBatchesAsync(options: CsvScanOptions): AsyncGenerator<CsvRecordBatch> {
    const firstRecord = options.firstRecord ?? 0;
    const batchRecords = options.batchRecords ?? DEFAULT_BATCH_RECORDS;
    const total = options.index.readableCount;
    const totalRows = Math.max(0, total - firstRecord);

    for (let start = firstRecord; start < total; start += batchRecords) {
        throwIfAborted(options.signal);
        const end = Math.min(total, start + batchRecords);
        const records = await readCsvRecordsAsync(options, start, end);
        throwIfAborted(options.signal);
        yield { records, firstRow: start - firstRecord, scannedRows: end - firstRecord, totalRows };
        await yieldToEventLoopAsync();
    }
}

// Visits every indexed record once, batch by batch. Throws an AbortError when the signal fires.
export async function scanCsvRecordsAsync(
    options: CsvScanOptions,
    visit: (record: CsvRecord, row: number) => void,
): Promise<void> {
    let totalRows = 0;

    for await (const batch of iterateCsvRecordBatchesAsync(options)) {
        for (let offset = 0; offset < batch.records.length; offset += 1) {
            visit(batch.records[offset] ?? [], batch.firstRow + offset);
        }

        totalRows = batch.totalRows;
        options.onProgress?.({ scannedRows: batch.scannedRows, totalRows });
    }

    if (totalRows === 0) {
        options.onProgress?.({ scannedRows: 0, totalRows: 0 });
    }
}

// A Uint32Array that doubles its capacity as values are appended.
class GrowingUint32Array {
    private buffer: Uint32Array;

    private size = 0;

    constructor(initialCapacity = 1024) {
        this.buffer = new Uint32Array(Math.max(1, initialCapacity));
    }

    get length(): number {
        return this.size;
    }

    push(value: number): void {
        if (this.size === this.buffer.length) {
            const next = new Uint32Array(this.buffer.length * 2);
            next.set(this.buffer);
            this.buffer = next;
        }

        this.buffer[this.size] = value;
        this.size += 1;
    }

    // A view over the values so far; it shares memory until the next growth.
    view(): Uint32Array {
        return this.buffer.subarray(0, this.size);
    }

    // A tightly sized copy.
    toArray(): Uint32Array {
        return this.buffer.slice(0, this.size);
    }
}

export interface CsvMatchOptions extends CsvScanOptions {
    readonly predicate: (record: CsvRecord, row: number) => boolean;
    // Called after each batch with the matches found so far.
    readonly onMatches?: (matches: Uint32Array, progress: CsvScanProgress) => void;
}

// Streams the file and returns the ascending row numbers whose record passes the predicate.
export async function findMatchingRowsAsync(options: CsvMatchOptions): Promise<Uint32Array> {
    const matches = new GrowingUint32Array();
    await scanCsvRecordsAsync({
        ...options,
        onProgress: (progress) => {
            options.onProgress?.(progress);
            options.onMatches?.(matches.view(), progress);
        },
    }, (record, row) => {
        if (options.predicate(record, row)) {
            matches.push(row);
        }
    });

    return matches.toArray();
}

export type CsvSortKey =
    | { readonly kind: 'number'; readonly values: Float64Array }
    | { readonly kind: 'text'; readonly values: ReadonlyArray<string> };

export interface CsvSortKeyOptions extends CsvScanOptions {
    readonly columns: ReadonlyArray<number>;
}

// Collects only the given columns in one pass, then types each one: numbers or ISO dates
// become a Float64Array (NaN for empty cells), anything else stays text.
export async function buildSortKeysAsync(options: CsvSortKeyOptions): Promise<CsvSortKey[]> {
    const rowCount = Math.max(0, options.index.readableCount - (options.firstRecord ?? 0));
    const collected = options.columns.map(() => new Array<string>(rowCount));

    await scanCsvRecordsAsync(options, (record, row) => {
        for (let key = 0; key < options.columns.length; key += 1) {
            const column = options.columns[key] as number;
            (collected[key] as string[])[row] = record[column] ?? '';
        }
    });

    return collected.map((values) => typeSortKey(values));
}

export function typeSortKey(values: ReadonlyArray<string>): CsvSortKey {
    const numbers = new Float64Array(values.length);
    let numeric = true;

    for (let index = 0; index < values.length; index += 1) {
        const text = (values[index] ?? '').trim();

        if (text === '') {
            numbers[index] = Number.NaN;
            continue;
        }

        const parsed = Number(text);

        if (!Number.isFinite(parsed)) {
            numeric = false;
            break;
        }

        numbers[index] = parsed;
    }

    if (numeric) {
        return { kind: 'number', values: numbers };
    }

    let dates = true;

    for (let index = 0; index < values.length; index += 1) {
        const text = (values[index] ?? '').trim();

        if (text === '') {
            numbers[index] = Number.NaN;
            continue;
        }

        const parsed = ISO_DATE_PATTERN.test(text) ? Date.parse(text) : Number.NaN;

        if (Number.isNaN(parsed)) {
            dates = false;
            break;
        }

        numbers[index] = parsed;
    }

    if (dates) {
        return { kind: 'number', values: numbers };
    }

    return { kind: 'text', values };
}

export type CsvSortDirection = 'asc' | 'desc';

// Sorts row numbers by the keys in order. Empty cells go last in either direction.
export function sortRowPermutation(
    rows: Uint32Array,
    keys: ReadonlyArray<CsvSortKey>,
    directions: ReadonlyArray<CsvSortDirection>,
): Uint32Array {
    const collator = new Intl.Collator();
    const sorted = rows.slice();

    sorted.sort((left, right) => {
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
            const key = keys[keyIndex] as CsvSortKey;
            const sign = directions[keyIndex] === 'desc' ? -1 : 1;
            let comparison: number;

            if (key.kind === 'number') {
                const leftValue = key.values[left] as number;
                const rightValue = key.values[right] as number;
                const isLeftEmpty = Number.isNaN(leftValue);
                const isRightEmpty = Number.isNaN(rightValue);

                if (isLeftEmpty || isRightEmpty) {
                    comparison = isLeftEmpty === isRightEmpty ? 0 : isLeftEmpty ? 1 : -1;

                    if (comparison !== 0) {
                        return comparison;
                    }

                    continue;
                }

                comparison = (leftValue - rightValue) * sign;
            }
            else {
                const leftValue = key.values[left] ?? '';
                const rightValue = key.values[right] ?? '';

                if (leftValue === '' || rightValue === '') {
                    comparison = leftValue === rightValue ? 0 : leftValue === '' ? 1 : -1;

                    if (comparison !== 0) {
                        return comparison;
                    }

                    continue;
                }

                comparison = collator.compare(leftValue, rightValue) * sign;
            }

            if (comparison !== 0) {
                return comparison;
            }
        }

        return left - right;
    });

    return sorted;
}

// Rough memory a sort key needs: one string per row plus the column's share of the file decoded as UTF-16.
export function estimateSortKeyBytes(input: { byteLength: number; rowCount: number; columnCount: number; keyCount: number }): number {
    const perKey = input.rowCount * STRING_OVERHEAD_BYTES + (2 * input.byteLength) / Math.max(1, input.columnCount);

    return Math.ceil(perKey * input.keyCount);
}
