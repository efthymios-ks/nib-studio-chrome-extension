import { describe, expect, it } from 'vitest';
import { shortcutLetter } from './shortcutKey.js';

describe('shortcutLetter', () => {
    it('reads the letter of an English layout', () => {
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true }))).toBe('d');
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }))).toBe('s');
    });

    it('reads the key\'s place for a second layout such as Greek, as Chrome does for its own shortcuts', () => {
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'δ', code: 'KeyD', ctrlKey: true }))).toBe('d');
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'σ', code: 'KeyS', ctrlKey: true }))).toBe('s');
    });

    it('keeps the letter a Latin layout gives, wherever its key sits', () => {
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'a', code: 'KeyQ', ctrlKey: true }))).toBe('a');
    });

    it('gives other keys as they are, in lower case', () => {
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }))).toBe('enter');
        expect(shortcutLetter(new KeyboardEvent('keydown', { key: 'ς', code: '' }))).toBe('ς');
    });
});
