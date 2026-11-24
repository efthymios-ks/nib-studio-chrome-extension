import { Annotation, Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import {
    drawSelection,
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { highlightSelectionMatches, SearchCursor, searchKeymap, selectNextOccurrence } from '@codemirror/search';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';
import { extension as fileExtension } from '../../common/fs/fileEntry.js';
import { lintYaml } from '../../common/yaml/yamlLint.js';
import { HISTORY_BUTTONS, mountEditorBar, type EditorBarButton, type EditorBarHandle } from './editorBar.js';
import type { LocalImageContext } from '../../common/markdown/localImages.js';
import { htmlFormattingButtonGroups, htmlFormattingKeymap } from './htmlFormatting.js';
import { htmlLivePreview } from './htmlLivePreview.js';
import { CODE_LANGUAGE_MENU_EVENT, type CodeLanguageMenuDetail } from './liveBlocks.js';
import { liveImageContext } from './liveDecorations.js';
import { markdownFormattingButtonGroups, markdownFormattingKeymap } from './markdownFormattingToolbar.js';
import { markdownListKeymap } from './markdownListKeys.js';
import { markdownLivePreview } from './markdownLivePreview.js';

export type EditorMode = 'plain' | 'json' | 'yaml' | 'markdown' | 'xml' | 'html';

// JSON and YAML are checked once typing rests this long.
const LINT_DELAY_MS = 300;

export interface EditorHostOptions {
    readonly initialText: string;
    readonly mode: EditorMode;
    readonly readOnly?: boolean;
    readonly initialSelection?: number;
    readonly initialScrollTop?: number;
    readonly onChange?: (text: string) => void;
    readonly onSave?: () => void;
    // Editors mounted with the same key share one session, so undo history survives re-renders.
    readonly sessionKey?: string;
    // Shows Markdown or HTML with its formatting, as in the Interactive view; ignored for other modes.
    readonly livePreview?: boolean;
    // Where the Interactive view reads workspace images from.
    readonly imageContext?: LocalImageContext | null;
    // Mounts the docked editor bar in this element: undo and redo, plus the formatting buttons for Markdown.
    readonly barSlot?: HTMLElement;
}

interface EditorHandlers {
    onChange?: (text: string) => void;
    onSave?: () => void;
    onViewUpdate?: (update: ViewUpdate) => void;
}

interface EditorSession {
    readonly mode: EditorMode;
    readonly readOnly: boolean;
    readonly handlers: EditorHandlers;
    state: EditorState;
    scrollTop: number;
}

const editorSessions = new Map<string, EditorSession>();

// Saves the session of an editor still mounted under the key; a kept editor saves its session only when destroyed.
const sessionSavers = new Map<string, () => void>();

// Marks a change that brings the editor in line with text the caller already has, so onChange skips it.
const syncedText = Annotation.define<boolean>();

const livePreviewCompartment = new Compartment();
const imageContextCompartment = new Compartment();
const LIVE_PREVIEW = markdownLivePreview();
const HTML_LIVE_PREVIEW = htmlLivePreview();
// The modes with an Interactive view, and the extension that draws it.
const LIVE_PREVIEWS: ReadonlyMap<EditorMode, Extension> = new Map<EditorMode, Extension>([
    ['markdown', LIVE_PREVIEW],
    ['html', HTML_LIVE_PREVIEW],
]);

// Drops the sessions of closed files, so their history doesn't outlive the tab.
export function pruneEditorSessions(openKeys: ReadonlyArray<string>): void {
    const keep = new Set(openKeys);

    for (const key of [...editorSessions.keys()]) {
        if (!keep.has(key)) {
            editorSessions.delete(key);
        }
    }
}

export function renameEditorSession(fromKey: string, toKey: string): void {
    sessionSavers.get(fromKey)?.();
    const session = editorSessions.get(fromKey);

    if (session == null) {
        return;
    }

    editorSessions.delete(fromKey);
    editorSessions.set(toKey, session);
}

export interface EditorHostHandle {
    readonly view: EditorView;
    getValue(): string;
    // Replaces the text as one undoable edit, reported through onChange.
    setValue(text: string): void;
    // Brings the editor to text the caller already has, as one undoable edit that onChange doesn't report.
    // Returns whether the text changed.
    syncText(text: string): boolean;
    setMode(mode: EditorMode): void;
    getSelectionHead(): number;
    getScrollTop(): number;
    destroy(): void;
}

export function detectMode(fileName: string): EditorMode {
    const ext = fileExtension(fileName);

    if (ext === 'json') {
        return 'json';
    }

    if (ext === 'yaml' || ext === 'yml') {
        return 'yaml';
    }

    if (ext === 'md' || ext === 'markdown' || ext === 'mdx') {
        return 'markdown';
    }

    if (ext === 'xml' || ext === 'xsd' || ext === 'xsl' || ext === 'xslt' || ext === 'config') {
        return 'xml';
    }

    if (ext === 'html' || ext === 'htm') {
        return 'html';
    }

    return 'plain';
}

export function isLivePreviewOn(state: EditorState): boolean {
    const shown = livePreviewCompartment.get(state);

    return shown === LIVE_PREVIEW || shown === HTML_LIVE_PREVIEW;
}

export function mountEditor(container: HTMLElement, options: EditorHostOptions): EditorHostHandle {
    let currentMode = options.mode;
    const readOnly = options.readOnly === true;
    const reusable = options.sessionKey == null ? undefined : editorSessions.get(options.sessionKey);
    const session = reusable != null && reusable.mode === currentMode && reusable.readOnly === readOnly
        ? reusable
        : undefined;
    const handlers: EditorHandlers = session?.handlers ?? {};
    handlers.onChange = options.onChange;
    handlers.onSave = options.onSave;
    handlers.onViewUpdate = undefined;

    const view = new EditorView({
        parent: container,
        state: session == null
            ? buildState(options.initialText, currentMode, options, handlers)
            : withLivePreview(session.state, options),
    });

    // Text changed outside this editor (format, reload) becomes one undoable edit.
    if (session != null) {
        syncViewText(view, options.initialText);
    }

    const initialScrollTop = session?.scrollTop ?? options.initialScrollTop ?? 0;

    if (initialScrollTop > 0) {
        // Scroll restore has to wait for CodeMirror's first layout.
        requestAnimationFrame(() => {
            view.scrollDOM.scrollTop = initialScrollTop;
        });
    }

    let bar: EditorBarHandle | null = null;
    let detachLanguageMenu = (): void => {};

    if (options.barSlot != null) {
        const groups = readOnly ? [HISTORY_BUTTONS] : [HISTORY_BUTTONS, ...formattingButtonGroups(currentMode)];
        const mountedBar = mountEditorBar(options.barSlot, view, groups);
        bar = mountedBar;
        handlers.onViewUpdate = (update) => mountedBar.refresh(update.state);
        // A code block's language label in the Interactive view opens the bar's language menu under the label.
        const onLanguageMenu = (event: Event): void => {
            const detail = (event as CustomEvent<CodeLanguageMenuDetail>).detail;
            mountedBar.openMenu('codeBlock', detail.anchor);
        };
        view.dom.addEventListener(CODE_LANGUAGE_MENU_EVENT, onLanguageMenu);
        detachLanguageMenu = () => view.dom.removeEventListener(CODE_LANGUAGE_MENU_EVENT, onLanguageMenu);
    }

    const saveSession = (): void => {
        if (options.sessionKey == null) {
            return;
        }

        editorSessions.set(options.sessionKey, {
            mode: currentMode,
            readOnly,
            handlers,
            state: view.state,
            scrollTop: view.scrollDOM.scrollTop,
        });
    };

    if (options.sessionKey != null) {
        sessionSavers.set(options.sessionKey, saveSession);
    }

    return {
        view,
        getValue: () => view.state.doc.toString(),
        setValue: (text) => {
            replaceViewText(view, text, false);
        },
        syncText: (text) => syncViewText(view, text),
        setMode: (mode) => {
            if (mode === currentMode) {
                return;
            }

            currentMode = mode;
            view.setState(buildState(view.state.doc.toString(), mode, options, handlers));
        },
        getSelectionHead: () => view.state.selection.main.head,
        getScrollTop: () => view.scrollDOM.scrollTop,
        destroy: () => {
            saveSession();

            if (options.sessionKey != null && sessionSavers.get(options.sessionKey) === saveSession) {
                sessionSavers.delete(options.sessionKey);
            }

            detachLanguageMenu();
            bar?.destroy();
            handlers.onViewUpdate = undefined;
            view.destroy();
        },
    };
}

// CodeMirror holds `\n` line breaks whatever the text had, so `\r\n` and `\r` alone are no change.
function syncViewText(view: EditorView, text: string): boolean {
    const normalized = text.replace(/\r\n?/g, '\n');

    if (view.state.doc.length === normalized.length && view.state.doc.toString() === normalized) {
        return false;
    }

    replaceViewText(view, normalized, true);

    return true;
}

function replaceViewText(view: EditorView, text: string, isSync: boolean): void {
    view.dispatch({
        changes: minimalChange(view.state.doc.toString(), text),
        annotations: [isolateHistory.of('full'), syncedText.of(isSync)],
        userEvent: 'input.replace',
    });
}

// The formatting buttons of the editor bar after Undo and Redo, for the modes that have them.
function formattingButtonGroups(mode: EditorMode): ReadonlyArray<ReadonlyArray<EditorBarButton>> {
    if (mode === 'markdown') {
        return markdownFormattingButtonGroups();
    }

    return mode === 'html' ? htmlFormattingButtonGroups() : [];
}

// Turns the formatting shown in the Interactive view on or off for a reused session,
// and points its images at this mount's workspace.
function withLivePreview(state: EditorState, options: EditorHostOptions): EditorState {
    const live = LIVE_PREVIEWS.get(options.mode);

    if (live == null) {
        return state;
    }

    const wanted = options.livePreview === true;
    const effects = [imageContextCompartment.reconfigure(liveImageContext.of(options.imageContext ?? null))];

    if (isLivePreviewOn(state) !== wanted) {
        effects.push(livePreviewCompartment.reconfigure(wanted ? live : []));
    }

    return state.update({ effects }).state;
}

function buildState(
    initialText: string,
    mode: EditorMode,
    options: EditorHostOptions,
    handlers: EditorHandlers,
): EditorState {
    const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        // Ctrl+D and Ctrl+Shift+L add selections, and every one of them is drawn, with its own cursor.
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
            { key: 'Mod-Shift-l', run: selectEveryOccurrence, preventDefault: true },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
        ]),
        EditorView.lineWrapping,
    ];

    if (options.readOnly === true) {
        extensions.push(EditorState.readOnly.of(true));
    }

    if (mode === 'json') {
        extensions.push(json(), linter(jsonParseLinter(), { delay: LINT_DELAY_MS }), lintGutter());
    }
    else if (mode === 'yaml') {
        extensions.push(yaml(), linter(yamlDiagnostics, { delay: LINT_DELAY_MS }), lintGutter());
    }
    else if (mode === 'markdown') {
        // GitHub-flavoured, like the preview: tables, task lists, strikethrough and bare links.
        // The list keys, Enter and Backspace included, come from markdownListKeymap.
        extensions.push(markdown({ base: markdownLanguage, addKeymap: false }));
        extensions.push(livePreviewCompartment.of(options.livePreview === true ? LIVE_PREVIEW : []));
        extensions.push(imageContextCompartment.of(liveImageContext.of(options.imageContext ?? null)));

        if (options.readOnly !== true) {
            extensions.push(markdownFormattingKeymap(), markdownListKeymap());
        }
    }
    else if (mode === 'html') {
        extensions.push(html());
        extensions.push(livePreviewCompartment.of(options.livePreview === true ? HTML_LIVE_PREVIEW : []));
        extensions.push(imageContextCompartment.of(liveImageContext.of(options.imageContext ?? null)));

        if (options.readOnly !== true) {
            extensions.push(htmlFormattingKeymap());
        }
    }

    // Handlers are read at call time, so a reused session reaches the latest mount's callbacks.
    extensions.push(EditorView.updateListener.of((update) => {
        const isSync = update.transactions.some((transaction) => transaction.annotation(syncedText) === true);

        if (update.docChanged && !isSync) {
            handlers.onChange?.(update.state.doc.toString());
        }

        handlers.onViewUpdate?.(update);
    }));
    extensions.push(keymap.of([
        {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
                if (handlers.onSave == null) {
                    return false;
                }

                handlers.onSave();

                return true;
            },
        },
    ]));

    const selection = clampSelection(initialText.length, options.initialSelection);

    return EditorState.create({
        doc: initialText,
        extensions,
        selection,
    });
}

