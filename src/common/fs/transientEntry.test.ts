import { describe, expect, it } from 'vitest';
import { isTransientEntry } from './transientEntry.js';

describe('isTransientEntry', () => {
    it.each([
        '.nib-studio-configuration.json.crswap',
        'notes.md.crswap',
        'notes.md.1.crswap',
        '.crswap',
    ])('takes %s for Chrome\'s temporary swap file', (name) => {
        expect(isTransientEntry(name)).toBe(true);
    });

    it.each([
        '.nib-studio-configuration.json',
        'notes.md',
        'crswap',
        'notes.crswap.md',
        'notes.crswap-backup',
    ])('keeps %s', (name) => {
        expect(isTransientEntry(name)).toBe(false);
    });
});
