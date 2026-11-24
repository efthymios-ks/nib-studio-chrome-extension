import { parseJson } from '../../common/json/jsonTree.js';
import { parseXml } from '../../common/paths/xmlParser.js';
import { parseYamlAsJson } from '../../common/yaml/yamlToJson.js';
import { normalizeLineEndings } from '../../common/text/lineEndings.js';
import { DIFF_KIND_LABELS, DIFF_KINDS, pastedSide } from '../app/diffTabs.js';
import { clear, h } from '../app/dom.js';
import type { DiffKind, DiffSide, DiffTab } from '../app/store.js';
import { toast } from '../app/toast.js';
import { mountEditor, type EditorHostHandle, type EditorMode } from '../editor/editorHost.js';
import { buildDiffSideHeader, SIDE_BADGES, type DiffSideAction, type DiffSideName } from './diffSideHeader.js';
import { renderDiffTargetDropZone, type DiffDropTarget, type DiffTargetDropZoneFactory } from './diffTargetDropZone.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewCallbacks, DiffViewState } from './diffViewState.js';
import { renderJsonDiffView, YAML_DIFF_FORMAT } from './jsonDiffView.js';
import { renderMarkdownDiffView } from './markdownDiffView.js';
import { renderRowDiffView } from './rowDiffView.js';
import { renderTextDiffView } from './textDiffView.js';
import { renderXmlDiffView } from './xmlDiffView.js';

export interface DiffTabCallbacks {
    readonly onSetSide: (tabId: string, side: DiffSideName, target: DiffSide) => void;
    readonly onSwap: (tabId: string) => void;
    readonly onClearSide?: (tabId: string, side: DiffSideName) => void;
    // Compares both sides as another kind; offered on new compares.
    readonly onSetKind?: (tabId: string, kind: DiffKind) => void;
    readonly onPickSide?: (tabId: string, side: DiffSideName, anchor: HTMLElement) => void;
    readonly onPickDiskFileAsync?: () => Promise<DiffDropTarget | null>;
    readonly readWorkspaceFileAsync?: (path: string) => Promise<DiffDropTarget | null>;
}

// The side being typed into, with its unapplied text. Keyed by the tab's view state so it lasts while the tab is away.
interface SideEditorState {
    readonly side: DiffSideName;
    draft: string;
}

// Where Ctrl+V lands: the diff tab on screen and the side under the pointer.
interface PasteContext {
    readonly pane: HTMLElement;
    readonly tab: DiffTab;
    readonly callbacks: DiffTabCallbacks;
    hovered: DiffSideName | null;
}

const sideEditors = new WeakMap<DiffViewState, SideEditorState>();

const EDITOR_MODES: Readonly<Record<DiffKind, EditorMode>> = Object.freeze({
    text: 'plain',
    json: 'json',
    yaml: 'yaml',
    xml: 'xml',
    markdown: 'markdown',
    rows: 'plain',
});

// What reading a side gives: success, or the parser's message with its line and column.
type SideParse =
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string; readonly line: number; readonly column: number };

// The kinds whose sides must parse, and how each is read; a side that doesn't shows the parser's message.
const SIDE_PARSERS: Readonly<Partial<Record<DiffKind, (text: string) => SideParse>>> = Object.freeze({
    json: parseJson,
    yaml: parseYamlAsJson,
    xml: parseXml,
});

const PARSE_CACHE_LIMIT = 4;

const parseErrors = new Map<string, string | null>();

let activeSideEditor: EditorHostHandle | null = null;

let pasteContext: PasteContext | null = null;

let pasteListening = false;

// Turns what the drop zone delivered into a diff side.
function sideFromDropTarget(target: DiffDropTarget): DiffSide {
    if (target.kind === 'clipboard') {
        return { label: 'Clipboard', source: 'clipboard', text: target.text };
    }

    return { label: target.path, path: target.path, source: target.kind, text: target.text, file: target.file };
}

// Closes the side editor of the diff tab that was on screen, keeping its unapplied text.
export function disposeDiffSideEditor(): void {
    activeSideEditor?.destroy();
    activeSideEditor = null;
}

