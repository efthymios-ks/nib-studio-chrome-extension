import { describe, expect, it } from 'vitest';
import {
    DIFF_DOCUMENT_FORMAT,
    DIFF_DOCUMENT_VERSION,
    diffExportFileName,
    serializeDiffDocument,
    sidesOfChange,
    summarizeChanges,
    type DiffChange,
    type TextDiffDocument,
} from './diffDocument.js';

function change(id: string, kind: DiffChange['kind']): DiffChange {
    return { id, kind, location: {} };
}

function textDocument(originalName: string, modifiedName: string): TextDiffDocument {
    return {
        format: DIFF_DOCUMENT_FORMAT,
        version: DIFF_DOCUMENT_VERSION,
        kind: 'text',
        original: { name: originalName, source: 'file', path: originalName },
        modified: { name: modifiedName, source: 'file', path: modifiedName },
        options: {
            whitespace: 'none',
            ignoreCase: false,
            ignoreBlankLines: false,
            normalizeLineEndings: true,
            ignorePatterns: [],
            sortLines: false,
            uniqueLines: false,
            trimLines: false,
        },
        summary: summarizeChanges([]),
        changes: [],
        rows: [],
    };
}

describe('summarizeChanges', () => {
    it('counts the changes by kind', () => {
        const summary = summarizeChanges([
            change('a', 'added'),
            change('b', 'added'),
            change('c', 'removed'),
            change('d', 'changed'),
            change('e', 'typeChanged'),
        ]);

        expect(summary).toEqual({ total: 5, added: 2, removed: 1, changed: 1, typeChanged: 1 });
    });

    it('counts nothing for no changes', () => {
        expect(summarizeChanges([])).toEqual({ total: 0, added: 0, removed: 0, changed: 0, typeChanged: 0 });
    });
});

describe('sidesOfChange', () => {
    it('shows an addition on the modified side, a removal on the original and the rest on both', () => {
        expect(sidesOfChange('added')).toBe('modified');
        expect(sidesOfChange('removed')).toBe('original');
        expect(sidesOfChange('changed')).toBe('both');
        expect(sidesOfChange('typeChanged')).toBe('both');
    });
});

describe('diffExportFileName', () => {
    it('names the file after both sides without their extensions', () => {
        expect(diffExportFileName(textDocument('a.json', 'b.json'), 'json')).toBe('a-vs-b.diff.json');
        expect(diffExportFileName(textDocument('report.final.txt', 'report.txt'), 'html')).toBe('report.final-vs-report.diff.html');
    });

    it('replaces characters a file name cannot hold, and spaces, with dashes', () => {
        expect(diffExportFileName(textDocument('Pasted text', 'my: "notes"?<1>|*'), 'json')).toBe('Pasted-text-vs-my-notes-1.diff.json');
    });

    it('keeps letters of any script', () => {
        expect(diffExportFileName(textDocument('σημειώσεις.md', 'notes.md'), 'html')).toBe('σημειώσεις-vs-notes.diff.html');
    });

    it('falls back to the side name for a name with nothing usable, and shortens long names', () => {
        const name = diffExportFileName(textDocument('???', `${'x'.repeat(200)}.txt`), 'json');

        expect(name.startsWith('original-vs-xxx')).toBe(true);
        expect(name.length).toBeLessThanOrEqual(8 + 4 + 60 + 10);
    });

    it('keeps a leading dot name readable', () => {
        expect(diffExportFileName(textDocument('.env', '.env.local'), 'json')).toBe('env-vs-env.diff.json');
    });
});

describe('serializeDiffDocument', () => {
    it('writes indented JSON with a final line break that parses back to the same document', () => {
        const document = textDocument('a.txt', 'b.txt');
        const json = serializeDiffDocument(document);

        expect(json.endsWith('}\n')).toBe(true);
        expect(json).toContain('\n  "format": "nib-studio-diff",');
        expect(JSON.parse(json)).toEqual(document);
    });
});
