import { describe, expect, it, vi } from 'vitest';
import { cachePerFile } from './fileCache.js';

describe('cachePerFile', () => {
    it('reads a File snapshot once, and a new snapshot again', async () => {
        const read = vi.fn(async (file: File, label: string) => `${label}:${file.size}`);
        const cached = cachePerFile(read);
        const first = new File(['abc'], 'a.txt');
        const second = new File(['abcd'], 'a.txt');

        expect(await cached(first, 'one')).toBe('one:3');
        expect(await cached(first, 'two')).toBe('one:3');
        expect(await cached(second, 'three')).toBe('three:4');
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('forgets a read that fails, so the next one tries again', async () => {
        const read = vi.fn()
            .mockRejectedValueOnce(new Error('busy'))
            .mockResolvedValueOnce('ok');
        const cached = cachePerFile<string, []>(read);
        const file = new File(['x'], 'x.bin');

        await expect(cached(file)).rejects.toThrow('busy');
        expect(await cached(file)).toBe('ok');
        expect(read).toHaveBeenCalledTimes(2);
    });
});
