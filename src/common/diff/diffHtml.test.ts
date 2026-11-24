import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { parseXml } from '../paths/xmlParser.js';
import type { DiffDocument, DiffDocumentSide } from './diffDocument.js';
import { changeLabel, renderDiffDocumentHtmlAsync } from './diffHtml.js';
import { buildJsonDiffDocument, buildYamlDiffDocument } from './jsonDiffDocument.js';
import { buildRowsDiffDocument } from './rowDiffDocument.js';
import { buildTextDiffDocument } from './textDiffDocument.js';
import { buildXmlDiffDocument } from './xmlDiffDocument.js';

const ORIGINAL: DiffDocumentSide = { name: 'a.txt', source: 'file', path: 'notes/a.txt' };
const MODIFIED: DiffDocumentSide = { name: 'Clipboard', source: 'clipboard' };
const HOSTILE = '</script><img src=x onerror="alert(1)">\'&';

function textDocument(original = 'keep\nold one\nold two\nend\n', modified = 'keep\nnew one\nend\nextra\n'): DiffDocument {
    return buildTextDiffDocument({ original: ORIGINAL, modified: MODIFIED, originalText: original, modifiedText: modified });
}

function jsonDocument(left: unknown = { same: { x: 1 }, changed: { v: 1 }, gone: 1 }, right: unknown = { same: { x: 1 }, changed: { v: 2 }, added: 2 }): DiffDocument {
    return buildJsonDiffDocument({ original: { name: 'a.json', source: 'file' }, modified: { name: 'b.json', source: 'disk', path: 'b.json' }, left, right });
}

function yamlDocument(): DiffDocument {
    return buildYamlDiffDocument({
        original: { name: 'a.yaml', source: 'file' },
        modified: { name: 'b.yaml', source: 'file' },
        left: { server: { port: 80 }, tags: ['a'] },
        right: { server: { port: 8080 }, tags: ['a', 'b'] },
    });
}

function xmlDocument(): DiffDocument {
    const left = parseXml('<library name="Main"><book id="1"><title>One</title></book></library>');
    const right = parseXml('<library name="Main"><book id="1"><title>Uno</title></book><book id="2"/></library>');

    if (!left.ok || !right.ok) {
        throw new Error('Not valid XML.');
    }

    return buildXmlDiffDocument({ original: { name: 'a.xml', source: 'file' }, modified: { name: 'b.xml', source: 'file' }, left: left.root, right: right.root });
}

function rowsDocument(): DiffDocument {
    return buildRowsDiffDocument({
        original: { name: 'a.csv', source: 'file' },
        modified: { name: 'b.csv', source: 'file' },
        left: { columns: ['id', 'name', 'price'], rows: [['1', 'pen', '2'], ['2', 'ink', '3'], ['3', 'cap', '1']] },
        right: { columns: ['id', 'price', 'colour'], rows: [['2', '4', 'red'], ['1', '2', 'blue'], ['4', '9', 'green']] },
        keyColumns: ['id'],
    });
}

interface LoadedPage {
    readonly window: Window;
    readonly document: Document;
    readonly position: () => string;
    readonly press: (key: string) => void;
    readonly click: (selector: string) => void;
}

// Parses the page in a window of its own and runs its inline script there, as a browser opening the file would.
function loadPage(html: string): LoadedPage {
    const window = new Window({ url: 'file:///export/diff.html' });
    const document = new window.DOMParser().parseFromString(html, 'text/html') as unknown as Document;
    const script = document.querySelector('script')?.textContent ?? '';
    new Function('window', 'document', script)(window, document);

    return {
        window,
        document,
        position: () => document.querySelector('.nd-bar-position')?.textContent ?? '',
        press: (key) => {
            document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) as unknown as Event);
        },
        click: (selector) => {
            document.querySelector<HTMLElement>(selector)!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
        },
    };
}

