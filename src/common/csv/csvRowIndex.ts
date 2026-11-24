import { throwIfAborted, yieldToEventLoopAsync } from './csvLimits.js';

const OFFSET_CHUNK_SIZE = 65536;
const QUOTE_BYTE = 0x22;
const LF_BYTE = 0x0a;
const CR_BYTE = 0x0d;
const YIELD_EVERY_BYTES = 4 * 1024 * 1024;

export interface CsvIndexProgress {
    readonly records: number;
    readonly bytesRead: number;
    readonly totalBytes: number;
}

export interface CsvIndexOptions {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: CsvIndexProgress) => void;
}

// Byte offsets of every record start, kept in fixed-size Float64Array chunks so the
// index grows without copying and costs 8 bytes per record.
export class CsvRowIndex {
    private readonly chunks: Float64Array[] = [];

    private recordCount = 0;

    private finished = false;

    constructor(readonly byteLength: number) {
    }

    get count(): number {
        return this.recordCount;
    }

    get complete(): boolean {
        return this.finished;
    }

    // Records whose end offset is known; the last record is open until indexing finishes.
    get readableCount(): number {
        return this.finished ? this.recordCount : Math.max(0, this.recordCount - 1);
    }

    get memoryBytes(): number {
        return this.chunks.length * OFFSET_CHUNK_SIZE * Float64Array.BYTES_PER_ELEMENT;
    }

    push(offset: number): void {
        const chunkIndex = Math.floor(this.recordCount / OFFSET_CHUNK_SIZE);

        if (chunkIndex >= this.chunks.length) {
            this.chunks.push(new Float64Array(OFFSET_CHUNK_SIZE));
        }

        const chunk = this.chunks[chunkIndex] as Float64Array;
        chunk[this.recordCount % OFFSET_CHUNK_SIZE] = offset;
        this.recordCount += 1;
    }

    finish(): void {
        this.finished = true;
    }

    getStart(record: number): number {
        if (record < 0 || record >= this.recordCount) {
            throw new RangeError(`Record ${record} is outside the index.`);
        }

        const chunk = this.chunks[Math.floor(record / OFFSET_CHUNK_SIZE)] as Float64Array;

        return chunk[record % OFFSET_CHUNK_SIZE] as number;
    }

    // End offset (exclusive) of a record, including its line break and any blank lines after it.
    getEnd(record: number): number {
        if (record + 1 < this.recordCount) {
            return this.getStart(record + 1);
        }

        return this.byteLength;
    }
}

// Streams the blob once and records where each record starts, honouring quoted line breaks.
// LF, CRLF and CR line endings are accepted, blank lines are skipped and a UTF-8 BOM is ignored.
export async function buildCsvRowIndexAsync(blob: Blob, options: CsvIndexOptions = {}): Promise<CsvRowIndex> {
    const index = new CsvRowIndex(blob.size);
    await indexIntoAsync(index, blob, options);

    return index;
}

// Same as buildCsvRowIndexAsync, filling an index the caller already holds so it can read rows while indexing runs.
export async function indexIntoAsync(index: CsvRowIndex, blob: Blob, options: CsvIndexOptions = {}): Promise<void> {
    const reader = blob.stream().getReader();
    let position = 0;
    let inQuotes = false;
    let hasContent = false;
    let bytesSinceYield = 0;

    try {
        for (;;) {
            throwIfAborted(options.signal);
            const { value, done } = await reader.read();

            if (done) {
                break;
            }

            const bytes = value;
            let start = 0;

            if (position === 0 && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
                start = 3;
            }

            for (let offset = start; offset < bytes.length; offset += 1) {
                const byte = bytes[offset];

                if (inQuotes) {
                    if (byte === QUOTE_BYTE) {
                        inQuotes = false;
                    }

                    continue;
                }

                if (byte === LF_BYTE || byte === CR_BYTE) {
                    hasContent = false;
                    continue;
                }

                if (!hasContent) {
                    index.push(position + offset);
                    hasContent = true;
                }

                if (byte === QUOTE_BYTE) {
                    inQuotes = true;
                }
            }

            position += bytes.length;
            bytesSinceYield += bytes.length;
            options.onProgress?.({ records: index.count, bytesRead: position, totalBytes: blob.size });

            if (bytesSinceYield >= YIELD_EVERY_BYTES) {
                bytesSinceYield = 0;
                await yieldToEventLoopAsync();
            }
        }
    }
    catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }

    index.finish();
    options.onProgress?.({ records: index.count, bytesRead: position, totalBytes: blob.size });
}
