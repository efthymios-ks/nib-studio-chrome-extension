import { describe, expect, it } from 'vitest';
import { formatFileSize } from '../preview/metadataGroups.js';
import { formatLocalDateTime } from '../text/timeFormat.js';
import { cleanProperties, wordMetadataGroups } from './wordProperties.js';

const FILE = { name: 'report.docx', size: 25_516, lastModified: Date.UTC(2026, 10, 18, 10, 22) };

describe('wordMetadataGroups', () => {
    it('lists the file, then the document, its history and its statistics', () => {
        const created = new Date('2026-11-02T09:30:00Z');
        const groups = wordMetadataGroups(FILE, 'Word document (DOCX)', {
            title: 'Quarterly report',
            author: 'Nib Studio samples',
            keywords: 'orders, revenue',
            company: 'Acme',
            created,
            lastSavedBy: 'Nib',
            revision: '3',
            application: 'Microsoft Office Word',
            pages: 1,
            words: 1234,
            characters: 0,
            pictures: 3,
        });

        expect(groups.map((group) => [group.title, group.rows.map((row) => `${row.label}: ${row.value}`)])).toEqual([
            ['File', ['Name: report.docx', 'Type: Word document (DOCX)', `Size: ${formatFileSize(FILE.size)}`, `Modified: ${formatLocalDateTime(new Date(FILE.lastModified))}`]],
            ['Document', ['Title: Quarterly report', 'Author: Nib Studio samples', 'Keywords: orders, revenue', 'Company: Acme']],
            ['History', [`Created: ${formatLocalDateTime(created)}`, 'Modified by: Nib', 'Revision: 3', 'Application: Microsoft Office Word']],
            ['Statistics', ['Pages: 1', 'Words: 1,234', 'Pictures: 3']],
        ]);
    });

    it('shows only the File group when the properties can\'t be read', () => {
        expect(wordMetadataGroups(FILE, 'Word document (DOCX)', null).map((group) => group.title)).toEqual(['File']);
        expect(wordMetadataGroups(FILE, 'Word document (DOCX)', {}).map((group) => group.title)).toEqual(['File']);
    });
});

describe('cleanProperties', () => {
    it('keeps trimmed text, finite numbers and valid dates only', () => {
        expect(cleanProperties({ title: '  Title ', subject: '   ', pages: Number.NaN, words: 3, created: new Date('nope'), author: null }))
            .toEqual({ title: 'Title', words: 3 });
    });
});
