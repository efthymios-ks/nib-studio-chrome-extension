import type { RowSet } from '../../common/csv/rowCompare.js';
import type {
    DataDiffDocument,
    MarkdownDiffDocument,
    RowsDiffDocument,
    TextDiffDocument,
    XmlDiffDocument,
} from '../../common/diff/diffDocument.js';
import type { JsonArrayRule } from '../../common/json/jsonComparer.js';
import type { XmlNode } from '../../common/paths/xmlParser.js';
import { DEFAULT_TEXT_COMPARE_RULES, type TextCompareRules } from '../../common/text/textCompareRules.js';
import type { XmlArrayRule, XmlCompareOptions } from '../../common/xml/xmlCompare.js';
import type { DiffSide } from '../app/store.js';
import { createDiffNavigationState, type DiffNavigationState } from './diffNavigationBar.js';
import type { DiffTargetDropZoneFactory } from './diffTargetDropZone.js';
import type { DiffSideName } from './diffSideHeader.js';

// Scroll offsets of a view's scrollable areas, keyed by their data-scroll-key.
export type ScrollMemory = Record<string, { top: number; left: number }>;

export interface TextDiffViewState {
    // The bar's view and current change.
    navigation: DiffNavigationState;
    rules: TextCompareRules;
    scroll: ScrollMemory;
    // The diff document, kept until a side or the rules change.
    cache: { original: string; modified: string; rules: TextCompareRules; sides: string; document: TextDiffDocument } | null;
}

export interface JsonDiffViewState {
    rules: JsonArrayRule[];
    // Alphabetical keys; file order when off.
    sortKeys: boolean;
    // Rows of the aligned trees the user opened or closed, on top of what the differences expand.
    expansion: Map<string, boolean>;
    // A path whose parents open on the next render, so the bar can scroll to it.
    reveal: AlignedReveal | null;
    // The bar's view and current change.
    navigation: DiffNavigationState;
    scroll: ScrollMemory;
    // The diff document, kept until a side, the rules or the key order change.
    cache: {
        original: string;
        modified: string;
        rules: ReadonlyArray<JsonArrayRule>;
        sortKeys: boolean;
        sides: string;
        document: DataDiffDocument;
    } | null;
}

export interface XmlDiffViewState {
    options: XmlCompareOptions;
    view: 'xml' | 'json';
    rules: XmlArrayRule[];
    // Elements and attributes by name; document order when off.
    sortKeys: boolean;
    expansion: Map<string, boolean>;
    reveal: AlignedReveal | null;
    navigation: DiffNavigationState;
    scroll: ScrollMemory;
    // Both parsed documents and the diff document, kept until a side, an option, a rule, the order or the names change.
    cache: {
        original: string;
        modified: string;
        options: XmlCompareOptions;
        rules: ReadonlyArray<XmlArrayRule>;
        sortKeys: boolean;
        view: 'xml' | 'json';
        sides: string;
        left: XmlNode | null;
        right: XmlNode | null;
        // Null while a side is not valid XML.
        document: XmlDiffDocument | null;
    } | null;
}

export interface MarkdownDiffViewState {
    view: 'diff' | 'before' | 'after';
    scrollY: number;
    cache: { original: string; modified: string; html: string; document: MarkdownDiffDocument } | null;
}

export interface LoadedRowSet {
    readonly path: string;
    readonly rowSet: RowSet;
    // A workbook's sheets in order, and the one its rows come from; absent for a CSV or TSV file.
    readonly sheets?: ReadonlyArray<{ readonly name: string; readonly hidden: boolean }>;
    readonly sheet?: string;
}

export interface RowDiffViewState {
    keyColumns: string[];
    // Set once the user picks key columns, so a new suggestion never overrides them.
    keysChosen: boolean;
    sortColumns: string[];
    ignoreColumns: string[];
    // Columns by name; file order when off.
    sortKeys: boolean;
    // Key of the row with the current change, outlined in the table.
    activeDiffKey: string | null;
    navigation: DiffNavigationState;
    scroll: ScrollMemory;
    // The sheet picked on each side of a workbook compare; a side without one takes the sheet of the same name
    // as the original's, the sheet its table tab shows, or its first sheet.
    sheets: Partial<Record<DiffSideName, string>>;
    // Parsed sides, keyed by the text or File they came from and the sheets asked for.
    loaded: Partial<Record<DiffSideName, { source: string | File; request: string; rowSet: LoadedRowSet | null }>>;
    // The diff document, kept until a side, the key or sort columns or the column order change.
    cache: {
        original: LoadedRowSet;
        modified: LoadedRowSet;
        keyColumns: ReadonlyArray<string>;
        sortColumns: ReadonlyArray<string>;
        sortKeys: boolean;
        sides: string;
        document: RowsDiffDocument;
    } | null;
}

