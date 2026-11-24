import { basename, type DirectoryEntry } from '../../common/fs/fileEntry.js';
import type { SurfaceId } from '../../common/fs/workspaceConfig.js';
import type { WorkspaceRecord } from '../../common/fs/workspaceRegistry.js';
import type { GlobalSession } from '../../common/session/sessionStore.js';
import { applyLineEnding, detectLineEnding, normalizeLineEndings, type LineEnding } from '../../common/text/lineEndings.js';
import { encodeText, type EncodedText, type TextEncoding } from '../../common/text/textEncoding.js';
import type { DiffViewState } from '../views/diffViewState.js';

export type Theme = 'light' | 'dark';

export interface WorkspaceState {
    readonly id: string;
    readonly handle: FileSystemDirectoryHandle;
    readonly name: string;
}

export interface OpenFile {
    // The workspace path, or for a file from outside the workspace a key made by `externalTabPath`.
    readonly path: string;
    // The text as the editor holds it, with `\n` line breaks.
    readonly text: string;
    // The text on disk when the file was opened, reloaded or saved, with `\n` line breaks like `text`.
    readonly originalText: string;
    // The file's line ending on disk, which saving puts back; the most common one when the file mixes them.
    readonly lineEnding: LineEnding;
    // The encoding the file was read in, which saving writes it back in; UTF-8 when unset.
    readonly encoding?: TextEncoding;
    readonly dirty: boolean;
    readonly view: string;
    readonly file: File | null;
    readonly preview: boolean;
    // A CSV or TSV too large to load: text stays empty and the table reads rows from `file` on demand.
    readonly large?: boolean;
    // A file of an unknown type whose first bytes aren't text: text stays empty and it opens as a message.
    readonly binary?: boolean;
    // Set on a file opened from outside the workspace; it saves back through its handle, never into the workspace.
    readonly external?: ExternalFile;
}

export interface ExternalFile {
    // Null when the browser gave no handle for the file, so saving asks where to save.
    readonly handle: FileSystemFileHandle | null;
}

const EXTERNAL_PREFIX = 'external://';

// The empty segment after the prefix never occurs in a workspace path, so the key cannot collide with one,
// and the file name stays last, so `basename` still gives it.
export function externalTabPath(id: number, name: string): string {
    return `${EXTERNAL_PREFIX}${id}/${name}`;
}

export function isExternalPath(path: string | null | undefined): boolean {
    return path != null && path.startsWith(EXTERNAL_PREFIX);
}

// A tab's path as the user sees it: the path from the workspace root, or the name of a file from outside the workspace.
export function displayPath(path: string): string {
    return isExternalPath(path) ? basename(path) : path;
}

// The text of a file read from disk as an open file holds it: `\n` line breaks, and the file's own line ending for saving.
export function textFromDisk(
    diskText: string,
    encoding: TextEncoding = 'utf-8',
): Pick<OpenFile, 'text' | 'originalText' | 'lineEnding'> & { readonly encoding: TextEncoding } {
    const text = normalizeLineEndings(diskText);

    return { text, originalText: text, lineEnding: detectLineEnding(diskText), encoding };
}

// The text saving writes: the editor text with the file's own line ending.
export function textForDisk(file: Pick<OpenFile, 'text' | 'lineEnding'>): string {
    return applyLineEnding(file.text, file.lineEnding);
}

// The bytes saving writes: the text for disk in the file's own encoding, or the characters that encoding can't hold.
export function bytesForDisk(file: Pick<OpenFile, 'text' | 'lineEnding' | 'encoding'>): EncodedText {
    return encodeText(textForDisk(file), file.encoding ?? 'utf-8');
}

export type DiffKind = 'text' | 'json' | 'yaml' | 'xml' | 'markdown' | 'rows';

export type DiffSideSource = 'file' | 'clipboard' | 'open-tab' | 'disk' | 'paste';

// One side of a compare: a workspace file, an open tab, a file from disk, the clipboard or pasted text.
export interface DiffSide {
    readonly label: string;
    readonly path?: string;
    readonly source: DiffSideSource;
    readonly text?: string;
    // Binary sources such as xlsx need the original file, not its text.
    readonly file?: File | null;
    // When pasted or edited text was put on the side, in milliseconds since the epoch.
    readonly pastedAt?: number;
    // Set when the text was typed in the side editor rather than pasted.
    readonly edited?: boolean;
}

