import type { CsvRowIndex } from './csvRowIndex.js';

const QUOTE_CODE = 0x22;
const LF_CODE = 0x0a;
const CR_CODE = 0x0d;
const DEFAULT_BLOCK_SIZE = 2000;
const DEFAULT_MAX_BLOCKS = 20;

export type CsvRecord = ReadonlyArray<string>;

// Parses CSV text into records of string fields. Quoted fields may hold delimiters,
// doubled quotes and line breaks; blank lines are skipped.
export function parseCsvRecords(text: string, delimiter: string): string[][] {
    const records: string[][] = [];
    const delimiterCode = delimiter.charCodeAt(0);
    const length = text.length;
    let row: string[] = [];
    let lineEmpty = true;
    let position = 0;

    while (position <= length) {
        if (position < length && text.charCodeAt(position) === QUOTE_CODE) {
            let value = '';
            let cursor = position + 1;

            for (;;) {
                const quote = text.indexOf('"', cursor);

                if (quote < 0) {
                    value += text.slice(cursor);
                    position = length;
                    break;
                }

                value += text.slice(cursor, quote);

                if (text.charCodeAt(quote + 1) === QUOTE_CODE) {
                    value += '"';
                    cursor = quote + 2;
                    continue;
                }

                position = quote + 1;
                break;
            }

            const tailStart = position;

            while (position < length && !isFieldEnd(text.charCodeAt(position), delimiterCode)) {
                position += 1;
            }

            row.push(value + text.slice(tailStart, position));
            lineEmpty = false;
        }
        else {
            const fieldStart = position;

            while (position < length && !isFieldEnd(text.charCodeAt(position), delimiterCode)) {
                position += 1;
            }

            if (position > fieldStart) {
                lineEmpty = false;
            }

            row.push(text.slice(fieldStart, position));
        }

        if (position >= length) {
            if (!(row.length === 1 && lineEmpty)) {
                records.push(row);
            }

            break;
        }

        const code = text.charCodeAt(position);

        if (code === delimiterCode) {
            lineEmpty = false;
            position += 1;
            continue;
        }

        if (!(row.length === 1 && lineEmpty)) {
            records.push(row);
        }

        row = [];
        lineEmpty = true;
        position += code === CR_CODE && text.charCodeAt(position + 1) === LF_CODE ? 2 : 1;

        if (position >= length) {
            break;
        }
    }

    return records;
}

function isFieldEnd(code: number, delimiterCode: number): boolean {
    return code === delimiterCode || code === LF_CODE || code === CR_CODE;
}

export interface CsvRangeOptions {
    readonly blob: Blob;
    readonly index: CsvRowIndex;
    readonly delimiter: string;
}

// Reads records [start, end) by slicing the blob at their byte offsets, decoding and parsing only that range.
export async function readCsvRecordsAsync(options: CsvRangeOptions, start: number, end: number): Promise<CsvRecord[]> {
    const last = Math.min(end, options.index.readableCount);

    if (start >= last) {
        return [];
    }

    const from = options.index.getStart(start);
    const to = options.index.getEnd(last - 1);
    const text = await options.blob.slice(from, to).text();
    const records: CsvRecord[] = parseCsvRecords(text, options.delimiter);
    const expected = last - start;

    // A malformed quote can merge or split records; keep row numbers aligned with the index regardless.
    while (records.length < expected) {
        records.push([]);
    }

    records.length = expected;

    return records;
}

export interface CsvRangeReaderOptions extends CsvRangeOptions {
    readonly blockSize?: number;
    readonly maxBlocks?: number;
}

// Reads records through an LRU cache of decoded blocks, so scrolling back and forth costs no re-parsing.
export class CsvRangeReader {
    readonly blockSize: number;

    private readonly maxBlocks: number;

    private readonly cache = new Map<number, CsvRecord[]>();

    private readonly pending = new Map<number, Promise<CsvRecord[]>>();

    private blockReads = 0;

    constructor(private readonly options: CsvRangeReaderOptions) {
        this.blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
        this.maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
    }

    // Number of block slices read and parsed so far.
    get reads(): number {
        return this.blockReads;
    }

    get cachedBlockCount(): number {
        return this.cache.size;
    }

    getCachedRecord(record: number): CsvRecord | undefined {
        const block = Math.floor(record / this.blockSize);
        const records = this.cache.get(block);

        if (records == null) {
            return undefined;
        }

        this.cache.delete(block);
        this.cache.set(block, records);

        return records[record - block * this.blockSize];
    }

    async readRecordsAsync(start: number, end: number): Promise<CsvRecord[]> {
        const last = Math.min(end, this.options.index.readableCount);
        const result: CsvRecord[] = [];

        if (start >= last) {
            return result;
        }

        const firstBlock = Math.floor(start / this.blockSize);
        const lastBlock = Math.floor((last - 1) / this.blockSize);

        for (let block = firstBlock; block <= lastBlock; block += 1) {
            const records = await this.readBlockAsync(block);
            const blockStart = block * this.blockSize;
            const from = Math.max(start, blockStart) - blockStart;
            const to = Math.min(last, blockStart + records.length) - blockStart;

            for (let offset = from; offset < to; offset += 1) {
                result.push(records[offset] ?? []);
            }
        }

        return result;
    }

    async readBlockAsync(block: number): Promise<CsvRecord[]> {
        const cached = this.cache.get(block);

        if (cached != null) {
            this.cache.delete(block);
            this.cache.set(block, cached);

            return cached;
        }

        const inFlight = this.pending.get(block);

        if (inFlight != null) {
            return await inFlight;
        }

        const blockStart = block * this.blockSize;
        const blockEnd = blockStart + this.blockSize;
        const complete = blockEnd <= this.options.index.readableCount;
        const promise = readCsvRecordsAsync(this.options, blockStart, blockEnd);
        this.pending.set(block, promise);
        this.blockReads += 1;

        try {
            const records = await promise;

            // A block cut short by indexing still in progress is read again later rather than cached.
            if (complete) {
                this.remember(block, records);
            }

            return records;
        }
        finally {
            this.pending.delete(block);
        }
    }

    clear(): void {
        this.cache.clear();
    }

    private remember(block: number, records: CsvRecord[]): void {
        this.cache.set(block, records);

        while (this.cache.size > this.maxBlocks) {
            const oldest = this.cache.keys().next().value;

            if (oldest == null) {
                break;
            }

            this.cache.delete(oldest);
        }
    }
}