// Renders a diff tab: every view reads and writes the tab's own state, so leaving and coming back restores it.
export function renderDiffTabView(container: HTMLElement, tab: DiffTab, callbacks: DiffTabCallbacks): void {
    disposeDiffSideEditor();
    clear(container);

    const pane = h('div', { class: 'editor-pane diff-tab-pane', dataset: { diffKind: tab.diffKind, tabId: tab.id } });
    container.append(pane);

    const rerender = (): void => renderDiffTabView(container, tab, callbacks);
    attachSideActions({ pane, tab, callbacks, rerender });
    trackPasteTarget(pane, tab, callbacks);

    const editing = sideEditors.get(tab.state);

    if (editing != null) {
        renderSideEditor({ pane, tab, editing, callbacks, rerender });

        return;
    }

    const targetDropZone: DiffTargetDropZoneFactory = (onTarget) => renderDiffTargetDropZone({
        // Text pasted into an empty side is shown as pasted text, like the header's Paste.
        onTarget: (target) => onTarget(target.kind === 'clipboard' ? pastedSide(target.text) : sideFromDropTarget(target)),
        onPickFileAsync: async () => await callbacks.onPickDiskFileAsync?.() ?? null,
        readWorkspaceFileAsync: callbacks.readWorkspaceFileAsync,
        pasteScope: pane,
    });
    const viewCallbacks: DiffViewCallbacks = {
        onSetSide: (side, target) => callbacks.onSetSide(tab.id, side, target),
        onSwap: () => callbacks.onSwap(tab.id),
        onPickSide: callbacks.onPickSide == null ? undefined : (side, anchor) => callbacks.onPickSide?.(tab.id, side, anchor),
        targetDropZone,
        toolbarExtra: tab.scratch == null || callbacks.onSetKind == null ? undefined : () => buildKindPicker(tab, callbacks),
    };
    const base = { original: tab.original, modified: tab.modified, callbacks: viewCallbacks };

    if (hasInvalidSide(tab)) {
        renderInvalidSides(pane, { ...base, diffKind: tab.diffKind });

        return;
    }

    if (tab.diffKind === 'json') {
        renderJsonDiffView(pane, { ...base, state: tab.state.json });

        return;
    }

    if (tab.diffKind === 'yaml') {
        renderJsonDiffView(pane, { ...base, state: tab.state.yaml, format: YAML_DIFF_FORMAT });

        return;
    }

    if (tab.diffKind === 'xml') {
        renderXmlDiffView(pane, { ...base, state: tab.state.xml });

        return;
    }

    if (tab.diffKind === 'markdown') {
        renderMarkdownDiffView(pane, { ...base, state: tab.state.markdown });

        return;
    }

    if (tab.diffKind === 'rows') {
        renderRowDiffView(pane, { ...base, state: tab.state.rows });

        return;
    }

    renderTextDiffView(pane, { ...base, state: tab.state.text });
}

// Why a side's text is not valid for the kind, with line and column, or null when it parses.
function diffSideError(kind: DiffKind, side: DiffSide | null): string | null {
    const parse = SIDE_PARSERS[kind];

    if (side == null || parse == null) {
        return null;
    }

    const text = side.text ?? '';
    const key = `${kind}:${text}`;

    if (parseErrors.has(key)) {
        return parseErrors.get(key) ?? null;
    }

    const parsed = parse(text);
    const error = parsed.ok ? null : `${parsed.message} (line ${parsed.line}, column ${parsed.column}).`;

    if (parseErrors.size >= PARSE_CACHE_LIMIT) {
        parseErrors.delete(parseErrors.keys().next().value ?? '');
    }

    parseErrors.set(key, error);

    return error;
}

function hasInvalidSide(tab: DiffTab): boolean {
    return diffSideError(tab.diffKind, tab.original) != null || diffSideError(tab.diffKind, tab.modified) != null;
}

interface SideActionOptions {
    readonly pane: HTMLElement;
    readonly tab: DiffTab;
    readonly callbacks: DiffTabCallbacks;
    readonly rerender: () => void;
}

// The side headers' Paste, Edit, Choose file… and Clear buttons. Views re-render inside the pane, so one listener serves them all.
function attachSideActions(options: SideActionOptions): void {
    const { pane, tab, callbacks, rerender } = options;

    pane.addEventListener('click', (event) => {
        const button = (event.target as Element | null)?.closest<HTMLElement>('[data-side-action]');
        const side = button?.closest<HTMLElement>('.diff-side-header')?.dataset['side'];

        if (button == null || (side !== 'original' && side !== 'modified')) {
            return;
        }

        event.stopPropagation();
        const action = button.dataset['sideAction'] as DiffSideAction;
        const current = side === 'original' ? tab.original : tab.modified;

        if (action === 'paste') {
            void pasteClipboardAsync((text) => callbacks.onSetSide(tab.id, side, pastedSide(text)));
        }
        else if (action === 'edit') {
            sideEditors.set(tab.state, { side, draft: current?.text ?? '' });
            rerender();
        }
        else if (action === 'choose') {
            void chooseSideAsync({ tab, side, anchor: button, callbacks });
        }
        else {
            callbacks.onClearSide?.(tab.id, side);
        }
    });
}

