import { detectDelimiter } from '../../common/csv/csvParser.js';
import { CsvRangeReader, parseCsvRecords } from '../../common/csv/csvRangeReader.js';
import { CsvRowIndex, indexIntoAsync } from '../../common/csv/csvRowIndex.js';
import {
    buildSortKeysAsync,
    estimateSortKeyBytes,
    findMatchingRowsAsync,
    sortRowPermutation,
    type CsvSortKey,
} from '../../common/csv/csvScan.js';
import { formatMegabytes, throwIfAborted } from '../../common/csv/csvLimits.js';
import { extension } from '../../common/fs/fileEntry.js';
import { evaluateFilter } from './tableFilters.js';
import type {
    TableLargeQuery,
    TableLargeQueryOptions,
    TableLargeQueryResult,
    TableLargeSource,
} from './tableView.js';

const SAMPLE_BYTES = 64 * 1024;
const SORT_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

// A CSV or TSV file read on demand: a byte-offset index, an LRU cache of parsed blocks,
// and streaming scans for search, filters and sort keys. Record 0 is the header.
export class LargeCsvSource implements TableLargeSource {
    readonly index: CsvRowIndex;

    readonly reader: CsvRangeReader;

    private readonly listeners = new Set<() => void>();

    private readonly indexing: Promise<void>;

    private readonly sortKeys = new Map<number, CsvSortKey>();

    private bytesIndexed = 0;

    private indexError: Error | null = null;

    private lastQuery: { key: string; result: TableLargeQueryResult } | null = null;

    private constructor(
        readonly file: Blob,
        readonly delimiter: string,
        readonly columns: ReadonlyArray<string>,
    ) {
        this.index = new CsvRowIndex(file.size);
        this.reader = new CsvRangeReader({ blob: file, index: this.index, delimiter });
        this.indexing = indexIntoAsync(this.index, file, {
            onProgress: (progress) => {
                this.bytesIndexed = progress.bytesRead;
                this.notify();
            },
        }).catch((error: unknown) => {
            this.indexError = error instanceof Error ? error : new Error(String(error));
            this.index.finish();
            this.notify();
        });
    }

    static async openAsync(file: Blob, fileName: string): Promise<LargeCsvSource> {
        const sample = await file.slice(0, SAMPLE_BYTES).text();
        const delimiter = extension(fileName) === 'tsv' ? '\t' : detectDelimiter(sample);
        const header = parseCsvRecords(sample.replace(/^\uFEFF/, ''), delimiter)[0] ?? [];
        const columns = header.map((name, index) => (name.trim() === '' ? `Column ${index + 1}` : name));

        return new LargeCsvSource(file, delimiter, columns);
    }

    // Resolves once the whole file is indexed.
    async whenIndexedAsync(): Promise<void> {
        await this.indexing;
    }

    getRowCount(): number {
        return Math.max(0, this.index.readableCount - 1);
    }

    isIndexing(): boolean {
        return !this.index.complete;
    }

    getIndexProgress(): number {
        return this.file.size === 0 ? 1 : this.bytesIndexed / this.file.size;
    }

