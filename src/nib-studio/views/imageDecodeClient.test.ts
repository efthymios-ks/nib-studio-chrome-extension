import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDecodeRequest, ImageDecodeResponse } from '../../common/image/imageDecodeRequest.js';
import { createWorkerImageDecoder, DECODE_WORKER_IDLE_MS } from './imageDecodeClient.js';

class FakeWorker {
    onmessage: ((event: MessageEvent<ImageDecodeResponse>) => void) | null = null;

    onerror: ((event: ErrorEvent) => void) | null = null;

    readonly requests: Array<{ request: ImageDecodeRequest; transfer: Transferable[] }> = [];

    terminated = false;

    postMessage(request: ImageDecodeRequest, transfer: Transferable[]): void {
        this.requests.push({ request, transfer });
    }

    terminate(): void {
        this.terminated = true;
    }

    reply(response: ImageDecodeResponse): void {
        this.onmessage?.({ data: response } as MessageEvent<ImageDecodeResponse>);
    }
}

let workers: FakeWorker[];

function decoder(): ReturnType<typeof createWorkerImageDecoder> {
    return createWorkerImageDecoder(() => {
        const worker = new FakeWorker();
        workers.push(worker);

        return worker;
    });
}

async function nextRequestAsync(): Promise<{ worker: FakeWorker; request: ImageDecodeRequest; transfer: Transferable[] }> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const worker = workers.at(-1);
        const sent = worker?.requests.at(-1);

        if (worker != null && sent != null) {
            return { worker, ...sent };
        }

        await Promise.resolve();
    }

    throw new Error('No request was sent');
}

beforeEach(() => {
    workers = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createWorkerImageDecoder', () => {
    it('sends the file bytes as a transfer and resolves with the pixels', async () => {
        const decode = decoder();
        const pending = decode('tiff', new Blob([new Uint8Array([1, 2, 3])]));
        const { worker, request, transfer } = await nextRequestAsync();

        expect(request.decoder).toBe('tiff');
        expect(new Uint8Array(request.bytes)).toEqual(new Uint8Array([1, 2, 3]));
        expect(transfer).toEqual([request.bytes]);

        worker.reply({ id: request.id, ok: true, width: 1, height: 1, pixels: new Uint8ClampedArray([9, 8, 7, 255]).buffer, pageCount: 1 });
        const pixels = await pending;

        expect([pixels.width, pixels.height, pixels.pageCount]).toEqual([1, 1, 1]);
        expect([...pixels.pixels]).toEqual([9, 8, 7, 255]);
    });

    it('starts one worker and matches replies to their requests', async () => {
        const decode = decoder();
        const first = decode('tiff', new Blob(['a']));
        const second = decode('tiff', new Blob(['b']));
        await nextRequestAsync();
        await Promise.resolve();
        await Promise.resolve();
        const worker = workers[0] as FakeWorker;

        expect(workers).toHaveLength(1);
        expect(worker.requests).toHaveLength(2);

        const [one, two] = worker.requests.map((entry) => entry.request);
        worker.reply({ id: two?.id ?? 0, ok: false, message: 'Not a TIFF.' });
        worker.reply({ id: one?.id ?? 0, ok: true, width: 2, height: 1, pixels: new ArrayBuffer(8), pageCount: 3 });

        await expect(second).rejects.toThrow('Not a TIFF.');
        expect((await first).pageCount).toBe(3);
    });

    it('fails every waiting request when the worker breaks, and starts a new one next time', async () => {
        const decode = decoder();
        const pending = decode('tiff', new Blob(['x']));
        const { worker } = await nextRequestAsync();
        worker.onerror?.({ message: 'Script error.', preventDefault: () => {} } as ErrorEvent);

        await expect(pending).rejects.toThrow('Script error.');
        expect(worker.terminated).toBe(true);

        void decode('tiff', new Blob(['y'])).catch(() => {});
        await nextRequestAsync();
        expect(workers).toHaveLength(2);
    });

    it('lets the worker go after a minute without work', async () => {
        vi.useFakeTimers();
        const decode = decoder();
        const pending = decode('tiff', new Blob(['x']));
        const { worker, request } = await nextRequestAsync();
        worker.reply({ id: request.id, ok: true, width: 1, height: 1, pixels: new ArrayBuffer(4), pageCount: 1 });
        await pending;
        vi.advanceTimersByTime(DECODE_WORKER_IDLE_MS - 1);

        expect(worker.terminated).toBe(false);
        vi.advanceTimersByTime(1);
        expect(worker.terminated).toBe(true);
    });
});
