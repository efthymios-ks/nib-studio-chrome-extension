import { extension } from '../fs/fileEntry.js';

// CSV and TSV files above this size are indexed and read on demand instead of loaded whole.
export const LARGE_TABLE_FILE_BYTES = 2 * 1024 * 1024;

export function isLargeTableFile(path: string, size: number): boolean {
    const ext = extension(path);

    return (ext === 'csv' || ext === 'tsv') && size > LARGE_TABLE_FILE_BYTES;
}

export function formatMegabytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createAbortError(): Error {
    const error = new Error('The operation was cancelled.');
    error.name = 'AbortError';

    return error;
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) {
        throw createAbortError();
    }
}

export async function yieldToEventLoopAsync(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}