describe('renderDiffDocumentHtmlAsync', () => {
    it('draws a text diff side by side, with the side headers, hatched placeholders and a hunk per change', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(textDocument()));
        const { document } = page;

        expect(document.title).toBe('a.txt ↔ Clipboard · Text diff');
        expect([...document.querySelectorAll('.nd-side-header')].map((header) => header.textContent)).toEqual([
            'Originala.txtnotes/a.txt',
            'ModifiedClipboardText read from the clipboard',
        ]);
        const rows = [...document.querySelectorAll<HTMLElement>('.nd-text-row')];
        expect(rows.map((row) => [...row.querySelectorAll<HTMLElement>('.nd-line')].map((line) => line.dataset['placeholder'] === 'true' ? '·' : `${line.dataset['marker'] ?? '='}:${line.textContent}`).join(' | '))).toEqual([
            '=:keep | =:keep',
            'del:old one | add:new one',
            'del:old two | ·',
            '=:end | =:end',
            '· | add:extra',
        ]);
        expect(rows.map((row) => row.dataset['only'] ?? '')).toEqual(['', '', 'original', '', 'modified']);
        expect([...document.querySelectorAll<HTMLElement>('.nd-hunk')].map((hunk) => `${hunk.dataset['change']}:${hunk.dataset['sides']}:${hunk.dataset['label']}`)).toEqual([
            '0:both:Original lines 2–3, modified line 2',
            '1:modified:Modified line 4',
        ]);
    });

    it('draws a JSON diff as an aligned tree, marking the rows of changes, with unchanged branches closed', async () => {
        const { document } = loadPage(await renderDiffDocumentHtmlAsync(jsonDocument()));
        const rows = [...document.querySelectorAll<HTMLElement>('.nd-tree-row')];
        const describeRow = (row: HTMLElement): string => [...row.querySelectorAll<HTMLElement>('.nd-cell')]
            .map((cell) => cell.dataset['placeholder'] === 'true' ? '·' : `${cell.querySelector('.nd-key')?.textContent ?? ''}${cell.querySelector('.nd-value')?.textContent}${cell.dataset['diff'] == null ? '' : `!${cell.dataset['diff']}`}`)
            .join(' | ');

        expect(rows.filter((row) => !row.hidden).map(describeRow)).toEqual([
            '{ | {',
            '· | added2!added',
            'changed{ | changed{',
            'v1!changed | v2!changed',
            '} | }',
            'gone1!removed | ·',
            'same{ | same{',
            '} | }',
        ]);
        expect(rows.filter((row) => row.hidden).map(describeRow)).toEqual(['x1 | x1', '} | }']);
        expect(document.querySelector('.nd-tree-row[data-collapsed="true"] .nd-twist')?.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector('style')?.textContent).toContain('.nd-cell[data-depth="2"]{padding-left:40px;}');
    });

    it('draws a YAML diff as the JSON tree, titled as a YAML compare', async () => {
        const html = await renderDiffDocumentHtmlAsync(yamlDocument());
        const { document } = loadPage(html);

        expect(document.querySelector('.nd-subtitle')?.textContent).toBe('YAML compare');
        expect(document.title).toBe('a.yaml ↔ b.yaml · YAML diff');
        expect(document.body.dataset['kind']).toBe('yaml');
        expect(document.querySelectorAll('[data-change]').length).toBeGreaterThan(0);
    });

    it('labels XML rows as XML', async () => {
        const { document } = loadPage(await renderDiffDocumentHtmlAsync(xmlDocument()));
        const keys = [...document.querySelectorAll('.nd-cell[data-side="original"] .nd-key')].map((key) => key.textContent);

        expect(keys.slice(0, 4)).toEqual(['<library>', '@name', '<book>', '[0]']);
        expect(document.querySelector('.nd-subtitle')?.textContent).toBe('XML compare');
    });

    it('draws a table diff with both headers, placeholders for missing columns and rows, and changed cells', async () => {
        const { document } = loadPage(await renderDiffDocumentHtmlAsync(rowsDocument()));
        const headers = [...document.querySelectorAll('thead tr:last-child th')].map((cell) => (cell.textContent === '' ? '·' : cell.textContent));

        expect(headers).toEqual(['#', 'id', 'name', 'price', '·', '#', 'id', '·', 'price', 'colour']);
        const changed = [...document.querySelectorAll<HTMLElement>('td[data-changed="true"]')];
        expect(changed.map((cell) => `${cell.dataset['side']}:${cell.textContent}:${cell.dataset['change']}`)).toEqual([
            'original:3:row id=2 · price',
            'modified:4:row id=2 · price',
        ]);
        expect(changed[0]?.getAttribute('title')).toBe('Original: 3\nModified: 4');
        expect([...document.querySelectorAll<HTMLElement>('tbody tr')].map((row) => `${row.dataset['key']}:${row.dataset['marker'] ?? ''}:${row.dataset['change'] ?? ''}`)).toEqual([
            '1::',
            '2:changed:',
            '3:removed:row id=3',
            '4:added:row id=4',
        ]);
        expect(document.querySelectorAll('tbody tr:last-child td[data-side="original"][data-placeholder="true"]')).toHaveLength(5);
    });

    it('escapes everything the document holds, so values never become markup', async () => {
        const html = await renderDiffDocumentHtmlAsync(buildJsonDiffDocument({
            original: { name: HOSTILE, source: 'file', path: HOSTILE },
            modified: { name: 'b.json', source: 'file' },
            left: { [HOSTILE]: HOSTILE },
            right: { [HOSTILE]: `${HOSTILE}!` },
        }));
        const { document } = loadPage(html);

        expect(html.match(/<script>/g)).toHaveLength(1);
        expect(html.match(/<\/script>/g)).toHaveLength(1);
        expect(html).not.toContain('<img');
        expect(document.querySelectorAll('img')).toHaveLength(0);
        expect(document.querySelector('.nd-title')?.textContent).toBe(`${HOSTILE} ↔ b.json`);
        expect(document.querySelector('.nd-cell[data-side="original"][data-diff] .nd-key')?.textContent).toBe(HOSTILE);
        expect(document.querySelector('.nd-tree-row[data-change]')?.getAttribute('data-change')).toBe(`[${JSON.stringify(HOSTILE)}]`);
    });

    it('escapes text lines and table cells too', async () => {
        const text = await renderDiffDocumentHtmlAsync(textDocument(`${HOSTILE}\n`, 'safe\n'));
        const rows = await renderDiffDocumentHtmlAsync(buildRowsDiffDocument({
            original: { name: 'a.csv', source: 'file' },
            modified: { name: 'b.csv', source: 'file' },
            left: { columns: ['id', HOSTILE], rows: [['1', HOSTILE]] },
            right: { columns: ['id', HOSTILE], rows: [['1', 'x']] },
            keyColumns: ['id'],
        }));

        for (const html of [text, rows]) {
            expect(html.match(/<\/script>/g)).toHaveLength(1);
            expect(html).not.toContain('<img');
        }

        expect(loadPage(rows).document.querySelector('td[data-changed="true"]')?.textContent).toBe(HOSTILE);
    });

    it('fetches nothing: no external URL, and a content policy that allows no loading', async () => {
        for (const document of [textDocument(), jsonDocument(), yamlDocument(), xmlDocument(), rowsDocument()]) {
            const html = await renderDiffDocumentHtmlAsync(document);

            expect(html).not.toMatch(/https?:|\bsrc=|\bhref=|url\(|@import|<link|<iframe/i);
            expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">');
        }
    });

    it('styles light and dark as the system prefers, and hatches placeholders', async () => {
        const html = await renderDiffDocumentHtmlAsync(textDocument());

        expect(html).toContain('color-scheme: light dark;');
        expect(html).toMatch(/@media \(prefers-color-scheme: dark\) \{\s+:root \{\s+--bg: #181818;/);
        expect(html).toContain('repeating-linear-gradient(135deg');
        expect(html).toContain('@media print');
    });

    it('carries the bar, Diff, Before, After, Previous and Next, and an ES5 script that drives it', async () => {
        const html = await renderDiffDocumentHtmlAsync(textDocument());
        const { document } = loadPage(html);
        const script = document.querySelector('script')?.textContent ?? '';

        expect([...document.querySelectorAll('.nd-bar button')].map((button) => `${button.textContent} ${button.getAttribute('title')}`)).toEqual([
            'Diff Insertions and deletions',
            'Before Read the original',
            'After Read the revision',
            '↑ Previous change (p)',
            '↓ Next change (n)',
        ]);
        expect(script).not.toMatch(/=>|\blet\b|\bconst\b|`|\bclass\b/);
    });

    it('says there are no changes for equal sides, and hides the steps', async () => {
        const { document, position } = loadPage(await renderDiffDocumentHtmlAsync(textDocument('a\n', 'a\n')));

        expect(position()).toBe('No changes');
        expect(document.querySelector('.nd-bar')?.getAttribute('data-empty')).toBe('true');
    });

    it('draws the same page from a document read back from JSON', async () => {
        for (const document of [textDocument(), jsonDocument(), xmlDocument(), rowsDocument()]) {
            const html = await renderDiffDocumentHtmlAsync(document);

            expect(await renderDiffDocumentHtmlAsync(JSON.parse(JSON.stringify(document)))).toBe(html);
            expect(await renderDiffDocumentHtmlAsync(document)).toBe(html);
        }
    });
});

describe('the page script', () => {
    it('steps through the changes with n, p and the arrows, flashing each and naming it in the position', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(rowsDocument()));

        expect(page.position()).toBe('– / 3');
        page.press('n');
        expect(page.position()).toBe('1 / 3');
        expect(page.document.querySelector('.nd-bar-position')?.getAttribute('title')).toBe('row id=2 · price');
        expect(page.document.querySelectorAll('td[data-flash="true"]')).toHaveLength(2);
        page.press('ArrowDown');
        expect(page.position()).toBe('2 / 3');
        expect(page.document.querySelector('tr[data-key="3"]')?.getAttribute('data-flash')).toBe('true');
        page.press('n');
        page.press('n');
        expect(page.position()).toBe('3 / 3');
        page.press('p');
        page.press('ArrowUp');
        expect(page.position()).toBe('1 / 3');
    });

    it('steps from the bar buttons and ignores keys typed with a modifier', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(textDocument()));

        page.click('.nd-bar [data-step="1"]');
        expect(page.position()).toBe('1 / 2');
        page.document.body.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }) as unknown as Event);
        expect(page.position()).toBe('1 / 2');
        page.click('.nd-bar [data-step="1"]');
        expect(page.position()).toBe('2 / 2');
    });

    it('reads one side with Before and After, stepping only through what that side has', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(rowsDocument()));

        page.click('.nd-bar [data-view="before"]');
        expect(page.document.body.dataset['view']).toBe('before');
        expect(page.document.querySelector('.nd-bar [data-view="before"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(page.position()).toBe('– / 2');
        page.click('.nd-bar [data-view="after"]');
        expect(page.position()).toBe('– / 2');
        page.click('.nd-bar [data-view="diff"]');
        expect(page.position()).toBe('– / 3');
    });

    it('makes a change clicked in the diff the current one', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(textDocument()));

        page.click('.nd-hunk[data-change="1"] .nd-line[data-side="modified"]');

        expect(page.position()).toBe('2 / 2');
    });

    it('opens and closes objects and arrays, keeping closed ones inside closed', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(jsonDocument({ o: { inner: { x: 1 }, y: 1 }, z: 1 }, { o: { inner: { x: 1 }, y: 1 }, z: 2 })));
        const visible = (): string[] => [...page.document.querySelectorAll<HTMLElement>('.nd-tree-row')]
            .filter((row) => !row.hidden)
            .map((row) => row.querySelector('.nd-key')?.textContent ?? row.querySelector('.nd-value')?.textContent ?? '');

        expect(visible()).toEqual(['{', 'o', 'z', '}']);
        page.click('.nd-tree-row[data-depth="1"][data-node="open"] .nd-twist');
        expect(visible()).toEqual(['{', 'o', 'inner', 'y', '}', 'z', '}']);
        page.click('.nd-tree-row[data-depth="2"][data-node="open"] .nd-twist');
        expect(visible()).toEqual(['{', 'o', 'inner', 'x', '}', 'y', '}', 'z', '}']);
        page.click('.nd-tree-row[data-depth="1"][data-node="open"] .nd-twist');
        expect(visible()).toEqual(['{', 'o', 'z', '}']);
    });

    it('opens the closed parents of a change it steps to', async () => {
        const page = loadPage(await renderDiffDocumentHtmlAsync(jsonDocument({ o: { deep: { x: 1 } } }, { o: { deep: { x: 2 } } })));
        page.click('.nd-tree-row[data-depth="1"][data-node="open"] .nd-twist');
        expect(page.document.querySelector<HTMLElement>('.nd-tree-row[data-change]')?.hidden).toBe(true);

        page.press('n');

        expect(page.document.querySelector<HTMLElement>('.nd-tree-row[data-change]')?.hidden).toBe(false);
        expect(page.document.querySelectorAll('.nd-tree-row[data-collapsed="true"]')).toHaveLength(0);
        expect(page.position()).toBe('1 / 1');
    });
});

describe('changeLabel', () => {
    it('names text changes by their lines and other changes by their id', () => {
        expect(changeLabel({ id: '0', kind: 'removed', location: { lines: { original: { from: 4, to: 4 }, modified: null } } })).toBe('Original line 4');
        expect(changeLabel({ id: 'items[2].price', kind: 'changed', location: { path: 'items[2].price' } })).toBe('items[2].price');
    });
});
