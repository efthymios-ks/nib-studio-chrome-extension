import { HASH_ALGORITHMS, type HashAlgorithm } from './hash.js';
import { Md5 } from './md5.js';

export interface BlobDigestOptions {
    // Called with the share of the work done, from 0 to 1.
    readonly onProgress?: (fraction: number) => void;
    readonly signal?: AbortSignal;
    readonly chunkSize?: number;
}

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
// Reading the file and feeding MD5 counts for this share of the progress; the SHA digests for the rest.
const READ_SHARE = 0.8;

// Every algorithm's digest of a file or blob. MD5 is fed chunk by chunk as the file is read;
// Web Crypto can't digest in pieces, so the SHA digests run once the whole file is in memory.
export async function digestBlobAsync(blob: Blob, options: BlobDigestOptions = {}): Promise<Map<HashAlgorithm, Uint8Array>> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const bytes = new Uint8Array(blob.size);
    const md5 = new Md5();

    options.onProgress?.(0);

    for (let offset = 0; offset < blob.size; offset += chunkSize) {
        options.signal?.throwIfAborted();
        const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
        bytes.set(chunk, offset);
        md5.update(chunk);
        options.onProgress?.(READ_SHARE * Math.min(1, (offset + chunk.length) / blob.size));
    }

    options.signal?.throwIfAborted();
    const digests = new Map<HashAlgorithm, Uint8Array>([['MD5', md5.digest()]]);
    const shaAlgorithms = HASH_ALGORITHMS.filter((algorithm) => algorithm !== 'MD5');
    const shareEach = (1 - READ_SHARE) / shaAlgorithms.length;
    let finished = 0;

    await Promise.all(shaAlgorithms.map(async (algorithm) => {
        digests.set(algorithm, new Uint8Array(await crypto.subtle.digest(algorithm, bytes)));
        finished += 1;
        options.onProgress?.(READ_SHARE + finished * shareEach);
    }));

    options.signal?.throwIfAborted();

    return new Map(HASH_ALGORITHMS.map((algorithm) => [algorithm, digests.get(algorithm) as Uint8Array]));
}
