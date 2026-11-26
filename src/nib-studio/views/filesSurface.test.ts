import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createDiffTab } from '../app/diffTabs.js';
import type { DiffTab, OpenFile, OpenTab } from '../app/store.js';
import { LIVE_PREVIEW_MAX_LENGTH } from '../editor/markdownLivePreview.js';
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { externalTabPath } from '../app/store.js';
import {
    notifyFilesSurfaceOfChanges,
    renderFilesSurface,
    revealInFilesSurface,
    setFilesSurfaceView,
    type FilesSurfaceCallbacks,
    type FilesSurfaceState,
} from './filesSurface.js';
import type { OpenPdf } from './pdfSavePagesDialog.js';
import { exportMarkdownToHtmlAsync, exportMarkdownToPdfAsync } from './markdownActions.js';
import { renderMermaidIntoAsync } from './mermaidBridge.js';
import { renderTableViewerAsync } from './tableViewer.js';
import { drawSandboxPage } from '../testing/sandboxFrames.js';
import {
    activeViewTab,
    blurEditor,
    buttonByText,
    flushAsync,
    ignoreSelectionChange,
    openFileFixture,
    settleAsync,
    viewTabLabels,
} from '../testing/testHelpers.js';

vi.mock('./mermaidBridge.js', () => ({
    renderMermaidIntoAsync: vi.fn(async () => {}),
    renderMermaidSvgAsync: vi.fn(async () => '<svg></svg>'),
    buildMermaidTools: vi.fn(() => document.createElement('div')),
}));

vi.mock('./markdownActions.js', () => ({
    exportMarkdownToHtmlAsync: vi.fn(async () => {}),
    exportMarkdownToPdfAsync: vi.fn(async () => {}),
}));

// Longer than the pause in typing after which an HTML preview is drawn again.
const TYPING_PAUSE_MS = 1000;

interface PreviewInput {
    readonly kind: string;
    readonly file: File | null;
    readonly fileName: string;
    readonly memoryKey: string;
    readonly onSavePdfPages?: (open: OpenPdf) => void;
}

// Previews are stood in for by handles that record what the surface asks of them.
const previews = vi.hoisted(() => ({
    mounted: [] as Array<{ pane: HTMLElement; input: PreviewInput; update: Mock; destroy: Mock }>,
}));

vi.mock('./previewPane.js', () => ({
    mountPreview: (pane: HTMLElement, input: PreviewInput) => {
        const element = document.createElement('div');
        element.className = 'preview-frame';
        pane.append(element);
        const handle = { pane, input, update: vi.fn(), destroy: vi.fn() };
        previews.mounted.push(handle);

        return { element, update: handle.update, destroy: handle.destroy };
    },
}));

vi.mock('./tableViewer.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('./tableViewer.js')>();

    return { ...original, renderTableViewerAsync: vi.fn(async () => {}) };
});

type CallbackMocks = {
    readonly [Key in Exclude<keyof FilesSurfaceCallbacks, 'diffTab'>]-?: Mock<NonNullable<FilesSurfaceCallbacks[Key]>>;
} & Pick<FilesSurfaceCallbacks, 'diffTab'>;

function buildCallbacks(): CallbackMocks {
    return {
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onPickWorkspace: vi.fn(),
        onReopenWorkspace: vi.fn(),
        onTabContextMenu: vi.fn(),
        onPromoteTab: vi.fn(),
        onCompareWith: vi.fn(),
        onNewCompare: vi.fn(),
        onSavePdfPages: vi.fn(),
        onOpenLink: vi.fn(),
        onConvertJsonToYaml: vi.fn(),
        diffTab: { onSetSide: vi.fn(), onSwap: vi.fn() },
    };
}

function stateFor(
    tabs: OpenTab[],
    active: OpenTab | null,
    workspaceOpen = true,
    workspaceRoot: FileSystemDirectoryHandle | null = null,
): FilesSurfaceState {
    const activeDiff = active != null && 'kind' in active && active.kind === 'diff' ? active as DiffTab : null;

    return {
        workspaceOpen,
        tabs,
        activeId: active == null ? null : ('id' in active ? active.id : active.path),
        activeFile: activeDiff == null ? active as OpenFile | null : null,
        activeDiff,
        workspaceRoot,
    };
}

function badges(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.editor-toolbar .badge')].map((badge) => badge.textContent ?? '');
}

function editorView(container: HTMLElement): EditorView {
    const content = container.querySelector('.cm-content') as HTMLElement;

    return EditorView.findFromDOM(content) as EditorView;
}

