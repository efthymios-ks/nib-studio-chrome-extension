import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { notValidMessage } from '../../common/errorMessage.js';
import { basename } from '../../common/fs/fileEntry.js';
import { resolveFileType, type FileTypeId } from '../../common/fs/fileTypes.js';
import type { WorkspaceResources } from '../../common/fs/workspaceResources.js';
import { parseXml } from '../../common/paths/xmlParser.js';
import { convertXmlToJson } from '../../common/xml/xmlToJson.js';
import { YAML_DATA_FORMAT } from '../../common/yaml/yamlToJson.js';
import { clear, h } from '../app/dom.js';
import { detectMode, mountEditor, type EditorHostHandle, type EditorMode } from '../editor/editorHost.js';
import { LIVE_PREVIEW_MAX_LENGTH } from '../editor/markdownLivePreview.js';
import { renderTabBar } from '../editor/tabBar.js';
import { toast } from '../app/toast.js';
import { createDocumentResources } from './documentImages.js';
import { emptyState } from './emptyState.js';
import { renderJsonPathPanel } from './jsonPathPanel.js';
import {
    createJsonSchemaPanelState,
    renderJsonSchemaPanel,
    startJsonSchemaPanelWith,
    type JsonSchemaPanelState,
} from './jsonSchemaPanel.js';
import { renderJsonTreeView } from './jsonTreeView.js';
import { createPathResultsState, type PathResultsState } from './pathResults.js';
import { renderMarkdownSplit, disposeActiveMarkdownSplitEditor, type MarkdownSplitCallbacks } from './markdownSplit.js';
import { mountMarkdownPreview } from './markdownPreview.js';
import { mountHtmlPreview } from './htmlPreview.js';
import { renderHtmlSplit } from './htmlSplit.js';
import type { WorkspaceLinkTarget } from './workspaceLinks.js';
import { renderXmlTreeView } from './xmlTreeView.js';
import { renderXPathPanel } from './xPathPanel.js';
import { renderTableViewerAsync } from './tableViewer.js';
import { mountPreview } from './previewPane.js';
import type { OpenPdf } from './pdfSavePagesDialog.js';
import { isPreviewKind, pickViewer, type PreviewKind } from './viewerKinds.js';
import { applyJsonTransform } from './jsonActions.js';
import { applyYamlFormat, applyYamlToJson } from './yamlActions.js';
import { renderYamlTreeView } from './yamlTreeView.js';
import { exportMarkdownToHtmlAsync, exportMarkdownToPdfAsync } from './markdownActions.js';
import { disposeDiffSideEditor, renderDiffTabView, type DiffTabCallbacks } from './diffTabView.js';
import { isDiffTab, isExternalPath, type DiffTab, type OpenFile, type OpenTab } from '../app/store.js';

export interface FilesSurfaceCallbacks {
    readonly onActivate: (path: string) => void;
    readonly onClose: (path: string) => void;
    readonly onChange: (path: string, text: string) => void;
    readonly onSave: (path: string) => void;
    readonly onPickWorkspace: () => void;
    readonly onReopenWorkspace: () => void;
    readonly onTabContextMenu?: (event: MouseEvent, path: string) => void;
    readonly onPromoteTab?: (path: string) => void;
    // Asks for the other side, anchored to the "Compare with…" button, and opens a diff tab.
    readonly onCompareWith?: (path: string, anchor: HTMLElement) => void;
    // Asks for the kind of an empty compare and opens it; the event places the kind menu.
    readonly onNewCompare?: (event: MouseEvent) => void;
    // Save pages… in a PDF preview's toolbar, with the document the preview has open.
    readonly onSavePdfPages?: (path: string, open: OpenPdf) => void;
    // A click on a link to a workspace file or folder in a Markdown or HTML preview.
    readonly onOpenLink?: (target: WorkspaceLinkTarget) => void;
    // Convert to YAML in a JSON file's toolbar, with the editor's text: opens the YAML in a tab of its own.
    readonly onConvertJsonToYaml?: (path: string, text: string) => void;
    readonly diffTab: DiffTabCallbacks;
}

export interface FilesSurfaceState {
    readonly workspaceOpen: boolean;
    // Every tab, file and diff, in display order.
    readonly tabs: ReadonlyArray<OpenTab>;
    readonly activeId: string | null;
    readonly activeFile: OpenFile | null;
    readonly activeDiff: DiffTab | null;
    // The workspace folder previews read images and style sheets from.
    readonly workspaceRoot?: FileSystemDirectoryHandle | null;
}

// The tab bar and the editor shell, kept across renders so an unchanged editor stays mounted.
interface SurfaceFrame {
    readonly tabBar: HTMLElement;
    readonly editorShell: HTMLElement;
}

// What a kept view does as the file changes: `sync` brings it to text or a file snapshot changed elsewhere,
// `refresh` draws again what it shows from workspace files changed on disk, `reveal` scrolls to a heading or anchor,
// and `dispose` lets it go.
interface PaneLifecycle {
    readonly sync: (file: OpenFile) => void;
    readonly refresh?: (changedPaths: ReadonlyArray<string>) => void;
    readonly reveal?: (fragment: string) => void;
    readonly dispose?: () => void;
}

// The view a render keeps as it is while the file, view and mode stay the same: an editor keeps focus, caret and scroll,
// a preview keeps its zoom without loading again, and a box in a view such as Schema or a table keeps focus and caret.
interface MountedPane extends PaneLifecycle {
    readonly key: string;
    readonly shell: HTMLElement;
    readonly path: string;
}

