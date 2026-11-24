import { describe, expect, it } from 'vitest';
import { emptyState } from './emptyState.js';

describe('emptyState', () => {
    it('shows the title and message without a button', () => {
        const element = emptyState({ title: 'No folder', message: 'Open a folder to start.' });

        expect(element.className).toBe('editor-placeholder');
        expect(element.querySelector('h2')?.textContent).toBe('No folder');
        expect(element.querySelector('p')?.textContent).toBe('Open a folder to start.');
        expect(element.querySelector('button')).toBeNull();
    });
});
