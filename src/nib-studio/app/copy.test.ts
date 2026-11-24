import { describe, expect, it } from 'vitest';
import { resolveCopyName } from './app.js';

describe('resolveCopyName', () => {
    it('returns the name unchanged when nothing collides', () => {
        expect(resolveCopyName('notes.md', new Set())).toBe('notes.md');
    });

    it('adds -copy before the extension on first collision', () => {
        expect(resolveCopyName('notes.md', new Set(['notes.md']))).toBe('notes-copy.md');
    });

    it('bumps -copy-N when -copy also exists', () => {
        const existing = new Set(['notes.md', 'notes-copy.md']);

        expect(resolveCopyName('notes.md', existing)).toBe('notes-copy-2.md');
    });

    it('keeps incrementing until a slot is free', () => {
        const existing = new Set([
            'notes.md',
            'notes-copy.md',
            'notes-copy-2.md',
            'notes-copy-3.md',
        ]);

        expect(resolveCopyName('notes.md', existing)).toBe('notes-copy-4.md');
    });

    it('handles names without an extension', () => {
        const existing = new Set(['data', 'data-copy']);

        expect(resolveCopyName('data', existing)).toBe('data-copy-2');
    });

    it('treats a leading dot as part of the base, not an extension', () => {
        const existing = new Set(['.env', '.env-copy']);

        expect(resolveCopyName('.env', existing)).toBe('.env-copy-2');
    });
});