// The diff tab last drawn into the editor shell, kept on screen while the store holds that same tab.
interface ShownDiff {
    readonly tab: DiffTab;
    readonly shell: HTMLElement;
}

interface FilesSurfaceContext {
    editorHandle: EditorHostHandle | null;
    activePath: string | null;
    view: string;
    jsonPath: string;
    // The Schema view's mode, pasted schema and its undo history, for each open file by path.
    readonly schemaPanels: Map<string, JsonSchemaPanelState>;
    // The schema last put in any file's Schema view, which a file with no schema yet starts with.
    lastSchema: string;
    xPath: string;
    // A JSONPath the next JSON tree render opens, selects and flashes.
    revealJsonPath: string | null;
    // An XPath the next XML tree render opens, selects and flashes.
    revealXPath: string | null;
    // The JSONPath and XPath views' value layout and help, shared by both.
    pathResults: PathResultsState;
    frame: SurfaceFrame | null;
    mountedPane: MountedPane | null;
    shownDiff: ShownDiff | null;
    // The latest render's callbacks, which a mounted editor reports to.
    callbacks: FilesSurfaceCallbacks | null;
    workspaceRoot: FileSystemDirectoryHandle | null;
    // The text of every workspace file tab with unsaved edits, by path, which the HTML preview draws style sheets from.
    unsavedTexts: ReadonlyMap<string, string>;
    // A heading or anchor to scroll to once the file's preview shows.
    pendingReveal: { readonly path: string; readonly fragment: string } | null;
    // A selection to make once the file's editor shows, such as the match Lookup opened the file at.
    pendingSelection: PendingSelection | null;
}

// Finds what to select in the text the editor holds; null leaves the caret where it was.
export type SelectionFinder = (text: string) => { readonly from: number; readonly to: number } | null;

interface PendingSelection {
    readonly path: string;
    readonly find: SelectionFinder;
}

const VIEW_LABELS: Readonly<Record<string, string>> = Object.freeze({
    'editor': 'Editor',
    'interactive': 'Interactive',
    'tree': 'Tree',
    'split': 'Split',
    'preview': 'Preview',
    'jsonpath': 'JSONPath',
    'xpath': 'XPath',
    'schema': 'Schema',
    'as-json': 'As JSON',
    'table': 'Table',
});

// Tooltips of the view tabs that need one, by view and then by editor mode.
const VIEW_TITLES: Readonly<Record<string, Readonly<Partial<Record<EditorMode, string>>>>> = Object.freeze({
    interactive: Object.freeze({
        markdown: 'Edit with the formatting shown; the file stays Markdown',
        html: 'Edit the page as a document; the file stays HTML',
    }),
});

// The modes with an Interactive view.
const LIVE_MODES: ReadonlySet<EditorMode> = new Set(['markdown', 'html']);

// Views that show an editor, and so the docked editor bar.
const EDITOR_VIEWS = new Set(['editor', 'interactive', 'split']);

const context: FilesSurfaceContext = {
    editorHandle: null,
    activePath: null,
    view: 'editor',
    jsonPath: '$',
    schemaPanels: new Map(),
    lastSchema: '',
    xPath: '/*',
    revealJsonPath: null,
    revealXPath: null,
    pathResults: createPathResultsState(),
    frame: null,
    mountedPane: null,
    shownDiff: null,
    callbacks: null,
    workspaceRoot: null,
    unsavedTexts: new Map(),
    pendingReveal: null,
    pendingSelection: null,
};

// Reports to the latest render's callbacks, so a kept editor never reaches stale ones.
const currentCallbacks: MarkdownSplitCallbacks = {
    onChange: (path, text) => context.callbacks?.onChange(path, text),
    onSave: (path) => context.callbacks?.onSave(path),
};

// Remembers where the caret / scroll were per file, so switching away from
// Editor and back doesn't jump to the top. Keyed by file path.
const editorStateByPath = new Map<string, { head: number; scrollTop: number; textLength: number }>();

// Lets the shell force the editor onto a specific view, such as Editor for a freshly converted file.
// The caller still has to re-render the surface.
export function setFilesSurfaceView(view: string): void {
    context.view = view;
}

// A view that shows the file converted, such as As JSON for XML, has its Save button turned off.
export function isDerivedFilesSurfaceView(): boolean {
    return context.view === 'as-json';
}

// Scrolls the file's preview to a heading or anchor: now when it shows, or as soon as it does.
export function revealInFilesSurface(path: string, fragment: string): void {
    context.pendingReveal = { path, fragment };
    revealPending(path);
}

// Selects a part of the file's text in its editor, scrolled into view and with the editor focused:
// now when the editor shows it, or as soon as it does.
export function selectInFilesSurface(path: string, find: SelectionFinder): void {
    context.pendingSelection = { path, find };
    selectPending();
}

// Gives the keyboard to the file on screen: its editor, or its preview.
export function focusFilesSurface(): void {
    if (context.editorHandle != null) {
        context.editorHandle.view.focus();

        return;
    }

    document.querySelector<HTMLElement>('.editor-shell .preview-viewport')?.focus({ preventScroll: true });
}

