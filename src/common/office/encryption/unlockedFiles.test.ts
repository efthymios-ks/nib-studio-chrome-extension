import { describe, expect, it } from 'vitest';
import { rememberUnlocked, unlockedBytesOf } from './unlockedFiles.js';

describe('unlockedBytesOf', () => {
    it('gives the plain bytes of the same File snapshot only', () => {
        const file = new File(['locked'], 'a.docx');
        const changed = new File(['locked'], 'a.docx');
        const plain = Uint8Array.of(1, 2, 3);

        expect(unlockedBytesOf(file)).toBeNull();
        rememberUnlocked(file, plain);

        expect(unlockedBytesOf(file)).toBe(plain);
        expect(unlockedBytesOf(changed)).toBeNull();
    });
});
