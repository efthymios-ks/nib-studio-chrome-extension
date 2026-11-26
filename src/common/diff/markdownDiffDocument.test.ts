import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareMarkdown } from '../markdown/diff/comparer.js';
import { renderDiffHtmlAsync } from '../markdown/diff/htmlRenderer.js';
import type { MermaidRenderer } from '../markdown/diff/types.js';
import type { DiffDocumentSide } from './diffDocument.js';
import { renderDiffDocumentHtmlAsync } from './diffHtml.js';
import { buildMarkdownDiffDocument, markdownDiffTitle } from './markdownDiffDocument.js';

const ORIGINAL_SIDE: DiffDocumentSide = { name: 'a.md', source: 'file', path: 'docs/a.md' };
const MODIFIED_SIDE: DiffDocumentSide = { name: 'b.md', source: 'file', path: 'docs/b.md' };

// Front matter, prose, lists, a table, code, a diagram, a quote and whole sections, so every block renderer runs.
const ORIGINAL = [
    '---',
    'title: Guide',
    '---',
    '# Guide',
    '',
    'Intro paragraph that stays the same.',
    '',
    '## Setup',
    '',
    'Install the tool with the default options.',
    '',
    '- first step',
    '- second step',
    '  - nested detail',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| alpha | 1 |',
    '| beta | 2 |',
    '',
    '```js',
    'const answer = 41;',
    'console.log(answer);',
    '```',
    '',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
    '',
    '> A quote that will go.',
    '',
    '## Removed section',
    '',
    'This whole section goes away.',
    '',
].join('\n');

const MODIFIED = [
    '---',
    'title: Guide v2',
    '---',
    '# Guide',
    '',
    'Intro paragraph that stays the same.',
    '',
    '## Setup',
    '',
    'Install the tool with the recommended options & <script>alert(1)</script>.',
    '',
    '- first step',
    '- a new second step',
    '  - nested detail',
    '- third step',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| alpha | 1 |',
    '| beta | 3 |',
    '| gamma | 4 |',
    '',
    '```js',
    'const answer = 42;',
    'console.log(answer);',
    '```',
    '',
    '```mermaid',
    'graph TD',
    '  A --> C',
    '```',
    '',
    '## Added section',
    '',
    'A brand new closing section.',
    '',
].join('\n');

// The Markdown diff page for ORIGINAL and MODIFIED, pinned byte for byte so any change to it is a deliberate one.
const GOLDEN_PAGE = Object.freeze({
    length: 27552,
    sha256: 'b6d38b7eafa9236b3a44ceb9db7acdf24e9c9dbdd57b7232be37bd5be61cc568',
});

// The page the Markdown renderer draws straight from both texts, with no diff document between them.
async function renderDirectAsync(renderMermaid?: MermaidRenderer): Promise<string> {
    const markdown = compareMarkdown(ORIGINAL, MODIFIED, { includeUnchanged: true, originalName: 'a.md', modifiedName: 'b.md' });
    const result = await renderDiffHtmlAsync(markdown, { title: 'a.md ↔ b.md', renderMermaid });

    return result.html;
}

function build(changesOnly?: boolean): ReturnType<typeof buildMarkdownDiffDocument> {
    return buildMarkdownDiffDocument({
        original: ORIGINAL_SIDE,
        modified: MODIFIED_SIDE,
        originalText: ORIGINAL,
        modifiedText: MODIFIED,
        changesOnly,
    });
}

function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('buildMarkdownDiffDocument', () => {
    it('wraps the Markdown compare as it is, named after both sides', () => {
        const document = build();

        expect(document.markdown).toEqual(compareMarkdown(ORIGINAL, MODIFIED, { includeUnchanged: true, originalName: 'a.md', modifiedName: 'b.md' }));
        expect(document).toMatchObject({ format: 'nib-studio-diff', version: 1, kind: 'markdown', options: { changesOnly: false } });
        expect(markdownDiffTitle(document)).toBe('a.md ↔ b.md');
    });

    it('lists each changed block as a change numbered as the page numbers it, with its heading path and source', () => {
        const document = build();
        const records = document.markdown.changes.filter((record) => record.status !== 'Unchanged');

        expect(document.changes.map((change) => change.id)).toEqual(records.map((_, index) => `chg${index + 1}`));
        expect(document.changes.map((change) => change.kind)).toEqual(records.map((record) => ({ Added: 'added', Removed: 'removed', Modified: 'changed' })[record.status as 'Added']));
        const setup = document.changes.find((change) => change.after?.toString().includes('recommended options'));
        expect(setup?.location.path).toContain('Setup');
        expect(setup?.before).toBe('Install the tool with the default options.');
    });

    it('gives every block one row, with placeholders for blocks one side lacks, and sums the changes up', () => {
        const document = build();

        expect(document.rows).toHaveLength(document.markdown.changes.length);
        const removed = document.rows.find((row) => row.left?.tokens[0]?.text === '> A quote that will go.');
        expect(removed?.right).toBeNull();
        expect(removed?.left).toMatchObject({ status: 'removed', label: 'BlockQuote', line: 31 });
        expect(document.summary.total).toBe(document.changes.length);
        expect(document.summary.unchanged).toBe(document.markdown.summary.unchanged);
        expect(document.changes.every((change) => document.rows[change.row ?? -1]?.change === change.id)).toBe(true);
    });

    it('leaves unchanged blocks out when asked for changes only', () => {
        const document = build(true);

        expect(document.markdown.changes.every((record) => record.status !== 'Unchanged')).toBe(true);
        expect(document.options.changesOnly).toBe(true);
    });

    it('builds the same JSON for the same inputs, and survives a JSON round trip', () => {
        const document = build();

        expect(JSON.stringify(build())).toBe(JSON.stringify(document));
        expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    });
});

describe('Markdown diff page', () => {
    it('draws the pinned Markdown diff page byte for byte', async () => {
        const html = await renderDiffDocumentHtmlAsync(build());

        expect(html.length).toBe(GOLDEN_PAGE.length);
        expect(sha256(html)).toBe(GOLDEN_PAGE.sha256);
    });

    it('draws the same bytes as the Markdown renderer given both texts, and the same again from a document read back from JSON', async () => {
        const directPage = await renderDirectAsync();
        const document = build();

        expect(await renderDiffDocumentHtmlAsync(document)).toBe(directPage);
        expect(await renderDiffDocumentHtmlAsync(JSON.parse(JSON.stringify(document)))).toBe(directPage);
    });

    it('draws Mermaid diagrams with the renderer it is given, as the Markdown renderer does', async () => {
        const renderMermaid = async (source: string): Promise<string> => `<svg data-source="${source.length}"></svg>`;
        const directPage = await renderDirectAsync(renderMermaid);

        expect(await renderDiffDocumentHtmlAsync(build(), { renderMermaid })).toBe(directPage);
    });
});
