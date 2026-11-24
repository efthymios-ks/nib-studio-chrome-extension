import type { ImageDecodeRequest, ImageDecodeResponse } from '../../common/image/imageDecodeRequest.js';

export interface DecodedPixels {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray<ArrayBuffer>;
    // The pages of the TIFF.
    readonly pageCount: number;
}

export type DecodeImageAsync = (decoder: 'tiff', file: Blob) => Promise<DecodedPixels>;

// The worker is let go after this long without work, which frees its memory.
export const DECODE_WORKER_IDLE_MS = 60_000;

interface WorkerLike {
    onmessage: ((event: MessageEvent<ImageDecodeResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: ImageDecodeRequest, transfer: Transferable[]): void;
    terminate(): void;
}

interface Pending {
    readonly resolve: (pixels: DecodedPixels) => void;
    readonly reject: (error: Error) => void;
}

// The worker script sits next to main.js in the package and is never fetched from anywhere else.
function createDecodeWorker(): WorkerLike {
    return new Worker(new URL('./imageDecodeWorker.js', import.meta.url), { name: 'Nib Studio image decoder' });
}

// Sends TIFF files to the decode worker, one shared worker started on first use.
export function createWorkerImageDecoder(createWorker: () => WorkerLike = createDecodeWorker): DecodeImageAsync {
    let worker: WorkerLike | null = null;
    let nextId = 1;
    let idleTimer: number | null = null;
    const pending = new Map<number, Pending>();

    const stop = (reason: string): void => {
        worker?.terminate();
        worker = null;

        for (const entry of pending.values()) {
            entry.reject(new Error(reason));
        }

        pending.clear();
    };

    const scheduleIdleStop = (): void => {
        if (idleTimer != null) {
            window.clearTimeout(idleTimer);
            idleTimer = null;
        }

        if (pending.size === 0 && worker != null) {
            idleTimer = window.setTimeout(() => stop('The image decoder was stopped.'), DECODE_WORKER_IDLE_MS);
        }
    };

    const ensureWorker = (): WorkerLike => {
        if (worker != null) {
            return worker;
        }

        const created = createWorker();
        created.onmessage = (event) => {
            const response = event.data;
            const entry = pending.get(response.id);
            pending.delete(response.id);
            scheduleIdleStop();

            if (entry == null) {
                return;
            }

            if (!response.ok) {
                entry.reject(new Error(response.message));

                return;
            }

            entry.resolve({
                width: response.width,
                height: response.height,
                pixels: new Uint8ClampedArray(response.pixels),
                pageCount: response.pageCount,
            });
        };
        created.onerror = (event) => {
            event.preventDefault?.();
            const reason = event.message === '' || event.message == null
                ? 'The image decoder stopped working.'
                : event.message;
            stop(reason);
        };
        worker = created;

        return created;
    };

    return async (decoder, file) => {
        const bytes = await file.arrayBuffer();
        const id = nextId;
        nextId += 1;

        return await new Promise<DecodedPixels>((resolve, reject) => {
            const target = ensureWorker();
            pending.set(id, { resolve, reject });
            scheduleIdleStop();
            target.postMessage({ id, decoder, bytes }, [bytes]);
        });
    };
}
