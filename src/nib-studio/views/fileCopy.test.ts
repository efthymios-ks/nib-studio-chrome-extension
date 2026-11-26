import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RICH_TABLE_ROW_LIMIT } from '../../common/clipboard/tableClipboard.js';
import { SALES_SHEETS, buildSheetsWorkbook } from '../../common/office/testing/workbookFixtures.js';
import type { OpenFile } from '../app/store.js';
import { stubClipboard, type FakeClipboard } from '../testing/fakeClipboard.js';
import { blurEditor, buttonByText, openFileFixture, settleAsync, toastTexts } from '../testing/testHelpers.js';
import { buildFileCopyButtons, copyActionsFor, DISK_COPY_LIMIT_BYTES, type FileCopyInput } from './fileCopy.js';
import { registerShownTable } from './shownTable.js';
import { pruneTableMemories, renderTableViewerAsync, tableMemoryFor } from './tableViewer.js';

vi.mock('./mermaidBridge.js', () => ({
    renderMermaidSvgAsync: vi.fn(async () => '<svg viewBox="0 0 100 40"><text>A</text></svg>'),
}));

const LABELS = Object.freeze({ raw: 'Copy raw', formatted: 'Copy formatted', content: 'Copy content' });

const PEOPLE_CSV = 'name,age,city\nAda,36,Athens\nAlan,41,Patras\nGrace,29,Volos\nLinus,52,Larissa\n';

function labelsFor(fileName: string, isBinary = false): string[] {
    return copyActionsFor(fileName, isBinary).map((action) => LABELS[action]);
}

describe('copyActionsFor', () => {
    it.each([
        ['README.md'],
        ['page.html'],
        ['users.csv'],
        ['products.tsv'],
        ['sample.json'],
        ['app.yaml'],
        ['feed.xml'],
    ])('gives %s Copy raw and Copy formatted', (fileName) => {
        expect(labelsFor(fileName)).toEqual(['Copy raw', 'Copy formatted']);
    });

    it.each([['sales.xlsx'], ['inventory.ods'], ['old.xls'], ['report.docx'], ['letter.doc']])(
        'gives %s, which has no text of its own, Copy formatted only',
        (fileName) => {
            expect(labelsFor(fileName)).toEqual(['Copy formatted']);
        },
    );

    it.each([['main.ts'], ['app.js'], ['site.css'], ['notes.txt'], ['app.log'], ['capture.har']])(
        'gives %s, which opens only in the Editor, Copy content',
        (fileName) => {
            expect(labelsFor(fileName)).toEqual(['Copy content']);
        },
    );

    it.each([['paper.pdf'], ['photo.png'], ['logo.svg'], ['song.mp3'], ['clip.mp4'], ['font.woff2'], ['bundle.zip'], ['deck.pptx']])(
        'gives %s none',
        (fileName) => {
            expect(labelsFor(fileName)).toEqual([]);
        },
    );

    it('gives a file whose bytes are not text none', () => {
        expect(labelsFor('blob.dat', true)).toEqual([]);
    });
});