function selectPending(): void {
    const pending = context.pendingSelection;
    const handle = context.editorHandle;

    if (pending == null || handle == null || context.activePath !== pending.path) {
        return;
    }

    context.pendingSelection = null;
    const view = handle.view;
    const range = pending.find(handle.getValue());

    if (range != null) {
        const length = view.state.doc.length;
        const selection = EditorSelection.single(Math.min(range.from, length), Math.min(range.to, length));
        const scrollToMatch = (): void => {
            view.dispatch({ effects: EditorView.scrollIntoView(selection.main, { y: 'center' }) });
        };
        view.dispatch({ selection });
        scrollToMatch();
        // A mounting editor puts back its remembered scroll in the next frame, so the match is scrolled to again after it.
        requestAnimationFrame(scrollToMatch);
    }

    view.focus();
}

// A renamed or moved file keeps what its views held, such as the schema pasted into its Schema view.
export function renameFilesSurfaceMemory(fromPath: string, toPath: string): void {
    const schemaPanel = context.schemaPanels.get(fromPath);

    if (schemaPanel != null) {
        context.schemaPanels.delete(fromPath);
        context.schemaPanels.set(toPath, schemaPanel);
    }
}

// Workspace files changed on disk; a preview that shows one of them, such as an image or a style sheet, draws again.
export function notifyFilesSurfaceOfChanges(changedPaths: ReadonlyArray<string>): void {
    context.mountedPane?.refresh?.(changedPaths);
}

export function renderFilesSurface(
    container: HTMLElement,
    state: FilesSurfaceState,
    callbacks: FilesSurfaceCallbacks,
): void {
    context.callbacks = callbacks;
    context.unsavedTexts = unsavedTextsOf(state.tabs);
    forgetClosedSchemaPanels(state.tabs);

    // Previews read from the workspace they were drawn for, so a new workspace draws them again.
    if ((state.workspaceRoot ?? null) !== context.workspaceRoot) {
        context.workspaceRoot = state.workspaceRoot ?? null;
        dropMountedPane();
    }

    // Compares need no folder, so they stay on screen while no workspace is open.
    if (!state.workspaceOpen && state.tabs.length === 0) {
        destroyEditor();
        disposeActiveMarkdownSplitEditor();
        disposeDiffSideEditor();
        context.frame = null;
        dropMountedPane();
        clear(container);
        container.append(buildWorkspacePicker(callbacks));

        return;
    }

    const { tabBar, editorShell } = surfaceFrame(container);

    renderTabBar(tabBar, state.tabs, state.activeId, {
        onActivate: callbacks.onActivate,
        onClose: callbacks.onClose,
        onContextMenu: callbacks.onTabContextMenu,
        onPromote: callbacks.onPromoteTab,
        onNewCompare: callbacks.onNewCompare,
    });

    if (state.activeDiff != null) {
        renderActiveDiff(editorShell, state.activeDiff, callbacks.diffTab);
    }
    else {
        context.shownDiff = null;
        disposeDiffSideEditor();
        renderEditorShell(editorShell, state.activeFile, callbacks);
    }
}

// A diff tab stays on screen as it is while the store holds the same tab, so its side editor keeps focus and caret;
// a change the tab makes in itself draws it again from within.
function renderActiveDiff(shell: HTMLElement, tab: DiffTab, callbacks: DiffTabCallbacks): void {
    const shown = context.shownDiff;
    const pane = shell.querySelector<HTMLElement>(':scope > .diff-tab-pane');

    if (
        shown != null
        && shown.tab === tab
        && shown.shell === shell
        && pane?.dataset['tabId'] === tab.id
    ) {
        return;
    }

    destroyEditor();
    disposeActiveMarkdownSplitEditor();
    dropMountedPane();
    clear(shell);
    renderDiffTabView(shell, tab, callbacks);
    context.shownDiff = { tab, shell };
}

// Reuses the tab bar and editor shell of the last render into this container, or builds them.
function surfaceFrame(container: HTMLElement): SurfaceFrame {
    const frame = context.frame;

    if (
        frame != null
        && frame.tabBar.parentElement === container
        && frame.editorShell.parentElement === container
        && container.childElementCount === 2
    ) {
        return frame;
    }

    dropMountedPane();
    clear(container);
    const tabBar = h('div', { class: 'tab-bar' });
    const editorShell = h('div', { class: 'editor-shell' });
    container.append(tabBar, editorShell);
    context.frame = { tabBar, editorShell };

    return context.frame;
}

// Lets go of the kept view, so a preview stops its media and frees its blob URLs.
function dropMountedPane(): void {
    const mounted = context.mountedPane;
    context.mountedPane = null;
    mounted?.dispose?.();
}

function buildWorkspacePicker(callbacks: FilesSurfaceCallbacks): HTMLElement {
    return h('div', {
        class: 'pick-workspace-screen',
        children: [
            h('div', {
                class: 'pick-workspace-card',
                children: [
                    h('img', { class: 'app-brand-mark app-brand-mark-large', attrs: { src: '../icons/icon-128.png', alt: '' } }),
                    h('h1', { text: 'Pick a workspace folder' }),
                    h('p', {
                        text: 'Nib Studio needs a local folder to work from. Everything stays on disk — no network, no uploads.',
                    }),
                    h('button', {
                        class: 'button button-primary',
                        text: 'Choose folder',
                        attrs: { type: 'button' },
                        on: { click: () => callbacks.onPickWorkspace() },
                    }),
                    h('button', {
                        class: 'button',
                        text: 'Re-open last workspace',
                        attrs: { type: 'button' },
                        on: { click: () => callbacks.onReopenWorkspace() },
                    }),
                    callbacks.onNewCompare == null
                        ? null
                        : h('button', {
                            class: 'button',
                            text: 'Start a compare',
                            dataset: { action: 'new-compare' },
                            attrs: { type: 'button', title: 'Paste or pick two texts and compare them, no folder needed' },
                            on: { click: (event) => callbacks.onNewCompare?.(event as MouseEvent) },
                        }),
                ],
            }),
        ],
    });
}