async function pasteClipboardAsync(onText: (text: string) => void): Promise<void> {
    let text: string;

    try {
        text = await navigator.clipboard.readText();
    }
    catch {
        toast('Could not read clipboard.', 'fail');

        return;
    }

    if (text === '') {
        toast('The clipboard has no text.', 'warn');

        return;
    }

    onText(text);
}

interface ChooseSideOptions {
    readonly tab: DiffTab;
    readonly side: DiffSideName;
    readonly anchor: HTMLElement;
    readonly callbacks: DiffTabCallbacks;
}

async function chooseSideAsync(options: ChooseSideOptions): Promise<void> {
    const { tab, side, anchor, callbacks } = options;

    if (callbacks.onPickSide != null) {
        callbacks.onPickSide(tab.id, side, anchor);

        return;
    }

    try {
        const picked = await callbacks.onPickDiskFileAsync?.() ?? null;

        if (picked != null) {
            callbacks.onSetSide(tab.id, side, sideFromDropTarget(picked));
        }
    }
    catch {
        toast('Could not read that file.', 'fail');
    }
}

interface SideEditorOptions {
    readonly pane: HTMLElement;
    readonly tab: DiffTab;
    readonly editing: SideEditorState;
    readonly callbacks: DiffTabCallbacks;
    readonly rerender: () => void;
}

// Types or changes one side's text in place of the diff; Apply puts it on the side and the diff comes back.
function renderSideEditor(options: SideEditorOptions): void {
    const { pane, tab, editing, callbacks, rerender } = options;
    const current = editing.side === 'original' ? tab.original : tab.modified;

    const apply = (): void => {
        sideEditors.delete(tab.state);

        // The editor holds `\n` line breaks, so a side read with other line endings is unchanged when only they differ.
        if (normalizeLineEndings(editing.draft) === normalizeLineEndings(current?.text ?? '')) {
            rerender();

            return;
        }

        if (editing.draft === '') {
            if (callbacks.onClearSide == null) {
                rerender();
            }
            else {
                callbacks.onClearSide(tab.id, editing.side);
            }

            return;
        }

        callbacks.onSetSide(tab.id, editing.side, pastedSide(editing.draft, { edited: true }));
    };
    const cancel = (): void => {
        sideEditors.delete(tab.state);
        rerender();
    };

    const host = h('div', { class: 'editor-host diff-side-editor-host' });

    pane.append(
        h('div', {
            class: 'editor-toolbar diff-side-editor-toolbar',
            dataset: { side: editing.side },
            children: [
                h('span', { class: 'diff-side-badge', text: SIDE_BADGES[editing.side] }),
                h('span', { class: 'diff-side-editor-title', text: `Editing the ${editing.side} side as ${DIFF_KIND_LABELS[tab.diffKind]}` }),
                h('span', { class: 'toolbar-spacer' }),
                h('div', {
                    class: 'toolbar-group',
                    children: [
                        h('button', {
                            class: 'button',
                            text: 'Cancel',
                            dataset: { action: 'cancel-edit' },
                            attrs: { type: 'button', title: 'Back to the diff without changing this side' },
                            on: { click: cancel },
                        }),
                        h('button', {
                            class: 'button button-primary',
                            text: 'Apply',
                            dataset: { action: 'apply-edit' },
                            attrs: { type: 'button', title: 'Compare with this text (Ctrl+Enter)' },
                            on: { click: apply },
                        }),
                    ],
                }),
            ],
        }),
        host,
    );

    host.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            apply();
        }
    });

    activeSideEditor = mountEditor(host, {
        initialText: editing.draft,
        mode: EDITOR_MODES[tab.diffKind],
        onChange: (text) => {
            editing.draft = text;
        },
        onSave: apply,
    });
    activeSideEditor.view.focus();
}

interface InvalidSidesInput {
    readonly original: DiffSide | null;
    readonly modified: DiffSide | null;
    readonly callbacks: DiffViewCallbacks;
    readonly diffKind: DiffKind;
}

