import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, markChange, openHarnessWorkspaceAsync, tabElement, treeRow, type AppHarness } from '../testing/appHarness.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';
import { externalTabPath, type OpenFile } from './store.js';

const PICTURE = 'data:image/png;base64,AAAA';

vi.mock('../views/diagramImage.js', () => ({
    renderMermaidImageAsync: vi.fn(async () => ({ url: 'data:image/png;base64,AAAA', width: 40, height: 20 })),
}));

const PAGE_HTML = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><title>Shop</title><script>window.ran = true;</script></head>',
    '<body>',
    '<h1>Shop</h1>',
    '<ul><li>Pens</li><li>Ink</li></ul>',
    '<table><tr><th>Item</th><th>Qty</th></tr><tr><td>Pens</td><td>3</td></tr></table>',
    '<pre><code class="language-js">const total = 3;</code></pre>',
    '<p><a href="guide.md">Guide</a> <img src="images/logo.png" alt="Logo"></p>',
    '</body>',
    '</html>',
    '',
].join('\n');

const PAGE_MARKDOWN = [
    '# Shop',
    '',
    '- Pens',
    '- Ink',
    '',
    '| Item | Qty |',
    '| --- | --- |',
    '| Pens | 3 |',
    '',
    '```js',
    'const total = 3;',
    '```',
    '',
    '[Guide](guide.md) ![Logo](images/logo.png)',
    '',
].join('\n');

const NOTES_MD = '# Notes\n\n![Logo](images/logo.png)\n\n```mermaid\nflowchart LR\n    A --> B\n```\n';

let harness: AppHarness;

function createHarness(): AppHarness {
    return createAppHarness({
        'site/page.html': PAGE_HTML,
        'site/notes.md': NOTES_MD,
        'site/windows.md': '# Windows\r\n\r\nText\r\n',
        'site/data.json': '{"a":1}',
        'site/app.yaml': 'a: 1\n',
        'site/readme.txt': 'plain\n',
    });
}

function menuLabels(): string[] {
    return [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
        .map((item) => item.firstElementChild?.textContent ?? item.textContent ?? '');
}

function menuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('.context-menu[data-open="true"] .context-menu-item')]
        .find((candidate) => (candidate.firstElementChild?.textContent ?? candidate.textContent) === label);

    if (item == null) {
        throw new Error(`No menu item ${label}`);
    }

    return item;
}

