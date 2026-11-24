import { beforeEach, describe, expect, it } from 'vitest';
import { readInfoPanelOpen, renderInfoPanel, writeInfoPanelOpen } from './previewInfoPanel.js';

describe('renderInfoPanel', () => {
    it('shows titled groups of label and value rows as plain text', () => {
        const panel = document.createElement('aside');
        renderInfoPanel(panel, [
            { title: 'File', rows: [{ label: 'Name', value: 'photo.jpg' }, { label: 'Type', value: 'JPEG image' }] },
            { title: 'Location', rows: [{ label: 'Coordinates', value: '48.858222° N, 2.294500° E' }] },
        ]);

        expect([...panel.querySelectorAll('.preview-info-title')].map((title) => title.textContent)).toEqual(['File', 'Location']);
        expect([...panel.querySelectorAll('.preview-info-row')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])).toEqual([
            ['Name', 'photo.jpg'],
            ['Type', 'JPEG image'],
            ['Coordinates', '48.858222° N, 2.294500° E'],
        ]);
        expect(panel.querySelector('a, button')).toBeNull();
    });

    it('says when the details are still being read, and when there are none', () => {
        const panel = document.createElement('aside');
        renderInfoPanel(panel, null);
        expect(panel.textContent).toBe('Reading details…');

        renderInfoPanel(panel, []);
        expect(panel.textContent).toBe('No details to show.');
    });
});

describe('Info panel open state', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('starts closed and remembers being opened', () => {
        expect(readInfoPanelOpen()).toBe(false);

        writeInfoPanelOpen(true);
        expect(readInfoPanelOpen()).toBe(true);

        writeInfoPanelOpen(false);
        expect(readInfoPanelOpen()).toBe(false);
    });
});