describe('renderFilesSurface', () => {
    let container: HTMLElement;
    let callbacks: ReturnType<typeof buildCallbacks>;

    beforeEach(() => {
        // Editor sessions are cached by path, so tests that count onChange use paths no other test opens.
        localStorage.clear();
        setFilesSurfaceView('editor');
        container = document.createElement('div');
        document.body.append(container);
        callbacks = buildCallbacks();
    });

    afterEach(() => {
        vi.useRealTimers();
        // An empty render destroys any mounted editor before the next test.
        renderFilesSurface(container, stateFor([], null, false), callbacks);
        container.remove();
        document.querySelectorAll('.toast-stack').forEach((stack) => stack.remove());
        vi.clearAllMocks();
    });

    describe('without a workspace', () => {
        it('shows the folder picker with working buttons', () => {
            renderFilesSurface(container, stateFor([], null, false), callbacks);

            expect(container.querySelector('.pick-workspace-screen h1')?.textContent).toBe('Pick a workspace folder');

            buttonByText(container, 'Choose folder')?.click();
            buttonByText(container, 'Re-open last workspace')?.click();
            buttonByText(container, 'Start a compare')?.click();

            expect(callbacks.onPickWorkspace).toHaveBeenCalledTimes(1);
            expect(callbacks.onReopenWorkspace).toHaveBeenCalledTimes(1);
            expect(callbacks.onNewCompare).toHaveBeenCalledTimes(1);
            expect(container.querySelector('.tab-bar')).toBeNull();
        });

        it('leaves out Start a compare when compares are not offered', () => {
            const { onNewCompare: _ignored, ...rest } = callbacks;

            renderFilesSurface(container, stateFor([], null, false), rest);

            expect(buttonByText(container, 'Start a compare')).toBeUndefined();
        });

        it('keeps compare tabs on screen without a folder', async () => {
            const diff = createDiffTab({ label: 'a.txt', source: 'paste', text: 'a\n' }, { label: 'b.txt', source: 'paste', text: 'b\n' }, 'text');

            renderFilesSurface(container, stateFor([diff], diff, false), callbacks);
            await settleAsync();

            expect(container.querySelector('.pick-workspace-screen')).toBeNull();
            expect(container.querySelector('.tab[data-kind="diff"]')).not.toBeNull();
            expect(container.querySelector('.diff-side-header[data-side="original"]')).not.toBeNull();
        });
    });

    describe('tabs', () => {
        it('shows an empty state without a compare action when no tab is active', () => {
            renderFilesSurface(container, stateFor([], null), callbacks);

            expect(container.querySelector('.tab-bar')).not.toBeNull();
            expect(container.querySelector('.editor-shell')?.textContent).toBe(
                'No file openPick one from the Explorer, or right-click the tree to create a new file.',
            );
            expect(buttonByText(container, 'Start a compare')).toBeUndefined();
            expect(container.querySelector('.editor-shell button')).toBeNull();
        });

        it('renders every tab in order, marking the active, preview and dirty ones', () => {
            const first = openFileFixture('docs/a.json', '{}', { preview: true });
            const second = openFileFixture('b.txt', 'b', { dirty: true });

            renderFilesSurface(container, stateFor([first, second], second), callbacks);

            const tabs = [...container.querySelectorAll<HTMLElement>('.tab-bar .tab')];
            expect(tabs.map((tab) => tab.dataset.path)).toEqual(['docs/a.json', 'b.txt']);
            expect(tabs[0]?.dataset.preview).toBe('true');
            expect(tabs[1]?.dataset.active).toBe('true');
            expect(tabs[1]?.dataset.dirty).toBe('true');
        });

        it('activates, closes and promotes tabs through the callbacks', () => {
            const first = openFileFixture('a.json', '{}', { preview: true });
            const second = openFileFixture('b.txt', 'b');
            renderFilesSurface(container, stateFor([first, second], second), callbacks);
            const tab = container.querySelector('.tab[data-path="a.json"]') as HTMLElement;

            tab.click();
            tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            (tab.querySelector('.tab-close') as HTMLButtonElement).click();

            expect(callbacks.onActivate).toHaveBeenCalledWith('a.json');
            expect(callbacks.onPromoteTab).toHaveBeenCalledWith('a.json');
            expect(callbacks.onClose).toHaveBeenCalledWith('a.json');
            expect(callbacks.onActivate).toHaveBeenCalledTimes(1);
        });

        it('offers a new compare from the tab bar plus button', () => {
            renderFilesSurface(container, stateFor([], null), callbacks);

            (container.querySelector('.tab-new') as HTMLButtonElement).click();

            expect(callbacks.onNewCompare).toHaveBeenCalledTimes(1);
        });

        it('renders a diff tab instead of an editor when a compare is active', async () => {
            const file = openFileFixture('a.json', '{"a":1}');
            const diff = createDiffTab(
                { label: 'a.json', path: 'a.json', source: 'file', text: '{"a":1}' },
                { label: 'b.json', path: 'b.json', source: 'file', text: '{"a":2}' },
            );

            renderFilesSurface(container, stateFor([file, diff], diff), callbacks);
            await settleAsync();

            expect(container.querySelector('.tab[data-kind="diff"]')?.getAttribute('data-active')).toBe('true');
            expect(container.querySelector('.diff-side-header[data-side="modified"] .diff-side-name')?.textContent).toBe('b.json');
            expect(container.querySelector('.cm-editor .editor-toolbar')).toBeNull();
        });
    });

    describe('editor toolbar', () => {
        it('offers JSON views, a JSON badge and Format, Minify and Save actions', () => {
            const file = openFileFixture('a.json', '{"a":1}');

            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(viewTabLabels(container)).toEqual(['Editor', 'Tree', 'JSONPath', 'Schema']);
            expect(activeViewTab(container)).toBe('Editor');
            expect(badges(container)).toEqual(['JSON']);
            expect(buttonByText(container, 'Format')).toBeDefined();
            expect(buttonByText(container, 'Minify')).toBeDefined();
            expect(buttonByText(container, 'Saved')).toBeDefined();
        });

        it('labels Save by the dirty state and saves the file on click', () => {
            const file = openFileFixture('notes.txt', 'hello', { dirty: true });
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(viewTabLabels(container)).toEqual(['Editor']);
            expect(badges(container)).toEqual(['Text']);

            buttonByText(container, 'Save')?.click();

            expect(callbacks.onSave).toHaveBeenCalledWith('notes.txt');
        });

        it('asks for the other side of a compare, anchored to the button', () => {
            const file = openFileFixture('a.json', '{}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const button = container.querySelector('button[data-action="compare-with"]') as HTMLButtonElement;

            button.click();

            expect(callbacks.onCompareWith).toHaveBeenCalledWith('a.json', button);
        });

        it('formats and minifies JSON through onChange', () => {
            const file = openFileFixture('format.json', '{ "a" : [1, 2] }');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            buttonByText(container, 'Format')?.click();
            buttonByText(container, 'Minify')?.click();

            expect(callbacks.onChange).toHaveBeenNthCalledWith(1, 'format.json', '{\n  "a": [\n    1,\n    2\n  ]\n}');
            expect(callbacks.onChange).toHaveBeenNthCalledWith(2, 'format.json', '{"a":[1,2]}');
        });

        it('warns instead of formatting invalid JSON', () => {
            const file = openFileFixture('broken.json', '{ broken');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            buttonByText(container, 'Format')?.click();

            expect(callbacks.onChange).not.toHaveBeenCalled();
            expect(document.querySelector('.toast[data-tone="fail"]')).not.toBeNull();
        });

        it('converts XML to JSON through onChange', () => {
            const file = openFileFixture('a.xml', '<root><item>1</item></root>');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(viewTabLabels(container)).toEqual(['Editor', 'Tree', 'XPath', 'As JSON']);
            expect(badges(container)).toEqual(['XML']);

            buttonByText(container, 'Convert to JSON')?.click();

            expect(callbacks.onChange).toHaveBeenCalledTimes(1);
            const [path, text] = callbacks.onChange.mock.calls[0] as [string, string];
            expect(path).toBe('a.xml');
            expect(JSON.parse(text)).toBeTruthy();
        });

        it('reports the parse error instead of converting invalid XML', () => {
            const file = openFileFixture('broken.xml', '<root>');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            buttonByText(container, 'Convert to JSON')?.click();

            expect(callbacks.onChange).not.toHaveBeenCalled();
            expect(document.querySelector('.toast[data-tone="fail"]')?.textContent).toContain('Not valid XML');
        });

        it('exports Markdown to HTML and PDF', () => {
            const file = openFileFixture('readme.md', '# Title');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(viewTabLabels(container)).toEqual(['Editor', 'Interactive', 'Split', 'Preview']);

            buttonByText(container, 'Export HTML')?.click();
            buttonByText(container, 'Export PDF')?.click();

            expect(exportMarkdownToHtmlAsync).toHaveBeenCalledWith(file, null);
            expect(exportMarkdownToPdfAsync).toHaveBeenCalledWith(file, null);
        });
    });

    describe('editor', () => {
        it('mounts the editor with the file text and reports edits and saves', () => {
            const file = openFileFixture('notes.txt', 'hello');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const view = editorView(container);

            expect(view.state.doc.toString()).toBe('hello');

            view.dispatch({ changes: { from: 5, insert: ' world' } });
            blurEditor();

            expect(callbacks.onChange).toHaveBeenLastCalledWith('notes.txt', 'hello world');
        });

        it('restores the caret when coming back to the editor view', () => {
            const file = openFileFixture('a.json', '{"alpha":1}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            editorView(container).dispatch({ selection: { anchor: 4 } });
            blurEditor();

            buttonByText(container, 'Tree')?.click();
            expect(container.querySelector('.cm-content')).toBeNull();

            buttonByText(container, 'Editor')?.click();

            expect(editorView(container).state.selection.main.head).toBe(4);
        });
    });

    describe('views', () => {
        it('switches a JSON file to the tree view and keeps it for the next JSON file', () => {
            const first = openFileFixture('a.json', '{"alpha":1}');
            renderFilesSurface(container, stateFor([first], first), callbacks);

            buttonByText(container, 'Tree')?.click();

            expect(activeViewTab(container)).toBe('Tree');
            expect(container.querySelector('.cm-content')).toBeNull();
            expect(buttonByText(container, 'Format')).toBeUndefined();
            expect(container.querySelector('.editor-pane')?.textContent).toContain('alpha');

            const second = openFileFixture('b.json', '{"beta":2}');
            renderFilesSurface(container, stateFor([first, second], second), callbacks);

            expect(activeViewTab(container)).toBe('Tree');
        });

        it('falls back to Editor when the remembered view does not apply', () => {
            setFilesSurfaceView('tree');
            const file = openFileFixture('notes.txt', 'plain');

            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(activeViewTab(container)).toBe('Editor');
            expect(container.querySelector('.cm-content')).not.toBeNull();
        });

        it('runs JSONPath queries on render and on Enter, one card per match', () => {
            setFilesSurfaceView('jsonpath');
            const file = openFileFixture('a.json', '{"items":[{"id":7},{"id":8}]}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const input = container.querySelector<HTMLInputElement>('.path-query-input')!;

            expect(input.value).toBe('$');
            expect(container.querySelectorAll('.path-card')).toHaveLength(1);
            expect(buttonByText(container, 'Run')).toBeUndefined();

            input.value = '$.items[*].id';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            expect([...container.querySelectorAll('.path-card-value')].map((value) => value.textContent)).toEqual(['7', '8']);
            expect(container.querySelector('.path-query-status')?.textContent).toMatch(/^2 matches · /);
        });

        it('reports no matches and invalid documents in the JSONPath view', () => {
            setFilesSurfaceView('jsonpath');
            const file = openFileFixture('a.json', '{"a":1}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const input = container.querySelector<HTMLInputElement>('.path-query-input')!;
            input.value = '$.missing';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            expect(container.querySelector('.path-query-status')?.textContent).toMatch(/^No matches · /);

            const broken = openFileFixture('b.json', '{');
            renderFilesSurface(container, stateFor([broken], broken), callbacks);

            expect(container.querySelector('.path-query-status')?.textContent).toMatch(/^Document is not valid JSON: .+\(line 1, column 2\)\.$/);
        });

        it('shows a JSONPath match in the Tree view, selected, flashed and in the path bar', () => {
            setFilesSurfaceView('jsonpath');
            const file = openFileFixture('reveal.json', '{"items":[{"id":7},{"id":8}]}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const input = container.querySelector<HTMLInputElement>('.path-query-input')!;
            input.value = '$..id';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            container.querySelectorAll<HTMLElement>('.path-card')[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

            expect(activeViewTab(container)).toBe('Tree');
            const row = container.querySelector<HTMLElement>('.json-row[data-selected="true"]');
            expect(row?.dataset['nodePath']).toBe('$.items[1].id');
            expect(row?.dataset['flash']).toBe('true');
            expect(container.querySelector('.path-bar-path')?.textContent).toBe('$.items[1].id');

            buttonByText(container, 'JSONPath')?.click();

            expect(container.querySelector<HTMLInputElement>('.path-query-input')?.value).toBe('$..id');
        });

        it('keeps the Formatted / Compact choice across views and files', () => {
            setFilesSurfaceView('jsonpath');
            const file = openFileFixture('layout.json', '{"a":{"b":1}}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            container.querySelector<HTMLButtonElement>('.path-layout-option[data-layout="compact"]')!.click();

            const xml = openFileFixture('layout.xml', '<a><b/></a>');
            setFilesSurfaceView('xpath');
            renderFilesSurface(container, stateFor([xml], xml), callbacks);

            expect(container.querySelector<HTMLElement>('.path-results')?.dataset['layout']).toBe('compact');

            container.querySelector<HTMLButtonElement>('.path-layout-option[data-layout="formatted"]')!.click();
        });

        it('checks the document against a schema as it is pasted, without a Check button', () => {
            setFilesSurfaceView('schema');
            const file = openFileFixture('a.json', '{"age":"old"}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            buttonByText(container, 'Validate')?.click();
            const paste = (text: string): void => {
                const box = container.querySelector<HTMLTextAreaElement>('.schema-input')!;
                box.value = text;
                box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
            };
            paste('');

            expect(container.querySelector('.path-query-status')?.textContent).toBe('Paste a JSON Schema to check this document against it.');
            expect(buttonByText(container, 'Check')).toBeUndefined();

            paste('{"type":"object","properties":{"age":{"type":"number"}}}');

            expect(container.querySelector('.path-card-path')?.textContent).toBe('$/age');

            container.querySelector<HTMLElement>('.path-card')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            expect(activeViewTab(container)).toBe('Tree');
            expect(container.querySelector<HTMLElement>('.json-row[data-selected="true"]')?.dataset['nodePath']).toBe('$.age');

            buttonByText(container, 'Schema')?.click();

            expect(container.querySelector<HTMLTextAreaElement>('.schema-input')?.value).toBe('{"type":"object","properties":{"age":{"type":"number"}}}');

            paste('{"type":"object"}');

            expect(container.querySelector('.path-query-status')?.textContent).toBe('OK — 1 keyword checked.');
        });

        it('keeps the schema box\'s text and its undo history for each file, across a trip to Tree', () => {
            setFilesSurfaceView('schema');
            const first = openFileFixture('undo-first.json', '{"age":1}');
            const second = openFileFixture('undo-second.json', '{"name":"x"}');
            const box = (): HTMLTextAreaElement => container.querySelector<HTMLTextAreaElement>('.schema-input')!;
            const write = (text: string, inputType: string): void => {
                box().value = text;
                box().dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
            };
            const undo = (): void => {
                box().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
            };
            renderFilesSurface(container, stateFor([first, second], first), callbacks);
            buttonByText(container, 'Validate')?.click();
            // The box may start with the last schema an earlier file used.
            const start = box().value;
            write('{"type":"object"}', 'insertFromPaste');
            write('{"type":"array"}', 'insertFromPaste');

            buttonByText(container, 'Tree')?.click();
            buttonByText(container, 'Schema')?.click();
            write('{"type":"string"}', 'insertFromPaste');
            undo();
            undo();

            expect(box().value).toBe('{"type":"object"}');

            renderFilesSurface(container, stateFor([first, second], second), callbacks);
            write('{"type":"number"}', 'insertFromPaste');

            renderFilesSurface(container, stateFor([first, second], first), callbacks);

            expect(box().value).toBe('{"type":"object"}');

            undo();

            expect(box().value).toBe(start);

            renderFilesSurface(container, stateFor([first, second], second), callbacks);

            expect(box().value).toBe('{"type":"number"}');
        });

        it('starts a file with no schema yet with the last schema used, with an undo history of its own', () => {
            setFilesSurfaceView('schema');
            const first = openFileFixture('last-first.json', '{"age":1}');
            const second = openFileFixture('last-second.json', '{"age":"old"}');
            const third = openFileFixture('last-third.json', '{"age":2}');
            const tabs = [first, second, third];
            const box = (): HTMLTextAreaElement => container.querySelector<HTMLTextAreaElement>('.schema-input')!;
            const write = (text: string): void => {
                box().value = text;
                box().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
            };
            const undo = (): void => {
                box().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
            };
            const schema = '{"type":"object","properties":{"age":{"type":"integer"}}}';
            renderFilesSurface(container, stateFor(tabs, first), callbacks);
            buttonByText(container, 'Validate')?.click();
            write(schema);

            renderFilesSurface(container, stateFor(tabs, second), callbacks);

            expect(box().value).toBe(schema);
            expect(container.querySelector('.path-card-path')?.textContent).toBe('$/age');

            undo();

            expect(box().value).toBe(schema);

            write('');
            renderFilesSurface(container, stateFor(tabs, first), callbacks);
            renderFilesSurface(container, stateFor(tabs, second), callbacks);

            expect(box().value).toBe('');

            renderFilesSurface(container, stateFor(tabs, third), callbacks);

            expect(box().value).toBe(schema);
            expect(container.querySelector('.path-query-status')?.textContent).toBe('OK — 4 keywords checked.');
        });

        it('generates a schema from the document and regenerates when the text changes', () => {
            setFilesSurfaceView('schema');
            const file = openFileFixture('a.json', '{"age":36}');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            buttonByText(container, 'Generate')?.click();

            expect(container.querySelector('.schema-output')?.textContent).toContain('"age": {\n      "type": "integer"\n    }');

            const edited = { ...file, text: '{"age":"old"}' };
            renderFilesSurface(container, stateFor([edited], edited), callbacks);

            expect(container.querySelector('.schema-output')?.textContent).toContain('"age": {\n      "type": "string"\n    }');

            buttonByText(container, 'Validate')?.click();
        });

        it('shows XML as a read-only JSON tree with Save disabled', () => {
            setFilesSurfaceView('as-json');
            const file = openFileFixture('a.xml', '<root><item>1</item></root>');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(container.querySelector('.xml-as-json-badge')?.textContent).toBe('converted from XML');
            expect(buttonByText(container, 'Saved')?.hasAttribute('disabled')).toBe(true);
            expect(buttonByText(container, 'Convert to JSON')).toBeUndefined();
        });

        it('explains invalid XML in the As JSON view', () => {
            setFilesSurfaceView('as-json');
            const file = openFileFixture('a.xml', '<root>');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(container.textContent).toContain('Not valid XML');
        });

        it('evaluates XPath, then reveals and flashes a match in the Tree view', () => {
            setFilesSurfaceView('xpath');
            const file = openFileFixture('orders.xml', '<orders><order id="1"/><order id="2"><item>x</item></order></orders>');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const input = container.querySelector<HTMLInputElement>('.path-query-input')!;
            input.value = '//order/@id';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            expect(activeViewTab(container)).toBe('XPath');
            expect(container.querySelector('.path-query-status')?.textContent).toMatch(/^2 matches · /);

            container.querySelectorAll<HTMLElement>('.path-card')[1]!.querySelector<HTMLButtonElement>('.path-card-reveal')!.click();

            expect(activeViewTab(container)).toBe('Tree');
            const attribute = container.querySelector<HTMLElement>('.xml-attr[data-selected="true"]');
            expect(attribute?.dataset['nodePath']).toBe('/orders/order[2]/@id');
            expect(attribute?.dataset['flash']).toBe('true');
            expect(container.querySelector('.path-bar-path')?.textContent).toBe('/orders/order[2]/@id');

            buttonByText(container, 'XPath')?.click();

            expect(container.querySelector<HTMLInputElement>('.path-query-input')?.value).toBe('//order/@id');
        });

        it('opens the XPath view with the selected node from Use in XPath', () => {
            setFilesSurfaceView('tree');
            const file = openFileFixture('orders.xml', '<orders><order/><order><item>x</item></order></orders>');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            container.querySelector<HTMLElement>('.xml-row .xml-text')!.click();
            buttonByText(container, 'Use in XPath')?.click();

            expect(activeViewTab(container)).toBe('XPath');
            expect(container.querySelector<HTMLInputElement>('.path-query-input')?.value).toBe('/orders/order[2]/item/text()');
            expect(container.querySelector('.path-query-status')?.textContent).toMatch(/^1 match · /);
        });

        it('opens the JSONPath view with the selected node from Use in JSONPath', () => {
            setFilesSurfaceView('tree');
            const file = openFileFixture('a.json', '{"items":[{"id":7},{"id":8}]}');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            container.querySelector<HTMLElement>('li[data-json-path="$.items[1].id"] > .json-row')!.click();

            expect(container.querySelector('.path-bar-path')?.textContent).toBe('$.items[1].id');

            buttonByText(container, 'Use in JSONPath')?.click();

            expect(activeViewTab(container)).toBe('JSONPath');
            expect(container.querySelector<HTMLInputElement>('.path-query-input')?.value).toBe('$.items[1].id');
            expect([...container.querySelectorAll('.path-card-value')].map((value) => value.textContent)).toEqual(['8']);
        });

        it('renders a Markdown preview and hands diagrams to mermaid', () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture('readme.md', '# Title\n\n```mermaid\ngraph TD; A-->B;\n```\n');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(container.querySelector('.markdown-preview h1')?.textContent).toBe('Title');
            expect(renderMermaidIntoAsync).toHaveBeenCalledTimes(1);
            expect(vi.mocked(renderMermaidIntoAsync).mock.calls[0]?.[1]).toContain('graph TD');
        });
    });

    describe('view-only files', () => {
        it('shows a table file as view only with no Save and passes its path to the viewer', () => {
            const file = openFileFixture('data/people.csv', 'id\n1\n');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(viewTabLabels(container)).toEqual(['Table']);
            expect(badges(container)).toEqual(['Table', 'View only']);
            expect(buttonByText(container, 'Saved')).toBeUndefined();
            expect(container.querySelector('button[data-action="compare-with"]')).not.toBeNull();
            expect(renderTableViewerAsync).toHaveBeenCalledWith(
                expect.any(HTMLElement),
                { fileName: 'people.csv', path: 'data/people.csv', text: 'id\n1\n', file: null },
            );
        });

        it('flags a large table file', () => {
            const file = openFileFixture('big.csv', '', { large: true });
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(badges(container)).toEqual(['Table', 'Large file', 'View only']);
        });

        it('opens Word documents in the preview frame, without the editor toolbar, view tabs or compare', () => {
            previews.mounted.length = 0;
            const docx = new File(['x'], 'report.docx');
            const doc = new File(['y'], 'old.doc');
            const first = openFileFixture('docs/report.docx', '', { file: docx });
            const second = openFileFixture('docs/old.doc', '', { file: doc });
            renderFilesSurface(container, stateFor([first, second], first), callbacks);
            renderFilesSurface(container, stateFor([first, second], second), callbacks);

            expect(previews.mounted.map((mounted) => mounted.input)).toEqual([
                { kind: 'document', file: docx, fileName: 'report.docx', memoryKey: 'docs/report.docx' },
                { kind: 'document', file: doc, fileName: 'old.doc', memoryKey: 'docs/old.doc' },
            ]);
            expect(container.querySelector('.editor-shell > .editor-toolbar')).toBeNull();
            expect(viewTabLabels(container)).toEqual([]);
            expect(container.querySelector('button[data-action="compare-with"]')).toBeNull();
            expect(renderTableViewerAsync).not.toHaveBeenCalled();
        });
    });

    describe('previews', () => {
        beforeEach(() => {
            previews.mounted.length = 0;
        });

        it('opens an image in the preview frame with no editor toolbar, view tabs, Save or Compare', () => {
            const png = new File(['png'], 'logo.png');
            const file = openFileFixture('media/logo.png', '', { file: png });
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(previews.mounted).toHaveLength(1);
            expect(previews.mounted[0]?.input).toEqual({ kind: 'image', file: png, fileName: 'logo.png', memoryKey: 'media/logo.png' });
            expect(container.querySelector('.editor-shell > .editor-pane.preview-pane > .preview-frame')).not.toBeNull();
            expect(container.querySelector('.editor-shell > .editor-toolbar')).toBeNull();
            expect(container.querySelector('[data-action="save"], [data-action="compare-with"], .view-tab, .cm-editor')).toBeNull();
            expect(renderTableViewerAsync).not.toHaveBeenCalled();
        });

        it('routes audio and video to their previews', () => {
            const audio = openFileFixture('tone.wav', '', { file: new File(['a'], 'tone.wav') });
            const video = openFileFixture('clip.webm', '', { file: new File(['v'], 'clip.webm') });
            renderFilesSurface(container, stateFor([audio, video], audio), callbacks);
            renderFilesSurface(container, stateFor([audio, video], video), callbacks);

            expect(previews.mounted.map((mounted) => mounted.input.kind)).toEqual(['audio', 'video']);
        });

        it('opens an archive in the preview frame, never in the editor', () => {
            const zip = new File(['PK'], 'photos.zip');
            const file = openFileFixture('backups/photos.zip', '', { file: zip });
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(previews.mounted.map((mounted) => mounted.input)).toEqual([
                { kind: 'archive', file: zip, fileName: 'photos.zip', memoryKey: 'backups/photos.zip' },
            ]);
            expect(container.querySelector('.editor-shell > .editor-toolbar, .cm-editor, .view-tab')).toBeNull();
        });

        it('gives a PDF preview Save pages, which reports the tab and the open document to the latest callbacks', () => {
            const pdf = new File(['%PDF'], 'report.pdf');
            const file = openFileFixture('documents/report.pdf', '', { file: pdf });
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const later = buildCallbacks();
            renderFilesSurface(container, stateFor([file], file), later);
            const open = { document: {}, engine: {} } as unknown as OpenPdf;
            previews.mounted[0]?.input.onSavePdfPages?.(open);

            expect(previews.mounted).toHaveLength(1);
            expect(previews.mounted[0]?.input).toMatchObject({ kind: 'pdf', fileName: 'report.pdf', memoryKey: 'documents/report.pdf' });
            expect(later.onSavePdfPages).toHaveBeenCalledWith('documents/report.pdf', open);
            expect(callbacks.onSavePdfPages).not.toHaveBeenCalled();
        });

        it('keeps the preview through unrelated renders and hands it new snapshots without mounting again', () => {
            const first = new File(['1'], 'logo.png');
            const file = openFileFixture('media/logo.png', '', { file: first });
            const other = openFileFixture('notes.txt', 'text');
            renderFilesSurface(container, stateFor([file, other], file), callbacks);
            const frame = container.querySelector('.preview-frame');
            renderFilesSurface(container, stateFor([file, other], file), callbacks);
            renderFilesSurface(container, stateFor([{ ...file }, { ...other, dirty: true }], { ...file }), callbacks);

            expect(previews.mounted).toHaveLength(1);
            expect(container.querySelector('.preview-frame')).toBe(frame);
            expect(previews.mounted[0]?.update).toHaveBeenLastCalledWith(first);

            const second = new File(['2'], 'logo.png');
            const refreshed = { ...file, file: second };
            renderFilesSurface(container, stateFor([refreshed, other], refreshed), callbacks);

            expect(previews.mounted).toHaveLength(1);
            expect(previews.mounted[0]?.update).toHaveBeenLastCalledWith(second);
            expect(previews.mounted[0]?.destroy).not.toHaveBeenCalled();
        });

        it('lets the preview go when another tab, a compare or no workspace takes its place', () => {
            const image = openFileFixture('a.png', '', { file: new File(['a'], 'a.png') });
            const text = openFileFixture('notes.txt', 'text');
            renderFilesSurface(container, stateFor([image, text], image), callbacks);
            renderFilesSurface(container, stateFor([image, text], text), callbacks);

            expect(previews.mounted[0]?.destroy).toHaveBeenCalledTimes(1);

            renderFilesSurface(container, stateFor([image, text], image), callbacks);
            expect(previews.mounted).toHaveLength(2);

            const diff = createDiffTab(null, null, 'text');
            renderFilesSurface(container, stateFor([image, diff], diff), callbacks);
            expect(previews.mounted[1]?.destroy).toHaveBeenCalledTimes(1);

            renderFilesSurface(container, stateFor([image], image), callbacks);
            renderFilesSurface(container, stateFor([], null, false), callbacks);
            expect(previews.mounted[2]?.destroy).toHaveBeenCalledTimes(1);
        });

        it('mounts again for another preview file', () => {
            const first = openFileFixture('a.png', '', { file: new File(['a'], 'a.png') });
            const second = openFileFixture('b.gif', '', { file: new File(['b'], 'b.gif') });
            renderFilesSurface(container, stateFor([first, second], first), callbacks);
            renderFilesSurface(container, stateFor([first, second], second), callbacks);

            expect(previews.mounted.map((mounted) => mounted.input.memoryKey)).toEqual(['a.png', 'b.gif']);
            expect(previews.mounted[0]?.destroy).toHaveBeenCalledTimes(1);
        });
    });

    describe('editor bar', () => {
        function barCommands(): string[] {
            return [...container.querySelectorAll<HTMLElement>('.editor-bar .editor-bar-button')]
                .map((button) => button.dataset['command'] ?? '');
        }

        it('docks above the editor in Editor, Interactive and Split for Markdown, and not in Preview', () => {
            const file = openFileFixture('bar/readme.md', '# Title\n\nbody');
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(barCommands()).toHaveLength(13);
            expect(container.querySelector('.editor-pane > .editor-bar-slot + .editor-host')).not.toBeNull();

            buttonByText(container, 'Interactive')?.click();

            expect(barCommands()).toHaveLength(13);
            expect(container.querySelector('.cm-editor[data-live-preview="true"]')).not.toBeNull();

            buttonByText(container, 'Split')?.click();

            expect(container.querySelectorAll('.editor-bar')).toHaveLength(1);
            expect(container.querySelector('.editor-pane > .editor-bar-slot + .split')).not.toBeNull();
            expect(container.querySelector('.cm-editor[data-live-preview="true"]')).toBeNull();

            buttonByText(container, 'Preview')?.click();

            expect(container.querySelector('.editor-bar')).toBeNull();
        });

        it('formats the Split source from the bar above the split', () => {
            setFilesSurfaceView('split');
            const file = openFileFixture('bar/split.md', 'make it loud');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            editorView(container).dispatch({ selection: { anchor: 8, head: 12 } });

            container.querySelector<HTMLButtonElement>('.editor-bar-button[data-command="bold"]')?.click();

            expect(callbacks.onChange).toHaveBeenLastCalledWith('bar/split.md', 'make it **loud**');
            expect(container.querySelector('.markdown-preview strong')?.textContent).toBe('loud');
        });

        it('offers only undo and redo for JSON, XML and text in the Editor view, and no bar in their other views', () => {
            const json = openFileFixture('bar/a.json', '{}');
            renderFilesSurface(container, stateFor([json], json), callbacks);

            expect(barCommands()).toEqual(['undo', 'redo']);

            buttonByText(container, 'Tree')?.click();

            expect(container.querySelector('.editor-bar')).toBeNull();

            const xml = openFileFixture('bar/a.xml', '<a/>');
            setFilesSurfaceView('editor');
            renderFilesSurface(container, stateFor([xml], xml), callbacks);

            expect(barCommands()).toEqual(['undo', 'redo']);

            buttonByText(container, 'As JSON')?.click();

            expect(container.querySelector('.editor-bar')).toBeNull();

            const text = openFileFixture('bar/notes.txt', 'hello');
            renderFilesSurface(container, stateFor([text], text), callbacks);

            expect(barCommands()).toEqual(['undo', 'redo']);
        });
    });

    describe('Interactive view', () => {
        it('sits between Editor and Split with a tooltip, and is remembered for the next Markdown file', () => {
            const first = openFileFixture('live/one.md', '# One');
            const second = openFileFixture('live/two.md', '**Two**');
            renderFilesSurface(container, stateFor([first], first), callbacks);
            const tab = container.querySelector<HTMLElement>('.view-tab[data-view="interactive"]');

            expect(tab?.textContent).toBe('Interactive');
            expect(tab?.title).toBe('Edit with the formatting shown; the file stays Markdown');
            expect(activeViewTab(container)).toBe('Editor');

            tab?.click();
            renderFilesSurface(container, stateFor([first, second], second), callbacks);

            expect(activeViewTab(container)).toBe('Interactive');
            expect(container.querySelector('.cm-editor[data-live-preview="true"]')).not.toBeNull();
        });

        it('shows the source with a note for a file too large to show formatted', () => {
            setFilesSurfaceView('interactive');
            const file = openFileFixture('live/huge.md', 'a'.repeat(LIVE_PREVIEW_MAX_LENGTH + 1));
            renderFilesSurface(container, stateFor([file], file), callbacks);

            expect(container.querySelector('.editor-note')?.textContent).toContain('too large');
            expect(container.querySelector('.cm-editor[data-live-preview="true"]')).toBeNull();
            expect(container.querySelector('.editor-bar')).not.toBeNull();
        });
    });

    describe('keeping the editor across renders', () => {
        beforeEach(() => {
            document.addEventListener('selectionchange', ignoreSelectionChange, true);
        });

        afterEach(() => {
            document.removeEventListener('selectionchange', ignoreSelectionChange, true);
        });

        function focusedContent(): HTMLElement {
            const content = container.querySelector<HTMLElement>('.cm-content')!;
            EditorView.findFromDOM(content)!.focus();

            return content;
        }

        function press(element: HTMLElement): MouseEvent {
            const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            element.dispatchEvent(mousedown);
            element.click();

            return mousedown;
        }

        it('keeps the same editor, focus and caret when the file turns dirty and when its text changes elsewhere', () => {
            const file = openFileFixture('keep/notes.txt', 'hello');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const content = focusedContent();
            const view = editorView(container);
            view.dispatch({ changes: { from: 5, insert: '!' }, selection: { anchor: 6 }, userEvent: 'input.type' });

            const dirty = { ...file, text: 'hello!', dirty: true };
            renderFilesSurface(container, stateFor([dirty], dirty), callbacks);

            expect(container.querySelector('.cm-content')).toBe(content);
            expect(content.contains(document.activeElement)).toBe(true);
            expect(view.state.selection.main.head).toBe(6);
            expect(buttonByText(container, 'Save')).toBeDefined();

            const reloaded = { ...dirty, text: 'hello! again' };
            renderFilesSurface(container, stateFor([reloaded], reloaded), callbacks);

            expect(view.state.doc.toString()).toBe('hello! again');
            expect(content.contains(document.activeElement)).toBe(true);
            expect(callbacks.onChange).toHaveBeenCalledTimes(1);
        });

        it('keeps focus in the editor through Format, Minify and Save', () => {
            const file = openFileFixture('keep/data.json', '{ "a" : [1, 2] }');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const content = focusedContent();

            for (const label of ['Format', 'Minify', 'Saved']) {
                const mousedown = press(buttonByText(container, label)!);

                expect(mousedown.defaultPrevented).toBe(true);
                expect(content.contains(document.activeElement)).toBe(true);
            }

            expect(editorView(container).state.doc.toString()).toBe('{"a":[1,2]}');
            expect(callbacks.onSave).toHaveBeenCalledWith('keep/data.json');
        });

        it('keeps keyboard focus on the same toolbar button when the toolbar is drawn again', () => {
            const file = openFileFixture('keep/key.txt', 'x', { dirty: true });
            renderFilesSurface(container, stateFor([file], file), callbacks);
            buttonByText(container, 'Save')?.focus();

            const saved = { ...file, dirty: false };
            renderFilesSurface(container, stateFor([saved], saved), callbacks);

            expect(document.activeElement).toBe(buttonByText(container, 'Saved'));
        });

        it('keeps the Schema box, with focus and caret, until the text changes, and moves on with the latest file', () => {
            setFilesSurfaceView('schema');
            const file = openFileFixture('keep/person.json', '{"age":"old"}', { dirty: true });
            renderFilesSurface(container, stateFor([file], file), callbacks);
            buttonByText(container, 'Validate')?.click();
            const box = container.querySelector<HTMLTextAreaElement>('.schema-input')!;
            const paste = (text: string): void => {
                const current = container.querySelector<HTMLTextAreaElement>('.schema-input')!;
                current.value = text;
                current.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
            };
            box.focus();
            paste('{"type":"object","properties":{"age":{"type":"number"}}}');
            box.setSelectionRange(3, 3);

            const saved = { ...file, dirty: false };
            renderFilesSurface(container, stateFor([saved], saved), callbacks);

            expect(container.querySelector('.schema-input')).toBe(box);
            expect(document.activeElement).toBe(box);
            expect(box.selectionStart).toBe(3);
            expect(container.querySelector('.path-query-status')?.textContent).toBe('1 error');

            const reloaded = { ...saved, text: '{"age":36}' };
            renderFilesSurface(container, stateFor([reloaded], reloaded), callbacks);

            expect(container.querySelectorAll('.schema-panel')).toHaveLength(1);
            expect(container.querySelector('.schema-input')).not.toBe(box);
            expect(container.querySelector('.path-query-status')?.textContent).toBe('OK — 4 keywords checked.');

            const wrong = { ...reloaded, text: '{"age":"old"}' };
            renderFilesSurface(container, stateFor([wrong], wrong), callbacks);
            container.querySelector<HTMLElement>('.path-card')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            expect(activeViewTab(container)).toBe('Tree');
            expect(buttonByText(container, 'Saved')).toBeDefined();

            buttonByText(container, 'Schema')?.click();
            paste('');
        });

        it('keeps a table until its file changes, then draws it into a fresh pane', () => {
            const file = openFileFixture('keep/rows.csv', 'id\n1\n');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            const promoted = { ...file, preview: false };
            renderFilesSurface(container, stateFor([promoted], promoted), callbacks);

            expect(renderTableViewerAsync).toHaveBeenCalledTimes(1);

            const changed = { ...promoted, text: 'id\n2\n' };
            renderFilesSurface(container, stateFor([changed], changed), callbacks);

            const [first, second] = vi.mocked(renderTableViewerAsync).mock.calls.map((call) => call[0]);
            expect(renderTableViewerAsync).toHaveBeenCalledTimes(2);
            expect(second).not.toBe(first);
            expect(first?.isConnected).toBe(false);
            expect(second?.isConnected).toBe(true);
            expect(vi.mocked(renderTableViewerAsync).mock.calls[1]?.[1].text).toBe('id\n2\n');
        });

        it('keeps a compare as it is while the same tab shows, and draws it again when the tab changes or comes back', () => {
            const diff = createDiffTab({ label: 'a', source: 'paste', text: 'a\n' }, { label: 'b', source: 'paste', text: 'b\n' }, 'text');
            const file = openFileFixture('keep/other.txt', 'x');
            renderFilesSurface(container, stateFor([diff, file], diff), callbacks);
            const pane = container.querySelector('.diff-tab-pane');

            renderFilesSurface(container, stateFor([diff, file], diff), callbacks);

            expect(container.querySelector('.diff-tab-pane')).toBe(pane);

            const changed = { ...diff, modified: { label: 'c', source: 'paste' as const, text: 'c\n' } };
            renderFilesSurface(container, stateFor([changed, file], changed), callbacks);
            const changedPane = container.querySelector('.diff-tab-pane');

            expect(changedPane).not.toBe(pane);

            renderFilesSurface(container, stateFor([changed, file], file), callbacks);
            renderFilesSurface(container, stateFor([changed, file], changed), callbacks);

            expect(container.querySelector('.diff-tab-pane')).not.toBeNull();
            expect(container.querySelector('.diff-tab-pane')).not.toBe(changedPane);
        });

        it('moves focus to the new editor when the view changes while the editor has it', () => {
            const file = openFileFixture('keep/switch.md', '# Title');
            renderFilesSurface(container, stateFor([file], file), callbacks);
            focusedContent();

            const mousedown = press(container.querySelector<HTMLElement>('.view-tab[data-view="interactive"]')!);

            expect(mousedown.defaultPrevented).toBe(true);
            expect(container.querySelector('.cm-content')?.contains(document.activeElement)).toBe(true);
            expect(container.querySelector('.cm-editor[data-live-preview="true"]')).not.toBeNull();
        });
    });

    describe('workspace files in previews', () => {
        const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        let root: FileSystemDirectoryHandle;

        beforeEach(() => {
            const folder = new FakeDirectoryHandle('workspace');
            folder.addFile('media/dot.png', PNG);
            folder.addFile('docs/page.css', 'p { color: red; }');
            root = asRoot(folder);
            let counter = 0;
            vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
                counter += 1;

                return `blob:surface/${counter}`;
            });
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('opens HTML files with Markdown\'s four views, the Preview the page in the sandbox page, scripts included', async () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture('docs/page.html', '<link rel="stylesheet" href="page.css"><p>Hi</p><script>window.ran = 1</script>');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();
            const sandbox = drawSandboxPage(container);

            expect(viewTabLabels(container)).toEqual(['Editor', 'Interactive', 'Split', 'Preview']);
            expect(container.querySelector<HTMLElement>('.view-tab[data-view="interactive"]')?.title).toBe('Edit the page as a document; the file stays HTML');
            expect(badges(container)).toEqual(['HTML']);
            expect(sandbox.frame.getAttribute('src')).toBe('sandbox.html');
            expect(sandbox.frame.getAttribute('sandbox')).toBe('allow-scripts allow-modals allow-forms');
            expect(sandbox.page()).toContain('p { color: red; }');
            expect(sandbox.page()).toContain('<script>window.ran = 1</script>');
            expect(buttonByText(container, 'Saved')).toBeDefined();

            container.querySelector<HTMLElement>('.view-tab[data-view="editor"]')?.click();

            expect(container.querySelector('iframe')).toBeNull();
            expect(editorView(container).state.doc.toString()).toContain('<p>Hi</p>');
        });

        it('draws a style sheet open in a tab with unsaved edits from that tab, and a saved one from disk', async () => {
            setFilesSurfaceView('preview');
            const page = openFileFixture('docs/page.html', '<link rel="stylesheet" href="page.css"><p>Hi</p>');
            const sheet = openFileFixture('docs/page.css', 'p { color: blue; }', { dirty: true });
            renderFilesSurface(container, stateFor([page, sheet], page, true, root), callbacks);
            await settleAsync();

            expect(drawSandboxPage(container).page()).toContain('p { color: blue; }');

            setFilesSurfaceView('preview');
            const saved = { ...sheet, dirty: false };
            const other = openFileFixture('docs/other.html', '<link rel="stylesheet" href="page.css"><p>Hi</p>');
            renderFilesSurface(container, stateFor([page, saved, other], other, true, root), callbacks);
            await settleAsync();

            expect(drawSandboxPage(container).page()).toContain('p { color: red; }');
        });

        it('edits HTML in the Interactive view, with its workspace images and the HTML formatting bar', async () => {
            setFilesSurfaceView('interactive');
            const file = openFileFixture('docs/page.html', '<p>Hi <img src="../media/dot.png" alt="Dot"></p>');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();

            expect(container.querySelector('.cm-editor[data-live-kind="html"]')).not.toBeNull();
            expect(container.querySelector('.cm-editor img.cm-live-image')?.getAttribute('src')).toBe('blob:surface/1');
            expect([...container.querySelectorAll('.editor-bar [data-command]')].map((button) => button.getAttribute('data-command'))).toEqual([
                'undo', 'redo', 'bold', 'italic', 'link', 'heading', 'bulletedList', 'numberedList',
            ]);
        });

        it('shows the HTML source beside its page in Split, and draws the page again once typing pauses', async () => {
            setFilesSurfaceView('split');
            const file = openFileFixture('docs/split.html', '<p>one</p>');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();
            const first = drawSandboxPage(container.querySelector('.split') ?? container);

            expect([...container.querySelectorAll('.split-pane-header')].map((header) => header.textContent)).toEqual(['Source', 'Preview']);
            expect(first.page()).toContain('one');

            // The page is drawn again on a timer once typing pauses, so the clock is moved on rather than waited for.
            vi.useFakeTimers();
            editorView(container).dispatch({ changes: { from: 3, to: 6, insert: 'two' } });
            await flushAsync();

            expect(callbacks.onChange).toHaveBeenCalledWith('docs/split.html', '<p>two</p>');
            expect(container.querySelectorAll('.split iframe.html-preview-frame')).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
            await flushAsync();
            const second = drawSandboxPage(container);

            expect(second.frame).not.toBe(first.frame);
            expect(second.page()).toContain('two');
            expect([...container.querySelectorAll('.split iframe.html-preview-frame')]).toEqual([second.frame]);
        });

        it('keeps the HTML preview while the text stays, and draws it again as the text changes', async () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture('docs/live.html', '<p>one</p>');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();
            const host = container.querySelector('.html-preview-host');
            const first = drawSandboxPage(container);
            expect(first.page()).toContain('one');

            vi.useFakeTimers();
            const edited = { ...file, text: '<p>two</p>' };
            renderFilesSurface(container, stateFor([edited], edited, true, root), callbacks);
            await flushAsync();

            expect(container.querySelector('.html-preview-host')).toBe(host);
            expect([...container.querySelectorAll('iframe')]).toEqual([first.frame]);

            await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
            await flushAsync();
            const second = drawSandboxPage(container);

            expect(container.querySelector('.html-preview-host')).toBe(host);
            expect(second.page()).toContain('two');
            expect([...container.querySelectorAll('iframe')]).toEqual([second.frame]);
        });

        it('shows workspace images in the Markdown preview and hands workspace links to the app', async () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture('docs/links.md', '![Dot](../media/dot.png)\n\n[Guide](guide.md#setup)');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();

            expect(container.querySelector('.markdown-preview img')?.getAttribute('src')).toBe('blob:surface/1');

            container.querySelector<HTMLElement>('.markdown-preview a')?.click();

            expect(callbacks.onOpenLink).toHaveBeenCalledWith({ path: 'docs/guide.md', fragment: 'setup' });
        });

        it('keeps the Markdown preview across renders that don\'t change the text', async () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture('docs/kept.md', '![Dot](../media/dot.png)');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();
            const image = container.querySelector('.markdown-preview img');

            renderFilesSurface(container, stateFor([{ ...file, dirty: false }], file, true, root), callbacks);
            await settleAsync();

            expect(container.querySelector('.markdown-preview img')).toBe(image);
            expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        });

        it('draws the Markdown preview\'s images again when their files change on disk', async () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture('docs/refresh.md', '![Dot](../media/dot.png)');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();

            notifyFilesSurfaceOfChanges(['media/dot.png']);
            await settleAsync();

            expect(container.querySelector('.markdown-preview img')?.getAttribute('src')).toBe('blob:surface/2');
        });

        it('scrolls the preview to a heading asked for before or after it shows', async () => {
            const scrolled: string[] = [];
            vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
                scrolled.push(this.id);
            });
            setFilesSurfaceView('preview');
            const file = openFileFixture('docs/target.md', '# Top\n\n## Set up\n\n## Use');
            revealInFilesSurface('docs/target.md', 'set-up');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();

            revealInFilesSurface('docs/target.md', 'use');
            await settleAsync();

            expect(scrolled).toEqual(['set-up', 'use']);
        });

        it('shows the Interactive view\'s workspace images', async () => {
            setFilesSurfaceView('interactive');
            const file = openFileFixture('docs/live.md', 'Text ![Dot](../media/dot.png)');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();

            expect(container.querySelector('.cm-editor img.cm-live-image')?.getAttribute('src')).toBe('blob:surface/1');
        });

        it('shows placeholders for the relative images of a file from outside the workspace', async () => {
            setFilesSurfaceView('preview');
            const file = openFileFixture(externalTabPath(1, 'notes.md'), '![Dot](../media/dot.png)');
            renderFilesSurface(container, stateFor([file], file, true, root), callbacks);
            await settleAsync();

            expect(container.querySelector('.markdown-preview .md-image-blocked')?.textContent).toBe('Image not shown (file outside the workspace): ../media/dot.png');
        });
    });
});
