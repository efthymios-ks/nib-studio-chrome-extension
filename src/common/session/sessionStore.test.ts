import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION } from './sessionStore.js';

describe('DEFAULT_SESSION', () => {
    it('starts in the light theme', () => {
        expect(DEFAULT_SESSION.theme).toBe('light');
    });
});
