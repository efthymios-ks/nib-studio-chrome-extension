import { describe, expect, it } from 'vitest';
import { passwordOfUnlockedPdf, rememberUnlockedPdf } from './unlockedPdfs.js';

describe('unlocked PDFs', () => {
    it('keeps the password that opened a PDF for that File snapshot alone', () => {
        const snapshot = new File(['%PDF-1.7'], 'locked.pdf');
        const changedOnDisk = new File(['%PDF-1.7'], 'locked.pdf');

        expect(passwordOfUnlockedPdf(snapshot)).toBeNull();
        rememberUnlockedPdf(snapshot, 'abc');

        expect(passwordOfUnlockedPdf(snapshot)).toBe('abc');
        expect(passwordOfUnlockedPdf(changedOnDisk)).toBeNull();
    });
});