function openTreeMenu(path: string): void {
    treeRow(path).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

function openTabMenu(path: string): void {
    tabElement(path)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

function openFile(path: string): OpenFile {
    const file = harness.state().openFiles.find((candidate) => candidate.path === path);

    if (file == null) {
        throw new Error(`${path} is not open`);
    }

    return file;
}

function toolbarActions(): string[] {
    return [...document.querySelectorAll<HTMLElement>('.editor-toolbar [data-action^="convert-"]')]
        .map((button) => `${button.dataset['action']}:${button.textContent}`);
}

const CONVERT_COMMANDS = ['Convert HTML to Markdown', 'Convert Markdown to HTML'];

beforeEach(async () => {
    localStorage.clear();
    setFilesSurfaceView('editor');
    harness = createHarness();
    await openHarnessWorkspaceAsync(harness);
    await harness.callAsync('expandFolder', 'site');
    await settleAsync();
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    // The context menu is made once per page, so it stays for the next test.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
});

describe('convert commands in the context menus', () => {
    it('offers Convert HTML to Markdown for an HTML file and Convert Markdown to HTML for a Markdown file, in the tree and on the tab', async () => {
        openTreeMenu('site/page.html');

        expect(menuLabels()).toContain('Convert HTML to Markdown');
        expect(menuLabels()).not.toContain('Convert Markdown to HTML');

        openTreeMenu('site/notes.md');

        expect(menuLabels()).toContain('Convert Markdown to HTML');
        expect(menuLabels()).not.toContain('Convert HTML to Markdown');

        await harness.callAsync('openFileAsync', 'site/page.html', { preview: false });
        openTabMenu('site/page.html');

        expect(menuLabels()).toContain('Convert HTML to Markdown');
        // Beside the other conversions, in the format and convert group.
        expect(menuLabels().indexOf('Convert HTML to Markdown')).toBeGreaterThan(menuLabels().indexOf('Copy content to clipboard'));
    });

    it('offers neither for other files, nor on the tab of a file from outside the workspace', async () => {
        for (const path of ['site/data.json', 'site/app.yaml', 'site/readme.txt']) {
            openTreeMenu(path);

            expect(menuLabels()).not.toEqual(expect.arrayContaining([CONVERT_COMMANDS[0]]));
            expect(menuLabels()).not.toEqual(expect.arrayContaining([CONVERT_COMMANDS[1]]));
        }

        const outside = externalTabPath(1, 'outside.md');
        const file: OpenFile = {
            path: outside,
            text: '# Outside\n',
            originalText: '# Outside\n',
            lineEnding: '\n',
            dirty: false,
            view: 'editor',
            file: null,
            preview: false,
            external: { handle: null },
        };
        harness.store.update({ openFiles: [file], activePath: outside, activeSurface: 'files' });
        await settleAsync();
        openTabMenu(outside);

        expect(menuLabels()).not.toContain('Convert Markdown to HTML');
        expect(toolbarActions()).toEqual([]);
    });

    it('converts an HTML file to Markdown in a tab of its own, which Save writes next to the page', async () => {
        openTreeMenu('site/page.html');
        menuItem('Convert HTML to Markdown').click();
        await settleAsync();

        expect(harness.state().activePath).toBe('site/page.html.converted.md');
        expect(openFile('site/page.html.converted.md').text).toBe(PAGE_MARKDOWN);
        expect(openFile('site/page.html.converted.md').dirty).toBe(true);
        expect(toastTexts()).toContain('Converted page.html to Markdown.');
        expect(document.querySelector('.cm-content')?.getAttribute('data-language')).toBe('markdown');
        expect(document.querySelector<HTMLButtonElement>('[data-action="save"]')?.textContent).toBe('Save');

        await harness.callAsync('saveAsync', 'site/page.html.converted.md');

        expect(textOf(harness.folder, 'site/page.html.converted.md')).toBe(PAGE_MARKDOWN);
        expect(openFile('site/page.html.converted.md').dirty).toBe(false);
        expect(textOf(harness.folder, 'site/page.html')).toBe(PAGE_HTML);
    });

    it('converts a Markdown file to an HTML page in a tab of its own, which Save writes next to the Markdown', async () => {
        openTreeMenu('site/notes.md');
        menuItem('Convert Markdown to HTML').click();
        await settleAsync();

        const html = openFile('site/notes.md.converted.html').text;

        expect(harness.state().activePath).toBe('site/notes.md.converted.html');
        expect(toastTexts()).toContain('Converted notes.md to HTML.');
        expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
        expect(html).toContain('<title>Notes</title>');
        expect(html).toContain('<img src="images/logo.png" alt="Logo">');
        expect(html).toContain(`<div class="md-mermaid" data-mermaid-source="flowchart LR\n    A --&gt; B"><img src="${PICTURE}" alt="Mermaid diagram" width="40" height="20"></div>`);
        expect(html).not.toContain('<script');
        expect(document.querySelector('.cm-content')?.getAttribute('data-language')).toBe('html');

        await harness.callAsync('saveAsync', 'site/notes.md.converted.html');

        expect(textOf(harness.folder, 'site/notes.md.converted.html')).toBe(html);
        expect(textOf(harness.folder, 'site/notes.md')).toBe(NOTES_MD);
    });

    it('converts the tab\'s text, unsaved edits included, and converting again replaces the converted tab\'s text', async () => {
        await harness.callAsync('openFileAsync', 'site/notes.md', { preview: false });
        markChange(harness, 'site/notes.md', '# Edited\n\nNot saved.\n');
        await settleAsync();
        openTabMenu('site/notes.md');
        menuItem('Convert Markdown to HTML').click();
        await settleAsync();

        expect(openFile('site/notes.md.converted.html').text).toContain('<h1 id="edited">Edited</h1>\n<p>Not saved.</p>');

        markChange(harness, 'site/notes.md', '# Again\n');
        await harness.callAsync('convertDocumentFileAsync', 'site/notes.md', 'html');
        await settleAsync();

        expect(harness.state().openFiles.filter((file) => file.path === 'site/notes.md.converted.html')).toHaveLength(1);
        expect(openFile('site/notes.md.converted.html').text).toContain('<h1 id="again">Again</h1>');
    });

    it('saves the converted page with the line ending of its source', async () => {
        await harness.callAsync('convertDocumentFileAsync', 'site/windows.md', 'html');
        await harness.callAsync('saveAsync', 'site/windows.md.converted.html');

        const saved = textOf(harness.folder, 'site/windows.md.converted.html');

        expect(saved).toContain('<h1 id="windows">Windows</h1>\r\n<p>Text</p>');
        expect(saved.replace(/\r\n/g, '')).not.toContain('\n');
    });
});

describe('convert buttons in the file toolbar', () => {
    it('shows Convert to Markdown on an HTML file and Convert to HTML on a Markdown file, in every view', async () => {
        for (const [path, expected] of [
            ['site/page.html', ['convert-to-markdown:Convert to Markdown']],
            ['site/notes.md', ['convert-to-html:Convert to HTML']],
        ] as const) {
            await harness.callAsync('openFileAsync', path, { preview: false });

            for (const view of ['editor', 'interactive', 'split', 'preview']) {
                document.querySelector<HTMLButtonElement>(`.editor-toolbar .view-tab[data-view="${view}"]`)!.click();
                await settleAsync();

                expect({ path, view, actions: toolbarActions() }).toEqual({ path, view, actions: expected });
            }
        }
    });

    it('hides both on other files', async () => {
        for (const path of ['site/data.json', 'site/app.yaml', 'site/readme.txt']) {
            await harness.callAsync('openFileAsync', path, { preview: false });

            expect(toolbarActions().filter((action) => /markdown|html/i.test(action))).toEqual([]);
        }
    });

    it('converts the editor\'s text, unsaved edits included, from the toolbar', async () => {
        await harness.callAsync('openFileAsync', 'site/page.html', { preview: false });
        markChange(harness, 'site/page.html', '<h2>Edited</h2><p>Not <b>saved</b>.</p>');
        await settleAsync();
        document.querySelector('.editor-toolbar .view-tab[data-view="preview"]')!.dispatchEvent(new MouseEvent('click'));
        await settleAsync();

        document.querySelector<HTMLButtonElement>('button[data-action="convert-to-markdown"]')!.click();
        await settleAsync();

        expect(harness.state().activePath).toBe('site/page.html.converted.md');
        expect(openFile('site/page.html.converted.md').text).toBe('## Edited\n\nNot **saved**.\n');
    });
});
