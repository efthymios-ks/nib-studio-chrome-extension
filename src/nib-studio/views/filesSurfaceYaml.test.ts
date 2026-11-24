import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { OpenFile } from '../app/store.js';
import { activeViewTab, buttonByText, openFileFixture, toastTexts, viewTabLabels } from '../testing/testHelpers.js';
import { renderFilesSurface, setFilesSurfaceView, type FilesSurfaceCallbacks, type FilesSurfaceState } from './filesSurface.js';

const APP_YAML = [
    '# Application settings',
    'name: demo',
    'server:',
    '    host: localhost   # where it listens',
    '    port: 8080',
    'tags: [a, b]',
    '',
].join('\n');

const MULTI_YAML = 'kind: first\n---\nkind: second\n---\n- third\n';

type YamlCallbacks = FilesSurfaceCallbacks & {
    readonly onChange: Mock<FilesSurfaceCallbacks['onChange']>;
    readonly onConvertJsonToYaml: Mock<NonNullable<FilesSurfaceCallbacks['onConvertJsonToYaml']>>;
};

function buildCallbacks(): YamlCallbacks {
    return {
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onPickWorkspace: vi.fn(),
        onReopenWorkspace: vi.fn(),
        onConvertJsonToYaml: vi.fn(),
        diffTab: { onSetSide: vi.fn(), onSwap: vi.fn() },
    };
}

function stateFor(file: OpenFile | null): FilesSurfaceState {
    return {
        workspaceOpen: true,
        tabs: file == null ? [] : [file],
        activeId: file?.path ?? null,
        activeFile: file,
        activeDiff: null,
    };
}

function rowTexts(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>('.json-tree .json-row')]
        .map((row) => row.textContent ?? '')
        .filter((text) => text !== '');
}