function renderEditorShell(container: HTMLElement, file: OpenFile | null, callbacks: FilesSurfaceCallbacks): void {
    if (file == null) {
        destroyEditor();
        disposeActiveMarkdownSplitEditor();
        dropMountedPane();
        clear(container);
        container.append(emptyState({
            title: 'No file open',
            message: 'Pick one from the Explorer, or right-click the tree to create a new file.',
        }));

        return;
    }

    const fileName = basename(file.path);
    // A file of an unknown type whose bytes aren't text opens as a message, which only its bytes could tell.
    const viewerKind = file.binary === true ? 'binary' : pickViewer(fileName);

    if (isPreviewKind(viewerKind)) {
        renderPreviewPane(container, file, viewerKind);

        return;
    }

    const mode = detectMode(fileName);
    const typeId = resolveFileType(fileName).id;
    const views = viewOptionsFor(mode, fileName);
    context.view = views.includes(context.view) ? context.view : views[0] ?? 'editor';

    const toolbar = buildToolbar(file, callbacks, mode, typeId, views);
    const key = [file.path, context.view, mode, viewerKind].join('\u0000');
    const mounted = context.mountedPane;

    // Edits, saves and other store changes keep the editor mounted, with its focus, caret and scroll.
    if (mounted != null && mounted.key === key && mounted.shell === container) {
        replaceToolbar(container, toolbar);
        mounted.sync(file);
        revealPending(file.path);
        selectPending();

        return;
    }

    const pane = h('div', { class: 'editor-pane' });
    dropMountedPane();
    clear(container);
    container.append(toolbar, pane);
    const lifecycle = renderActiveView(pane, file, callbacks, { mode, typeId, viewerKind });
    context.mountedPane = { key, shell: container, path: file.path, ...lifecycle };
    revealPending(file.path);
    selectPending();
}

function revealPending(path: string): void {
    const pending = context.pendingReveal;
    const mounted = context.mountedPane;
    const reveal = mounted?.path === path ? mounted.reveal : undefined;

    if (pending == null || pending.path !== path || reveal == null) {
        return;
    }

    context.pendingReveal = null;
    reveal(pending.fragment);
}

// Word documents, PDFs, images, audio, video, fonts, archives, presentations and files that aren't text open in the
// preview frame, which brings its own toolbar with the View only badge. The preview stays mounted through unrelated re-renders and only reloads
// for a new snapshot of the file.
function renderPreviewPane(container: HTMLElement, file: OpenFile, kind: PreviewKind): void {
    const key = ['preview', file.path, kind].join('\u0000');
    const mounted = context.mountedPane;

    if (mounted != null && mounted.key === key && mounted.shell === container) {
        mounted.sync(file);

        return;
    }

    destroyEditor();
    disposeActiveMarkdownSplitEditor();
    dropMountedPane();
    clear(container);
    const pane = h('div', { class: 'editor-pane preview-pane' });
    container.append(pane);
    const path = file.path;
    const handle = mountPreview(pane, {
        kind,
        file: file.file,
        fileName: basename(path),
        memoryKey: path,
        // The kept preview reports to the latest render's callbacks.
        onSavePdfPages: kind !== 'pdf' || context.callbacks?.onSavePdfPages == null
            ? undefined
            : (open) => context.callbacks?.onSavePdfPages?.(path, open),
    });
    context.mountedPane = {
        key,
        shell: container,
        path,
        sync: (next) => handle.update(next.file),
        dispose: () => handle.destroy(),
    };
}

// Swaps in the new toolbar, keeping keyboard focus on the same control.
function replaceToolbar(shell: HTMLElement, toolbar: HTMLElement): void {
    const previous = shell.querySelector<HTMLElement>(':scope > .editor-toolbar');

    if (previous == null) {
        shell.prepend(toolbar);

        return;
    }

    const focused = document.activeElement instanceof HTMLElement && previous.contains(document.activeElement)
        ? document.activeElement
        : null;
    previous.replaceWith(toolbar);

    if (focused == null) {
        return;
    }

    const selector = ['view', 'action']
        .map((name) => focused.dataset[name] == null ? null : `[data-${name}="${focused.dataset[name]}"]`)
        .find((candidate) => candidate != null);

    if (selector != null) {
        toolbar.querySelector<HTMLElement>(selector)?.focus();
    }
}

