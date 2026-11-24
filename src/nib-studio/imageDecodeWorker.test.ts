import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDecodeRequest, ImageDecodeResponse } from '../common/image/imageDecodeRequest.js';
import { buildTiff } from '../common/image/testing/imageBuilders.js';

const TIFF = buildTiff([{ width: 6, height: 4, rgb: new Array(6 * 4 * 3).fill(9) }, { width: 1, height: 1, rgb: [1, 2, 3] }]);

interface WorkerScope {
    onmessage: ((event: { data: ImageDecodeRequest }) => void) | null;
}

const scope = self as unknown as WorkerScope;
let posted: Array<{ message: ImageDecodeResponse; transfer: Transferable[] }>;

async function startWorkerAsync(): Promise<void> {
    vi.resetModules();
    await import('./imageDecodeWorker.js');
}

async function sendAsync(request: ImageDecodeRequest): Promise<ImageDecodeResponse> {
    const count = posted.length;
    scope.onmessage?.({ data: request });
    await vi.waitFor(() => expect(posted.length).toBe(count + 1));

    return (posted.at(-1) as { message: ImageDecodeResponse }).message;
}

beforeEach(() => {
    posted = [];
    vi.spyOn(window, 'postMessage').mockImplementation(((message: ImageDecodeResponse, transfer: Transferable[]) => {
        posted.push({ message, transfer });
    }) as unknown as typeof window.postMessage);
});

afterEach(() => {
    scope.onmessage = null;
    vi.restoreAllMocks();
});

describe('imageDecodeWorker', () => {
    it('decodes a TIFF and transfers the pixels back', async () => {
        await startWorkerAsync();
        const response = await sendAsync({ id: 3, decoder: 'tiff', bytes: TIFF.slice().buffer });

        expect(response).toMatchObject({ id: 3, ok: true, width: 6, height: 4, pageCount: 2 });
        expect(posted[0]?.transfer).toEqual([response.ok ? response.pixels : null]);
    });

    it('answers a damaged file with a message and transfers nothing', async () => {
        await startWorkerAsync();
        const response = await sendAsync({ id: 4, decoder: 'tiff', bytes: new ArrayBuffer(8) });

        expect(response.ok).toBe(false);
        expect(response.ok ? '' : response.message).not.toBe('');
        expect(posted[0]?.transfer).toEqual([]);
    });
});