describe('YAML files in the files surface', () => {
    let container: HTMLElement;
    let callbacks: YamlCallbacks;

    beforeEach(() => {
        setFilesSurfaceView('editor');
        container = document.createElement('div');
        document.body.append(container);
        callbacks = buildCallbacks();
    });

    afterEach(() => {
        renderFilesSurface(container, { ...stateFor(null), workspaceOpen: false }, callbacks);
        container.remove();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
    });

    it('offers the YAML views, a YAML badge, Format and Convert to JSON', () => {
        const file = openFileFixture('yaml-views/app.yaml', APP_YAML);

        renderFilesSurface(container, stateFor(file), callbacks);

        expect(viewTabLabels(container)).toEqual(['Editor', 'Tree', 'JSONPath', 'Schema']);
        expect([...container.querySelectorAll('.editor-toolbar .badge')].map((badge) => badge.textContent)).toEqual(['YAML']);
        expect(buttonByText(container, 'Format')).toBeDefined();
        expect(buttonByText(container, 'Convert to JSON')).toBeDefined();
        expect(buttonByText(container, 'Minify')).toBeUndefined();
        expect(container.querySelector('.cm-content')?.getAttribute('data-language')).toBe('yaml');
    });

    it('formats in the editor as one undoable step, keeping comments', () => {
        const file = openFileFixture('yaml-format/app.yaml', APP_YAML);
        renderFilesSurface(container, stateFor(file), callbacks);

        buttonByText(container, 'Format')?.click();

        const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-content')!)!;
        expect(view.state.doc.toString()).toBe([
            '# Application settings',
            'name: demo',
            'server:',
            '  host: localhost # where it listens',
            '  port: 8080',
            'tags: [ a, b ]',
            '',
        ].join('\n'));
        expect(callbacks.onChange).toHaveBeenCalledTimes(1);

        undo(view);

        expect(view.state.doc.toString()).toBe(APP_YAML);
    });

    it('says where invalid YAML is wrong instead of formatting it', () => {
        const file = openFileFixture('yaml-broken/broken.yaml', 'a: 1\nb: [1, 2\nc: 3\n');
        renderFilesSurface(container, stateFor(file), callbacks);

        buttonByText(container, 'Format')?.click();

        expect(callbacks.onChange).not.toHaveBeenCalled();
        expect(toastTexts()).toEqual([
            'Not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] (line 3, column 1).',
        ]);
    });

    it('converts the editor text to JSON in place, as XML does', () => {
        const file = openFileFixture('yaml-convert/app.yaml', APP_YAML);
        renderFilesSurface(container, stateFor(file), callbacks);

        buttonByText(container, 'Convert to JSON')?.click();

        const [path, text] = callbacks.onChange.mock.calls[0] as [string, string];
        expect(path).toBe('yaml-convert/app.yaml');
        expect(JSON.parse(text)).toEqual({ name: 'demo', server: { host: 'localhost', port: 8080 }, tags: ['a', 'b'] });
    });

    it('shows the data as a tree with JSONPath paths', () => {
        setFilesSurfaceView('tree');
        const file = openFileFixture('yaml-tree/app.yaml', APP_YAML);
        renderFilesSurface(container, stateFor(file), callbacks);

        expect(rowTexts(container)).toContain('"host":"localhost"');

        container.querySelector<HTMLElement>('.json-row[data-node-path="$.server.port"]')?.click();

        expect(container.querySelector('.path-bar-path')?.textContent).toBe('$.server.port');
    });

    it('shows each document as Document n in the tree', () => {
        setFilesSurfaceView('tree');
        const file = openFileFixture('yaml-multi/multi.yaml', MULTI_YAML);
        renderFilesSurface(container, stateFor(file), callbacks);

        expect([...container.querySelectorAll('.json-key[data-label="true"]')].map((key) => key.textContent)).toEqual([
            'Document 1',
            'Document 2',
            'Document 3',
        ]);

        container.querySelector<HTMLElement>('.json-row[data-node-path="$[1].kind"]')?.click();

        expect(container.querySelector('.path-bar-path')?.textContent).toBe('$[1].kind');
    });

    it('explains invalid YAML with the line and column in the Tree view', () => {
        setFilesSurfaceView('tree');
        const file = openFileFixture('yaml-invalid/broken.yaml', 'a: 1\n  b: 2\n');
        renderFilesSurface(container, stateFor(file), callbacks);

        expect(container.textContent).toContain('Not valid YAML');
        expect(container.textContent).toContain('Nested mappings are not allowed in compact mappings (line 1, column 4).');
    });

    it('queries the data with JSONPath and shows a match in the tree', () => {
        setFilesSurfaceView('jsonpath');
        const file = openFileFixture('yaml-path/app.yaml', APP_YAML);
        renderFilesSurface(container, stateFor(file), callbacks);
        const input = container.querySelector<HTMLInputElement>('.path-query-input')!;
        input.value = '$.tags[*]';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

        expect([...container.querySelectorAll('.path-card-value')].map((value) => value.textContent)).toEqual(['"a"', '"b"']);

        container.querySelectorAll<HTMLElement>('.path-card')[1]!.querySelector<HTMLButtonElement>('.path-card-reveal')!.click();

        expect(activeViewTab(container)).toBe('Tree');
        expect(container.querySelector('.path-bar-path')?.textContent).toBe('$.tags[1]');
    });

    it('says the document is not valid YAML in the JSONPath and Schema views', () => {
        setFilesSurfaceView('jsonpath');
        const file = openFileFixture('yaml-path-invalid/broken.yaml', 'a: [\n');
        renderFilesSurface(container, stateFor(file), callbacks);

        expect(container.textContent).toContain('Document is not valid YAML:');

        buttonByText(container, 'Schema')?.click();
        buttonByText(container, 'Generate')?.click();

        expect(container.querySelector('.path-query-status')?.textContent).toMatch(/^Document is not valid YAML: /);
    });

    it('validates the data against a pasted JSON Schema', () => {
        setFilesSurfaceView('schema');
        const file = openFileFixture('yaml-schema/app.yaml', APP_YAML);
        renderFilesSurface(container, stateFor(file), callbacks);
        buttonByText(container, 'Validate')?.click();
        const box = container.querySelector<HTMLTextAreaElement>('.schema-input')!;
        box.value = '{"type":"object","properties":{"server":{"properties":{"port":{"type":"string"}}}}}';
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));

        expect(container.querySelector('.path-query-status')?.textContent).toBe('1 error');
        expect(container.querySelector('.schema-error')?.textContent).toContain('$/server/port');

        box.value = '';
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    });

    it('offers Convert to YAML for JSON, handing over the editor text', () => {
        const file = openFileFixture('yaml-from-json/data.json', '{"name":"nib","tags":[1,2]}');
        renderFilesSurface(container, stateFor(file), callbacks);

        buttonByText(container, 'Convert to YAML')?.click();

        expect(callbacks.onConvertJsonToYaml).toHaveBeenCalledWith('yaml-from-json/data.json', '{"name":"nib","tags":[1,2]}');
    });
});