function buildToolbar(
    file: OpenFile,
    callbacks: FilesSurfaceCallbacks,
    mode: EditorMode,
    typeId: FileTypeId,
    views: ReadonlyArray<string>,
): HTMLElement {
    const isTableFile = typeId === 'csv' || typeId === 'excel';
    const viewButtons = views.map((view) => h('button', {
        class: 'view-tab',
        text: labelForView(view),
        dataset: view === context.view ? { view, active: 'true' } : { view },
        attrs: { type: 'button', title: VIEW_TITLES[view]?.[mode] ?? null },
        on: {
            mousedown: keepEditorFocus,
            click: () => showView(view, file, callbacks),
        },
    }));

    const actionGroup: HTMLElement[] = [];

    if (callbacks.onCompareWith != null) {
        const compareButton = h('button', {
            class: 'button',
            dataset: { action: 'compare-with' },
            text: 'Compare with…',
            attrs: { type: 'button', title: 'Open a diff tab comparing this file with another file, a tab, the clipboard or pasted text' },
        });
        compareButton.addEventListener('click', () => callbacks.onCompareWith?.(file.path, compareButton));
        actionGroup.push(compareButton);
    }

    // The editor's own buttons, such as Format, change its text as typing does.
    const editorCallbacks = { onChange: (path: string, text: string) => replaceFileText(path, text, callbacks) };

    if (!isTableFile && mode === 'json' && context.view === 'editor') {
        actionGroup.push(h('button', {
            class: 'button',
            text: 'Format',
            dataset: { action: 'format' },
            attrs: { type: 'button', title: 'Reformat JSON with 2-space indent' },
            on: {
                mousedown: keepEditorFocus,
                click: () => applyJsonTransform(withEditorText(file), editorCallbacks, 'format'),
            },
        }));

        actionGroup.push(h('button', {
            class: 'button',
            text: 'Minify',
            dataset: { action: 'minify' },
            attrs: { type: 'button', title: 'Strip whitespace from JSON' },
            on: {
                mousedown: keepEditorFocus,
                click: () => applyJsonTransform(withEditorText(file), editorCallbacks, 'minify'),
            },
        }));
    }

    // The YAML tab saves next to the JSON, which a file from outside the workspace doesn't have.
    if (
        mode === 'json'
        && context.view === 'editor'
        && callbacks.onConvertJsonToYaml != null
        && !isExternalPath(file.path)
    ) {
        actionGroup.push(h('button', {
            class: 'button',
            text: 'Convert to YAML',
            dataset: { action: 'convert-to-yaml' },
            attrs: { type: 'button', title: 'Open this JSON document as YAML in a new tab' },
            on: {
                mousedown: keepEditorFocus,
                click: () => callbacks.onConvertJsonToYaml?.(file.path, withEditorText(file).text),
            },
        }));
    }

    if (mode === 'yaml' && context.view === 'editor') {
        actionGroup.push(h('button', {
            class: 'button',
            text: 'Format',
            dataset: { action: 'format' },
            attrs: { type: 'button', title: 'Reformat YAML with 2-space indent, keeping comments' },
            on: {
                mousedown: keepEditorFocus,
                click: () => applyYamlFormat(withEditorText(file), editorCallbacks),
            },
        }));

        actionGroup.push(h('button', {
            class: 'button',
            text: 'Convert to JSON',
            dataset: { action: 'convert-to-json' },
            attrs: { type: 'button', title: 'Convert this YAML document to JSON' },
            on: {
                mousedown: keepEditorFocus,
                click: () => applyYamlToJson(withEditorText(file), editorCallbacks),
            },
        }));
    }

    if (mode === 'xml' && context.view === 'editor') {
        actionGroup.push(h('button', {
            class: 'button',
            text: 'Convert to JSON',
            dataset: { action: 'convert-to-json' },
            attrs: { type: 'button', title: 'Convert this XML document to JSON' },
            on: {
                mousedown: keepEditorFocus,
                click: () => applyXmlToJson(withEditorText(file), callbacks),
            },
        }));
    }

    if (mode === 'markdown') {
        actionGroup.push(h('button', {
            class: 'button',
            text: 'Export HTML',
            dataset: { action: 'export-html' },
            attrs: { type: 'button' },
            on: {
                mousedown: keepEditorFocus,
                click: () => {
                    void exportMarkdownToHtmlAsync(file, context.workspaceRoot);
                },
            },
        }));

        actionGroup.push(h('button', {
            class: 'button',
            text: 'Export PDF',
            dataset: { action: 'export-pdf' },
            attrs: { type: 'button' },
            on: {
                mousedown: keepEditorFocus,
                click: () => {
                    void exportMarkdownToPdfAsync(file, context.workspaceRoot);
                },
            },
        }));
    }

    const isDerivedView = isDerivedFilesSurfaceView() || isTableFile;

    if (!isTableFile) {
        const saveButton = h('button', {
            class: 'button button-primary',
            text: file.dirty ? 'Save' : 'Saved',
            dataset: { action: 'save' },
            attrs: { type: 'button', title: 'Save (Ctrl+S)' },
            on: {
                mousedown: keepEditorFocus,
                click: () => callbacks.onSave(file.path),
            },
        });

        if (isDerivedView) {
            saveButton.setAttribute('disabled', '');
        }

        actionGroup.push(saveButton);
    }
    else {
        if (file.large === true) {
            actionGroup.push(h('span', {
                class: 'badge',
                dataset: { tone: 'warn' },
                text: 'Large file',
                attrs: { title: 'File is too large to edit here — showing as a table. Rows are read from disk as you scroll.' },
            }));
        }

        actionGroup.push(h('span', { class: 'badge', text: 'View only' }));
    }

    return h('div', {
        class: 'editor-toolbar',
        children: [
            h('div', { class: 'view-tabs', attrs: { role: 'tablist' }, children: viewButtons }),
            h('div', {
                class: 'toolbar-group',
                children: [h('span', { class: 'badge', text: modeBadge(mode, typeId) })],
            }),
            h('span', { class: 'toolbar-spacer' }),
            h('div', {
                class: 'toolbar-group',
                children: actionGroup,
            }),
        ],
    });
}

// A pressed toolbar button doesn't take focus, so the editor keeps it.
function keepEditorFocus(event: Event): void {
    event.preventDefault();
}

