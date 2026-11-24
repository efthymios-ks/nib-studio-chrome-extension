import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    LARGE_TABLE_FILE_BYTES,
    createAbortError,
    formatMegabytes,
    isAbortError,
    isLargeTableFile,
    throwIfAborted,
    yieldToEventLoopAsync,
} from './csvLimits.js';

describe('csvLimits', () => {
    describe('isLargeTableFile', () => {
        it('flags a CSV file above the threshold', () => {
            expect(isLargeTableFile('data/orders.csv', LARGE_TABLE_FILE_BYTES + 1)).toBe(true);
        });

        it('flags a TSV file regardless of extension case', () => {
            expect(isLargeTableFile('ORDERS.TSV', LARGE_TABLE_FILE_BYTES + 1)).toBe(true);
        });

        it('does not flag a file exactly at the threshold', () => {
            expect(isLargeTableFile('orders.csv', LARGE_TABLE_FILE_BYTES)).toBe(false);
        });

        it('does not flag other file types however large', () => {
            expect(isLargeTableFile('orders.json', LARGE_TABLE_FILE_BYTES * 10)).toBe(false);
            expect(isLargeTableFile('csv', LARGE_TABLE_FILE_BYTES * 10)).toBe(false);
        });
    });

    describe('formatMegabytes', () => {
        it('formats bytes with one decimal', () => {
            expect(formatMegabytes(2 * 1024 * 1024)).toBe('2.0 MB');
            expect(formatMegabytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
        });

        it('formats zero', () => {
            expect(formatMegabytes(0)).toBe('0.0 MB');
        });
    });

    describe('createAbortError', () => {
        it('creates an error named AbortError', () => {
            const error = createAbortError();

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('AbortError');
            expect(error.message).toBe('The operation was cancelled.');
        });
    });

    describe('isAbortError', () => {
        it('recognises an abort error', () => {
            expect(isAbortError(createAbortError())).toBe(true);
            expect(isAbortError(new DOMException('Stopped.', 'AbortError'))).toBe(true);
        });

        it('rejects other errors and non-errors', () => {
            expect(isAbortError(new Error('Boom.'))).toBe(false);
            expect(isAbortError({ name: 'AbortError' })).toBe(false);
            expect(isAbortError(null)).toBe(false);
        });
    });

    describe('throwIfAborted', () => {
        it('does nothing without a signal or with a live signal', () => {
            expect(() => throwIfAborted(undefined)).not.toThrow();
            expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
        });

        it('throws an abort error once the signal is aborted', () => {
            const controller = new AbortController();
            controller.abort();

            expect(() => throwIfAborted(controller.signal)).toThrow(expect.objectContaining({ name: 'AbortError' }));
        });
    });

    describe('yieldToEventLoopAsync', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('resolves only after a timer tick', async () => {
            vi.useFakeTimers();
            let resolved = false;
            const pending = yieldToEventLoopAsync().then(() => {
                resolved = true;
            });

            await Promise.resolve();
            expect(resolved).toBe(false);

            await vi.advanceTimersByTimeAsync(0);
            await pending;
            expect(resolved).toBe(true);
        });
    });
});
