import { describe, expect, it } from 'vitest';
import { headingSlug } from './headingSlug.js';

describe('headingSlug', () => {
    it('makes ids as the preview does', () => {
        expect(headingSlug('Release notes')).toBe('release-notes');
        expect(headingSlug('  Café & Co.  ')).toBe('café-co');
    });

    it('keeps letters and digits of any script, so a Greek heading gets an id', () => {
        expect(headingSlug('Σύμβαση 2026')).toBe('σύμβαση-2026');
        expect(headingSlug('Обзор: часть 1')).toBe('обзор-часть-1');
    });
});