describe('buildFileCopyButtons', () => {
    let clipboard: FakeClipboard;
    let view: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        pruneTableMemories([]);
        clipboard = stubClipboard();
        view = document.createElement('div');
        document.body.append(view);
    });

    afterEach(() => {
        clipboard.restore();
    });

    function inputFor(file: OpenFile, overrides: Partial<FileCopyInput> = {}): FileCopyInput {
        return { currentFile: () => file, root: null, view: () => view, ...overrides };
    }

    function mount(input: FileCopyInput): HTMLElement {
        const buttons = buildFileCopyButtons(input);

        if (buttons == null) {
            throw new Error('No copy buttons.');
        }

        document.body.append(buttons);

        return buttons;
    }

    async function clickAsync(container: ParentNode, label: string): Promise<void> {
        const button = buttonByText(container, label);

        if (button == null) {
            throw new Error(`No button ${label}.`);
        }

        button.click();
        await settleAsync();
    }

    it('groups Copy raw and Copy formatted, with a Copy menu button for narrow windows', () => {
        const group = mount(inputFor(openFileFixture('docs/a.md', '# A')));

        expect(group.classList.contains('copy-actions')).toBe(true);
        expect(group.getAttribute('role')).toBe('group');
        expect([...group.querySelectorAll('.copy-buttons > button')].map((button) => button.textContent)).toEqual(['Copy raw', 'Copy formatted']);
        expect(group.querySelector('.copy-menu-button')?.getAttribute('aria-haspopup')).toBe('menu');
    });

    it('shows a lone Copy content button for a file with no rendered view, and nothing for a PDF', () => {
        const button = mount(inputFor(openFileFixture('src/main.ts', 'run();')));

        expect(button.localName).toBe('button');
        expect(button.textContent).toBe('Copy content');
        expect(buildFileCopyButtons(inputFor(openFileFixture('docs/paper.pdf')))).toBeNull();
        expect(buildFileCopyButtons(inputFor(openFileFixture('media/photo.png')))).toBeNull();
    });

    it('copies the text as the tab holds it, unsaved edits included', async () => {
        const file = openFileFixture('src/main.ts', 'edited();', { originalText: 'saved();', dirty: true });
        mount(inputFor(file));

        await clickAsync(document.body, 'Copy content');

        expect(clipboard.writeText).toHaveBeenCalledWith('edited();');
        expect(toastTexts()).toEqual(['Content copied.']);
    });

    it('copies raw Markdown from the tab\'s current text', async () => {
        let file = openFileFixture('docs/a.md', '# Saved');
        mount(inputFor(openFileFixture('docs/a.md'), { currentFile: () => file }));
        file = { ...file, text: '# Typed since', dirty: true };

        await clickAsync(document.body, 'Copy raw');

        expect(clipboard.last().get('text/plain')).toBe('# Typed since');
        expect(toastTexts()).toEqual(['Raw text copied.']);
    });

    it('copies formatted Markdown as rich HTML with its text, never with a script', async () => {
        const text = '# Plan\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n```mermaid\ngraph TD; A-->B\n```\n';
        mount(inputFor(openFileFixture('docs/plan.md', text)));

        await clickAsync(document.body, 'Copy formatted');

        const written = clipboard.last();
        expect([...written.keys()]).toEqual(['text/html', 'text/plain']);
        expect(written.get('text/html')).toContain('<h1 id="plan">Plan</h1>');
        expect(written.get('text/html')).toMatch(/<table border="1"/);
        expect(written.get('text/html')).toContain('alt="Mermaid diagram"');
        expect(written.get('text/html')).not.toMatch(/<script|alert/);
        expect(written.get('text/plain')).toBe('Plan\n\nA\tB\n1\t2');
        expect(toastTexts()).toEqual(['Formatted document copied.']);
    });

    it('copies a formatted HTML page as rich HTML without its scripts', async () => {
        const page = '<html><body><h2>Hi</h2><ol><li>One</li></ol><script>alert(1)</script><a href="javascript:x()">J</a></body></html>';
        mount(inputFor(openFileFixture('docs/page.html', page)));

        await clickAsync(document.body, 'Copy formatted');

        expect(clipboard.last().get('text/html')).toBe('<h2>Hi</h2><ol><li>One</li></ol><a>J</a>');
        expect(clipboard.last().get('text/plain')).toBe('Hi\n\n1. One\n\nJ');
    });

    it.each([
        ['data/a.json', '{"b":[1,2]}', '{\n  "b": [\n    1,\n    2\n  ]\n}', 'Formatted JSON copied.'],
        ['config/a.yaml', 'a:    1\nb:   [x, y]\n', 'a: 1\nb: [ x, y ]\n', 'Formatted YAML copied.'],
        ['xml/a.xml', '<a><b>1</b></a>', '<a>\n  <b>1</b>\n</a>', 'Formatted XML copied.'],
    ])('copies %s pretty-printed', async (path, text, formatted, message) => {
        mount(inputFor(openFileFixture(path, text)));

        await clickAsync(document.body, 'Copy formatted');

        expect(clipboard.writeText).toHaveBeenCalledWith(formatted);
        expect(toastTexts()).toEqual([message]);
    });

    it('copies nothing from JSON that does not parse, and says why', async () => {
        mount(inputFor(openFileFixture('data/a.json', '{"b": }')));

        await clickAsync(document.body, 'Copy formatted');

        expect(clipboard.writeText).not.toHaveBeenCalled();
        expect(toastTexts()[0]).toMatch(/^Not valid JSON: .+ \(line 1, column \d+\)\. Nothing was copied\.$/);
        expect(document.querySelector('.toast')?.getAttribute('data-tone')).toBe('fail');
    });

    it('says so in a toast when the clipboard refuses the copy', async () => {
        clipboard.restore();
        clipboard = stubClipboard({ failWith: new Error('Document is not focused.') });
        mount(inputFor(openFileFixture('notes.txt', 'x')));

        await clickAsync(document.body, 'Copy content');

        expect(toastTexts()).toEqual(['Could not copy: Document is not focused.']);
        expect(document.querySelector('.toast')?.getAttribute('data-tone')).toBe('fail');
    });

    it('reads Copy raw of a CSV too large to load from disk, and refuses one past the limit', async () => {
        const file = new File(['a,b\n1,2\n'], 'big.csv');
        mount(inputFor(openFileFixture('data/big.csv', '', { large: true, file })));

        await clickAsync(document.body, 'Copy raw');

        expect(clipboard.last().get('text/plain')).toBe('a,b\n1,2\n');

        document.body.innerHTML = '';
        const huge = new File(['x'], 'huge.csv');
        Object.defineProperty(huge, 'size', { value: DISK_COPY_LIMIT_BYTES + 1 });
        mount(inputFor(openFileFixture('data/huge.csv', '', { large: true, file: huge })));

        await clickAsync(document.body, 'Copy raw');

        expect(clipboard.writes).toHaveLength(1);
        expect(toastTexts()).toEqual(['This file is too large to copy as text: it is 64.0 MB, and a copy takes up to 64.0 MB.']);
    });

    it('copies a CSV table as shown: sorted, filtered, searched and without its hidden columns', async () => {
        const path = 'data/people.csv';
        const memory = tableMemoryFor(path);
        memory.sorts = [{ columnId: 'col-1', direction: 'desc' }];
        memory.filters = [{ columnId: 'col-2', operator: 'contains', value: 'a' }];
        memory.hiddenColumns = ['col-2'];
        memory.search = 'l';
        await renderTableViewerAsync(view, { fileName: 'people.csv', path, text: PEOPLE_CSV });
        await settleAsync();
        mount(inputFor(openFileFixture(path, PEOPLE_CSV)));

        await clickAsync(document.body, 'Copy formatted');

        const written = clipboard.last();
        expect(written.get('text/plain')).toBe('name\tage\nLinus\t52\nAlan\t41');
        expect(written.get('text/html')).toContain('<thead><tr><th>name</th><th>age</th></tr></thead>');
        expect(written.get('text/html')).toContain('<tbody><tr><td>Linus</td><td>52</td></tr><tr><td>Alan</td><td>41</td></tr></tbody>');
        expect(toastTexts()).toEqual(['2 rows copied.']);
    });

    it('copies the sheet of a workbook on screen', async () => {
        const path = 'data/sales.xlsx';
        const file = new File([buildSheetsWorkbook(SALES_SHEETS).slice()], 'sales.xlsx');
        await renderTableViewerAsync(view, { fileName: 'sales.xlsx', path, file });
        await settleAsync();
        ([...view.querySelectorAll<HTMLElement>('.sheet-tab')].find((tab) => tab.textContent === 'Q2') as HTMLElement).click();
        mount(inputFor(openFileFixture(path, '', { file })));

        await clickAsync(document.body, 'Copy formatted');

        expect(clipboard.last().get('text/plain')).toBe('order_id\tcity\ttotal\nQ2-1\tLarissa\t300\nQ2-2\tPatras\t15');
        expect(toastTexts()).toEqual(['2 rows copied.']);
    });

    it('copies a query result shown in place of the rows', async () => {
        const path = 'data/people.csv';
        await renderTableViewerAsync(view, { fileName: 'people.csv', path, text: PEOPLE_CSV });
        await settleAsync();
        view.querySelector<HTMLButtonElement>('[data-query-toggle]')?.click();
        const editor = EditorView.findFromDOM(view.querySelector('.query-editor .cm-editor') as HTMLElement) as EditorView;
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'from * where age > 40 orderby age select name, age' } });
        blurEditor();
        buttonByText(view, 'Run')?.click();
        await settleAsync();
        mount(inputFor(openFileFixture(path, PEOPLE_CSV)));

        await clickAsync(document.body, 'Copy formatted');

        expect(clipboard.last().get('text/plain')).toBe('name\tage\nAlan\t41\nLinus\t52');
    });

    it('copies a large table as text only past the rich limit, and only its first rows past the copy limit', async () => {
        const host = document.createElement('div');
        view.append(host);
        let shown = RICH_TABLE_ROW_LIMIT + 1;
        const readRowsAsync = vi.fn(async (limit: number) => ({
            columns: ['n'],
            rows: Array.from({ length: Math.min(limit, shown) }, (_, index) => [index + 1]),
        }));
        registerShownTable(host, { rowCount: () => shown, busyReason: () => null, readRowsAsync });
        mount(inputFor(openFileFixture('data/orders-large.csv', '', { large: true, file: new File([''], 'orders-large.csv') })));

        await clickAsync(document.body, 'Copy formatted');

        expect([...clipboard.last().keys()]).toEqual(['text/plain']);
        expect(toastTexts()).toEqual(['10,001 rows copied, as plain text.']);

        shown = 250_000;
        await clickAsync(document.body, 'Copy formatted');

        expect(readRowsAsync).toHaveBeenLastCalledWith(100_000);
        expect(clipboard.last().get('text/plain')?.split('\n')).toHaveLength(100_001);
        expect(toastTexts()[1]).toBe('First 100,000 of 250,000 rows copied, as plain text.');
        expect(document.querySelectorAll('.toast')[1]?.getAttribute('data-tone')).toBe('warn');
    });

    it('waits for a large table still being read before copying it', async () => {
        const host = document.createElement('div');
        view.append(host);
        const readRowsAsync = vi.fn(async () => ({ columns: [], rows: [] }));
        registerShownTable(host, {
            rowCount: () => 10,
            busyReason: () => 'The file is still being read; copy again once it has finished.',
            readRowsAsync,
        });
        mount(inputFor(openFileFixture('data/orders-large.csv', '', { large: true })));

        await clickAsync(document.body, 'Copy formatted');

        expect(readRowsAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toEqual(['The file is still being read; copy again once it has finished.']);
    });

    it('offers both copies in the narrow window\'s Copy menu', async () => {
        mount(inputFor(openFileFixture('data/a.json', '{"a":1}')));

        document.querySelector<HTMLButtonElement>('.copy-menu-button')?.click();
        const items = [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')];
        expect(items.map((item) => item.textContent)).toEqual(['Copy raw', 'Copy formatted']);

        items[1]?.click();
        await settleAsync();

        expect(clipboard.writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
    });
});
