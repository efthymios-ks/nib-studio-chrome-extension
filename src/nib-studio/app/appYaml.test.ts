import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textOf } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, markChange, openHarnessWorkspaceAsync, tabElement, treeRow, type AppHarness } from '../testing/appHarness.js';
import { flushAsync, settleAsync, toastTexts } from '../testing/testHelpers.js';
import { setFilesSurfaceView } from '../views/filesSurface.js';
import type { DiffTab, OpenFile } from './store.js';

const APP_YAML = '# Settings\nname: demo\nserver:\n    host: localhost\n    port: 80\n';
const APP_V2_YAML = '# Settings\nname: demo\nserver:\n    host: localhost\n    port: 8080\n    tls: true\n';

let harness: AppHarness;

function createHarness(): AppHarness {
    return createAppHarness({
        'app.yaml': APP_YAML,
        'app-v2.yaml': APP_V2_YAML,
        'windows.yml': 'name: demo\r\nlist:\r\n  - 1\r\n',
        'broken.yaml': 'a: 1\nb: [1, 2\nc: 3\n',
        'data.json': '{"name":"nib","tags":["a","yes"]}',
        'feed.xml': '<feed><item>1</item></feed>',
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

const YAML_COMMANDS = ['Format YAML', 'Convert YAML to JSON'];

const JSON_COMMANDS = ['Format JSON', 'Convert JSON to YAML'];

beforeEach(async () => {
    localStorage.clear();
    setFilesSurfaceView('editor');
    harness = createHarness();
    await openHarnessWorkspaceAsync(harness);
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    // The context menu is made once per page, so it stays for the next test.
    document.body.replaceChildren(...document.querySelectorAll('.context-menu'));
});

describe('YAML commands in the context menus', () => {
    it('offers Format YAML and Convert YAML to JSON for a YAML file in the tree and on its tab, and nothing of JSON', async () => {
        openTreeMenu('app.yaml');

        expect(menuLabels()).toEqual(expect.arrayContaining(YAML_COMMANDS));
        expect(menuLabels()).not.toEqual(expect.arrayContaining(['Format JSON']));
        expect(menuLabels()).not.toContain('Convert JSON to YAML');
        expect(menuLabels()).not.toContain('Convert XML to JSON');

        await harness.callAsync('openFileAsync', 'app.yaml', { preview: false });
        openTabMenu('app.yaml');

        expect(menuLabels()).toEqual(expect.arrayContaining(YAML_COMMANDS));
    });

    it('offers Format JSON and Convert JSON to YAML for a JSON file, and nothing of YAML', () => {
        openTreeMenu('data.json');

        expect(menuLabels()).toEqual(expect.arrayContaining(JSON_COMMANDS));
        expect(menuLabels()).not.toContain('Format YAML');
        expect(menuLabels()).not.toContain('Convert YAML to JSON');

        openTreeMenu('feed.xml');

        expect(menuLabels()).not.toContain('Convert JSON to YAML');
        expect(menuLabels()).not.toContain('Format YAML');
    });

    it('formats a YAML file from the menu, opening it first, and leaves it unsaved', async () => {
        openTreeMenu('app.yaml');
        menuItem('Format YAML').click();
        await settleAsync();

        expect(openFile('app.yaml').text).toBe('# Settings\nname: demo\nserver:\n  host: localhost\n  port: 80\n');
        expect(openFile('app.yaml').dirty).toBe(true);
        expect(textOf(harness.folder, 'app.yaml')).toBe(APP_YAML);
    });

    it('converts YAML to JSON in a tab of its own, which Save writes next to the YAML', async () => {
        openTreeMenu('app.yaml');
        menuItem('Convert YAML to JSON').click();
        await settleAsync();

        expect(harness.state().activePath).toBe('app.yaml.converted.json');
        expect(JSON.parse(openFile('app.yaml.converted.json').text)).toEqual({ name: 'demo', server: { host: 'localhost', port: 80 } });
        expect(toastTexts()).toContain('Converted app.yaml to JSON.');
        expect(document.querySelector('.cm-content')?.textContent).toContain('"host": "localhost"');
        // Not on disk yet, so it counts as unsaved, and Save is there to press.
        expect(openFile('app.yaml.converted.json').dirty).toBe(true);
        expect(document.querySelector<HTMLButtonElement>('[data-action="save"]')?.textContent).toBe('Save');

        await harness.callAsync('saveAsync', 'app.yaml.converted.json');

        expect(JSON.parse(textOf(harness.folder, 'app.yaml.converted.json'))).toEqual({ name: 'demo', server: { host: 'localhost', port: 80 } });
        expect(openFile('app.yaml.converted.json').dirty).toBe(false);
        expect(textOf(harness.folder, 'app.yaml')).toBe(APP_YAML);
    });

    it('saves the converted JSON with the line ending of the YAML', async () => {
        await harness.callAsync('convertYamlToJsonAsync', 'windows.yml');
        await harness.callAsync('saveAsync', 'windows.yml.converted.json');

        expect(textOf(harness.folder, 'windows.yml.converted.json')).toBe('{\r\n  "name": "demo",\r\n  "list": [\r\n    1\r\n  ]\r\n}');
    });

    it('says where invalid YAML is wrong instead of converting it', async () => {
        await harness.callAsync('convertYamlToJsonAsync', 'broken.yaml');

        expect(harness.state().openFiles.map((file) => file.path)).toEqual([]);
        expect(toastTexts()).toContain('Not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] (line 3, column 1).');
    });

    it('converts JSON to YAML in a tab of its own, which Save writes next to the JSON', async () => {
        openTreeMenu('data.json');
        menuItem('Convert JSON to YAML').click();
        await settleAsync();

        expect(harness.state().activePath).toBe('data.json.converted.yaml');
        expect(openFile('data.json.converted.yaml').text).toBe('name: nib\ntags:\n  - a\n  - "yes"\n');

        await harness.callAsync('saveAsync', 'data.json.converted.yaml');

        expect(textOf(harness.folder, 'data.json.converted.yaml')).toBe('name: nib\ntags:\n  - a\n  - "yes"\n');
    });

    it('converts the JSON editor text to YAML from the toolbar, unsaved edits included', async () => {
        await harness.callAsync('openFileAsync', 'data.json', { preview: false });
        markChange(harness, 'data.json', '{"edited":true}');
        await flushAsync();

        document.querySelector<HTMLButtonElement>('button[data-action="convert-to-yaml"]')!.click();
        await settleAsync();

        expect(harness.state().activePath).toBe('data.json.converted.yaml');
        expect(openFile('data.json.converted.yaml').text).toBe('edited: true\n');
        expect(document.querySelector('.cm-content')?.getAttribute('data-language')).toBe('yaml');
    });
});

describe('YAML compares', () => {
    it('lists Compare YAML among the new compare kinds, and opens an empty YAML compare', async () => {
        const items = await harness.callAsync<Array<{ label: string }>>('newCompareMenuItems');

        expect(items.map((item) => item.label)).toEqual([
            'Compare text',
            'Compare JSON',
            'Compare YAML',
            'Compare XML',
            'Compare Markdown',
            'Compare tables (CSV/TSV)',
        ]);

        const tab = harness.app.newCompare('yaml');

        expect(tab.diffKind).toBe('yaml');
        expect(document.querySelector('.tab[data-active="true"]')?.textContent).toContain('YAML compare');
        expect(document.querySelector('.diff-kind-picker .view-tab[data-active="true"]')?.textContent).toBe('YAML');
    });

    it('compares two YAML files structurally, in the aligned grid with its changes', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'app.yaml', 'app-v2.yaml');
        const tab = harness.state().diffTabs[0] as DiffTab;

        expect(tab.diffKind).toBe('yaml');
        expect(document.querySelector('.diff-tab-pane')?.getAttribute('data-diff-kind')).toBe('yaml');
        expect(document.querySelector('.aligned-tree')).not.toBeNull();
        const changedCells = [...document.querySelectorAll<HTMLElement>('.aligned-cell[data-diff]')]
            .map((cell) => `${cell.dataset['side']} ${cell.dataset['diff']} ${cell.dataset['path']}`);

        expect(changedCells).toEqual([
            'original changed $.server.port',
            'modified changed $.server.port',
            'modified added $.server.tls',
        ]);
    });

    it('exports the YAML diff as JSON and HTML', async () => {
        const blobs: Blob[] = [];
        const downloads: string[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            blobs.push(blob as Blob);

            return `blob:download-${blobs.length}`;
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push(this.download);
        });
        await harness.callAsync('compareTwoSelectedAsync', 'app.yaml', 'app-v2.yaml');
        const tabId = harness.state().diffTabs[0]!.id;

        await harness.callAsync('exportDiffAsync', tabId, 'json');
        await harness.callAsync('exportDiffAsync', tabId, 'html');

        expect(downloads).toEqual(['app-vs-app-v2.diff.json', 'app-vs-app-v2.diff.html']);
        expect(JSON.parse(await blobs[0]!.text())).toMatchObject({
            kind: 'yaml',
            original: { name: 'app.yaml', path: 'app.yaml' },
            changes: [{ id: 'server.port', kind: 'changed', before: 80, after: 8080 }, { id: 'server.tls', kind: 'added' }],
        });
        expect(await blobs[1]!.text()).toContain('<title>app.yaml ↔ app-v2.yaml · YAML diff</title>');
    });

    it('shows the parser message above a side that is not valid YAML', async () => {
        await harness.callAsync('compareTwoSelectedAsync', 'app.yaml', 'broken.yaml');
        const error = document.querySelector('.diff-side-error');

        expect(error?.textContent).toBe(
            'Not valid YAMLFlow sequence in block collection must be sufficiently indented and end with a ] (line 3, column 1).',
        );
        expect(error?.closest('.split-pane')?.getAttribute('data-pane')).toBe('modified');
    });
});