function showView(view: string, file: OpenFile, callbacks: FilesSurfaceCallbacks): void {
    const editorHadFocus = context.editorHandle?.view.hasFocus === true || activeSplitEditorHasFocus();
    context.view = view;
    const shell = document.querySelector<HTMLElement>('.editor-shell');

    if (shell == null) {
        return;
    }

    renderEditorShell(shell, file, callbacks);

    if (editorHadFocus) {
        shell.querySelector<HTMLElement>('.cm-content')?.focus();
    }
}

function activeSplitEditorHasFocus(): boolean {
    return document.activeElement?.closest('.split .cm-editor') != null;
}

// The file with the text the editor holds right now, when its editor is mounted.
function withEditorText(file: OpenFile): OpenFile {
    if (context.editorHandle == null || context.activePath !== file.path) {
        return file;
    }

    return { ...file, text: context.editorHandle.getValue() };
}

// Goes through the editor when it is mounted, so the change is one undo step and the editor keeps focus.
function replaceFileText(path: string, text: string, callbacks: FilesSurfaceCallbacks): void {
    if (context.editorHandle != null && context.activePath === path) {
        context.editorHandle.setValue(text);

        return;
    }

    callbacks.onChange(path, text);
}

function applyXmlToJson(file: OpenFile, callbacks: FilesSurfaceCallbacks): void {
    const parsed = parseXml(file.text);

    if (!parsed.ok) {
        toast(notValidMessage('XML', parsed), 'fail');

        return;
    }

    const converted = convertXmlToJson(parsed.root);
    const text = JSON.stringify(converted, null, 2);
    replaceFileText(file.path, text, callbacks);
}

interface ViewKinds {
    readonly mode: EditorMode;
    readonly typeId: FileTypeId;
    readonly viewerKind: ReturnType<typeof pickViewer>;
}

// Renders the active view; returns how to keep it up to date.
function renderActiveView(
    pane: HTMLElement,
    file: OpenFile,
    callbacks: FilesSurfaceCallbacks,
    kinds: ViewKinds,
): PaneLifecycle {
    const { mode, typeId, viewerKind } = kinds;
    const isEditorView = viewerKind !== 'table' && (EDITOR_VIEWS.has(context.view) || !hasOwnView(mode, typeId, context.view));

    if (!isEditorView || context.view !== 'split') {
        disposeActiveMarkdownSplitEditor();
    }

    if (!isEditorView) {
        destroyEditor();

        return renderNonEditorView(pane, file, callbacks, kinds);
    }

    if (mode === 'html' && context.view === 'split') {
        destroyEditor();

        return renderHtmlSplit(pane, file, currentCallbacks, {
            documentPath: workspacePathOf(file),
            root: context.workspaceRoot,
            unsavedText,
            onOpenLink: openLink,
            onSave: () => context.callbacks?.onSave(file.path),
        });
    }

    if (mode === 'markdown' && context.view === 'split') {
        destroyEditor();

        return renderMarkdownSplit(pane, file, currentCallbacks, {
            documentPath: workspacePathOf(file),
            root: context.workspaceRoot,
            onOpenLink: openLink,
        });
    }

    const resources = LIVE_MODES.has(mode) && context.view === 'interactive' ? resourcesFor(file) : null;
    mountEditorInto(pane, file, mode, resources);

    return {
        sync: (next) => {
            context.editorHandle?.syncText(next.text);
        },
        dispose: () => resources?.dispose(),
    };
}

function forgetClosedSchemaPanels(tabs: ReadonlyArray<OpenTab>): void {
    const openPaths = new Set(tabs.filter((tab) => !isDiffTab(tab)).map((tab) => (tab as OpenFile).path));

    for (const path of context.schemaPanels.keys()) {
        if (!openPaths.has(path)) {
            context.schemaPanels.delete(path);
        }
    }
}

// The Schema view's state of a file, made the first time the view shows for it.
// While the file has no schema of its own, the view starts with the last schema used in any file.
function schemaPanelOf(path: string): JsonSchemaPanelState {
    const state = context.schemaPanels.get(path) ?? createJsonSchemaPanelState();
    context.schemaPanels.set(path, state);
    startJsonSchemaPanelWith(state, context.lastSchema);

    return state;
}

function unsavedTextsOf(tabs: ReadonlyArray<OpenTab>): ReadonlyMap<string, string> {
    const texts = new Map<string, string>();

    for (const tab of tabs) {
        if (!isDiffTab(tab) && tab.dirty && !isExternalPath(tab.path)) {
            texts.set(tab.path, tab.text);
        }
    }

    return texts;
}

// Reads the latest render's tabs, so a kept preview draws from the edits made since it was mounted.
function unsavedText(path: string): string | null {
    return context.unsavedTexts.get(path) ?? null;
}

// The file's path in the workspace; null for a file from outside it, whose relative paths lead nowhere.
function workspacePathOf(file: OpenFile): string | null {
    return isExternalPath(file.path) ? null : file.path;
}

function resourcesFor(file: OpenFile): WorkspaceResources | null {
    return context.workspaceRoot == null || workspacePathOf(file) == null ? null : createDocumentResources(context.workspaceRoot);
}

// Reaches the latest render's callbacks, so a kept preview never calls stale ones.
function openLink(target: WorkspaceLinkTarget): void {
    context.callbacks?.onOpenLink?.(target);
}

