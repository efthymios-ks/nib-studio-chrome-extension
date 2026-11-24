import { describe, expect, it, vi } from 'vitest';
import { listenForPreviewFind, requestPreviewFind, takePreviewFind } from './previewFindRequests.js';

describe('previewFindRequests', () => {
    it('keeps a phrase for its preview until that preview takes it', () => {
        requestPreviewFind('a.pdf', 'Total');

        expect(takePreviewFind('b.pdf')).toBeNull();
        expect(takePreviewFind('a.pdf')).toBe('Total');
        expect(takePreviewFind('a.pdf')).toBeNull();
    });

    it('keeps only the newest request', () => {
        requestPreviewFind('a.pdf', 'first');
        requestPreviewFind('b.docx', 'second');

        expect(takePreviewFind('a.pdf')).toBeNull();
        expect(takePreviewFind('b.docx')).toBe('second');
    });

    it('tells a preview listening for its own key, until it stops', () => {
        const heard = vi.fn();
        const stop = listenForPreviewFind('a.pdf', heard);
        requestPreviewFind('b.pdf', 'elsewhere');
        requestPreviewFind('a.pdf', 'here');
        stop();
        requestPreviewFind('a.pdf', 'again');

        expect(heard).toHaveBeenCalledTimes(1);
        takePreviewFind('a.pdf');
    });
});
