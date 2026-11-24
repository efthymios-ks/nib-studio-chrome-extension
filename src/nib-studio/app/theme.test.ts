import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, nextTheme } from './theme.js';

describe('theme', () => {
    afterEach(() => {
        delete document.documentElement.dataset.theme;
    });

    it('applies the theme to the document element', () => {
        applyTheme('dark');

        expect(document.documentElement.dataset.theme).toBe('dark');

        applyTheme('light');

        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('toggles between light and dark', () => {
        expect(nextTheme('light')).toBe('dark');
        expect(nextTheme('dark')).toBe('light');
    });
});