// Whether the view is one this mode or file type draws without an editor.
function hasOwnView(mode: EditorMode, typeId: FileTypeId, view: string): boolean {
    return NON_EDITOR_VIEWS.some((entry) => entry.view === view
        && (entry.mode == null || entry.mode === mode)
        && (entry.typeId == null || entry.typeId === typeId));
}

const NON_EDITOR_VIEWS: ReadonlyArray<{ readonly view: string; readonly mode?: EditorMode; readonly typeId?: FileTypeId }> = [
    { view: 'jsonpath' },
    { view: 'schema' },
    { view: 'tree', mode: 'json' },
    { view: 'tree', mode: 'yaml' },
    { view: 'tree', mode: 'xml' },
    { view: 'preview', mode: 'markdown' },
    { view: 'preview', typeId: 'html' },
    { view: 'xpath', mode: 'xml' },
    { view: 'as-json', mode: 'xml' },
];

function renderNonEditorView(
    pane: HTMLElement,
    file: OpenFile,
    callbacks: FilesSurfaceCallbacks,
    kinds: ViewKinds,
): PaneLifecycle {
    const { mode, typeId } = kinds;

    if (typeId === 'html' && context.view === 'preview') {
        return mountHtmlPreviewView(pane, file);
    }

    if (mode === 'markdown' && context.view === 'preview') {
        return mountMarkdownPreviewView(pane, file);
    }

    return mountContentView(pane, file, callbacks, kinds);
}

// A view drawn from the file's content alone: JSONPath, Schema, XPath, a tree, As JSON or a table.
// It stays as it is through renders that leave the content the same, so a box in it keeps focus and caret,
// and is drawn again once the content changes, into a fresh pane, so a table still reading the old content draws
// into the pane it started in.
function mountContentView(
    pane: HTMLElement,
    file: OpenFile,
    callbacks: FilesSurfaceCallbacks,
    kinds: ViewKinds,
): PaneLifecycle {
    let current = pane;
    let shown = file;
    let latest = file;
    // Moving on to another view takes the file and callbacks of the latest render.
    const show = (view: string): void => showView(view, latest, context.callbacks ?? callbacks);
    drawContentView(current, shown, kinds, show);

    return {
        sync: (next) => {
            latest = next;

            if (next.text === shown.text && next.file === shown.file) {
                return;
            }

            shown = next;
            const fresh = current.cloneNode(false) as HTMLElement;
            current.replaceWith(fresh);
            current = fresh;
            drawContentView(current, shown, kinds, show);
        },
    };
}

function drawContentView(
    pane: HTMLElement,
    file: OpenFile,
    kinds: ViewKinds,
    show: (view: string) => void,
): void {
    const { mode, viewerKind } = kinds;

    if (viewerKind === 'table') {
        const fileName = basename(file.path);
        void renderTableViewerAsync(pane, { fileName, path: file.path, text: file.text, file: file.file });

        return;
    }

    if (context.view === 'jsonpath') {
        renderJsonPathPanel(pane, {
            text: file.text,
            format: mode === 'yaml' ? YAML_DATA_FORMAT : undefined,
            expression: context.jsonPath,
            state: context.pathResults,
            onRun: (expression) => {
                context.jsonPath = expression;
            },
            onReveal: (path) => {
                context.revealJsonPath = path;
                show('tree');
            },
        });

        return;
    }

    if (context.view === 'schema') {
        renderJsonSchemaPanel(pane, {
            text: file.text,
            format: mode === 'yaml' ? YAML_DATA_FORMAT : undefined,
            state: schemaPanelOf(file.path),
            onReveal: (path) => {
                context.revealJsonPath = path;
                show('tree');
            },
            onSchemaChange: (schema) => {
                if (schema.trim() !== '') {
                    context.lastSchema = schema;
                }
            },
        });

        return;
    }

    if (mode === 'json' && context.view === 'tree') {
        const reveal = context.revealJsonPath;
        context.revealJsonPath = null;
        renderJsonTreeView(pane, file.text, {
            reveal,
            onUseInJsonPath: (path) => {
                context.jsonPath = path;
                show('jsonpath');
            },
        });

        return;
    }

    if (mode === 'yaml' && context.view === 'tree') {
        const reveal = context.revealJsonPath;
        context.revealJsonPath = null;
        renderYamlTreeView(pane, file.text, {
            reveal,
            onUseInJsonPath: (path) => {
                context.jsonPath = path;
                show('jsonpath');
            },
        });

        return;
    }

    if (mode === 'xml' && context.view === 'tree') {
        const reveal = context.revealXPath;
        context.revealXPath = null;
        renderXmlTreeView(pane, file.text, {
            reveal,
            onUseInXPath: (path) => {
                context.xPath = path;
                show('xpath');
            },
        });

        return;
    }

    if (mode === 'xml' && context.view === 'xpath') {
        renderXPathPanel(pane, {
            text: file.text,
            expression: context.xPath,
            state: context.pathResults,
            onRun: (expression) => {
                context.xPath = expression;
            },
            onReveal: (path) => {
                context.revealXPath = path;
                show('tree');
            },
        });

        return;
    }

    if (mode === 'xml' && context.view === 'as-json') {
        renderXmlAsJsonView(pane, file.text);
    }
}

