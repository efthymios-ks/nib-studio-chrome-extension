import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeDiffDocument } from '../../common/diff/diffDocument.js';
import { DEFAULT_TEXT_COMPARE_RULES } from '../../common/text/textCompareRules.js';
import { createDiffTab } from '../app/diffTabs.js';
import type { DiffKind, DiffSide, DiffTab } from '../app/store.js';
import { canExportDiffTab, diffDocumentForTabAsync, exportDiffTabAsync } from './diffExport.js';
import { currentTextDiffDocument } from './textDiffView.js';

vi.mock('./mermaidBridge.js', () => ({ renderMermaidSvgAsync: vi.fn(async () => '<svg></svg>') }));

function side(path: string, text: string): DiffSide {
    return { label: path, path, source: 'file', text };
}

function tabOf(kind: DiffKind, original: string | null, modified: string | null, extension: string = kind): DiffTab {
    return createDiffTab(
        original == null ? null : side(`docs/a.${extension}`, original),
        modified == null ? null : side(`docs/b.${extension}`, modified),
        kind,
    );
}

interface Download {
    readonly name: string;
    readonly blob: Blob;
}

describe('diff exports', () => {
    let downloads: Download[];

    beforeEach(() => {
        downloads = [];
        const blobs: Blob[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            blobs.push(blob as Blob);

            return `blob:download-${blobs.length}`;
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push({ name: this.download, blob: blobs[blobs.length - 1]! });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('can export once both sides are chosen', () => {
        expect(canExportDiffTab(tabOf('text', 'a', 'b'))).toBe(true);
        expect(canExportDiffTab(tabOf('text', 'a', null))).toBe(false);
        expect(canExportDiffTab(undefined)).toBe(false);
    });

    it.each([
        ['text', 'one\n', 'two\n', 'txt'],
        ['json', '{"a":1}', '{"a":2}', 'json'],
        ['xml', '<r a="1"/>', '<r a="2"/>', 'xml'],
        ['markdown', '# A\n\nOne.\n', '# A\n\nTwo.\n', 'md'],
        ['rows', 'id,v\n1,a\n', 'id,v\n1,b\n', 'csv'],
    ] as const)('builds the %s diff document of a tab from its own state', async (kind, original, modified, extension) => {
        const document = await diffDocumentForTabAsync(tabOf(kind, original, modified, extension));

        expect(document?.kind).toBe(kind);
        expect(document?.original).toEqual({ name: `a.${extension}`, source: 'file', path: `docs/a.${extension}` });
        expect(document?.summary.total).toBe(1);
    });

    it('has nothing to export while a side is missing or not valid for the kind', async () => {
        expect(await diffDocumentForTabAsync(tabOf('json', '{"a":1}', null))).toBeNull();
        expect(await diffDocumentForTabAsync(tabOf('json', '{"a":', '{}'))).toBeNull();
        expect(await exportDiffTabAsync(tabOf('xml', '<r>', '<r/>'), 'json')).toBeNull();
        expect(downloads).toEqual([]);
    });

    it('exports with the rules of the tab, reusing the document the diff shows', async () => {
        const tab = tabOf('text', 'Hello\n', 'hello\n', 'txt');
        tab.state.text.rules = { ...DEFAULT_TEXT_COMPARE_RULES, ignoreCase: true };
        const shown = currentTextDiffDocument({ original: tab.original, modified: tab.modified, state: tab.state.text });

        const document = await diffDocumentForTabAsync(tab);

        expect(document).toBe(shown);
        expect(document?.options).toMatchObject({ ignoreCase: true });
        expect(document?.changes).toEqual([]);
    });

    it('downloads the JSON as <original>-vs-<modified>.diff.json', async () => {
        const tab = tabOf('json', '{"a":1}', '{"a":2}');

        const name = await exportDiffTabAsync(tab, 'json');

        expect(name).toBe('a-vs-b.diff.json');
        expect(downloads.map((download) => download.name)).toEqual(['a-vs-b.diff.json']);
        expect(downloads[0]?.blob.type).toBe('application/json;charset=utf-8');
        const text = await downloads[0]!.blob.text();
        expect(text).toBe(serializeDiffDocument((await diffDocumentForTabAsync(tab))!));
        expect(JSON.parse(text)).toMatchObject({ format: 'nib-studio-diff', version: 1, kind: 'json', changes: [{ id: 'a', kind: 'changed' }] });
    });

    it('downloads the page as <original>-vs-<modified>.diff.html, for every kind', async () => {
        for (const [kind, extension, original, modified] of [
            ['text', 'txt', 'a\n', 'b\n'],
            ['rows', 'csv', 'id\n1\n', 'id\n2\n'],
            ['markdown', 'md', '# A\n', '# B\n'],
        ] as const) {
            expect(await exportDiffTabAsync(tabOf(kind, original, modified, extension), 'html')).toBe('a-vs-b.diff.html');
        }

        expect(downloads.map((download) => download.blob.type)).toEqual(['text/html;charset=utf-8', 'text/html;charset=utf-8', 'text/html;charset=utf-8']);
        expect(await downloads[0]!.blob.text()).toContain('<title>a.txt ↔ b.txt · Text diff</title>');
        expect(await downloads[2]!.blob.text()).toContain('<title>a.md ↔ b.md &mdash; diff</title>');
    });

    it('exports a Markdown diff\'s code blocks without the preview\'s Copy buttons', async () => {
        const original = '# A\n\n```js\nkept();\n```\n\n```js\nrun();\n```\n';
        const modified = '# A\n\n```js\nkept();\n```\n\n```js\nrunAgain();\n```\n';

        await exportDiffTabAsync(tabOf('markdown', original, modified, 'md'), 'html');
        const html = await downloads[0]!.blob.text();

        expect(html).toContain('<span class="md-l">kept();</span>');
        expect(html).toContain('runAgain();');
        expect(html).not.toMatch(/md-code-copy|md-code-wrap|data-code|Copy code/);
    });

    it('names the files after pasted sides too', async () => {
        const tab = createDiffTab({ label: 'Pasted text', source: 'paste', text: 'a', pastedAt: 1 }, { label: 'Clipboard', source: 'clipboard', text: 'b' }, 'text');

        expect(await exportDiffTabAsync(tab, 'json')).toBe('Pasted-text-vs-Clipboard.diff.json');
    });
});
