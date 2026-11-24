import { describe, expect, it } from 'vitest';
import { applyLineEnding, detectLineEnding, normalizeLineEndings } from './lineEndings.js';

describe('detectLineEnding', () => {
    it('finds Windows line endings', () => {
        expect(detectLineEnding('one\r\ntwo\r\n')).toBe('\r\n');
    });

    it('finds Unix line endings', () => {
        expect(detectLineEnding('one\ntwo\n')).toBe('\n');
    });

    it('finds classic Mac line endings', () => {
        expect(detectLineEnding('one\rtwo\r')).toBe('\r');
    });

    it('uses Unix line endings for text without line breaks', () => {
        expect(detectLineEnding('')).toBe('\n');
        expect(detectLineEnding('one line')).toBe('\n');
    });

    it('picks the most common ending in mixed text', () => {
        expect(detectLineEnding('a\r\nb\r\nc\nd')).toBe('\r\n');
        expect(detectLineEnding('a\nb\nc\r\nd')).toBe('\n');
    });

    it('prefers Unix line endings on a tie', () => {
        expect(detectLineEnding('a\r\nb\nc')).toBe('\n');
    });
});

describe('normalizeLineEndings', () => {
    it('turns every kind of line break into a newline', () => {
        expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    });
});

describe('applyLineEnding', () => {
    it('restores Windows line endings to editor text', () => {
        expect(applyLineEnding('one\ntwo\n', '\r\n')).toBe('one\r\ntwo\r\n');
    });

    it('does not double the carriage return of text that already has Windows line endings', () => {
        expect(applyLineEnding('one\r\ntwo', '\r\n')).toBe('one\r\ntwo');
    });

    it('round-trips a Windows file through the editor unchanged', () => {
        const onDisk = 'first\r\nsecond\r\n\r\nlast';
        const inEditor = normalizeLineEndings(onDisk);

        expect(applyLineEnding(inEditor, detectLineEnding(onDisk))).toBe(onDisk);
    });
});
