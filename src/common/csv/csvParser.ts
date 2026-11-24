import * as Papa from 'papaparse';

export type CsvDelimiter = ',' | ';' | '\t' | '|';

export interface CsvParseOptions {
    readonly delimiter?: string;
    readonly hasHeader?: boolean;
    readonly dynamicTyping?: boolean;
    readonly skipEmptyLines?: boolean;
    readonly encoding?: string;
    readonly useWorker?: boolean;
}

export interface CsvParseResult {
    readonly header: ReadonlyArray<string> | null;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
    readonly errors: ReadonlyArray<string>;
}

const CANDIDATE_DELIMITERS: ReadonlyArray<CsvDelimiter> = [',', ';', '\t', '|'];

// Auto-detect a delimiter from a text sample by counting occurrences per line.
// The winner is the delimiter with the most consistent per-line count.
export function detectDelimiter(sample: string): string {
    if (sample.length === 0) {
        return ',';
    }

    const lines = sample.split(/\r?\n/).filter((line) => line.length > 0).slice(0, 20);

    if (lines.length === 0) {
        return ',';
    }

    let best: CsvDelimiter = ',';
    let bestScore = -1;

    for (const candidate of CANDIDATE_DELIMITERS) {
        const counts = lines.map((line) => countOutsideQuotes(line, candidate));
        const first = counts[0] ?? 0;

        if (first === 0) {
            continue;
        }

        const consistent = counts.every((value) => value === first);
        const score = consistent ? first * 10 + counts.length : first;

        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
    let inQuote = false;
    let count = 0;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];

        if (char === '"') {
            inQuote = !inQuote;
            continue;
        }

        if (!inQuote && char === delimiter) {
            count += 1;
        }
    }

    return count;
}

// Parse the full CSV using Papa with step/chunk callbacks so the UI thread stays responsive.
export async function parseCsvStreamAsync(
    input: File | string,
    options: CsvParseOptions = {},
): Promise<CsvParseResult> {
    const header = options.hasHeader !== false;
    const rows: unknown[][] = [];
    const errors: string[] = [];
    let headerFields: string[] | null = null;

    await runPapaAsync(input, {
        header,
        skipEmptyLines: options.skipEmptyLines !== false ? 'greedy' : false,
        dynamicTyping: options.dynamicTyping === true,
        worker: options.useWorker === true && typeof Worker !== 'undefined',
        delimiter: options.delimiter,
        encoding: options.encoding,
        step: (result) => {
            if (headerFields == null && Array.isArray(result.meta.fields)) {
                headerFields = [...result.meta.fields];
            }

            const data = result.data as unknown;
            pushRow(rows, data, headerFields);

            for (const error of result.errors) {
                errors.push(error.message);
            }
        },
    });

    return { header: headerFields, rows, errors };
}

function pushRow(
    rows: unknown[][],
    data: unknown,
    headerFields: ReadonlyArray<string> | null,
): void {
    if (Array.isArray(data)) {
        rows.push(data);

        return;
    }

    if (data != null && typeof data === 'object') {
        const record = data as Record<string, unknown>;

        if (headerFields != null) {
            rows.push(headerFields.map((field) => record[field] ?? ''));

            return;
        }

        rows.push(Object.values(record));
    }
}

interface PapaRunConfig {
    readonly header: boolean;
    readonly skipEmptyLines: boolean | 'greedy';
    readonly dynamicTyping: boolean;
    readonly worker: boolean;
    readonly delimiter?: string;
    readonly encoding?: string;
    readonly step: (result: Papa.ParseStepResult<unknown>) => void;
}

function runPapaAsync(input: File | string, config: PapaRunConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const base = {
            header: config.header,
            skipEmptyLines: config.skipEmptyLines,
            dynamicTyping: config.dynamicTyping,
            worker: config.worker,
            delimiter: config.delimiter,
            encoding: config.encoding,
            step: config.step,
            complete: () => resolve(),
            error: (err: Error) => reject(err),
        };

        if (typeof input === 'string') {
            Papa.parse<unknown>(input, base as Papa.ParseConfig<unknown>);

            return;
        }

        Papa.parse<unknown, File>(input, base as unknown as Papa.ParseLocalConfig<unknown, File>);
    });
}