// The rendered document alone, kept while the text stays the same, so its images aren't read again on every render.
function mountMarkdownPreviewView(pane: HTMLElement, file: OpenFile): PaneLifecycle {
    const article = h('article', { class: 'markdown-preview' });
    pane.append(h('div', { class: 'md-preview-scroller', children: [article] }));
    const preview = mountMarkdownPreview(article, {
        documentPath: workspacePathOf(file),
        root: context.workspaceRoot,
        onOpenLink: openLink,
    });
    let shown = file.text;
    preview.render(shown);

    return {
        sync: (next) => {
            if (next.text !== shown) {
                shown = next.text;
                preview.render(shown);
            }
        },
        refresh: (changedPaths) => preview.refresh(changedPaths),
        reveal: (fragment) => {
            void preview.revealAsync(fragment);
        },
        dispose: () => preview.dispose(),
    };
}

// An HTML file drawn as a page in a sandboxed frame, drawn again as the text changes.
function mountHtmlPreviewView(pane: HTMLElement, file: OpenFile): PaneLifecycle {
    const path = file.path;
    const preview = mountHtmlPreview(pane, file.text, {
        fileName: basename(path),
        documentPath: workspacePathOf(file),
        root: context.workspaceRoot,
        unsavedText,
        onOpenLink: openLink,
        onSave: () => context.callbacks?.onSave(path),
    });

    return {
        sync: (next) => preview.update(next.text),
        refresh: (changedPaths) => preview.refresh(changedPaths),
        reveal: (fragment) => preview.reveal(fragment),
        dispose: () => preview.dispose(),
    };
}

function renderXmlAsJsonView(pane: HTMLElement, text: string): void {
    const parsed = parseXml(text);

    if (!parsed.ok) {
        pane.append(emptyState({
            title: 'Not valid XML',
            message: `${parsed.message} (line ${parsed.line}, column ${parsed.column}).`,
        }));

        return;
    }

    const converted = convertXmlToJson(parsed.root);
    const badge = h('div', {
        class: 'xml-as-json-badge',
        children: [h('span', { class: 'badge', text: 'converted from XML' })],
    });
    const tree = h('div', { class: 'editor-pane' });
    pane.append(badge, tree);
    renderJsonTreeView(tree, JSON.stringify(converted, null, 2));
}

function mountEditorInto(pane: HTMLElement, file: OpenFile, mode: EditorMode, resources: WorkspaceResources | null): void {
    destroyEditor();

    const isInteractive = LIVE_MODES.has(mode) && context.view === 'interactive';
    const isTooLarge = isInteractive && file.text.length > LIVE_PREVIEW_MAX_LENGTH;
    const barSlot = h('div', { class: 'editor-bar-slot' });
    const host = h('div', { class: 'editor-host' });
    pane.append(barSlot);

    if (isTooLarge) {
        pane.append(h('div', {
            class: 'editor-note',
            attrs: { role: 'note' },
            text: `This file is too large to show formatted, over ${LIVE_PREVIEW_MAX_LENGTH.toLocaleString('en-US')} characters, `
                + 'so the Interactive view shows its source to keep typing fast.',
        }));
    }

    pane.append(host);
    context.activePath = file.path;

    const remembered = editorStateByPath.get(file.path);
    const sameLength = remembered != null && remembered.textLength === file.text.length;

    context.editorHandle = mountEditor(host, {
        initialText: file.text,
        mode,
        initialSelection: sameLength ? remembered?.head : undefined,
        initialScrollTop: sameLength ? remembered?.scrollTop : undefined,
        onChange: (text) => currentCallbacks.onChange(file.path, text),
        onSave: () => currentCallbacks.onSave(file.path),
        sessionKey: file.path,
        livePreview: isInteractive && !isTooLarge,
        imageContext: isInteractive ? { documentPath: workspacePathOf(file), resources } : null,
        barSlot,
    });
}

function destroyEditor(): void {
    if (context.editorHandle != null) {
        if (context.activePath != null) {
            try {
                editorStateByPath.set(context.activePath, {
                    head: context.editorHandle.getSelectionHead(),
                    scrollTop: context.editorHandle.getScrollTop(),
                    textLength: context.editorHandle.getValue().length,
                });
            }
            catch {
                // Destroying an already-torn-down view is non-fatal.
            }
        }

        context.editorHandle.destroy();
        context.editorHandle = null;
    }

    context.activePath = null;
}

function viewOptionsFor(mode: EditorMode, fileName: string): string[] {
    const typeId = resolveFileType(fileName).id;

    if (typeId === 'csv' || typeId === 'excel') {
        return ['table'];
    }

    if (typeId === 'html') {
        return ['editor', 'interactive', 'split', 'preview'];
    }

    if (mode === 'json') {
        return ['editor', 'tree', 'jsonpath', 'schema'];
    }

    if (mode === 'markdown') {
        return ['editor', 'interactive', 'split', 'preview'];
    }

    if (mode === 'xml') {
        return ['editor', 'tree', 'xpath', 'as-json'];
    }

    if (mode === 'yaml') {
        return ['editor', 'tree', 'jsonpath', 'schema'];
    }

    return ['editor'];
}

function labelForView(view: string): string {
    const label = VIEW_LABELS[view];

    return label ?? view;
}

function modeBadge(mode: EditorMode, typeId: FileTypeId): string {
    if (typeId === 'csv' || typeId === 'excel') {
        return 'Table';
    }

    if (typeId === 'html') {
        return 'HTML';
    }

    if (mode === 'json') {
        return 'JSON';
    }

    if (mode === 'markdown') {
        return 'Markdown';
    }

    if (mode === 'xml') {
        return 'XML';
    }

    if (mode === 'yaml') {
        return 'YAML';
    }

    return 'Text';
}