// A tab that compares two sides; `state` is owned by the tab so the view comes back exactly as it was left.
export interface DiffTab {
    readonly id: string;
    readonly kind: 'diff';
    readonly diffKind: DiffKind;
    readonly original: DiffSide | null;
    readonly modified: DiffSide | null;
    readonly state: DiffViewState;
    // A compare started empty from "New compare": titled by its kind, kept for the session only.
    readonly scratch?: { readonly number: number };
}

export type OpenTab = OpenFile | DiffTab;

export interface AppState {
    readonly workspace: WorkspaceState | null;
    readonly workspaces: ReadonlyArray<WorkspaceRecord>;
    readonly tree: DirectoryEntry | null;
    readonly openFiles: ReadonlyArray<OpenFile>;
    readonly diffTabs: ReadonlyArray<DiffTab>;
    // Display order of every tab: file paths and diff tab ids. Kept in step with openFiles and diffTabs by the store.
    readonly tabOrder: ReadonlyArray<string>;
    // Path of the active file tab, or id of the active diff tab.
    readonly activePath: string | null;
    readonly activeSurface: SurfaceId;
    readonly expandedPaths: ReadonlySet<string>;
    readonly selectedPath: string | null;
    readonly theme: Theme;
    readonly busy: boolean;
}

export type AppListener = (state: AppState) => void;

const INITIAL_STATE: AppState = {
    workspace: null,
    workspaces: [],
    tree: null,
    openFiles: [],
    diffTabs: [],
    tabOrder: [],
    activePath: null,
    activeSurface: 'files',
    expandedPaths: new Set(),
    selectedPath: null,
    theme: 'light',
    busy: false,
};

export function isDiffTab(tab: OpenTab | null | undefined): tab is DiffTab {
    return tab != null && 'kind' in tab && tab.kind === 'diff';
}

export function tabId(tab: OpenTab): string {
    return isDiffTab(tab) ? tab.id : tab.path;
}

// Every open tab in display order.
export function orderedTabs(state: Pick<AppState, 'openFiles' | 'diffTabs' | 'tabOrder'>): OpenTab[] {
    const byId = new Map<string, OpenTab>();

    for (const file of state.openFiles) {
        byId.set(file.path, file);
    }

    for (const diff of state.diffTabs) {
        byId.set(diff.id, diff);
    }

    return state.tabOrder.flatMap((id) => {
        const tab = byId.get(id);

        return tab == null ? [] : [tab];
    });
}

// Keeps the previous order of tabs that are still open, places a new file next to the file it follows
// in openFiles, and appends new diff tabs at the end.
export function normalizeTabOrder(
    previous: ReadonlyArray<string>,
    openFiles: ReadonlyArray<OpenFile>,
    diffTabs: ReadonlyArray<DiffTab>,
): string[] {
    const filePaths = openFiles.map((file) => file.path);
    const live = new Set([...filePaths, ...diffTabs.map((diff) => diff.id)]);
    const order = [...new Set(previous)].filter((id) => live.has(id));
    const placed = new Set(order);

    filePaths.forEach((path, index) => {
        if (placed.has(path)) {
            return;
        }

        const before = filePaths.slice(0, index).reverse().find((candidate) => placed.has(candidate));
        const after = filePaths.slice(index + 1).find((candidate) => placed.has(candidate));

        if (before != null) {
            order.splice(order.indexOf(before) + 1, 0, path);
        }
        else if (after != null) {
            order.splice(order.indexOf(after), 0, path);
        }
        else {
            order.push(path);
        }

        placed.add(path);
    });

    for (const diff of diffTabs) {
        if (!placed.has(diff.id)) {
            order.push(diff.id);
            placed.add(diff.id);
        }
    }

    return order;
}

export class Store {
    private state: AppState = INITIAL_STATE;

    private readonly listeners = new Set<AppListener>();

    getState(): AppState {
        return this.state;
    }

    subscribe(listener: AppListener): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    update(patch: Partial<AppState>): void {
        const next = { ...this.state, ...patch };
        const tabsChanged = patch.openFiles != null || patch.diffTabs != null || patch.tabOrder != null;
        this.state = tabsChanged
            ? { ...next, tabOrder: normalizeTabOrder(next.tabOrder, next.openFiles, next.diffTabs) }
            : next;

        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    hydrateGlobals(session: GlobalSession): void {
        this.update({ theme: session.theme });
    }
}
