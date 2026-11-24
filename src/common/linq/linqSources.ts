import { iterateCsvRecordBatchesAsync } from '../csv/csvScan.js';
import { throwIfAborted, yieldToEventLoopAsync } from '../csv/csvLimits.js';
import type { CsvRowIndex } from '../csv/csvRowIndex.js';

export interface LinqRowBatch {
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
    // Rows read so far, this batch included, and the rows in the table.
    readonly done: number;
    readonly total: number;
}

// The table a query reads. Rows come in batches so a large file is never held whole;
// ending the iteration early stops reading.
export interface LinqTableSource {
    readonly columns: ReadonlyArray<string>;
    readonly batches: (signal?: AbortSignal) => AsyncIterable<LinqRowBatch>;
}

const ARRAY_BATCH_ROWS = 5000;

// A table already in memory, handed out in batches with a pause between them so the page stays responsive.
export function createArrayTableSource(
    columns: ReadonlyArray<string>,
    rows: ReadonlyArray<ReadonlyArray<unknown>>,
    batchRows = ARRAY_BATCH_ROWS,
): LinqTableSource {
    return {
        columns,
        batches: async function* (signal) {
            for (let start = 0; start < rows.length; start += batchRows) {
                throwIfAborted(signal);
                const end = Math.min(rows.length, start + batchRows);
                yield { rows: rows.slice(start, end), done: end, total: rows.length };

                if (end < rows.length) {
                    await yieldToEventLoopAsync();
                }
            }
        },
    };
}

export interface CsvTableSourceOptions {
    readonly columns: ReadonlyArray<string>;
    readonly blob: Blob;
    // A completed index of the file; record 0 is the header.
    readonly index: CsvRowIndex;
    readonly delimiter: string;
    readonly batchRecords?: number;
}

// A CSV or TSV file read from disk chunk by chunk.
export function createCsvTableSource(options: CsvTableSourceOptions): LinqTableSource {
    return {
        columns: options.columns,
        batches: async function* (signal) {
            for await (const batch of iterateCsvRecordBatchesAsync({
                blob: options.blob,
                index: options.index,
                delimiter: options.delimiter,
                firstRecord: 1,
                batchRecords: options.batchRecords,
                signal,
            })) {
                yield { rows: batch.records, done: batch.scannedRows, total: batch.totalRows };
            }
        },
    };
}