// The most occurrences Ctrl+Shift+L selects, the first ones in the text, as CodeMirror's own command allows.
const MAX_OCCURRENCES = 1_000;

// Ctrl+Shift+L selects every occurrence of the selected text, after Ctrl+D has added some too,
// and of the word at the caret when nothing is selected. CodeMirror's own command needs a single selection.
// As with Ctrl+D, a selection that is a whole word matches whole words only.
function selectEveryOccurrence(view: EditorView): boolean {
    if (view.state.selection.main.empty) {
        selectNextOccurrence(view);
    }

    const { state } = view;
    const main = state.selection.main;

    if (main.empty) {
        return false;
    }

    const ranges: ReturnType<typeof EditorSelection.range>[] = [];
    const isWholeWord = (from: number, to: number): boolean => {
        const word = state.wordAt(from);

        return word != null && word.from === from && word.to === to;
    };
    const wordsOnly = isWholeWord(main.from, main.to);
    let mainIndex = 0;

    for (const cursor = new SearchCursor(state.doc, state.sliceDoc(main.from, main.to)); !cursor.next().done;) {
        if (ranges.length >= MAX_OCCURRENCES) {
            break;
        }

        if (wordsOnly && !isWholeWord(cursor.value.from, cursor.value.to)) {
            continue;
        }

        if (cursor.value.from === main.from) {
            mainIndex = ranges.length;
        }

        ranges.push(EditorSelection.range(cursor.value.from, cursor.value.to));
    }

    view.dispatch({ selection: EditorSelection.create(ranges, mainIndex), userEvent: 'select.search.matches' });

    return true;
}

// Errors and warnings of the YAML parser, each with its line and column, as the JSON validator gives them.
function yamlDiagnostics(view: EditorView): Diagnostic[] {
    const length = view.state.doc.length;

    return lintYaml(view.state.doc.toString()).map((issue) => ({
        from: Math.min(issue.from, length),
        to: Math.min(Math.max(issue.to, issue.from), length),
        severity: issue.severity,
        message: `${issue.message} (line ${issue.line}, column ${issue.column}).`,
    }));
}

function clampSelection(docLength: number, requested: number | undefined): EditorSelection | undefined {
    if (requested == null) {
        return undefined;
    }

    const head = Math.max(0, Math.min(requested, docLength));

    return EditorSelection.single(head);
}

function minimalChange(current: string, next: string): { from: number; to: number; insert: string } {
    let prefix = 0;
    const shortest = Math.min(current.length, next.length);

    while (prefix < shortest && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
        prefix += 1;
    }

    let suffix = 0;

    while (
        suffix < shortest - prefix
        && current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
    ) {
        suffix += 1;
    }

    return { from: prefix, to: current.length - suffix, insert: next.slice(prefix, next.length - suffix) };
}