// Both sides as text, with the parse error over the side that is not valid for the kind. The text stays as it was.
function renderInvalidSides(pane: HTMLElement, input: InvalidSidesInput): void {
    const panes = h('div', { class: 'split split-horizontal diff-invalid-panes' });

    for (const side of ['original', 'modified'] as const) {
        const source = side === 'original' ? input.original : input.modified;
        const error = diffSideError(input.diffKind, source);
        const body = h('div', { class: 'split-pane-body', dataset: { scrollKey: side } });

        if (error != null) {
            body.append(h('div', {
                class: 'diff-side-error',
                attrs: { role: 'alert' },
                children: [
                    h('strong', { text: `Not valid ${DIFF_KIND_LABELS[input.diffKind]}` }),
                    h('span', { text: error }),
                ],
            }));
        }

        if (source != null) {
            body.append(h('pre', { class: 'diff-side-text', text: source.text ?? '' }));
        }
        else if (input.callbacks.targetDropZone != null) {
            body.append(input.callbacks.targetDropZone((target) => input.callbacks.onSetSide(side, target)));
        }

        panes.append(h('div', {
            class: 'split-pane',
            dataset: { pane: side },
            children: [buildDiffSideHeader(side, source), body],
        }));
    }

    pane.append(
        h('div', { class: 'editor-toolbar', children: buildDiffToolbarSides({ ...input, state: null }) }),
        panes,
    );
}

// "Compare as" switch of a new compare: both sides are read again as the chosen kind.
function buildKindPicker(tab: DiffTab, callbacks: DiffTabCallbacks): HTMLElement {
    return h('div', {
        class: 'toolbar-group diff-kind-picker',
        attrs: { role: 'group', 'aria-label': 'Compare as' },
        children: [
            h('span', { class: 'diff-kind-label', text: 'Compare as' }),
            h('div', {
                class: 'view-tabs',
                children: DIFF_KINDS.map((kind) => h('button', {
                    class: 'view-tab',
                    text: DIFF_KIND_LABELS[kind],
                    dataset: kind === tab.diffKind ? { kind, active: 'true' } : { kind },
                    attrs: { type: 'button', 'aria-pressed': kind === tab.diffKind ? 'true' : 'false' },
                    on: { click: () => callbacks.onSetKind?.(tab.id, kind) },
                })),
            }),
        ],
    });
}

function sideOfElement(target: EventTarget | null): DiffSideName | null {
    if (!(target instanceof Element)) {
        return null;
    }

    const marked = target.closest<HTMLElement>('[data-side], [data-pane]');
    const side = marked?.dataset['side'] ?? marked?.dataset['pane'];

    return side === 'original' || side === 'modified' ? side : null;
}

// Ctrl+V replaces the focused or hovered side, or fills the first empty one.
function trackPasteTarget(pane: HTMLElement, tab: DiffTab, callbacks: DiffTabCallbacks): void {
    const context: PasteContext = { pane, tab, callbacks, hovered: null };
    pasteContext = context;
    pane.addEventListener('pointerover', (event) => {
        context.hovered = sideOfElement(event.target);
    });
    pane.addEventListener('pointerleave', () => {
        context.hovered = null;
    });

    if (!pasteListening) {
        pasteListening = true;
        // Capture runs before the drop zone's own paste handler, so one paste fills one side.
        document.addEventListener('paste', onDocumentPaste, true);
    }
}

function isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
}

function onDocumentPaste(event: ClipboardEvent): void {
    const context = pasteContext;

    if (context == null || !context.pane.isConnected || sideEditors.has(context.tab.state) || isEditable(event.target)) {
        return;
    }

    // The paste goes where the focus is: anywhere in the compare, or nowhere, as after a popover closed.
    // A caret left behind in the page can aim the event elsewhere, such as at the status bar, while nothing has focus.
    const target = event.target;
    const inPane = target instanceof Node && context.pane.contains(target);
    const focused = document.activeElement;
    const focusInPane = focused != null && context.pane.contains(focused);
    const unfocused = focused == null || focused === document.body || focused === document.documentElement;

    if (!inPane && !focusInPane && !unfocused) {
        return;
    }

    const { tab, callbacks } = context;
    const firstEmpty: DiffSideName | null = tab.original == null ? 'original' : tab.modified == null ? 'modified' : null;
    const side = (inPane ? sideOfElement(target) : null) ?? context.hovered ?? firstEmpty;
    const file = event.clipboardData?.files[0];
    const text = event.clipboardData?.getData('text/plain') ?? '';

    if (side == null || (file == null && text === '')) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (file != null) {
        void setSideFromFileAsync({ file, side, tab, callbacks });

        return;
    }

    callbacks.onSetSide(tab.id, side, pastedSide(text));
}

// A file pasted on a side fills it as a file from disk.
async function setSideFromFileAsync(options: {
    readonly file: File;
    readonly side: DiffSideName;
    readonly tab: DiffTab;
    readonly callbacks: DiffTabCallbacks;
}): Promise<void> {
    const { file, side, tab, callbacks } = options;

    try {
        const text = await file.text();
        callbacks.onSetSide(tab.id, side, { label: file.name, path: file.name, source: 'disk', text, file });
    }
    catch {
        toast('Could not read that file.', 'fail');
    }
}