    getError(): string | null {
        return this.indexError?.message ?? null;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    getCachedRow(row: number): ReadonlyArray<unknown> | undefined {
        return this.reader.getCachedRecord(row + 1);
    }

    // Reads rows in any order, touching each cached block once.
    async readRowsAsync(rows: ArrayLike<number>): Promise<ReadonlyArray<ReadonlyArray<unknown>>> {
        const result = new Array<ReadonlyArray<unknown>>(rows.length);
        const positionsByBlock = new Map<number, number[]>();
        const blockSize = this.reader.blockSize;

        for (let position = 0; position < rows.length; position += 1) {
            const block = Math.floor(((rows[position] as number) + 1) / blockSize);
            const positions = positionsByBlock.get(block);

            if (positions == null) {
                positionsByBlock.set(block, [position]);
            }
            else {
                positions.push(position);
            }
        }

        for (const block of [...positionsByBlock.keys()].sort((left, right) => left - right)) {
            const records = await this.reader.readBlockAsync(block);

            for (const position of positionsByBlock.get(block) ?? []) {
                const record = (rows[position] as number) + 1;
                result[position] = records[record - block * blockSize] ?? [];
            }
        }

        return result;
    }

    async queryAsync(query: TableLargeQuery, options: TableLargeQueryOptions): Promise<TableLargeQueryResult> {
        const key = JSON.stringify(query);

        if (this.lastQuery?.key === key) {
            return this.lastQuery.result;
        }

        const needle = query.search.trim().toLowerCase();
        const narrowing = query.filters.length > 0 || needle !== '';

        if (!narrowing && query.sorts.length === 0) {
            return { rows: null };
        }

        await this.waitForIndexAsync(options);
        const scan = { blob: this.file, index: this.index, delimiter: this.delimiter, firstRecord: 1, signal: options.signal };
        let rows: Uint32Array | null = null;

        if (narrowing) {
            rows = await findMatchingRowsAsync({
                ...scan,
                predicate: (record) => query.filters.every(({ columnIndex, filter }) => evaluateFilter(record[columnIndex] ?? '', filter))
                    && (needle === '' || query.searchColumns.some((column) => (record[column] ?? '').toLowerCase().includes(needle))),
                onMatches: (matches, progress) => options.onProgress({
                    phase: 'scanning',
                    done: progress.scannedRows,
                    total: progress.totalRows,
                    matches,
                }),
            });
        }

        let warning: string | undefined;

        if (query.sorts.length > 0) {
            const missing = query.sorts.map((sort) => sort.columnIndex).filter((column) => !this.sortKeys.has(column));
            const estimate = estimateSortKeyBytes({
                byteLength: this.file.size,
                rowCount: this.getRowCount(),
                columnCount: Math.max(1, this.columns.length),
                keyCount: missing.length,
            });

            if (estimate > SORT_MEMORY_LIMIT_BYTES) {
                warning = `Sorting needs about ${formatMegabytes(estimate)} for this column, over the ${formatMegabytes(SORT_MEMORY_LIMIT_BYTES)} limit; rows stay in file order.`;
            }
            else {
                await this.loadSortKeysAsync(missing, options);
                const keys = query.sorts.map((sort) => this.sortKeys.get(sort.columnIndex) as CsvSortKey);
                options.onProgress({ phase: 'sorting', done: 1, total: 1 });
                rows = sortRowPermutation(rows ?? identityRows(this.getRowCount()), keys, query.sorts.map((sort) => sort.direction));
            }
        }

        // Keep only the keys the current sort uses.
        for (const column of [...this.sortKeys.keys()]) {
            if (!query.sorts.some((sort) => sort.columnIndex === column)) {
                this.sortKeys.delete(column);
            }
        }

        const result: TableLargeQueryResult = warning == null ? { rows } : { rows, warning };
        this.lastQuery = { key, result };

        return result;
    }

    private async loadSortKeysAsync(columns: ReadonlyArray<number>, options: TableLargeQueryOptions): Promise<void> {
        if (columns.length === 0) {
            return;
        }

        const keys = await buildSortKeysAsync({
            blob: this.file,
            index: this.index,
            delimiter: this.delimiter,
            firstRecord: 1,
            columns,
            signal: options.signal,
            onProgress: (progress) => options.onProgress({ phase: 'sorting', done: progress.scannedRows, total: progress.totalRows }),
        });

        columns.forEach((column, position) => {
            const key = keys[position];

            if (key != null) {
                this.sortKeys.set(column, key);
            }
        });
    }

    private async waitForIndexAsync(options: TableLargeQueryOptions): Promise<void> {
        if (this.index.complete) {
            return;
        }

        const report = (): void => options.onProgress({ phase: 'indexing', done: this.bytesIndexed, total: this.file.size });
        report();
        const unsubscribe = this.subscribe(report);

        try {
            await this.indexing;
        }
        finally {
            unsubscribe();
        }

        throwIfAborted(options.signal);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

function identityRows(count: number): Uint32Array {
    const rows = new Uint32Array(count);

    for (let row = 0; row < count; row += 1) {
        rows[row] = row;
    }

    return rows;
}