export interface AlignedReveal {
    readonly side: 'left' | 'right';
    readonly path: string;
}

export interface DiffViewState {
    readonly text: TextDiffViewState;
    readonly json: JsonDiffViewState;
    // YAML is compared as the data it holds, in the JSON diff with rules and key order of its own.
    readonly yaml: JsonDiffViewState;
    readonly xml: XmlDiffViewState;
    readonly markdown: MarkdownDiffViewState;
    readonly rows: RowDiffViewState;
}

export interface DiffViewCallbacks {
    // Fills or replaces a side, with what was dropped, pasted or picked.
    readonly onSetSide: (side: DiffSideName, target: DiffSide) => void;
    readonly onSwap: () => void;
    // Lets the user choose a side from the toolbar; the anchor is the button that asked.
    readonly onPickSide?: (side: DiffSideName, anchor: HTMLElement) => void;
    // Fills an empty side with a drop / paste / click target.
    readonly targetDropZone?: DiffTargetDropZoneFactory;
    // Extra toolbar control placed after the side controls, such as the kind of a new compare.
    readonly toolbarExtra?: () => HTMLElement;
}

export interface DiffViewInput<State> {
    readonly original: DiffSide | null;
    readonly modified: DiffSide | null;
    readonly state: State;
    readonly callbacks: DiffViewCallbacks;
}

export function createTextDiffViewState(): TextDiffViewState {
    return {
        navigation: createDiffNavigationState(),
        rules: DEFAULT_TEXT_COMPARE_RULES,
        scroll: {},
        cache: null,
    };
}

export function createJsonDiffViewState(): JsonDiffViewState {
    return {
        rules: [],
        sortKeys: true,
        expansion: new Map(),
        reveal: null,
        navigation: createDiffNavigationState(),
        scroll: {},
        cache: null,
    };
}

export function createXmlDiffViewState(): XmlDiffViewState {
    return {
        options: {
            ignoreWhitespaceOnly: true,
            trimText: true,
            ignoreNamespacePrefixes: false,
            caseSensitiveNames: true,
        },
        view: 'xml',
        rules: [],
        sortKeys: false,
        expansion: new Map(),
        reveal: null,
        navigation: createDiffNavigationState(),
        scroll: {},
        cache: null,
    };
}

export function createMarkdownDiffViewState(): MarkdownDiffViewState {
    return { view: 'diff', scrollY: 0, cache: null };
}

export function createRowDiffViewState(): RowDiffViewState {
    return {
        keyColumns: [],
        keysChosen: false,
        sortColumns: [],
        ignoreColumns: [],
        sortKeys: false,
        activeDiffKey: null,
        navigation: createDiffNavigationState(),
        scroll: {},
        sheets: {},
        loaded: {},
        cache: null,
    };
}

export function createDiffViewState(): DiffViewState {
    return {
        text: createTextDiffViewState(),
        json: createJsonDiffViewState(),
        yaml: createJsonDiffViewState(),
        xml: createXmlDiffViewState(),
        markdown: createMarkdownDiffViewState(),
        rows: createRowDiffViewState(),
    };
}

// Moves what each side remembers to the other side, so a swap keeps scroll and expanded nodes with their file.
export function swapSideMemory(state: DiffViewState): void {
    for (const scroll of [state.text.scroll, state.json.scroll, state.yaml.scroll, state.xml.scroll, state.rows.scroll]) {
        const original = scroll['original'];
        const modified = scroll['modified'];
        delete scroll['original'];
        delete scroll['modified'];

        if (modified != null) {
            scroll['original'] = modified;
        }

        if (original != null) {
            scroll['modified'] = original;
        }
    }

    const loaded = state.rows.loaded;
    state.rows.loaded = { original: loaded.modified, modified: loaded.original };
    const sheets = state.rows.sheets;
    state.rows.sheets = {
        ...(sheets.modified == null ? {} : { original: sheets.modified }),
        ...(sheets.original == null ? {} : { modified: sheets.original }),
    };
}
