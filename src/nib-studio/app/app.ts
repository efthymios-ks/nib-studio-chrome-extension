import type { PersistedDiffTab, SurfaceId } from '../../common/fs/workspaceConfig.js';
import { DEFAULT_WORKSPACE_CONFIG, WORKSPACE_CONFIG_PATH, readWorkspaceConfigAsync, writeWorkspaceConfigAsync } from '../../common/fs/workspaceConfig.js';
import { loadSessionAsync, saveSessionAsync } from '../../common/session/sessionStore.js';
import type { DirectoryEntry, FileEntry } from '../../common/fs/fileEntry.js';
import { basename, isDirectoryEntry, joinPath, parentPath, remapPath } from '../../common/fs/fileEntry.js';
import { pruneEditorSessions, renameEditorSession } from '../editor/editorHost.js';
import { resolveFileType } from '../../common/fs/fileTypes.js';
import { ensurePermissionAsync, pickDirectoryAsync, queryPermissionAsync } from '../../common/fs/workspaceHandle.js';
import {
    addWorkspaceAsync,
    findWorkspaceAsync,
    getActiveWorkspaceAsync,
    listWorkspacesAsync,
    removeWorkspaceAsync,
    setActiveWorkspaceAsync,
    type WorkspaceRecord,
} from '../../common/fs/workspaceRegistry.js';
import { readTreeAsync } from '../../common/fs/directoryTree.js';
import { findWorkspaceEntryAsync } from '../../common/fs/entryLookup.js';
import { isTransientEntry } from '../../common/fs/transientEntry.js';
import { watchDirectoryAsync, type DirectoryWatcher } from '../../common/fs/directoryWatcher.js';
import {
    copyEntryAsync,
    createDirectoryAsync,
    createFileAsync,
    deleteEntryAsync,
    duplicateEntryAsync,
    entryExistsAsync,
    entryKindAsync,
    getDirectoryAsync,
    getFileAsync,
    listChildEntriesAsync,
    listChildNamesAsync,
    moveEntryAsync,
    readFileAsync,
    renameEntryAsync,
    writeBytesAsync,
    writeHandleAsync,
} from '../../common/fs/fileIo.js';
import { isNameTaken, nameTakenMessage, nextCopyName, takenNameMessage } from '../../common/fs/nextFreeName.js';
import { isLargeTableFile } from '../../common/csv/csvLimits.js';
import { detectLineEnding, normalizeLineEndings, type LineEnding } from '../../common/text/lineEndings.js';
import {
    preferredCodePage,
    readTextBlobAsync,
    textEncodingLabel,
    type EncodedBytes,
    type TextEncoding,
} from '../../common/text/textEncoding.js';
import { looksLikeTextFileAsync } from '../../common/text/textSniff.js';
import { openExplorerMenu, renderExplorer, type ClickKind } from '../explorer/explorerView.js';
import { registerDragDrop, detectCollisions, isDescendant, sourcesOutsideFolder, type DragDropHandle } from '../explorer/dragDrop.js';
import {
    focusFilesSurface,
    isDerivedFilesSurfaceView,
    notifyFilesSurfaceOfChanges,
    renameFilesSurfaceMemory,
    renderFilesSurface,
    revealInFilesSurface,
    selectInFilesSurface,
    setFilesSurfaceView,
} from '../views/filesSurface.js';
import type { WorkspaceLinkTarget } from '../views/workspaceLinks.js';
import { copyDiskTextAsync, diskCopyRefusal } from '../views/fileCopy.js';
import { renderHashSurface } from '../views/hashSurface.js';
import { onSheetLabelChange, pruneTableMemories, revealSheet } from '../views/tableViewer.js';
import { holdsNoText, pickViewer } from '../views/viewerKinds.js';
import { prunePreviewMemories } from '../views/previewFrame.js';
import { applyJsonTransform } from '../views/jsonActions.js';
import { applyYamlFormat, jsonFileAsYaml, yamlFileAsJson } from '../views/yamlActions.js';
import { showCompareChooserAsync, type CompareChoice } from '../views/compareChooser.js';
import { canExportDiffTab, exportDiffTabAsync, type DiffExportFormat } from '../views/diffExport.js';
import { showSavePagesDialogAsync, type OpenPdf } from '../views/pdfSavePagesDialog.js';
import { suggestPagesFileName } from '../../common/pdf/pagesFileName.js';
import type { DiffSideName } from '../views/diffSideHeader.js';
import type { DiffDropTarget } from '../views/diffTargetDropZone.js';
import { buildShell, setActiveSurface, updateThemeToggle, type ShellElements } from './shell.js';
import { renderStatusBar } from './statusBar.js';
import {
    displayPath,
    externalTabPath,
    isExternalPath,
    orderedTabs,
    Store,
    bytesForDisk,
    textFromDisk,
    type AppState,
    type DiffKind,
    type DiffSide,
    type DiffTab,
    type ExternalFile,
    type OpenFile,
} from './store.js';
import { registerDesktopDrop, type DesktopDropHandle } from './desktopDrop.js';
import { registerSaveShortcutGuard } from './saveShortcut.js';
import {
    canReadClipboard,
    freeClipboardName,
    isOpenablePaste,
    isPastedTab,
    pastedTab,
    pasteProblem,
    readClipboardPasteAsync,
    readClipboardTextAsync,
    type PastedFile,
} from './clipboardPaste.js';
import {
    isDroppedFile,
    isDroppedFolder,
    type DroppedFile,
    type DroppedFolder,
    type DroppedItem,
} from './droppedItems.js';
import {
    createDiffTab,
    createScratchDiffTab,
    DIFF_KIND_MENU_LABELS,
    DIFF_KINDS,
    diffKindForPath,
    isPersistableDiffTab,
    isWorkspaceFileSide,
    openDiffTab,
    pastedSide,
    persistableDiffTabs,
    remapDiffTab,
    setDiffTabKind,
    setDiffTabSide,
    swapDiffTab,
    workspaceFileSide,
} from './diffTabs.js';
import { applyTheme, nextTheme } from './theme.js';
import { toast } from './toast.js';
import { copyFailureMessage, copyTextAsync, copyTextWithToastAsync } from './clipboard.js';
import { confirmActionAsync, pickFileFromDiskAsync } from './dialogs.js';
import { showDialogAsync, type DialogPath } from './dialog.js';
import { showTextInputModalAsync } from './modal.js';
import { showCollisionDialogAsync, type CollisionChoice } from './collisionDialog.js';
import {
    EMPTY_SELECTION,
    orderedSelection,
    rowAfterRemoval,
    selectAll as selectAllPaths,
    selectOnly,
    selectRange,
    toggle as toggleSelection,
    type SelectionState,
} from '../explorer/selection.js';
import { registerTreeKeybindings, type TreeKeybindingHandle } from './keybindings.js';
import { buildContextMenu, compareViewForPair, type Command, type CommandContext, type SubCommand } from './commands.js';
import type { ContextMenuGroup } from '../explorer/contextMenu.js';
import { errorMessage, notValidMessage } from '../../common/errorMessage.js';
import { countLabel } from '../../common/paths/valueFormat.js';
import { firstMatchRange } from '../../common/lookup/lookupMatcher.js';
import type { LookupResult } from '../../common/lookup/lookupResults.js';
import { unlockedBytesOf } from '../../common/office/encryption/unlockedFiles.js';
import { passwordOfUnlockedPdf } from '../../common/pdf/unlockedPdfs.js';
import { createLookupBox, type LookupBox } from '../lookup/lookupBox.js';
import { createLookupClient, createLookupWorker, type LookupClient } from '../lookup/lookupClient.js';
import { readPdfTextAsync } from '../lookup/lookupPdfText.js';
import { requestPreviewFind } from '../views/previewFindRequests.js';
import { renderMermaidImageAsync } from '../views/diagramImage.js';
import { htmlDocumentToMarkdown } from '../editor/htmlToMarkdown.js';
import { markdownToHtmlDocumentAsync } from '../../common/markdown/markdownToHtml.js';

const CONFIG_WRITE_DEBOUNCE_MS = 400;
const WATCH_REFRESH_DEBOUNCE_MS = 150;
const COPY_CONTENT_WARN_BYTES = 10 * 1024 * 1024;

// The format Convert HTML to Markdown and Convert Markdown to HTML convert a document to.
type DocumentFormat = 'markdown' | 'html';

interface DocumentConversion {
    readonly extension: string;
    readonly formatName: string;
    // The document's text in the other format; the file name titles a page that has no heading.
    readonly convertAsync: (text: string, fileName: string) => Promise<string>;
}

const DOCUMENT_CONVERSIONS: Readonly<Record<DocumentFormat, DocumentConversion>> = Object.freeze({
    markdown: {
        extension: 'md',
        formatName: 'Markdown',
        convertAsync: async (text: string) => htmlDocumentToMarkdown(text),
    },
    html: {
        extension: 'html',
        formatName: 'HTML',
        // Mermaid diagrams are drawn as Export HTML draws them, so the page shows them offline with no script.
        convertAsync: async (text: string, fileName: string) => await markdownToHtmlDocumentAsync(text, {
            fileName,
            drawDiagramAsync: renderMermaidImageAsync,
        }),
    },
});

// The Lookup index of the open workspace, started the first time its box takes focus.
interface LookupSession {
    readonly workspaceId: string;
    readonly client: LookupClient;
}

interface ExplorerLocal {
    selection: SelectionState;
    focusedPath: string | null;
    visiblePaths: ReadonlyArray<string>;
}

export class App {
    private readonly store = new Store();

    private readonly shell: ShellElements;

    private configWriteTimer: number | null = null;

    private suppressConfigWrite = false;

    private watcher: DirectoryWatcher | null = null;

    private watchRefreshTimer: number | null = null;

    private readonly pendingChangedPaths = new Set<string>();

    private keybindingHandle: TreeKeybindingHandle | null = null;

    private dragDropHandle: DragDropHandle | null = null;

    private desktopDropHandle: DesktopDropHandle | null = null;

    private readonly removeSaveShortcutGuard: () => void;
    private readonly removeSheetLabelListener: () => void;

    // Numbers the tabs of files opened from outside the workspace.
    private externalTabCount = 0;

    private readonly commands: ReadonlyArray<Command>;

    private readonly lookupBox: LookupBox;

    private lookup: LookupSession | null = null;

    private readonly explorer: ExplorerLocal = {
        selection: EMPTY_SELECTION,
        focusedPath: null,
        visiblePaths: [],
    };

    constructor(root: HTMLElement) {
        this.shell = buildShell(root, {
            onSurfaceSwitch: (surface) => this.switchSurface(surface),
            onThemeToggle: () => this.toggleTheme(),
            onPickWorkspace: () => void this.pickWorkspaceAsync(),
            onOpenWorkspace: (id) => void this.switchWorkspaceAsync(id),
            onForgetWorkspace: (id) => void this.forgetWorkspaceAsync(id),
            onCollapseAll: () => void this.collapseAllAsync(),
            onExpandAll: () => void this.expandAllAsync(),
            getWorkspaces: () => this.store.getState().workspaces,
            getActiveWorkspaceId: () => this.store.getState().workspace?.id ?? null,
        });

        this.commands = this.buildCommandRegistry();
        this.lookupBox = createLookupBox({
            connect: () => this.connectLookup(),
            onOpen: (result, query) => void this.openLookupResultAsync(result, query),
            onReveal: (result) => this.revealInExplorer(result.path),
            onLeave: () => this.shell.explorer.focus({ preventScroll: true }),
        });
        this.shell.explorer.before(this.lookupBox.element);
        this.installExplorerIntegrations();
        this.removeSaveShortcutGuard = registerSaveShortcutGuard(root.ownerDocument, () => this.saveFromShortcut());
        // The status bar names the sheet a workbook shows, which changes without the store changing.
        this.removeSheetLabelListener = onSheetLabelChange(() => renderStatusBar(this.shell.status, this.store.getState()));
        this.store.subscribe((state) => this.onStateChange(state));
    }

    dispose(): void {
        this.keybindingHandle?.dispose();
        this.dragDropHandle?.dispose();
        this.desktopDropHandle?.dispose();
        this.keybindingHandle = null;
        this.dragDropHandle = null;
        this.desktopDropHandle = null;
        this.shell.explorerDrawer.dispose();
        this.removeSaveShortcutGuard();
        this.removeSheetLabelListener();
        this.disposeWatcher();
        this.lookupBox.dispose();
        this.disposeLookup();

        // A configuration write still waiting would otherwise run, and read the tree, after the studio is gone.
        if (this.configWriteTimer != null) {
            window.clearTimeout(this.configWriteTimer);
            this.configWriteTimer = null;
        }
    }

    async bootstrapAsync(): Promise<void> {
        this.suppressConfigWrite = true;

        const session = await loadSessionAsync();
        this.store.hydrateGlobals(session);
        applyTheme(session.theme);

        const workspaces = await listWorkspacesAsync();
        this.store.update({ workspaces });

        const active = await getActiveWorkspaceAsync();

        if (active != null) {
            const permission = await queryPermissionAsync(active.handle, 'readwrite');

            if (permission === 'granted') {
                await this.activateWorkspaceAsync(active);
            }
            else {
                toast(`Click "Re-open last workspace" to resume ${active.name}.`, 'info');
            }
        }

        this.suppressConfigWrite = false;
        this.renderAll();
    }

    private installExplorerIntegrations(): void {
        this.keybindingHandle = registerTreeKeybindings(this.shell.explorer, {
            getFocusedPath: () => this.explorer.focusedPath,
            getVisiblePaths: () => this.explorer.visiblePaths,
            isDirectory: (path) => this.isDirectory(path),
            isExpanded: (path) => this.store.getState().expandedPaths.has(path),
            getParentOf: (path) => parentPath(path),
            getFirstChildOf: (path) => this.firstChildOf(path),
            focusPath: (path) => this.focusPath(path),
            onOpen: (path) => this.openFromExplorer(path),
            onExpand: (path) => this.expandFolder(path),
            onCollapse: (path) => this.collapseFolder(path),
            onRename: (path) => void this.renameAsync(path),
            onDelete: () => void this.deleteCurrentSelectionAsync(),
            onDuplicate: (path) => void this.duplicateAsync(path),
            onSelectAll: () => this.selectAllVisible(),
            onClearSelection: () => this.setSelection(EMPTY_SELECTION),
        });

        const canImport = (): boolean => this.store.getState().workspace != null;

        this.dragDropHandle = registerDragDrop(this.shell.explorer, {
            getSelectedPaths: () => [...this.explorer.selection.selectedPaths],
            isDirectory: (path) => this.isDirectory(path),
            expandFolder: (path) => this.expandFolder(path),
            canImport,
            onDrop: (sources, target) => void this.promptMoveOrCopyAsync(sources, target),
            onDropFromDesktop: (items, target) => void this.importDroppedItemsAsync(items, target),
        });

        this.desktopDropHandle = registerDesktopDrop({
            sidebar: this.shell.sidebar,
            main: this.shell.main,
            canImport,
            onOpen: (items) => void this.openDroppedItemsAsync(items),
            onClear: () => this.dragDropHandle?.clearHighlight(),
        });
    }

    // Each dropped file opens in a tab; then the first dropped folder, if any, is offered as the workspace.
    private async openDroppedItemsAsync(pending: Promise<DroppedItem[]>): Promise<void> {
        const items = await pending;
        const files = items.filter(isDroppedFile);

        if (files.length > 0) {
            this.store.update({ activeSurface: 'files' });
        }

        for (const file of files) {
            await this.openDroppedFileAsync(file);
        }

        const folder = items.find(isDroppedFolder);

        if (folder != null) {
            await this.offerFolderAsWorkspaceAsync(folder);
        }
    }

    // A file inside the workspace opens as that workspace file; any other opens in a tab of its own.
    // A file the app has just saved opens without the outside-the-workspace toast, so only "Saved" shows.
    private async openDroppedFileAsync(item: DroppedFile, options: { announce: boolean } = { announce: true }): Promise<void> {
        const path = await this.workspacePathOfAsync(item.handle);

        if (path == null) {
            await this.openExternalFileAsync(item, options);

            return;
        }

        await this.openFileAsync(path, { preview: false });
        this.revealInTree(path);
    }

    private async openExternalFileAsync(item: DroppedFile, options: { announce: boolean } = { announce: true }): Promise<void> {
        const open = await this.findExternalTabAsync(item.handle);

        if (open != null) {
            this.store.update({ activePath: open.path });

            return;
        }

        const contents = await readDroppedFileAsync(item);

        if (contents == null) {
            toast(`Could not read ${item.name}.`, 'fail');

            return;
        }

        this.externalTabCount += 1;
        const path = externalTabPath(this.externalTabCount, item.name);
        this.chooseViewForOpenedFile(item.name, false);
        const next: OpenFile = {
            path,
            ...textFromDisk(contents.text, contents.encoding),
            dirty: false,
            view: 'editor',
            file: contents.file,
            preview: false,
            large: contents.large,
            ...(contents.binary ? { binary: true } : {}),
            external: { handle: item.handle },
        };
        this.store.update({
            openFiles: [...this.store.getState().openFiles, next],
            activePath: path,
        });

        if (options.announce) {
            toast(`Opened ${item.name} from outside the workspace.`, 'info');
        }
    }

    private async findExternalTabAsync(handle: FileSystemFileHandle | null): Promise<OpenFile | null> {
        if (handle == null) {
            return null;
        }

        for (const file of this.store.getState().openFiles) {
            const own = file.external?.handle;

            if (own != null && await own.isSameEntry(handle)) {
                return file;
            }
        }

        return null;
    }

    // The path of a dropped item inside the workspace, '' for the workspace folder itself, or null when it lies outside.
    private async workspacePathOfAsync(handle: FileSystemHandle | null): Promise<string | null> {
        const workspace = this.store.getState().workspace;

        if (workspace == null || handle == null) {
            return null;
        }

        try {
            const segments = await workspace.handle.resolve(handle);

            return segments == null ? null : segments.join('/');
        }
        catch {
            return null;
        }
    }

    private async offerFolderAsWorkspaceAsync(folder: DroppedFolder): Promise<void> {
        if (folder.handle == null) {
            toast(`${folder.name} can't be opened from a drop here. Use Open folder… in the workspace menu.`, 'warn');

            return;
        }

        const workspace = this.store.getState().workspace;

        if (workspace != null && await workspace.handle.isSameEntry(folder.handle)) {
            toast(`${folder.name} is already the open workspace.`, 'info');

            return;
        }

        const confirmed = await confirmActionAsync({
            title: 'Open folder',
            body: `Open ${folder.name} as a workspace?`,
            confirmLabel: 'Open',
        });

        if (!confirmed) {
            return;
        }

        try {
            await this.openFolderAsWorkspaceAsync(folder.handle);
        }
        catch (error) {
            toast(errorMessage(error, `Could not open ${folder.name}.`), 'fail');
        }
    }

    // Items already in the target folder stay where they are, unasked about; a drop of only such items does nothing.
    private async promptMoveOrCopyAsync(
        dropped: ReadonlyArray<string>,
        targetFolder: string,
    ): Promise<void> {
        const sources = sourcesOutsideFolder(dropped, targetFolder);

        if (sources.length === 0) {
            return;
        }

        const dialogPaths: DialogPath[] = [
            ...sources.map((source) => ({ label: 'From', path: source })),
            // A folder is written with its slash, as everywhere else; the root says so in words.
            { label: 'To', path: targetFolder === '' ? '' : `${targetFolder}/` },
        ];
        const body = sources.length === 1
            ? 'Move or copy the item into the target folder?'
            : `Move or copy ${sources.length} items into the target folder?`;
        const result = await showDialogAsync({
            title: 'Move or copy',
            body,
            paths: dialogPaths,
            kind: {
                kind: 'two-button',
                confirmLabel: 'Move',
                cancelLabel: 'Copy',
            },
        });

        if (result.outcome === 'yes') {
            await this.moveEntriesAsync(sources, targetFolder);

            return;
        }

        if (result.outcome === 'no') {
            await this.copyEntriesAsync(sources, targetFolder);
        }
    }

    // Asks for read and write access before anything changes, so a refused folder is neither remembered
    // nor saved as the active workspace, and the open workspace stays as it is.
    private async isFolderAccessGrantedAsync(handle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
        if (await ensurePermissionAsync(handle, 'readwrite') === 'granted') {
            return true;
        }

        this.reportRefusedFolder(name);

        return false;
    }

    private reportRefusedFolder(name: string | null): void {
        const folder = name ?? 'the folder';
        const current = this.store.getState().workspace?.name;
        const message = current == null
            ? `Nib Studio was not allowed to open ${folder}.`
            : `Nib Studio was not allowed to open ${folder}, so ${current} stays open.`;
        toast(message, 'warn');
    }

    private async activateWorkspaceAsync(record: WorkspaceRecord): Promise<void> {
        if (!await this.isFolderAccessGrantedAsync(record.handle, record.name)) {
            return;
        }

        this.disposeWatcher();
        this.disposeLookup();
        this.suppressConfigWrite = true;
        this.explorer.selection = EMPTY_SELECTION;
        this.explorer.focusedPath = null;
        this.store.update({
            workspace: { id: record.id, handle: record.handle, name: record.name },
            ...this.tabsOutsideWorkspace(),
            activePath: null,
            selectedPath: null,
            expandedPaths: new Set(),
        });

        await this.refreshTreeAsync();
        const config = await readWorkspaceConfigAsync(record.handle);

        this.store.update({
            activeSurface: config.activeSurface,
            expandedPaths: new Set(config.expandedPaths),
        });
        await this.refreshTreeAsync();
        await this.restoreOpenFilesAsync(config.openFiles, config.activePath);
        await this.restoreDiffTabsAsync(config.diffTabs, config.activeDiffTab);
        this.activateFirstKeptTab();
        await this.startWatcherAsync(record.handle);
        this.suppressConfigWrite = false;
    }

    // The tabs kept across a workspace change stay in view: when the new workspace restores no active tab of its own,
    // the first tab left, in tab order, becomes the active one.
    private activateFirstKeptTab(): void {
        const { activePath, tabOrder } = this.store.getState();

        if (activePath != null || tabOrder.length === 0) {
            return;
        }

        this.store.update({ activePath: tabOrder[0] ?? null });
    }

    private async startWatcherAsync(handle: FileSystemDirectoryHandle): Promise<void> {
        try {
            this.watcher = await watchDirectoryAsync(handle, (event) => {
                if (event.path === WORKSPACE_CONFIG_PATH) {
                    return;
                }

                this.lookup?.client.applyChanges([event]);
                this.pendingChangedPaths.add(event.path);
                this.scheduleWatchRefresh();
            }, { recursive: true });
        }
        catch {
            // Directory watching is best-effort; the Refresh command still works.
        }
    }

    private disposeWatcher(): void {
        if (this.watcher != null) {
            this.watcher.dispose();
            this.watcher = null;
        }

        if (this.watchRefreshTimer != null) {
            window.clearTimeout(this.watchRefreshTimer);
            this.watchRefreshTimer = null;
        }

        this.pendingChangedPaths.clear();
    }

    private scheduleWatchRefresh(): void {
        if (this.watchRefreshTimer != null) {
            window.clearTimeout(this.watchRefreshTimer);
        }

        this.watchRefreshTimer = window.setTimeout(() => {
            this.watchRefreshTimer = null;
            void this.flushWatchRefreshAsync();
        }, WATCH_REFRESH_DEBOUNCE_MS);
    }

    private async flushWatchRefreshAsync(): Promise<void> {
        const paths = [...this.pendingChangedPaths];
        this.pendingChangedPaths.clear();
        await this.refreshTreeAsync();
        await this.reloadOpenFilesAsync(paths);
        notifyFilesSurfaceOfChanges(paths);
    }

    private async reloadOpenFilesAsync(changedPaths: ReadonlyArray<string>): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null || changedPaths.length === 0) {
            return;
        }

        const changed = new Set(changedPaths);
        const updates = new Map<string, Pick<OpenFile, 'text' | 'originalText' | 'lineEnding'>>();
        const snapshots = new Map<string, File>();

        for (const file of state.openFiles) {
            if (!changed.has(file.path)) {
                continue;
            }

            if (file.path === WORKSPACE_CONFIG_PATH) {
                continue;
            }

            if (holdsNoTextInMemory(file) || resolveFileType(basename(file.path)).id === 'excel') {
                // Large tables, documents and previews never hold their text, and workbooks are read from their File;
                // a fresh snapshot makes the table index or read the new content and a preview show the new file.
                try {
                    const snapshot = await getFileAsync(state.workspace.handle, file.path);

                    if (snapshot.size !== file.file?.size || snapshot.lastModified !== file.file.lastModified) {
                        snapshots.set(file.path, snapshot);
                    }
                }
                catch {
                    // The file may have been removed between events.
                }

                continue;
            }

            if (file.dirty) {
                toast(`${basename(file.path)} changed on disk; local edits kept.`, 'warn');
                continue;
            }

            try {
                const read = await readFileAsync(state.workspace.handle, file.path);
                const reloaded = textFromDisk(read.text, read.encoding);

                // Line endings or the encoding alone are no change to the text, but saving keeps what the file has on disk.
                if (
                    reloaded.text !== file.text
                    || reloaded.lineEnding !== file.lineEnding
                    || reloaded.encoding !== (file.encoding ?? 'utf-8')
                ) {
                    updates.set(file.path, reloaded);
                }
            }
            catch {
                // Skip unreadable files — they may have been removed between events.
            }
        }

        await this.reloadDiffSidesAsync(changed);

        if (updates.size === 0 && snapshots.size === 0) {
            return;
        }

        const next = state.openFiles.map((file) => {
            const snapshot = snapshots.get(file.path);

            if (snapshot != null) {
                return { ...file, file: snapshot, large: isLargeTableFile(file.path, snapshot.size) };
            }

            const reloaded = updates.get(file.path);

            if (reloaded == null) {
                return file;
            }

            return { ...file, ...reloaded, dirty: false };
        });
        this.store.update({ openFiles: next });
    }

    private async restoreOpenFilesAsync(
        paths: ReadonlyArray<string>,
        activePath: string | null,
    ): Promise<void> {
        for (const path of paths) {
            await this.openFileAsync(path, { silent: true });
        }

        if (activePath != null && paths.includes(activePath)) {
            this.store.update({ activePath, selectedPath: activePath });
            this.explorer.focusedPath = activePath;
        }
    }

    // Reopens the diff tabs between workspace files, reading both sides again, at their old places among the tabs.
    private async restoreDiffTabsAsync(persisted: ReadonlyArray<PersistedDiffTab>, activeIndex: number | null): Promise<void> {
        const restored: Array<{ tab: DiffTab; position: number; index: number }> = [];

        for (const [index, entry] of persisted.entries()) {
            const original = await this.sideForPathAsync(entry.original);
            const modified = await this.sideForPathAsync(entry.modified);

            if (original == null && modified == null) {
                continue;
            }

            restored.push({ tab: createDiffTab(original, modified), position: entry.position, index });
        }

        if (restored.length === 0) {
            return;
        }

        const state = this.store.getState();
        const order = [...state.tabOrder];

        for (const item of [...restored].sort((left, right) => left.position - right.position)) {
            order.splice(Math.min(item.position, order.length), 0, item.tab.id);
        }

        const active = restored.find((item) => item.index === activeIndex)?.tab.id ?? state.activePath;
        this.store.update({
            diffTabs: [...state.diffTabs, ...restored.map((item) => item.tab)],
            tabOrder: order,
            activePath: active,
        });
    }

    private onStateChange(state: AppState): void {
        pruneEditorSessions(state.openFiles.map((file) => file.path));
        pruneTableMemories(state.openFiles.map((file) => file.path));
        prunePreviewMemories(state.openFiles.map((file) => file.path));
        setActiveSurface(this.shell.surfaceTabs, state.activeSurface);
        updateThemeToggle(this.shell.themeToggle, state.theme);
        this.shell.workspaceLabel.textContent = state.workspace?.name ?? 'No workspace';
        this.shell.body.dataset['surface'] = state.activeSurface;
        this.lookupBox.setAvailable(state.workspace != null);
        this.renderSidebar(state);
        this.renderMain(state);
        renderStatusBar(this.shell.status, state);
        void saveSessionAsync({ theme: state.theme });
        this.scheduleConfigWrite();
    }

    private renderAll(): void {
        this.onStateChange(this.store.getState());
    }

    private renderSidebar(state: AppState): void {
        const render = renderExplorer(this.shell.explorer, {
            tree: state.tree,
            openPaths: new Set(state.openFiles.map((file) => file.path)),
            dirtyPaths: new Set(state.openFiles.filter((file) => file.dirty).map((file) => file.path)),
            selection: this.explorer.selection,
            focusedPath: this.explorer.focusedPath,
        }, {
            onToggleFolder: (path) => this.toggleExpanded(path),
            onOpen: (path) => this.openFromExplorer(path),
            onSelectClick: (path, kind) => this.handleSelectClick(path, kind),
            onContextMenu: (event, path) => this.showTreeContextMenu(event, path),
        });

        this.explorer.visiblePaths = render.visiblePaths;
    }

    private renderMain(state: AppState): void {
        const container = this.shell.main;
        const activeFile = state.openFiles.find((file) => file.path === state.activePath) ?? null;
        const activeDiff = state.diffTabs.find((tab) => tab.id === state.activePath) ?? null;

        if (state.activeSurface === 'files') {
            renderFilesSurface(container, {
                workspaceOpen: state.workspace != null,
                tabs: orderedTabs(state),
                activeId: state.activePath,
                activeFile,
                activeDiff: activeDiff == null ? null : withLiveSides(activeDiff, state.openFiles),
                workspaceRoot: state.workspace?.handle ?? null,
            }, {
                onActivate: (id) => this.activateFile(id),
                onClose: (id) => void this.closeFileAsync(id),
                onChange: (path, text) => this.markChange(path, text),
                onSave: (path) => void this.saveAsync(path),
                onPickWorkspace: () => void this.pickWorkspaceAsync(),
                onReopenWorkspace: () => void this.reopenWorkspaceAsync(),
                onTabContextMenu: (event, id) => this.showTabContextMenu(event, id),
                onPromoteTab: (path) => this.promoteFileToPermanent(path),
                onCompareWith: (path, anchor) => void this.compareWithChooserAsync(path, anchor),
                onNewCompare: (event) => this.showNewCompareMenu(event),
                onSavePdfPages: (path, open) => void this.savePdfPagesAsync(path, open),
                onOpenLink: (target) => void this.openWorkspaceLinkAsync(target),
                onConvertJsonToYaml: (path, text) => this.convertJsonTextToYaml(path, text),
                onConvertHtmlToMarkdown: (path, text) => void this.convertDocumentTextAsync(path, text, 'markdown'),
                onConvertMarkdownToHtml: (path, text) => void this.convertDocumentTextAsync(path, text, 'html'),
                diffTab: {
                    onSetSide: (tabId, side, target) => this.setDiffSide(tabId, side, target),
                    onClearSide: (tabId, side) => this.updateDiffTab(tabId, (tab) => setDiffTabSide(tab, side, null)),
                    onSetKind: (tabId, kind) => this.updateDiffTab(tabId, (tab) => setDiffTabKind(tab, kind)),
                    onSwap: (tabId) => this.swapDiffSides(tabId),
                    onPickSide: (tabId, side, anchor) => void this.pickDiffSideAsync(tabId, side, anchor),
                    onPickDiskFileAsync: async () => {
                        const picked = await this.pickComparableDiskFileAsync();

                        return picked == null ? null : { kind: 'disk', ...picked };
                    },
                    readWorkspaceFileAsync: async (path) => await this.readDropTargetAsync(path),
                },
            });

            return;
        }

        renderHashSurface(container);
    }

    private switchSurface(surface: SurfaceId): void {
        this.store.update({ activeSurface: surface });
    }

    private toggleTheme(): void {
        const next = nextTheme(this.store.getState().theme);
        applyTheme(next);
        this.store.update({ theme: next });
    }

    private toggleExpanded(path: string): void {
        if (path === '') {
            return;
        }

        const expanded = new Set(this.store.getState().expandedPaths);

        if (expanded.has(path)) {
            expanded.delete(path);
        }
        else {
            expanded.add(path);
        }

        this.store.update({ expandedPaths: expanded });
        void this.refreshTreeAsync();
    }

    private expandFolder(path: string): void {
        if (path === '' || this.store.getState().expandedPaths.has(path)) {
            return;
        }

        const expanded = new Set(this.store.getState().expandedPaths);
        expanded.add(path);
        this.store.update({ expandedPaths: expanded });
        void this.refreshTreeAsync();
    }

    private collapseFolder(path: string): void {
        if (path === '' || !this.store.getState().expandedPaths.has(path)) {
            return;
        }

        const expanded = new Set(this.store.getState().expandedPaths);
        expanded.delete(path);
        this.store.update({ expandedPaths: expanded });
        void this.refreshTreeAsync();
    }

    private handleSelectClick(path: string, kind: ClickKind): void {
        if (kind === 'toggle') {
            this.setSelection(toggleSelection(this.explorer.selection, path));
            this.explorer.focusedPath = path;

            return;
        }

        if (kind === 'range') {
            const anchor = this.explorer.selection.anchorPath ?? this.explorer.focusedPath;
            this.setSelection(selectRange(this.explorer.selection, this.explorer.visiblePaths, anchor, path));
            this.explorer.focusedPath = path;

            return;
        }

        this.setSelection(selectOnly(this.explorer.selection, path));
        this.explorer.focusedPath = path;
        this.store.update({ selectedPath: path });

        // Single plain click on a file opens it in the one shared preview tab.
        if (!this.isDirectory(path)) {
            this.shell.explorerDrawer.close();
            void this.openFileAsync(path, { preview: true });
        }
    }

    // Choosing a file from the narrow-layout drawer hands the screen back to the editor.
    private openFromExplorer(path: string): void {
        if (!this.isDirectory(path)) {
            this.shell.explorerDrawer.close();
        }

        void this.openFileAsync(path);
    }

    private setSelection(next: SelectionState): void {
        this.explorer.selection = next;
        const singleSelection = next.selectedPaths.size === 1
            ? next.anchorPath ?? [...next.selectedPaths][0] ?? null
            : null;
        this.store.update({ selectedPath: singleSelection });
    }

    private focusPath(path: string): void {
        this.explorer.focusedPath = path;
        this.setSelection(selectOnly(this.explorer.selection, path));
        this.renderAll();
    }

    private selectAllVisible(): void {
        this.setSelection(selectAllPaths(this.explorer.selection, this.explorer.visiblePaths));
        this.renderAll();
    }

    private firstChildOf(path: string): string | null {
        const entry = this.findEntry(path);

        if (entry == null || !isDirectoryEntry(entry)) {
            return null;
        }

        return entry.children[0]?.path ?? null;
    }

    private isDirectory(path: string): boolean {
        const entry = this.findEntry(path);

        return entry != null && isDirectoryEntry(entry);
    }

    private findEntry(path: string): FileEntry | null {
        const tree = this.store.getState().tree;

        if (tree == null) {
            return null;
        }

        return findInTree(tree, path);
    }

    private async pickWorkspaceAsync(): Promise<void> {
        try {
            const picked = await pickDirectoryAsync();

            if (picked.outcome === 'refused') {
                this.reportRefusedFolder(null);

                return;
            }

            if (picked.outcome === 'cancelled') {
                return;
            }

            const handle = picked.handle;
            const workspace = this.store.getState().workspace;

            if (workspace != null && await workspace.handle.isSameEntry(handle)) {
                toast(`${handle.name} is already the open workspace.`, 'info');

                return;
            }

            // Unsaved files are settled after the picker, which needs the click.
            await this.openFolderAsWorkspaceAsync(handle);
        }
        catch (error) {
            toast(errorMessage(error, 'Could not open folder.'), 'fail');
        }
    }

    // Open as workspace makes a folder in the tree the workspace, the same way Open folder… does with a picked one.
    // Its handle is walked down from the workspace root; the registry knows the folder again if it holds it already.
    private async openAsWorkspaceAsync(path: string): Promise<void> {
        const workspace = this.store.getState().workspace;

        if (workspace == null || path === '') {
            return;
        }

        try {
            const handle = await getDirectoryAsync(workspace.handle, path);
            await this.openFolderAsWorkspaceAsync(handle);
        }
        catch (error) {
            toast(errorMessage(error, `Could not open ${basename(path)}.`), 'fail');
        }
    }

    // Asks for access, settles the unsaved workspace files, then remembers the folder, or reuses its entry,
    // and makes it the workspace; the old workspace's tabs close, the folder's saved tabs open,
    // and the old workspace stays in the switcher. A remembered folder is asked about through its own entry.
    private async openFolderAsWorkspaceAsync(handle: FileSystemDirectoryHandle): Promise<void> {
        const known = await findWorkspaceAsync(handle);

        if (!await this.isFolderAccessGrantedAsync(known?.handle ?? handle, handle.name)) {
            return;
        }

        if (!await this.settleUnsavedBeforeWorkspaceChangeAsync()) {
            return;
        }

        const record = await addWorkspaceAsync(handle);
        this.store.update({ workspaces: await listWorkspacesAsync() });
        await this.activateWorkspaceAsync(record);
    }

    private async reopenWorkspaceAsync(): Promise<void> {
        const active = await getActiveWorkspaceAsync();

        if (active == null) {
            toast('No workspace to re-open yet.', 'warn');

            return;
        }

        await this.activateWorkspaceAsync(active);
    }

    private async switchWorkspaceAsync(id: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace?.id === id) {
            return;
        }

        const record = state.workspaces.find((workspace) => workspace.id === id);

        if (record == null) {
            toast('That workspace is no longer registered.', 'warn');

            return;
        }

        if (!await this.isFolderAccessGrantedAsync(record.handle, record.name)) {
            return;
        }

        if (!await this.settleUnsavedBeforeWorkspaceChangeAsync()) {
            return;
        }

        await setActiveWorkspaceAsync(id);
        await this.activateWorkspaceAsync(record);
    }

    // Files from outside the workspace, and compares with no workspace file side, belong to no folder,
    // so they stay open when the workspace is switched or forgotten.
    private tabsOutsideWorkspace(): Pick<AppState, 'openFiles' | 'diffTabs' | 'tabOrder'> {
        const state = this.store.getState();
        const diffTabs = state.diffTabs
            .filter((tab) => !isWorkspaceFileSide(tab.original) && !isWorkspaceFileSide(tab.modified));
        const openFiles = state.openFiles.filter((file) => file.external != null);
        const kept = new Set([...openFiles.map((file) => file.path), ...diffTabs.map((tab) => tab.id)]);

        return { openFiles, diffTabs, tabOrder: state.tabOrder.filter((tabId) => kept.has(tabId)) };
    }

    private async forgetWorkspaceAsync(id: string): Promise<void> {
        const state = this.store.getState();
        const record = state.workspaces.find((workspace) => workspace.id === id);

        if (record == null) {
            return;
        }

        const confirmed = await confirmActionAsync({
            title: 'Forget workspace',
            body: `Forget "${record.name}" from the list? Files on disk are not touched.`,
            confirmLabel: 'Forget',
        });

        if (!confirmed) {
            return;
        }

        if (state.workspace?.id === id && !await this.settleUnsavedBeforeWorkspaceChangeAsync()) {
            return;
        }

        await removeWorkspaceAsync(id);
        const workspaces = await listWorkspacesAsync();
        this.store.update({ workspaces });

        if (state.workspace?.id === id) {
            this.disposeLookup();
            this.suppressConfigWrite = true;
            this.explorer.selection = EMPTY_SELECTION;
            this.explorer.focusedPath = null;
            const kept = this.tabsOutsideWorkspace();
            const activePath = this.store.getState().activePath;
            this.store.update({
                workspace: null,
                tree: null,
                ...kept,
                activePath: activePath != null && kept.tabOrder.includes(activePath) ? activePath : kept.tabOrder[0] ?? null,
                selectedPath: null,
                expandedPaths: new Set(),
            });
            this.suppressConfigWrite = false;
        }

        toast(`Forgot "${record.name}".`, 'ok');
    }

    private async collapseAllAsync(): Promise<void> {
        this.store.update({ expandedPaths: new Set() });
        await this.refreshTreeAsync();
    }

    private async expandAllAsync(): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            return;
        }

        const paths = new Set<string>();
        await collectAllFolderPathsAsync(state.workspace.handle, '', paths);
        this.store.update({ expandedPaths: paths });
        await this.refreshTreeAsync();
    }

    private async refreshTreeAsync(): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            this.store.update({ tree: null });

            return;
        }

        try {
            const tree = await readTreeAsync(state.workspace.handle, { expandedPaths: state.expandedPaths });
            this.store.update({ tree });
        }
        catch (error) {
            toast(errorMessage(error, 'Could not read the workspace.'), 'fail');
        }
    }

    // A Markdown or HTML file opens in Preview, to be read first; a file just created opens in Editor, to be written.
    // Other files keep the current view when they offer it.
    private chooseViewForOpenedFile(name: string, isNew: boolean): void {
        if (isNew) {
            setFilesSurfaceView('editor');

            return;
        }

        const typeId = resolveFileType(name).id;

        if (typeId === 'markdown' || typeId === 'html') {
            setFilesSurfaceView('preview');
        }
    }

    // Follows a link clicked in a Markdown or HTML preview. A file opens in a permanent tab and shows in the tree;
    // with a `#heading`, a Markdown or HTML file opens in Preview at that heading.
    // A folder opens in the Explorer, which comes into view. Names match case-insensitively when they don't match exactly.
    private async openWorkspaceLinkAsync(target: WorkspaceLinkTarget): Promise<void> {
        const workspace = this.store.getState().workspace;

        if (workspace == null) {
            return;
        }

        const entry = await findWorkspaceEntryAsync(workspace.handle, target.path);

        if (entry == null) {
            toast(`${target.path} isn't in the workspace.`, 'warn');

            return;
        }

        if (entry.kind === 'directory') {
            this.revealFolder(entry.path);

            return;
        }

        const typeId = resolveFileType(basename(entry.path)).id;

        if (target.fragment != null && (typeId === 'markdown' || typeId === 'html')) {
            setFilesSurfaceView('preview');
            revealInFilesSurface(entry.path, target.fragment);
        }

        await this.openFileAsync(entry.path, { preview: false });
        this.revealInTree(entry.path);
        this.selectInTree(entry.path);
    }

    // Expands a folder and the folders around it, then selects it and scrolls it into view;
    // the Explorer comes into view to show it, shown again when hidden or slid in as the drawer on a narrow screen.
    private revealFolder(path: string): void {
        if (path === '') {
            return;
        }

        const expanded = new Set(this.store.getState().expandedPaths);

        for (let folder = path; folder !== ''; folder = parentPath(folder)) {
            expanded.add(folder);
        }

        this.store.update({ expandedPaths: expanded });
        this.selectInTree(path);
        this.shell.showExplorer();
        void this.refreshTreeThenScrollAsync(path);
    }

    private selectInTree(path: string): void {
        this.explorer.focusedPath = path;
        this.setSelection(selectOnly(this.explorer.selection, path));
    }

    private async openFileAsync(
        path: string,
        options?: { silent?: boolean; preview?: boolean; isNew?: boolean },
    ): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            return;
        }

        const preview = options?.preview ?? false;
        const existing = state.openFiles.find((file) => file.path === path);

        if (existing != null) {
            if (!preview && existing.preview) {
                const promoted = state.openFiles.map((file) => file.path === path
                    ? { ...file, preview: false }
                    : file);
                this.store.update({
                    openFiles: promoted,
                    activePath: path,
                    selectedPath: path,
                });

                return;
            }

            this.activateFile(path);

            return;
        }

        try {
            const snapshot = await getFileAsync(state.workspace.handle, path);
            const large = isLargeTableFile(path, snapshot.size);
            const binary = await isBinaryFileAsync(basename(path), snapshot);
            const next: OpenFile = {
                path,
                ...await textOfSnapshotAsync(snapshot, large || binary || holdsNoText(basename(path))),
                dirty: false,
                view: 'editor',
                file: snapshot,
                preview,
                large,
                ...(binary ? { binary } : {}),
            };

            let openFiles: OpenFile[];
            this.chooseViewForOpenedFile(basename(path), options?.isNew ?? false);

            if (preview) {
                const previewIndex = state.openFiles.findIndex((file) => file.preview);

                if (previewIndex >= 0) {
                    openFiles = state.openFiles.slice();
                    openFiles[previewIndex] = next;
                }
                else {
                    openFiles = [...state.openFiles, next];
                }
            }
            else {
                openFiles = [...state.openFiles, next];
            }

            this.store.update({
                openFiles,
                activePath: next.path,
                selectedPath: next.path,
            });
        }
        catch (error) {
            if (options?.silent !== true) {
                toast(errorMessage(error, 'Could not open file.'), 'fail');
            }
        }
    }

    private promoteFileToPermanent(path: string): void {
        const state = this.store.getState();
        const file = state.openFiles.find((item) => item.path === path);

        if (file == null || !file.preview) {
            return;
        }

        const updated = state.openFiles.map((item) => item.path === path
            ? { ...item, preview: false }
            : item);
        this.store.update({ openFiles: updated });
    }

    // Activates a file tab, or a diff tab, which reveals its modified side when that is a workspace file.
    private activateFile(id: string): void {
        const diff = this.store.getState().diffTabs.find((tab) => tab.id === id);

        if (diff != null) {
            const reveal = isWorkspaceFileSide(diff.modified) ? diff.modified.path : null;
            this.store.update({ activePath: id, selectedPath: reveal ?? this.store.getState().selectedPath });

            if (reveal != null) {
                this.revealInTree(reveal);
            }

            return;
        }

        if (isExternalPath(id)) {
            this.store.update({ activePath: id });

            return;
        }

        this.store.update({ activePath: id, selectedPath: id });
        this.revealInTree(id);
    }

    // The tab that becomes active when the ones in `closing` close: the nearest one to the right, else to the left.
    private nextActiveAfterClose(closing: ReadonlySet<string>): string | null {
        const state = this.store.getState();

        if (state.activePath == null || !closing.has(state.activePath)) {
            return state.activePath;
        }

        const index = state.tabOrder.indexOf(state.activePath);
        const after = state.tabOrder.slice(index + 1).find((id) => !closing.has(id));
        const before = state.tabOrder.slice(0, Math.max(0, index)).reverse().find((id) => !closing.has(id));

        return after ?? before ?? null;
    }

    private closeTabs(closing: ReadonlySet<string>): void {
        const state = this.store.getState();
        const activePath = this.nextActiveAfterClose(closing);
        this.store.update({
            openFiles: state.openFiles.filter((file) => !closing.has(file.path)),
            diffTabs: state.diffTabs.filter((tab) => !closing.has(tab.id)),
            activePath,
        });
    }

    private async closeFileAsync(path: string): Promise<void> {
        const state = this.store.getState();

        if (state.diffTabs.some((tab) => tab.id === path)) {
            this.closeTabs(new Set([path]));

            return;
        }

        const file = state.openFiles.find((item) => item.path === path);

        if (file != null && file.dirty) {
            const confirmed = await confirmActionAsync({
                title: 'Discard unsaved changes',
                body: `Discard unsaved changes in ${basename(path)}?`,
                paths: [{ label: 'File', path: displayPath(path) }],
                confirmLabel: 'Discard',
                tone: 'danger',
            });

            if (!confirmed) {
                return;
            }
        }

        this.closeTabs(new Set([path]));
    }

    private async closeOthersAsync(id: string): Promise<void> {
        const state = this.store.getState();
        const dirty = state.openFiles.filter((file) => file.path !== id && file.dirty);

        if (dirty.length > 0) {
            const confirmed = await this.confirmDiscardDirtyPathsAsync({
                paths: dirty.map((file) => file.path),
                title: 'Close other tabs',
                confirmLabel: 'Close anyway',
            });

            if (!confirmed) {
                return;
            }
        }

        this.closeTabs(new Set(state.tabOrder.filter((other) => other !== id)));
        this.store.update({ activePath: id });
    }

    private async closeToRightAsync(id: string): Promise<void> {
        const state = this.store.getState();
        const index = state.tabOrder.indexOf(id);

        if (index < 0) {
            return;
        }

        const toClose = new Set(state.tabOrder.slice(index + 1));
        const dirty = state.openFiles.filter((file) => toClose.has(file.path) && file.dirty);

        if (dirty.length > 0) {
            const confirmed = await this.confirmDiscardDirtyPathsAsync({
                paths: dirty.map((file) => file.path),
                title: 'Close tabs to the right',
                confirmLabel: 'Close anyway',
            });

            if (!confirmed) {
                return;
            }
        }

        const activeClosing = state.activePath != null && toClose.has(state.activePath);
        this.closeTabs(toClose);

        if (activeClosing) {
            this.store.update({ activePath: id });
        }
    }

    private async closeAllAsync(): Promise<void> {
        if (!await this.confirmDiscardDirtyAsync()) {
            return;
        }

        this.store.update({ openFiles: [], diffTabs: [], activePath: null });
    }

    private markChange(path: string, editorText: string): void {
        const state = this.store.getState();
        const text = normalizeLineEndings(editorText);
        const updated = state.openFiles.map((file) => {
            if (file.path !== path) {
                return file;
            }

            const dirty = text !== file.originalText;

            return {
                ...file,
                text,
                dirty,
                // An edit auto-promotes a preview tab to permanent.
                preview: dirty ? false : file.preview,
            };
        });
        this.store.update({ openFiles: updated });
    }

    // Returns whether the file was written.
    // Ctrl+S outside an editor, such as in the Tree or JSONPath view, saves the active file as its Save button does.
    // saveAsync turns down a preview, a table or a diff tab, which hold no text to write.
    private saveFromShortcut(): void {
        const state = this.store.getState();

        if (state.activeSurface !== 'files' || state.activePath == null || isDerivedFilesSurfaceView()) {
            return;
        }

        void this.saveAsync(state.activePath);
    }

    private async saveAsync(path: string): Promise<boolean> {
        const state = this.store.getState();
        const file = state.openFiles.find((item) => item.path === path);

        if (file == null) {
            return false;
        }

        // A paste is on no disk yet, a picture included, so saving asks where it goes.
        if (isPastedTab(file)) {
            return await this.savePastedAsync(file);
        }

        // A large table, a document or a preview holds no text, so writing it back would empty the file;
        // a table is view only, and a workbook's text is its bytes read as text, so writing it would break the file.
        if (holdsNoTextInMemory(file) || pickViewer(basename(file.path)) === 'table') {
            return false;
        }

        if (file.external != null) {
            return await this.saveExternalAsync(file, file.external);
        }

        if (state.workspace == null) {
            return false;
        }

        const encoded = await this.encodeForSaveAsync(file);

        if (encoded == null) {
            return false;
        }

        try {
            await writeBytesAsync(state.workspace.handle, path, new Blob([encoded.bytes]));
            // Edits made while the file was being written stay unsaved.
            const updated = this.store.getState().openFiles.map((item) => item.path === path
                ? { ...item, originalText: file.text, dirty: item.text !== file.text, encoding: encoded.encoding }
                : item);
            this.store.update({ openFiles: updated });
            toast(`${basename(path)} saved.`, 'ok');

            return true;
        }
        catch (error) {
            toast(errorMessage(error, 'Save failed.'), 'fail');

            return false;
        }
    }

    // The bytes a save writes: the text in the file's own encoding. When that encoding can't hold some of its characters,
    // such as `ü` in Windows-1253, the user is asked whether to save it as UTF-8 instead; null when they say no.
    private async encodeForSaveAsync(file: OpenFile): Promise<SaveBytes | null> {
        const encoding = file.encoding ?? 'utf-8';
        const encoded = bytesForDisk(file);

        if (encoded.ok) {
            return { bytes: encoded.bytes, encoding };
        }

        const name = basename(file.path);
        const label = textEncodingLabel(encoding);
        const shown = encoded.unrepresentable.slice(0, UNREPRESENTABLE_SHOWN).join(' ');
        const more = encoded.unrepresentable.length - UNREPRESENTABLE_SHOWN;
        const confirmed = await confirmActionAsync({
            title: `Save ${name} as UTF-8`,
            body: `${name} is in ${label}, which can't hold ${shown}${more > 0 ? ` and ${more} more` : ''}. `
                + `Save it as UTF-8 instead? Programs that expect ${label} may then show its other letters wrongly.`,
            confirmLabel: 'Save as UTF-8',
        });

        if (!confirmed) {
            return null;
        }

        const utf8 = bytesForDisk({ ...file, encoding: 'utf-8' });

        return utf8.ok ? { bytes: utf8.bytes, encoding: 'utf-8' } : null;
    }

    // What a save writes: a pasted picture's own bytes, or the text as encodeForSaveAsync encodes it.
    private async contentForSaveAsync(file: OpenFile): Promise<{ readonly blob: Blob; readonly encoding: TextEncoding } | null> {
        if (isPastedTab(file) && file.file != null) {
            return { blob: file.file, encoding: file.encoding ?? 'utf-8' };
        }

        const encoded = await this.encodeForSaveAsync(file);

        return encoded == null ? null : { blob: new Blob([encoded.bytes]), encoding: encoded.encoding };
    }

    // A paste saves into the workspace under a name it asks for, in the folder selected in the Explorer or at the root,
    // and its tab becomes that file's tab. With no workspace open, the browser's save dialog asks where it goes.
    private async savePastedAsync(file: PastedFile): Promise<boolean> {
        const workspace = this.store.getState().workspace;

        if (workspace == null) {
            return await this.saveExternalAsync(file, file.external);
        }

        const folder = this.selectedFolder();
        // A tab such as a conversion takes its name before it is on disk.
        const tabNames = this.store.getState().openFiles
            .filter((open) => !isExternalPath(open.path) && parentPath(open.path) === folder)
            .map((open): [string, FileSystemHandleKind] => [basename(open.path), 'file']);
        const taken = new Map([...await this.listFolderEntriesAsync(workspace.handle, folder), ...tabNames]);
        const name = await showTextInputModalAsync({
            title: `Save ${basename(file.path)}`,
            label: 'Name',
            initialValue: freeClipboardName(basename(file.path), taken.keys()),
            confirmLabel: 'Save',
            selectionRange: 'basename',
            hint: folder === '' ? 'Will be saved at the workspace root.' : `Will be saved in ${folder}/`,
            validate: (value) => this.validateName(value) ?? takenNameMessage(value, taken),
        });
        const current = this.store.getState().openFiles.find((open) => open.path === file.path);

        if (name == null || current == null) {
            return false;
        }

        return await this.savePastedToWorkspaceAsync(current, joinPath(folder, name));
    }

    private async savePastedToWorkspaceAsync(file: OpenFile, path: string): Promise<boolean> {
        const workspace = this.store.getState().workspace;
        const name = basename(path);
        const content = await this.contentForSaveAsync(file);

        if (workspace == null || content == null) {
            return false;
        }

        try {
            // A file of that name may have appeared while the name was asked for; it is never overwritten.
            const existing = await entryKindAsync(workspace.handle, path);

            if (existing != null) {
                toast(nameTakenMessage(name, existing), 'fail');

                return false;
            }

            await writeBytesAsync(workspace.handle, path, content.blob);
            const snapshot = await getFileAsync(workspace.handle, path);
            const written = file.text;
            const latest = this.store.getState();
            renameEditorSession(file.path, path);
            renameFilesSurfaceMemory(file.path, path);
            // Edits made while the file was being written stay unsaved.
            const saved = ({ external: _pasted, ...item }: OpenFile): OpenFile => ({
                ...item,
                path,
                originalText: written,
                dirty: item.text !== written,
                encoding: content.encoding,
                file: snapshot,
            });
            this.store.update({
                openFiles: latest.openFiles.map((item) => item.path === file.path ? saved(item) : item),
                activePath: latest.activePath === file.path ? path : latest.activePath,
                selectedPath: path,
            });
            toast(`${name} saved.`, 'ok');
            await this.refreshTreeAsync();
            this.revealInTree(path);

            return true;
        }
        catch (error) {
            toast(errorMessage(error, 'Save failed.'), 'fail');

            return false;
        }
    }

    private isPastedPath(path: string): boolean {
        return this.store.getState().openFiles.some((open) => open.path === path && isPastedTab(open));
    }

    // The folder selected in the Explorer, or the folder of the file selected there; the workspace root when there is none.
    private selectedFolder(): string {
        const first = orderedSelection(this.explorer.selection, this.explorer.visiblePaths)[0];

        if (first == null) {
            return '';
        }

        return this.isDirectory(first) ? first : parentPath(first);
    }

    // A file from outside the workspace saves back to the file it came from,
    // or, when the browser gave no handle for it, to a file the user picks, as a paste does while no workspace is open.
    private async saveExternalAsync(file: OpenFile, external: ExternalFile): Promise<boolean> {
        const name = basename(file.path);
        const reason = external.pasted === true
            ? `No workspace is open, so choose where to save ${name}.`
            : `${name} was opened from outside the workspace without a link to the original file. Choose where to save it.`;
        const handle = external.handle ?? await this.pickSaveTargetAsync(name, reason);

        if (handle == null) {
            return false;
        }

        if (await ensurePermissionAsync(handle, 'readwrite') !== 'granted') {
            toast(`Nib Studio was not allowed to save ${name}.`, 'warn');

            return false;
        }

        const written = file.text;
        const content = await this.contentForSaveAsync(file);

        if (content == null) {
            return false;
        }

        try {
            await writeHandleAsync(handle, content.blob);
            const snapshot = await handle.getFile().catch(() => file.file);
            const path = handle.name === name ? file.path : joinPath(parentPath(file.path), handle.name);
            const latest = this.store.getState();

            if (path !== file.path) {
                renameEditorSession(file.path, path);
                renameFilesSurfaceMemory(file.path, path);
            }

            const saved = (item: OpenFile): OpenFile => ({
                ...item,
                path,
                originalText: written,
                dirty: item.text !== written,
                encoding: content.encoding,
                file: snapshot,
                external: { handle },
            });
            this.store.update({
                openFiles: latest.openFiles.map((item) => item.path === file.path ? saved(item) : item),
                activePath: latest.activePath === file.path ? path : latest.activePath,
            });
            toast(`${handle.name} saved.`, 'ok');

            return true;
        }
        catch (error) {
            toast(errorMessage(error, 'Save failed.'), 'fail');

            return false;
        }
    }

    private async pickSaveTargetAsync(name: string, reason: string): Promise<FileSystemFileHandle | null> {
        const confirmed = await confirmActionAsync({
            title: 'Save as',
            body: reason,
            confirmLabel: 'Save as…',
        });

        if (!confirmed) {
            return null;
        }

        if (typeof window.showSaveFilePicker !== 'function') {
            toast('This browser cannot save files outside the workspace.', 'fail');

            return null;
        }

        try {
            return await window.showSaveFilePicker({ suggestedName: name });
        }
        catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) {
                toast(errorMessage(error, 'Save failed.'), 'fail');
            }

            return null;
        }
    }

    private async newFileAsync(parentFolder: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            toast('Pick a workspace folder first.', 'warn');

            return;
        }

        const handle = state.workspace.handle;
        const entries = await this.listFolderEntriesAsync(handle, parentFolder);
        const name = await showTextInputModalAsync({
            title: 'New file',
            label: 'Name',
            initialValue: 'untitled.md',
            confirmLabel: 'Create',
            selectionRange: 'basename',
            hint: parentFolder === ''
                ? 'Will be created at the workspace root.'
                : `Will be created in ${parentFolder}/`,
            validate: (value) => this.validateName(value) ?? takenNameMessage(value, entries),
        });

        if (name == null) {
            return;
        }

        const path = joinPath(parentFolder, name);

        try {
            await createFileAsync(handle, path);
            await this.refreshTreeAsync();
            await this.openFileAsync(path, { isNew: true });
            // The new file opens in Editor, ready to type in.
            focusFilesSurface();
            toast(`${name} created.`, 'ok');
        }
        catch (error) {
            toast(errorMessage(error, 'Could not create file.'), 'fail');
        }
    }

    private async newFolderAsync(parentFolder: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            toast('Pick a workspace folder first.', 'warn');

            return;
        }

        const handle = state.workspace.handle;
        const entries = await this.listFolderEntriesAsync(handle, parentFolder);
        const name = await showTextInputModalAsync({
            title: 'New folder',
            label: 'Name',
            confirmLabel: 'Create',
            hint: parentFolder === ''
                ? 'Will be created at the workspace root.'
                : `Will be created in ${parentFolder}/`,
            validate: (value) => this.validateName(value) ?? takenNameMessage(value, entries),
        });

        if (name == null) {
            return;
        }

        const path = joinPath(parentFolder, name);

        try {
            await createDirectoryAsync(handle, path);
            const expanded = new Set(state.expandedPaths);
            expanded.add(parentFolder);
            this.store.update({ expandedPaths: expanded });
            await this.refreshTreeAsync();
            toast(`${name} created.`, 'ok');
        }
        catch (error) {
            toast(errorMessage(error, 'Could not create folder.'), 'fail');
        }
    }

    private async renameAsync(path: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            return;
        }

        const handle = state.workspace.handle;
        const current = basename(path);
        // The entry itself doesn't take its name, so a change of case only is allowed.
        const others = await this.listFolderEntriesAsync(handle, parentPath(path));
        others.delete(current);
        const nextName = await showTextInputModalAsync({
            title: `Rename ${current}`,
            label: 'New name',
            initialValue: current,
            confirmLabel: 'Rename',
            selectionRange: 'basename',
            paths: [{ label: 'From', path }],
            validate: (value) => {
                if (value === current) {
                    return 'Pick a different name.';
                }

                return this.validateName(value) ?? takenNameMessage(value, others);
            },
        });

        if (nextName == null) {
            return;
        }

        try {
            const newPath = await renameEntryAsync(handle, path, nextName);
            await this.remapOpenPathsAsync(path, newPath);
            await this.refreshTreeAsync();
            toast(`Renamed to ${nextName}.`, 'ok');
        }
        catch (error) {
            toast(errorMessage(error, 'Rename failed.'), 'fail');
        }
    }

    private async duplicateAsync(path: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            return;
        }

        const handle = state.workspace.handle;
        const current = basename(path);
        const parent = parentPath(path);
        const entries = await this.listFolderEntriesAsync(handle, parent);
        const suggested = nextCopyName(current, entries.keys());

        const nextName = await showTextInputModalAsync({
            title: `Duplicate ${current}`,
            label: 'New name',
            initialValue: suggested,
            confirmLabel: 'Duplicate',
            selectionRange: 'basename',
            hint: parent === ''
                ? 'The copy lands at the workspace root.'
                : `The copy lands in ${parent}/`,
            paths: [
                { label: 'From', path },
                { label: 'To', path: joinPath(parent, suggested) },
            ],
            validate: (value) => {
                if (value === current) {
                    return 'Pick a different name.';
                }

                return this.validateName(value) ?? takenNameMessage(value, entries);
            },
        });

        if (nextName == null) {
            return;
        }

        try {
            const newPath = await duplicateEntryAsync(handle, path, nextName);
            await this.refreshTreeAsync();
            this.store.update({ selectedPath: newPath });
            toast(`Duplicated as ${nextName}.`, 'ok');
        }
        catch (error) {
            toast(errorMessage(error, 'Duplicate failed.'), 'fail');
        }
    }

    private validateName(value: string): string | null {
        if (value.includes('/') || value.includes('\\')) {
            return 'Name cannot contain slashes.';
        }

        if (value === '.' || value === '..') {
            return 'Reserved name.';
        }

        return null;
    }

    private async uniqueDuplicateNameAsync(
        handle: FileSystemDirectoryHandle,
        parent: string,
        originalName: string,
    ): Promise<string> {
        const existingNames = await listChildNamesAsync(handle, parent).catch(() => new Set<string>());

        return nextCopyName(originalName, existingNames);
    }

    // The entries of the folder a new name goes in, read from disk, so collapsed folders count too.
    private async listFolderEntriesAsync(
        handle: FileSystemDirectoryHandle,
        folder: string,
    ): Promise<Map<string, FileSystemHandleKind>> {
        return await listChildEntriesAsync(handle, folder).catch(() => new Map<string, FileSystemHandleKind>());
    }

    private async deleteCurrentSelectionAsync(): Promise<void> {
        const selection = [...this.explorer.selection.selectedPaths];

        if (selection.length === 0 && this.explorer.focusedPath != null) {
            selection.push(this.explorer.focusedPath);
        }

        await this.deletePathsAsync(selection);
    }

    private async deletePathsAsync(paths: ReadonlyArray<string>): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null || paths.length === 0) {
            return;
        }

        const summary = paths.length === 1
            ? `Delete ${basename(paths[0] ?? '')}?`
            : `Delete ${paths.length} items?`;
        const deleteLabel = 'Delete';
        const dialogPaths: DialogPath[] = paths.map((path) => ({ label: deleteLabel, path }));
        const confirmed = await confirmActionAsync({
            title: deleteLabel,
            body: summary,
            paths: dialogPaths,
            confirmLabel: deleteLabel,
            tone: 'danger',
        });

        if (!confirmed) {
            return;
        }

        const handle = state.workspace.handle;
        const deleted: string[] = [];

        for (const path of paths) {
            try {
                await deleteEntryAsync(handle, path);
                deleted.push(path);
            }
            catch (error) {
                toast(errorMessage(error, `Could not delete ${basename(path)}.`), 'fail');
            }
        }

        if (deleted.length === 0) {
            return;
        }

        // A deleted folder takes the files inside it along; files from outside the workspace stay.
        const isDeleted = (path: string | null): boolean => path != null
            && !isExternalPath(path)
            && deleted.some((entry) => path === entry || path.startsWith(`${entry}/`));
        const nextRow = rowAfterRemoval(this.explorer.visiblePaths, isDeleted);
        this.explorer.selection = nextRow == null ? EMPTY_SELECTION : selectOnly(EMPTY_SELECTION, nextRow);
        this.explorer.focusedPath = nextRow;
        this.store.update({
            openFiles: state.openFiles.filter((file) => !isDeleted(file.path)),
            activePath: isDeleted(state.activePath) ? null : state.activePath,
            selectedPath: isDeleted(state.selectedPath) ? null : state.selectedPath,
        });
        await this.refreshTreeAsync();
        this.shell.explorer.focus({ preventScroll: true });
        toast(deleted.length === 1
            ? '1 item deleted.'
            : `${deleted.length} items deleted.`, 'ok');
    }

    private async moveEntriesAsync(sources: ReadonlyArray<string>, targetFolder: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null || sources.length === 0) {
            return;
        }

        const handle = state.workspace.handle;
        const existing = await listChildNamesAsync(handle, targetFolder).catch(() => new Set<string>());
        const collisions = detectCollisions(sources, targetFolder, existing);
        const resolutions = new Map<string, CollisionChoice>();
        let applyChoice: CollisionChoice | null = null;

        for (const collision of collisions) {
            if (applyChoice != null) {
                resolutions.set(collision.sourcePath, applyChoice);
                continue;
            }

            const result = await showCollisionDialogAsync({
                name: collision.name,
                targetFolder,
                offerApplyToAll: collisions.length > 1,
                paths: [
                    { label: 'From', path: collision.sourcePath },
                    { label: 'To', path: collision.targetPath },
                ],
            });

            if (result.choice === 'cancel') {
                return;
            }

            if (result.applyToAll) {
                applyChoice = result.choice;
            }

            resolutions.set(collision.sourcePath, result.choice);
        }

        for (const source of sources) {
            const resolution = resolutions.get(source) ?? 'replace';

            if (resolution === 'skip') {
                continue;
            }

            try {
                await this.moveSingleAsync(handle, source, targetFolder, resolution);
            }
            catch (error) {
                toast(errorMessage(error, `Could not move ${basename(source)}.`), 'fail');
            }
        }

        await this.refreshTreeAsync();
    }

    private async copyEntriesAsync(sources: ReadonlyArray<string>, targetFolder: string): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null || sources.length === 0) {
            return;
        }

        const handle = state.workspace.handle;
        const existing = await listChildNamesAsync(handle, targetFolder).catch(() => new Set<string>());
        let copied = 0;

        for (const source of sources) {
            const name = basename(source);
            const targetName = resolveCopyName(name, existing);
            existing.add(targetName);
            const targetPath = joinPath(targetFolder, targetName);

            try {
                await copyEntryAsync(handle, source, targetPath);
                copied += 1;
            }
            catch (error) {
                toast(errorMessage(error, `Could not copy ${name}.`), 'fail');
            }
        }

        if (copied > 0) {
            await this.refreshTreeAsync();
            toast(copied === 1
                ? '1 item copied.'
                : `${copied} items copied.`, 'ok');
        }
    }

    private async moveSingleAsync(
        handle: FileSystemDirectoryHandle,
        source: string,
        targetFolder: string,
        resolution: CollisionChoice,
    ): Promise<void> {
        const name = basename(source);
        let targetName = name;

        if (resolution === 'keep-both') {
            targetName = await this.uniqueDuplicateNameAsync(handle, targetFolder, name);
        }

        const targetPath = joinPath(targetFolder, targetName);

        if (resolution === 'replace' && await entryExistsAsync(handle, targetPath)) {
            await deleteEntryAsync(handle, targetPath);
        }

        await moveEntryAsync(handle, source, targetPath);
        await this.remapOpenPathsAsync(source, targetPath);
    }

    // Points open tabs, expanded folders and the selection at the new location of a moved or renamed entry.
    private async remapOpenPathsAsync(fromPath: string, toPath: string): Promise<void> {
        const state = this.store.getState();
        const handle = state.workspace?.handle ?? null;
        const remap = (path: string | null): string | null => path == null || isExternalPath(path)
            ? path
            : remapPath(path, fromPath, toPath);
        const openFiles = await Promise.all(state.openFiles.map(async (file) => {
            const path = remap(file.path) ?? file.path;

            if (path === file.path) {
                return file;
            }

            renameEditorSession(file.path, path);
            renameFilesSurfaceMemory(file.path, path);

            // The old File snapshot belongs to the removed entry, so take a fresh one.
            const fresh = handle == null ? null : await getFileAsync(handle, path).catch(() => null);

            return { ...file, path, file: fresh ?? file.file };
        }));
        const expandedPaths = new Set([...state.expandedPaths].map((path) => remapPath(path, fromPath, toPath)));
        this.explorer.focusedPath = remap(this.explorer.focusedPath);
        this.explorer.selection = EMPTY_SELECTION;
        this.store.update({
            openFiles,
            diffTabs: state.diffTabs.map((tab) => remapDiffTab(tab, (path) => remapPath(path, fromPath, toPath))),
            expandedPaths,
            activePath: remap(state.activePath),
            selectedPath: remap(state.selectedPath),
        });
    }

    // Items already in the workspace move or copy like a drag inside the tree; everything else is imported.
    private async importDroppedItemsAsync(pending: Promise<DroppedItem[]>, targetFolder: string): Promise<void> {
        const items = await pending;
        const inside: string[] = [];
        const outside: DroppedItem[] = [];

        for (const item of items) {
            const path = await this.workspacePathOfAsync(item.handle);

            if (path == null) {
                outside.push(item);
            }
            else {
                inside.push(path);
            }
        }

        if (inside.length > 0) {
            await this.moveOrCopyDroppedAsync(inside, targetFolder);
        }

        if (outside.length > 0) {
            await this.importFromComputerAsync(outside, targetFolder);
        }
    }

    private async moveOrCopyDroppedAsync(paths: ReadonlyArray<string>, targetFolder: string): Promise<void> {
        const intoItself = paths.find((path) => path === '' || isDescendant(targetFolder, path));

        if (intoItself != null) {
            const name = intoItself === '' ? this.store.getState().workspace?.name ?? '' : basename(intoItself);
            toast(`${name} can't be dropped into itself.`, 'warn');

            return;
        }

        await this.promptMoveOrCopyAsync(paths, targetFolder);
    }

    // Copies files and whole folders byte for byte, asking about every name that already exists, inside folders too.
    // Every question is asked before anything is written, so cancelling one leaves the workspace untouched.
    private async importFromComputerAsync(items: ReadonlyArray<DroppedItem>, folder: string): Promise<void> {
        const workspace = this.store.getState().workspace;

        if (workspace == null) {
            toast('Pick a workspace folder first.', 'warn');

            return;
        }

        const folderCount = items.filter(isDroppedFolder).length;
        const destination = folder === '' ? 'the workspace root' : `${folder}/`;
        const confirmed = await confirmActionAsync({
            title: 'Import into the workspace',
            body: `Import ${filesAndFoldersLabel(items.length - folderCount, folderCount)} into ${destination}?`,
            paths: items.map((item) => ({
                label: item.kind === 'directory' ? 'Folder' : 'File',
                path: joinPath(folder, item.name),
            })),
            confirmLabel: 'Import',
        });

        if (!confirmed) {
            return;
        }

        const root = workspace.handle;
        const steps = await planImportAsync({ root, items, folder, sourceFolder: '', folderExists: true })
            .catch((error: unknown) => {
                toast(errorMessage(error, 'Could not read the dropped items.'), 'fail');

                return null;
            });

        if (steps == null) {
            return;
        }

        const resolutions = await this.resolveImportClashesAsync(steps);

        if (resolutions == null) {
            return;
        }

        const tally: ImportTally = { files: 0, folders: 0, firstFile: null, firstFolder: null };
        await this.runImportStepsAsync({ root, steps, folder, resolutions, tally, topLevel: true });

        if (tally.files === 0 && tally.folders === 0) {
            return;
        }

        await this.refreshTreeAsync();

        if (tally.firstFile != null) {
            await this.openFileAsync(tally.firstFile);
        }

        const reveal = tally.firstFile ?? tally.firstFolder;

        if (reveal != null) {
            this.revealInTree(reveal);
        }

        toast(`${filesAndFoldersLabel(tally.files, tally.folders)} imported.`, 'ok');
    }

    private async resolveImportClashesAsync(
        steps: ReadonlyArray<ImportStep>,
    ): Promise<Map<ImportStep, CollisionChoice> | null> {
        const clashes = flattenImportSteps(steps).filter(isImportClash);
        const resolutions = new Map<ImportStep, CollisionChoice>();
        let applyChoice: CollisionChoice | null = null;

        for (const clash of clashes) {
            if (applyChoice != null) {
                resolutions.set(clash, applyChoice);
                continue;
            }

            const result = await showCollisionDialogAsync({
                name: clash.item.name,
                targetFolder: parentPath(clash.targetPath),
                offerApplyToAll: clashes.length > 1,
                paths: [
                    { label: 'From', path: clash.sourcePath },
                    { label: 'To', path: clash.targetPath },
                ],
            });

            if (result.choice === 'cancel') {
                return null;
            }

            if (result.applyToAll) {
                applyChoice = result.choice;
            }

            resolutions.set(clash, result.choice);
        }

        return resolutions;
    }

    private async runImportStepsAsync(options: {
        root: FileSystemDirectoryHandle;
        steps: ReadonlyArray<ImportStep>;
        folder: string;
        resolutions: ReadonlyMap<ImportStep, CollisionChoice>;
        tally: ImportTally;
        topLevel: boolean;
    }): Promise<void> {
        const { root, steps, folder, resolutions, tally, topLevel } = options;

        for (const step of steps) {
            const choice = resolutions.get(step);

            if (choice === 'skip') {
                continue;
            }

            const name = choice === 'keep-both'
                ? await this.uniqueDuplicateNameAsync(root, folder, step.item.name)
                : step.item.name;
            const path = joinPath(folder, name);

            try {
                if (choice === 'replace') {
                    await deleteEntryAsync(root, path);
                }

                if (step.item.kind === 'file') {
                    await writeBytesAsync(root, path, await step.item.readAsync());
                    tally.files += 1;
                    tally.firstFile ??= path;
                    continue;
                }

                // An existing folder of the same name is merged into.
                await createDirectoryAsync(root, path);
            }
            catch (error) {
                toast(errorMessage(error, `Could not import ${step.item.name}.`), 'fail');
                continue;
            }

            if (topLevel) {
                tally.folders += 1;
                tally.firstFolder ??= path;
            }

            await this.runImportStepsAsync({
                root,
                steps: step.children,
                folder: path,
                resolutions,
                tally,
                topLevel: false,
            });
        }
    }

    // Convert XML to JSON: the file as saved on disk, opened as JSON in a tab of its own.
    private async convertXmlToJsonAsync(path: string): Promise<void> {
        await this.convertFileAsync(path, {
            extension: 'json',
            formatName: 'JSON',
            convertAsync: async (text) => {
                const { parseXml } = await import('../../common/paths/xmlParser.js');
                const { convertXmlToJson } = await import('../../common/xml/xmlToJson.js');
                const parsed = parseXml(text);

                if (!parsed.ok) {
                    toast(notValidMessage('XML', parsed), 'fail');

                    return null;
                }

                return JSON.stringify(convertXmlToJson(parsed.root), null, 2);
            },
        });
    }

    // Convert YAML to JSON: the file as saved on disk, opened as JSON in a tab of its own.
    private async convertYamlToJsonAsync(path: string): Promise<void> {
        await this.convertFileAsync(path, {
            extension: 'json',
            formatName: 'JSON',
            convertAsync: async (text) => yamlFileAsJson(text),
        });
    }

    // Convert JSON to YAML: the file as saved on disk, opened as YAML in a tab of its own.
    private async convertJsonToYamlAsync(path: string): Promise<void> {
        await this.convertFileAsync(path, {
            extension: 'yaml',
            formatName: 'YAML',
            convertAsync: async (text) => jsonFileAsYaml(normalizeLineEndings(text)),
        });
    }

    // Reads a workspace file as saved on disk and opens what `convertAsync` makes of it in a tab of its own,
    // with the line ending of the file; `convertAsync` gives null after a toast saying why it can't.
    private async convertFileAsync(path: string, conversion: {
        readonly extension: string;
        readonly formatName: string;
        readonly convertAsync: (text: string) => Promise<string | null>;
    }): Promise<void> {
        const workspace = this.store.getState().workspace;

        if (workspace == null) {
            return;
        }

        try {
            const file = await readFileAsync(workspace.handle, path);
            const text = await conversion.convertAsync(file.text);

            if (text != null) {
                this.openConvertedTab({
                    sourcePath: path,
                    extension: conversion.extension,
                    text,
                    lineEnding: detectLineEnding(file.text),
                    formatName: conversion.formatName,
                });
            }
        }
        catch (error) {
            toast(errorMessage(error, 'Conversion failed.'), 'fail');
        }
    }

    // Convert to YAML in a JSON file's toolbar: the editor's text, unsaved edits included, as YAML in a tab of its own.
    private convertJsonTextToYaml(path: string, editorText: string): void {
        const open = this.store.getState().openFiles.find((file) => file.path === path);

        if (open == null || isExternalPath(path)) {
            return;
        }

        const text = jsonFileAsYaml(editorText);

        if (text != null) {
            this.openConvertedTab({
                sourcePath: path,
                extension: 'yaml',
                text,
                lineEnding: open.lineEnding,
                formatName: 'YAML',
            });
        }
    }

    // Convert HTML to Markdown and Convert Markdown to HTML in the context menus: the tab's text as it is now,
    // unsaved edits included, or the file as saved on disk when it has no tab.
    private async convertDocumentFileAsync(path: string, format: DocumentFormat): Promise<void> {
        const state = this.store.getState();
        const open = state.openFiles.find((file) => file.path === path);

        if (open != null) {
            await this.convertDocumentAsync({ path, text: open.text, lineEnding: open.lineEnding, format });

            return;
        }

        if (state.workspace == null) {
            return;
        }

        try {
            const file = await readFileAsync(state.workspace.handle, path);
            await this.convertDocumentAsync({
                path,
                text: normalizeLineEndings(file.text),
                lineEnding: detectLineEnding(file.text),
                format,
            });
        }
        catch (error) {
            toast(errorMessage(error, 'Conversion failed.'), 'fail');
        }
    }

    // Convert to Markdown and Convert to HTML in the toolbar: the editor's text, unsaved edits included.
    private async convertDocumentTextAsync(
        path: string,
        editorText: string,
        format: DocumentFormat,
    ): Promise<void> {
        const open = this.store.getState().openFiles.find((file) => file.path === path);

        if (open == null || isExternalPath(path)) {
            return;
        }

        await this.convertDocumentAsync({
            path,
            text: normalizeLineEndings(editorText),
            lineEnding: open.lineEnding,
            format,
        });
    }

    // Opens the document in the other format in a tab of its own, such as `page.html.converted.md`.
    private async convertDocumentAsync(source: {
        readonly path: string;
        readonly text: string;
        readonly lineEnding: LineEnding;
        readonly format: DocumentFormat;
    }): Promise<void> {
        const conversion = DOCUMENT_CONVERSIONS[source.format];

        try {
            const converted = await conversion.convertAsync(source.text, basename(source.path));
            this.openConvertedTab({
                sourcePath: source.path,
                extension: conversion.extension,
                text: converted,
                lineEnding: source.lineEnding,
                formatName: conversion.formatName,
            });
        }
        catch (error) {
            toast(errorMessage(error, 'Conversion failed.'), 'fail');
        }
    }

    // Opens a conversion in a tab named after its source, such as `orders.xml.converted.json`, in the Editor view.
    // It saves next to the source, with the line ending of the source; converting again replaces its text.
    // Until it is saved it isn't on disk, so it counts as unsaved, with Save to press.
    private openConvertedTab(conversion: {
        readonly sourcePath: string;
        readonly extension: string;
        readonly text: string;
        readonly lineEnding: LineEnding;
        readonly formatName: string;
    }): void {
        const state = this.store.getState();
        const scratchPath = `${conversion.sourcePath}.converted.${conversion.extension}`;
        const existing = state.openFiles.find((file) => file.path === scratchPath);
        // A conversion saved before is compared with what was saved.
        const savedText = existing?.file == null ? '' : existing.originalText;
        const nextFile: OpenFile = {
            path: scratchPath,
            text: conversion.text,
            originalText: savedText,
            lineEnding: conversion.lineEnding,
            dirty: existing?.file == null || conversion.text !== savedText,
            view: 'editor',
            file: null,
            preview: false,
        };

        const openFiles = existing == null
            ? [...state.openFiles, nextFile]
            : state.openFiles.map((file) => file.path === scratchPath ? nextFile : file);

        setFilesSurfaceView('editor');
        this.store.update({
            openFiles,
            activePath: scratchPath,
            activeSurface: 'files',
        });
        toast(`Converted ${basename(conversion.sourcePath)} to ${conversion.formatName}.`, 'ok');
    }

    // Save pages… of a PDF: the dialog asks which pages and previews them, and the new PDF goes next to the original,
    // or, for a PDF from outside the workspace, where a file picker says. `open` is the preview's document, when it has one.
    private async savePdfPagesAsync(path: string, open: OpenPdf | null): Promise<void> {
        const workspace = this.store.getState().workspace;
        const isOutside = isExternalPath(path);
        const name = basename(path);

        if (!isOutside && workspace == null) {
            return;
        }

        const file = await this.fileSnapshotAsync(path);

        if (file == null) {
            toast(`Could not read ${name}.`, 'fail');

            return;
        }

        const folder = parentPath(path);
        const entries = isOutside || workspace == null
            ? new Map<string, FileSystemHandleKind>()
            : await this.listFolderEntriesAsync(workspace.handle, folder);

        await showSavePagesDialogAsync({
            file,
            fileName: name,
            suggestedName: suggestPagesFileName(name, entries.keys()),
            destinationHint: isOutside
                ? 'A file picker asks where it goes.'
                : `It goes ${folder === '' ? 'at the workspace root' : `in ${folder}/`}, next to ${name}.`,
            saveLabel: isOutside ? 'Save as…' : 'Save',
            open,
            validateName: (candidate) => this.validateName(candidate) ?? takenNameMessage(candidate, entries),
            saveAsync: async (target, bytes) => (isOutside
                ? await this.savePagesOutsideAsync(target, bytes)
                : await this.savePagesToWorkspaceAsync(joinPath(folder, target), bytes)),
        });
    }

    // The tab's snapshot of the file, or a fresh one from the workspace.
    private async fileSnapshotAsync(path: string): Promise<File | null> {
        const state = this.store.getState();
        const open = state.openFiles.find((file) => file.path === path);

        if (open?.file != null) {
            return open.file;
        }

        if (state.workspace == null || isExternalPath(path)) {
            return null;
        }

        try {
            return await getFileAsync(state.workspace.handle, path);
        }
        catch {
            return null;
        }
    }

    // Writes the new PDF, then shows it in the tree and opens it; a failure throws, for the dialog to show.
    private async savePagesToWorkspaceAsync(path: string, bytes: Uint8Array): Promise<boolean> {
        const workspace = this.store.getState().workspace;
        const name = basename(path);

        if (workspace == null) {
            throw new Error('The workspace is no longer open.');
        }

        // A file of that name may have appeared since the dialog opened; it is never overwritten.
        const existing = await entryKindAsync(workspace.handle, path);

        if (existing != null) {
            throw new Error(nameTakenMessage(name, existing));
        }

        // pdf-lib writes into a plain ArrayBuffer.
        await writeBytesAsync(workspace.handle, path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
        toast(`Saved ${name}.`, 'ok');
        await this.refreshTreeAsync();
        await this.openFileAsync(path);
        this.revealInTree(path);

        return true;
    }

    // Writes the new PDF where a file picker says and opens it; false when the picker is closed.
    private async savePagesOutsideAsync(name: string, bytes: Uint8Array): Promise<boolean> {
        const handle = await pickPdfSaveTargetAsync(name);

        if (handle == null) {
            return false;
        }

        await writeHandleAsync(handle, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
        toast(`Saved ${handle.name}.`, 'ok');

        if (this.store.getState().workspace != null) {
            await this.refreshTreeAsync();
        }

        await this.openDroppedFileAsync(
            { kind: 'file', name: handle.name, handle, readAsync: async () => await handle.getFile() },
            { announce: false },
        );

        return true;
    }

    // Opens a diff tab for the pair, or focuses the one that already compares it. File tabs never change.
    openDiff(original: DiffSide | null, modified: DiffSide | null): DiffTab {
        const result = openDiffTab(this.store.getState(), original, modified);
        const reveal = isWorkspaceFileSide(result.tab.modified) ? result.tab.modified.path : null;
        this.store.update({
            ...result.patch,
            activeSurface: 'files',
            selectedPath: reveal ?? this.store.getState().selectedPath,
        });

        return result.tab;
    }

    // Opens an empty compare of the kind, whose sides are pasted, typed or chosen in the tab.
    newCompare(kind: DiffKind): DiffTab {
        const state = this.store.getState();
        const tab = createScratchDiffTab(state.diffTabs, kind);
        this.store.update({ diffTabs: [...state.diffTabs, tab], activePath: tab.id, activeSurface: 'files' });

        return tab;
    }

    private newCompareMenuItems(): Array<{ label: string; onSelect: () => void }> {
        return DIFF_KINDS.map((kind) => ({ label: DIFF_KIND_MENU_LABELS[kind], onSelect: () => void this.newCompare(kind) }));
    }

    // The "+" menu: the compares, then Paste from clipboard, left out where the browser can't read the clipboard.
    private showNewCompareMenu(event: MouseEvent): void {
        openExplorerMenu(event, [
            { items: this.newCompareMenuItems() },
            {
                items: [{
                    label: 'Paste from clipboard',
                    disabled: !canReadClipboard(),
                    onSelect: () => void this.pasteFromClipboardAsync(),
                }],
            },
        ]);
    }

    // Opens what is on the clipboard in an unsaved tab of its own: text by the format it reads as, such as `Clipboard.json`,
    // or else a picture in the image preview. It opens in the view a file of its type opens in.
    private async pasteFromClipboardAsync(): Promise<void> {
        const paste = await readClipboardPasteAsync(navigator.clipboard);

        if (!isOpenablePaste(paste)) {
            const problem = pasteProblem(paste);

            if (problem != null) {
                toast(problem.message, problem.tone);
            }

            return;
        }

        const state = this.store.getState();
        const openNames = state.openFiles.map((open) => basename(open.path));
        this.externalTabCount += 1;
        const tab = pastedTab(paste, { id: this.externalTabCount, openNames });
        this.chooseViewForOpenedFile(basename(tab.path), false);
        this.store.update({ openFiles: [...state.openFiles, tab], activePath: tab.path, activeSurface: 'files' });
    }

    // A workspace file as a diff side: the open tab's text when it is open, so unsaved edits are compared.
    private async sideForPathAsync(path: string): Promise<DiffSide | null> {
        const state = this.store.getState();
        const open = state.openFiles.find((file) => file.path === path);

        if (open?.external != null) {
            return openTabSide(open);
        }

        if (open != null) {
            return workspaceFileSide(path, holdsNoTextInMemory(open) ? '' : open.text, open.file);
        }

        if (state.workspace == null) {
            return null;
        }

        try {
            const snapshot = await getFileAsync(state.workspace.handle, path);
            const holdsText = !isLargeTableFile(path, snapshot.size) && !holdsNoText(basename(path));
            const text = holdsText ? (await readTextBlobAsync(snapshot)).text : '';

            return workspaceFileSide(path, text, snapshot);
        }
        catch {
            return null;
        }
    }

    private async readDropTargetAsync(path: string): Promise<DiffDropTarget | null> {
        if (this.isDirectory(path) || await this.refuseToCompareAsync(path)) {
            return null;
        }

        const side = await this.sideForPathAsync(path);

        return side == null ? null : { kind: 'file', path, text: side.text ?? '', file: side.file ?? null };
    }

    // Says why a workspace file can't be a side of a compare, and returns true, when it is a preview or isn't text.
    private async refuseToCompareAsync(path: string): Promise<boolean> {
        const name = basename(path);

        if (holdsNoText(name)) {
            toast(previewRefusal(name), 'warn');

            return true;
        }

        if (await this.isBinaryPathAsync(path)) {
            toast(binaryRefusal(name), 'warn');

            return true;
        }

        return false;
    }

    // Whether a workspace file isn't text: an open tab says so, and an unknown type that isn't open is read to tell.
    private async isBinaryPathAsync(path: string): Promise<boolean> {
        const state = this.store.getState();
        const open = state.openFiles.find((file) => file.path === path);

        if (open != null) {
            return open.binary === true;
        }

        if (state.workspace == null) {
            return false;
        }

        try {
            return await isBinaryFileAsync(basename(path), await getFileAsync(state.workspace.handle, path));
        }
        catch {
            return false;
        }
    }

    // Whether an open tab or a file has no text to compare: a preview by its name, or an open file that isn't text.
    private holdsNoTextAt(path: string): boolean {
        const isOpenBinary = this.store.getState().openFiles.some((file) => file.path === path && file.binary === true);

        return holdsNoText(basename(path)) || isOpenBinary;
    }

    private async clipboardSideAsync(): Promise<DiffSide | null> {
        const text = await readClipboardTextAsync(navigator.clipboard);

        return text == null ? null : { label: 'Clipboard', source: 'clipboard', text };
    }

    // A file picked from disk, read as text only once its first bytes show it is text; null when it isn't, or the picker is closed.
    private async pickComparableDiskFileAsync(): Promise<{ path: string; text: string; file: File } | null> {
        const picked = await pickFileFromDiskAsync();

        if (picked == null) {
            return null;
        }

        const refusal = await compareRefusalAsync(picked.path, picked.file);

        if (refusal != null) {
            toast(refusal, 'warn');

            return null;
        }

        return { path: picked.path, text: (await readTextBlobAsync(picked.file)).text, file: picked.file };
    }

    private async diskSideAsync(): Promise<DiffSide | null> {
        try {
            const picked = await this.pickComparableDiskFileAsync();

            return picked == null ? null : { label: picked.path, path: picked.path, source: 'disk', text: picked.text, file: picked.file };
        }
        catch (error) {
            toast(errorMessage(error, 'Could not read that file.'), 'fail');

            return null;
        }
    }

    private async compareWithPickedAsync(path: string): Promise<void> {
        if (await this.refuseToCompareAsync(path)) {
            return;
        }

        const original = await this.sideForPathAsync(path);
        const modified = await this.diskSideAsync();

        if (original != null && modified != null) {
            this.openDiff(original, modified);
        }
    }

    private async compareWithClipboardAsync(path: string): Promise<void> {
        if (await this.refuseToCompareAsync(path)) {
            return;
        }

        const original = await this.sideForPathAsync(path);
        const modified = await this.clipboardSideAsync();

        if (original != null && modified != null) {
            this.openDiff(original, modified);
        }
    }

    // First selected is the original, second the modified.
    private async compareTwoSelectedAsync(first: string, second: string): Promise<void> {
        const original = await this.sideForPathAsync(first);
        const modified = await this.sideForPathAsync(second);

        if (original == null || modified == null) {
            toast('Could not read both files.', 'fail');

            return;
        }

        this.openDiff(original, modified);
    }

    // The picked tab's in-memory text is compared, so unsaved edits count, not the on-disk version.
    private async compareWithOpenTabAsync(currentPath: string, pickedPath: string): Promise<void> {
        const picked = this.store.getState().openFiles.find((file) => file.path === pickedPath);

        if (picked == null || holdsNoTextInMemory(picked)) {
            toast('That tab is no longer open.', 'warn');

            return;
        }

        if (await this.refuseToCompareAsync(currentPath)) {
            return;
        }

        const original = await this.sideForPathAsync(currentPath);

        if (original != null) {
            this.openDiff(original, openTabSide(picked));
        }
    }

    // Workspace files of a diff kind, other than `exclude`; text files only for a line diff.
    private async listComparableFilesAsync(kind: DiffKind, exclude: string | null): Promise<string[]> {
        const workspace = this.store.getState().workspace;

        if (workspace == null) {
            return [];
        }

        const files: string[] = [];
        await collectFilePathsAsync(workspace.handle, '', files);

        return files.filter((candidate) => candidate !== exclude
            && candidate !== WORKSPACE_CONFIG_PATH
            && !holdsNoText(basename(candidate))
            && diffKindForPath(candidate) === kind
            && (kind !== 'text' || resolveFileType(basename(candidate)).isText));
    }

    // Asks where a side comes from: files and tabs of the kind, a file from disk, the clipboard or pasted text.
    private async chooseSideAsync(options: { exclude: string | null; kind: DiffKind; anchor: HTMLElement; title: string }): Promise<DiffSide | null> {
        const { exclude, kind, anchor, title } = options;
        const state = this.store.getState();
        const openTabs = state.openFiles
            .filter((file) => file.path !== exclude && !holdsNoTextInMemory(file) && diffKindForPath(file.path) === kind)
            .map((file) => file.path);
        const choice: CompareChoice | null = await showCompareChooserAsync({
            anchor,
            title,
            openTabs,
            listWorkspaceFilesAsync: async () => await this.listComparableFilesAsync(kind, exclude),
            clipboardAvailable: canReadClipboard(),
        });

        if (choice == null) {
            return null;
        }

        if (choice.source === 'open-tab') {
            const open = this.store.getState().openFiles.find((file) => file.path === choice.path);

            return open == null ? null : openTabSide(open);
        }

        if (choice.source === 'file') {
            return await this.sideForPathAsync(choice.path);
        }

        if (choice.source === 'disk') {
            return await this.diskSideAsync();
        }

        if (choice.source === 'clipboard') {
            return await this.clipboardSideAsync();
        }

        return pastedSide(choice.text);
    }

    // The file toolbar's "Compare with…": choose the other side first, then open the diff tab with both sides set.
    private async compareWithChooserAsync(path: string, anchor: HTMLElement): Promise<void> {
        const modified = await this.chooseSideAsync({
            exclude: path,
            kind: diffKindForPath(path),
            anchor,
            title: `Compare ${basename(path)} with…`,
        });

        if (modified == null) {
            return;
        }

        const original = await this.sideForPathAsync(path);

        if (original != null) {
            this.openDiff(original, modified);
        }
    }

    private async pickDiffSideAsync(tabId: string, side: DiffSideName, anchor: HTMLElement): Promise<void> {
        const tab = this.store.getState().diffTabs.find((candidate) => candidate.id === tabId);

        if (tab == null) {
            return;
        }

        const other = side === 'original' ? tab.modified : tab.original;
        const chosen = await this.chooseSideAsync({
            exclude: isWorkspaceFileSide(other) ? other.path : null,
            kind: tab.diffKind,
            anchor,
            title: side === 'original' ? 'Original side' : 'Modified side',
        });

        if (chosen != null) {
            this.setDiffSide(tabId, side, chosen);
        }
    }

    private updateDiffTab(tabId: string, change: (tab: DiffTab) => DiffTab): void {
        const state = this.store.getState();
        this.store.update({ diffTabs: state.diffTabs.map((tab) => tab.id === tabId ? change(tab) : tab) });
    }

    private setDiffSide(tabId: string, side: DiffSideName, value: DiffSide): void {
        this.updateDiffTab(tabId, (tab) => setDiffTabSide(tab, side, value));
    }

    private swapDiffSides(tabId: string): void {
        this.updateDiffTab(tabId, swapDiffTab);
    }

    // Downloads the diff of a tab as JSON or as a page of its own; nothing is written into the workspace.
    private async exportDiffAsync(tabId: string, format: DiffExportFormat): Promise<void> {
        const tab = this.store.getState().diffTabs.find((candidate) => candidate.id === tabId);

        if (tab == null) {
            return;
        }

        try {
            const fileName = await exportDiffTabAsync(tab, format);

            if (fileName == null) {
                toast('This compare has no diff to export yet.', 'warn');

                return;
            }

            toast(`Downloaded ${fileName}.`, 'ok');
        }
        catch (error) {
            toast(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed.', 'fail');
        }
    }

    // Re-reads diff sides that are workspace files changed on disk and not open in a tab.
    private async reloadDiffSidesAsync(changed: ReadonlySet<string>): Promise<void> {
        const state = this.store.getState();
        const open = new Set(state.openFiles.map((file) => file.path));
        const stale = new Set<string>();

        for (const tab of state.diffTabs) {
            for (const side of [tab.original, tab.modified]) {
                if (isWorkspaceFileSide(side) && changed.has(side.path) && !open.has(side.path)) {
                    stale.add(side.path);
                }
            }
        }

        if (stale.size === 0) {
            return;
        }

        const fresh = new Map<string, DiffSide>();

        for (const path of stale) {
            const side = await this.sideForPathAsync(path);

            if (side != null) {
                fresh.set(path, side);
            }
        }

        const refresh = (side: DiffSide | null): DiffSide | null => isWorkspaceFileSide(side) ? fresh.get(side.path) ?? side : side;
        this.store.update({
            diffTabs: this.store.getState().diffTabs.map((tab) => ({ ...tab, original: refresh(tab.original), modified: refresh(tab.modified) })),
        });
    }

    // Copies a file's text as the studio holds it: an open tab's text as it is now, unsaved edits and pastes included,
    // as the toolbar's Copy content does; a file not open, or a table too large to load, as saved on disk,
    // up to the size Copy raw reads. Over 10 MB it asks first.
    private async copyContentAsync(path: string): Promise<void> {
        const confirmation = `${basename(path)} copied.`;

        try {
            const open = this.store.getState().openFiles.find((file) => file.path === path && file.large !== true);

            if (open != null) {
                if (await this.confirmLargeCopyAsync(path, open.text.length)) {
                    await copyTextAsync(open.text);
                    toast(confirmation, 'ok');
                }

                return;
            }

            const onDisk = await this.savedFileAsync(path);
            const refusal = onDisk == null ? null : diskCopyRefusal(onDisk.size);

            if (refusal != null) {
                toast(refusal.message, refusal.tone);

                return;
            }

            if (onDisk != null && await this.confirmLargeCopyAsync(path, onDisk.size)) {
                await copyDiskTextAsync(onDisk);
                toast(confirmation, 'ok');
            }
        }
        catch (error) {
            toast(copyFailureMessage(error), 'fail');
        }
    }

    private async confirmLargeCopyAsync(path: string, size: number): Promise<boolean> {
        if (size <= COPY_CONTENT_WARN_BYTES) {
            return true;
        }

        return await confirmActionAsync({
            title: 'Copy large file',
            body: `${basename(path)} is larger than 10 MB. Copy to clipboard anyway?`,
            paths: [{ label: 'File', path: displayPath(path) }],
            confirmLabel: 'Copy',
        });
    }

    // A file as saved on disk: a workspace file from the workspace, and a file from outside it through its handle,
    // or the copy it opened with when the browser gave none; null when there is nothing to read it from.
    private async savedFileAsync(path: string): Promise<Blob | null> {
        const state = this.store.getState();
        const outside = state.openFiles.find((file) => file.path === path && file.external != null);

        if (outside != null) {
            return await outside.external?.handle?.getFile() ?? outside.file;
        }

        if (state.workspace == null) {
            return null;
        }

        return await getFileAsync(state.workspace.handle, path);
    }

    // The open workspace's Lookup, started the first time its box takes focus. Each time the box takes focus,
    // the index lists the workspace again for changes the watcher missed, searches the unsaved text of open files,
    // and learns which protected files their tabs have unlocked.
    private connectLookup(): LookupClient | null {
        const workspace = this.store.getState().workspace;

        if (workspace == null) {
            this.disposeLookup();

            return null;
        }

        if (this.lookup?.workspaceId === workspace.id) {
            this.lookup.client.refresh();
        }
        else {
            this.disposeLookup();
            this.lookup = { workspaceId: workspace.id, client: this.createLookupClient(workspace.handle) };
        }

        const workspaceFiles = this.store.getState().openFiles.filter((file) => file.external == null);
        const unsaved = workspaceFiles.filter((file) => file.dirty);
        const unlocked = workspaceFiles.filter((file) => (
            file.file != null && (unlockedBytesOf(file.file) != null || passwordOfUnlockedPdf(file.file) != null)
        ));
        this.lookup.client.setOpenTexts(new Map(unsaved.map((file) => [file.path, file.text])));
        this.lookup.client.setUnlocked(new Set(unlocked.map((file) => file.path)));

        return this.lookup.client;
    }

    private createLookupClient(root: FileSystemDirectoryHandle): LookupClient {
        return createLookupClient({
            root,
            codePage: preferredCodePage(),
            readPdfTextAsync: async (path, file) => {
                const snapshot = this.openSnapshotOf(path, file);

                return await readPdfTextAsync(file, snapshot == null ? null : passwordOfUnlockedPdf(snapshot));
            },
            readUnlockedBytesAsync: async (path, file) => {
                const snapshot = this.openSnapshotOf(path, file);

                return snapshot == null ? null : unlockedBytesOf(snapshot);
            },
            createWorker: typeof Worker === 'function' ? createLookupWorker : null,
        });
    }

    // The open tab's snapshot of a workspace file, when it is the same as `file` by size and last change.
    private openSnapshotOf(path: string, file: File): File | null {
        const open = this.store.getState().openFiles.find((item) => item.path === path && item.external == null);
        const snapshot = open?.file ?? null;

        return snapshot != null && snapshot.size === file.size && snapshot.lastModified === file.lastModified ? snapshot : null;
    }

    private disposeLookup(): void {
        this.lookup?.client.dispose();
        this.lookup = null;
        this.lookupBox.reset();
    }

    // Opens a file Lookup found in a permanent tab. A content match in a text file opens in Editor with the match selected,
    // a Word or PDF preview finds its first match, and a workbook shows the sheet of its first match.
    private async openLookupResultAsync(result: LookupResult, query: string): Promise<void> {
        const viewer = pickViewer(basename(result.path));
        const preview = result.preview;
        const selectsMatch = preview != null && viewer === 'editor';
        this.shell.explorerDrawer.close();

        if (preview != null && (viewer === 'document' || viewer === 'pdf')) {
            requestPreviewFind(result.path, preview.matchText);
        }

        if (selectsMatch) {
            selectInFilesSurface(result.path, (text) => {
                const range = firstMatchRange(text, query, preview.line);

                return range == null ? null : { from: range.start, to: range.end };
            });
        }

        if (this.store.getState().activeSurface !== 'files') {
            this.store.update({ activeSurface: 'files' });
        }

        await this.openFileAsync(result.path, { preview: false });

        // A match in a workbook shows the sheet it is on.
        if (preview?.sheet != null && viewer === 'table') {
            revealSheet(result.path, preview.sheet.name);
        }

        // Opening chose a view for the file, such as Preview for Markdown; the match is selected in Editor.
        if (selectsMatch) {
            setFilesSurfaceView('editor');
        }

        this.revealInTree(result.path);
        this.selectInTree(result.path);
        this.renderAll();
        focusFilesSurface();
    }

    // Expands the ancestors, selects the row and scrolls it into view, without activating the file,
    // since activating reveals and would recurse.
    private revealInTree(path: string): void {
        if (path === '' || isExternalPath(path)) {
            return;
        }

        const state = this.store.getState();
        const expanded = new Set(state.expandedPaths);
        let parent = parentPath(path);
        let changed = false;

        while (parent !== '') {
            if (!expanded.has(parent)) {
                expanded.add(parent);
                changed = true;
            }

            parent = parentPath(parent);
        }

        if (changed) {
            this.store.update({ expandedPaths: expanded });
            void this.refreshTreeThenScrollAsync(path);

            return;
        }

        this.scrollTreeRowIntoView(path);
    }

    // Reveal in Explorer: the row is revealed, selected and focused for the keyboard, and the Explorer comes into view,
    // shown again when hidden or slid in as the drawer on a narrow screen.
    private revealInExplorer(path: string): void {
        if (this.store.getState().workspace == null || isExternalPath(path)) {
            return;
        }

        this.shell.showExplorer();
        this.selectInTree(path);
        this.revealInTree(path);
        this.shell.explorer.focus({ preventScroll: true });
    }

    // The row of a folder just expanded exists once the tree is read again.
    private async refreshTreeThenScrollAsync(path: string): Promise<void> {
        await this.refreshTreeAsync();
        this.scrollTreeRowIntoView(path);
    }

    private scrollTreeRowIntoView(path: string): void {
        const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(path)
            : path.replace(/["\\]/g, (match) => `\\${match}`);
        const row = document.querySelector<HTMLElement>(`.tree-row[data-path="${escaped}"]`);
        row?.scrollIntoView({ block: 'nearest' });
    }

    private scheduleConfigWrite(): void {
        if (this.suppressConfigWrite) {
            return;
        }

        if (this.configWriteTimer != null) {
            window.clearTimeout(this.configWriteTimer);
        }

        this.configWriteTimer = window.setTimeout(() => {
            this.configWriteTimer = null;
            void this.flushConfigAsync();
        }, CONFIG_WRITE_DEBOUNCE_MS);
    }

    private async flushConfigAsync(): Promise<void> {
        const state = this.store.getState();

        if (state.workspace == null) {
            return;
        }

        const diffTabs = persistableDiffTabs(state);
        const persistedIds = state.diffTabs
            .filter(isPersistableDiffTab)
            .map((tab) => tab.id);
        const activeDiffIndex = state.activePath == null ? -1 : persistedIds.indexOf(state.activePath);
        // Files from outside the workspace are open for the session only.
        const workspaceFiles = state.openFiles.filter((file) => file.external == null);
        const activeIsFile = workspaceFiles.some((file) => file.path === state.activePath);

        const created = await writeWorkspaceConfigAsync(state.workspace.handle, {
            ...DEFAULT_WORKSPACE_CONFIG,
            openFiles: workspaceFiles.map((file) => file.path),
            diffTabs,
            activePath: activeIsFile ? state.activePath : null,
            activeDiffTab: activeDiffIndex < 0 ? null : activeDiffIndex,
            expandedPaths: [...state.expandedPaths],
            activeSurface: state.activeSurface,
        });

        // The watcher ignores the configuration file, so that its writes don't refresh the tree;
        // the tree is read once when the file is first made, to show it.
        if (created && this.store.getState().workspace?.id === state.workspace.id) {
            await this.refreshTreeAsync();
        }
    }

    private async confirmDiscardDirtyAsync(): Promise<boolean> {
        const dirty = this.store.getState().openFiles.filter((file) => file.dirty);

        if (dirty.length === 0) {
            return true;
        }

        return await this.confirmDiscardDirtyPathsAsync({
            paths: dirty.map((file) => file.path),
            title: 'Discard unsaved changes',
            confirmLabel: 'Discard',
        });
    }

    // Before another workspace replaces this one, or it is forgotten: Save all, Discard or Cancel for its unsaved files.
    // Files from outside the workspace stay open across the change, so they are not asked about.
    // Returns whether the change may go ahead.
    private async settleUnsavedBeforeWorkspaceChangeAsync(): Promise<boolean> {
        const state = this.store.getState();
        const dirty = state.openFiles.filter((file) => file.dirty && file.external == null);

        if (dirty.length === 0) {
            return true;
        }

        const result = await showDialogAsync({
            title: 'Unsaved changes',
            body: dirty.length === 1
                ? 'This file has unsaved changes. Save it before leaving the workspace?'
                : `${dirty.length} files have unsaved changes. Save them before leaving the workspace?`,
            paths: dirty.map((file) => ({ label: 'Unsaved', path: file.path })),
            kind: {
                kind: 'buttons',
                buttons: [
                    { id: 'cancel', label: 'Cancel' },
                    { id: 'discard', label: 'Discard', tone: 'danger' },
                    { id: 'save', label: 'Save all', tone: 'primary', primary: true },
                ],
            },
        });

        if (result.outcome !== 'button' || result.id === 'cancel') {
            return false;
        }

        if (result.id === 'discard') {
            return true;
        }

        return await this.saveAllAsync(dirty.map((file) => file.path));
    }

    // Saves the files in order and stops at the first one that isn't written, which keeps its edits.
    private async saveAllAsync(paths: ReadonlyArray<string>): Promise<boolean> {
        for (const path of paths) {
            if (!await this.saveAsync(path)) {
                toast(`${basename(path)} was not saved, so the workspace stays as it is.`, 'fail');

                return false;
            }
        }

        return true;
    }

    private async confirmDiscardDirtyPathsAsync(options: {
        paths: ReadonlyArray<string>;
        title: string;
        confirmLabel: string;
    }): Promise<boolean> {
        const { paths, title, confirmLabel } = options;
        const dialogPaths: DialogPath[] = paths.map((path) => ({ label: 'Unsaved', path: displayPath(path) }));
        const body = paths.length === 1
            ? 'The following file has unsaved changes. Continue anyway?'
            : `${paths.length} files have unsaved changes. Continue anyway?`;

        return await confirmActionAsync({
            title,
            body,
            paths: dialogPaths,
            confirmLabel,
            tone: 'danger',
        });
    }

    private showTreeContextMenu(event: MouseEvent, path: string | null): void {
        if (path != null && !this.explorer.selection.selectedPaths.has(path)) {
            // Right-click on an unselected row replaces the selection with it.
            this.setSelection(selectOnly(this.explorer.selection, path));
            this.explorer.focusedPath = path;
            this.renderAll();
        }

        const context: CommandContext = { ...this.makeCommandContext('tree'), rowPath: path };
        const menu = buildContextMenu(this.commands, context, 'tree');
        openExplorerMenu(event, menu);
    }

    private showTabContextMenu(event: MouseEvent, path: string): void {
        if (this.store.getState().diffTabs.some((tab) => tab.id === path)) {
            openExplorerMenu(event, this.diffTabMenu(path));

            return;
        }

        const context = this.makeCommandContext('tab', path);
        const menu = buildContextMenu(this.commands, context, 'tab');
        openExplorerMenu(event, menu);
    }

    private diffTabMenu(id: string): ReadonlyArray<ContextMenuGroup> {
        const state = this.store.getState();
        const index = state.tabOrder.indexOf(id);
        const tab = state.diffTabs.find((candidate) => candidate.id === id);
        const modifiedPath = isWorkspaceFileSide(tab?.modified ?? null) ? tab?.modified?.path ?? null : null;
        const exportable = canExportDiffTab(tab);

        return [
            {
                items: [
                    { label: 'Swap sides', onSelect: () => this.swapDiffSides(id) },
                    {
                        label: 'Reveal in Explorer',
                        disabled: modifiedPath == null,
                        onSelect: () => {
                            if (modifiedPath != null) {
                                this.revealInExplorer(modifiedPath);
                            }
                        },
                    },
                ],
            },
            {
                items: [
                    { label: 'Export JSON', disabled: !exportable, onSelect: () => void this.exportDiffAsync(id, 'json') },
                    { label: 'Export HTML', disabled: !exportable, onSelect: () => void this.exportDiffAsync(id, 'html') },
                ],
            },
            {
                items: [
                    { label: 'New compare', header: true, onSelect: () => {} },
                    ...this.newCompareMenuItems().map((item) => ({ ...item, label: `  ${item.label}` })),
                ],
            },
            {
                items: [
                    { label: 'Close', onSelect: () => void this.closeFileAsync(id) },
                    { label: 'Close others', disabled: state.tabOrder.length < 2, onSelect: () => void this.closeOthersAsync(id) },
                    {
                        label: 'Close to the right',
                        disabled: index < 0 || index >= state.tabOrder.length - 1,
                        onSelect: () => void this.closeToRightAsync(id),
                    },
                    { label: 'Close all', tone: 'fail', onSelect: () => void this.closeAllAsync() },
                ],
            },
        ];
    }

    private makeCommandContext(surface: 'tree' | 'tab', tabPath?: string): CommandContext {
        const state = this.store.getState();
        // On a tab the commands see the clicked tab as the whole selection.
        const selectedPaths = surface === 'tab' && tabPath != null
            ? [tabPath]
            : orderedSelection(this.explorer.selection, this.explorer.visiblePaths);

        return {
            surface,
            selectedPaths,
            // The tree's menus act on its rows only, so the empty area below them offers nothing for the active tab.
            activeTabPath: surface === 'tab' ? tabPath ?? state.activePath : null,
            openPaths: state.openFiles.map((file) => file.path),
            tabIds: state.tabOrder,
            dirtyPaths: state.openFiles.filter((file) => file.dirty).map((file) => file.path),
            workspaceOpen: state.workspace != null,
            clipboardAvailable: canReadClipboard(),
            // A tab is a file even while its folder is collapsed, or it lies outside the workspace, so no row shows it.
            isFile: (path) => {
                if (state.openFiles.some((file) => file.path === path)) {
                    return true;
                }

                const entry = this.findEntry(path);

                return entry != null && !isDirectoryEntry(entry);
            },
            isDirectory: (path) => this.isDirectory(path),
            isText: (path) => holdsTextAt(state.openFiles, path),
            isJson: (path) => resolveFileType(basename(path)).id === 'json',
            isXml: (path) => resolveFileType(basename(path)).id === 'xml',
            fileTypeId: (path) => resolveFileType(basename(path)).id,
            getOpenFileText: (path) => openFileText(state.openFiles, path),
        };
    }

    private buildCommandRegistry(): ReadonlyArray<Command> {
        const firstSelected = (context: CommandContext): string | null => context.selectedPaths[0] ?? null;
        const exactlyOneFile = (context: CommandContext): boolean => {
            if (context.selectedPaths.length !== 1) {
                return false;
            }

            const path = context.selectedPaths[0] ?? '';

            return context.isFile(path);
        };
        // Previews, such as Word documents, PDFs, images and archives, and files that aren't text have no text to compare.
        const exactlyOneComparableFile = (context: CommandContext): boolean => exactlyOneFile(context)
            && !this.holdsNoTextAt(context.selectedPaths[0] ?? '');

        return [
            // Group 0: reveal
            {
                id: 'reveal-in-explorer',
                label: 'Reveal in Explorer',
                appearsIn: 'tab',
                group: 0,
                // A file from outside the workspace has no row in the tree.
                enabledWhen: (context) => context.workspaceOpen
                    && context.activeTabPath != null
                    && !isExternalPath(context.activeTabPath),
                run: (context) => {
                    if (context.activeTabPath != null) {
                        this.revealInExplorer(context.activeTabPath);
                    }
                },
            },
            {
                id: 'save-pasted',
                label: 'Save…',
                appearsIn: 'tab',
                group: 0,
                // A pasted table or picture has no Save button in its toolbar.
                enabledWhen: (context) => context.activeTabPath != null && this.isPastedPath(context.activeTabPath),
                run: (context) => {
                    if (context.activeTabPath != null) {
                        void this.saveAsync(context.activeTabPath);
                    }
                },
            },

            // Group 1: open / compare
            {
                id: 'open',
                label: 'Open',
                shortcut: 'Enter',
                appearsIn: 'tree',
                group: 1,
                enabledWhen: (context) => exactlyOneFile(context),
                run: (context) => {
                    const path = firstSelected(context);

                    if (path != null) {
                        void this.openFileAsync(path);
                    }
                },
            },
            {
                id: 'open-as-workspace',
                label: 'Open as workspace',
                appearsIn: 'tree',
                group: 1,
                // One folder, picked by its own row; never over the empty area below the rows.
                enabledWhen: (context) => context.workspaceOpen
                    && context.rowPath != null
                    && context.selectedPaths.length === 1
                    && context.selectedPaths[0] === context.rowPath
                    && context.isDirectory(context.rowPath),
                run: (context) => {
                    if (context.rowPath != null) {
                        void this.openAsWorkspaceAsync(context.rowPath);
                    }
                },
            },
            {
                id: 'compare-selected-files',
                label: 'Compare these two files',
                appearsIn: 'tree',
                group: 1,
                multiSelect: true,
                visibleWhen: (context) => compareViewForPair(context) != null,
                enabledWhen: (context) => compareViewForPair(context) != null,
                run: (context) => {
                    const [first, second] = context.selectedPaths as [string, string];

                    if (compareViewForPair(context) != null) {
                        void this.compareTwoSelectedAsync(first, second);
                    }
                },
            },
            {
                id: 'compare-with',
                label: 'Compare with…',
                appearsIn: 'both',
                group: 1,
                enabledWhen: (context) => exactlyOneComparableFile(context),
                run: () => {},
                children: (context) => {
                    if (!exactlyOneComparableFile(context)) {
                        return [];
                    }

                    const path = firstSelected(context) ?? '';
                    const otherOpenTabs = context.openPaths.filter((openPath) => openPath !== path && !this.holdsNoTextAt(openPath));
                    const children: SubCommand[] = [
                        {
                            id: 'compare-clipboard',
                            label: 'Compare with clipboard',
                            enabledWhen: () => context.clipboardAvailable,
                            run: () => void this.compareWithClipboardAsync(path),
                        },
                        {
                            id: 'compare-pick',
                            label: 'Compare with a file…',
                            run: () => void this.compareWithPickedAsync(path),
                        },
                    ];

                    for (const otherPath of otherOpenTabs) {
                        children.push({
                            id: `compare-open-tab-${otherPath}`,
                            label: `Compare with open tab: ${basename(otherPath)}`,
                            run: () => void this.compareWithOpenTabAsync(path, otherPath),
                        });
                    }

                    return children;
                },
            },
            {
                id: 'new-compare',
                label: 'New compare',
                appearsIn: 'tab',
                group: 1,
                enabledWhen: () => true,
                run: () => {},
                children: () => DIFF_KINDS.map((kind) => ({
                    id: `new-compare-${kind}`,
                    label: DIFF_KIND_MENU_LABELS[kind],
                    run: () => void this.newCompare(kind),
                })),
            },

            // Group 2: create
            {
                id: 'new-file',
                label: 'New file',
                appearsIn: 'tree',
                group: 2,
                enabledWhen: (context) => context.workspaceOpen,
                run: (context) => {
                    const first = firstSelected(context);
                    const target = first != null && context.isDirectory(first)
                        ? first
                        : first != null
                            ? parentPath(first)
                            : '';
                    void this.newFileAsync(target);
                },
            },
            {
                id: 'new-folder',
                label: 'New folder',
                appearsIn: 'tree',
                group: 2,
                enabledWhen: (context) => context.workspaceOpen,
                run: (context) => {
                    const first = firstSelected(context);
                    const target = first != null && context.isDirectory(first)
                        ? first
                        : first != null
                            ? parentPath(first)
                            : '';
                    void this.newFolderAsync(target);
                },
            },

            // Group 3: rename / duplicate / delete
            {
                id: 'rename',
                label: 'Rename',
                shortcut: 'F2',
                appearsIn: 'tree',
                group: 3,
                enabledWhen: (context) => context.selectedPaths.length === 1,
                run: (context) => {
                    const path = firstSelected(context);

                    if (path != null) {
                        void this.renameAsync(path);
                    }
                },
            },
            {
                id: 'duplicate',
                label: 'Duplicate',
                shortcut: 'Ctrl+D',
                appearsIn: 'tree',
                group: 3,
                enabledWhen: (context) => context.selectedPaths.length === 1,
                run: (context) => {
                    const path = firstSelected(context);

                    if (path != null) {
                        void this.duplicateAsync(path);
                    }
                },
            },
            {
                id: 'delete',
                label: 'Delete',
                shortcut: 'Del',
                tone: 'fail',
                appearsIn: 'tree',
                group: 3,
                multiSelect: true,
                enabledWhen: (context) => context.selectedPaths.length > 0,
                run: (context) => void this.deletePathsAsync(context.selectedPaths),
            },

            // Group 4: copy helpers
            {
                id: 'copy-name',
                label: 'Copy name to clipboard',
                appearsIn: 'both',
                group: 4,
                enabledWhen: (context) => context.selectedPaths.length === 1 || context.activeTabPath != null,
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path != null) {
                        void copyTextWithToastAsync(basename(path), 'Name copied.');
                    }
                },
            },
            {
                id: 'copy-path',
                label: 'Copy path to clipboard',
                appearsIn: 'both',
                group: 4,
                // A file from outside the workspace has no workspace path.
                enabledWhen: (context) => (context.selectedPaths.length === 1 || context.activeTabPath != null)
                    && !isExternalPath(firstSelected(context) ?? context.activeTabPath),
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path != null) {
                        void copyTextWithToastAsync(path, 'Path copied.');
                    }
                },
            },
            {
                id: 'copy-content',
                label: 'Copy content to clipboard',
                appearsIn: 'both',
                group: 4,
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return false;
                    }

                    if (context.selectedPaths.length > 1) {
                        return false;
                    }

                    return context.isFile(path) && context.isText(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path != null) {
                        void this.copyContentAsync(path);
                    }
                },
            },

            // Group 5: format and convert
            {
                id: 'format-json',
                label: 'Format JSON',
                appearsIn: 'both',
                group: 5,
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null && context.isJson(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.formatJsonFileAsync(path);
                },
            },
            {
                id: 'format-yaml',
                label: 'Format YAML',
                appearsIn: 'both',
                group: 5,
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null && context.fileTypeId(path) === 'yaml';
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.formatYamlFileAsync(path);
                },
            },
            {
                id: 'convert-xml-to-json',
                label: 'Convert XML to JSON',
                appearsIn: 'both',
                group: 5,
                // The converted tab saves next to the source, which a file from outside the workspace doesn't have.
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null && context.isXml(path) && !isExternalPath(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.convertXmlToJsonAsync(path);
                },
            },
            {
                id: 'convert-yaml-to-json',
                label: 'Convert YAML to JSON',
                appearsIn: 'both',
                group: 5,
                // The converted tab saves next to the source, which a file from outside the workspace doesn't have.
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null && context.fileTypeId(path) === 'yaml' && !isExternalPath(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.convertYamlToJsonAsync(path);
                },
            },
            {
                id: 'convert-json-to-yaml',
                label: 'Convert JSON to YAML',
                appearsIn: 'both',
                group: 5,
                // The converted tab saves next to the source, which a file from outside the workspace doesn't have.
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null && context.isJson(path) && !isExternalPath(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.convertJsonToYamlAsync(path);
                },
            },
            {
                id: 'convert-html-to-markdown',
                label: 'Convert HTML to Markdown',
                appearsIn: 'both',
                group: 5,
                // The converted tab saves next to the source, which a file from outside the workspace doesn't have.
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null
                        && context.fileTypeId(path) === 'html'
                        && context.isFile(path)
                        && !isExternalPath(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.convertDocumentFileAsync(path, 'markdown');
                },
            },
            {
                id: 'convert-markdown-to-html',
                label: 'Convert Markdown to HTML',
                appearsIn: 'both',
                group: 5,
                // The converted tab saves next to the source, which a file from outside the workspace doesn't have.
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null
                        && context.fileTypeId(path) === 'markdown'
                        && context.isFile(path)
                        && !isExternalPath(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.convertDocumentFileAsync(path, 'html');
                },
            },
            {
                id: 'xml-compare-with',
                label: 'Compare XML with…',
                appearsIn: 'both',
                group: 5,
                enabledWhen: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    return path != null && context.isXml(path);
                },
                run: (context) => {
                    const path = firstSelected(context) ?? context.activeTabPath;

                    if (path == null) {
                        return;
                    }

                    void this.compareWithPickedAsync(path);
                },
            },
            {
                id: 'save-pages',
                label: 'Save pages…',
                appearsIn: 'both',
                group: 5,
                // A PDF in the tree, or the tab of a PDF from the workspace or from outside it.
                enabledWhen: (context) => {
                    const path = firstSelected(context);

                    return context.selectedPaths.length === 1
                        && path != null
                        && context.fileTypeId(path) === 'pdf'
                        && (context.surface === 'tab' || context.isFile(path));
                },
                run: (context) => {
                    const path = firstSelected(context);

                    if (path != null) {
                        void this.savePdfPagesAsync(path, null);
                    }
                },
            },

            // Group 6: refresh
            {
                id: 'refresh',
                label: 'Refresh',
                appearsIn: 'tree',
                group: 6,
                multiSelect: true,
                enabledWhen: (context) => context.workspaceOpen,
                run: () => void this.refreshTreeAsync(),
            },

            // Group 7: tab-only close commands
            {
                id: 'close',
                label: 'Close',
                appearsIn: 'tab',
                group: 7,
                enabledWhen: (context) => context.activeTabPath != null,
                run: (context) => {
                    if (context.activeTabPath != null) {
                        void this.closeFileAsync(context.activeTabPath);
                    }
                },
            },
            {
                id: 'close-others',
                label: 'Close others',
                appearsIn: 'tab',
                group: 7,
                enabledWhen: (context) => (context.tabIds ?? context.openPaths).length > 1 && context.activeTabPath != null,
                run: (context) => {
                    if (context.activeTabPath != null) {
                        void this.closeOthersAsync(context.activeTabPath);
                    }
                },
            },
            {
                id: 'close-right',
                label: 'Close to the right',
                appearsIn: 'tab',
                group: 7,
                enabledWhen: (context) => {
                    if (context.activeTabPath == null) {
                        return false;
                    }

                    const tabs = context.tabIds ?? context.openPaths;
                    const index = tabs.indexOf(context.activeTabPath);

                    return index >= 0 && index < tabs.length - 1;
                },
                run: (context) => {
                    if (context.activeTabPath != null) {
                        void this.closeToRightAsync(context.activeTabPath);
                    }
                },
            },
            {
                id: 'close-all',
                label: 'Close all',
                tone: 'fail',
                appearsIn: 'tab',
                group: 7,
                enabledWhen: (context) => (context.tabIds ?? context.openPaths).length > 0,
                run: () => void this.closeAllAsync(),
            },
        ];
    }

    private async formatJsonFileAsync(path: string): Promise<void> {
        const open = await this.openForEditAsync(path);

        if (open != null) {
            applyJsonTransform(open, { onChange: (changedPath, text) => this.markChange(changedPath, text) }, 'format');
        }
    }

    private async formatYamlFileAsync(path: string): Promise<void> {
        const open = await this.openForEditAsync(path);

        if (open != null) {
            applyYamlFormat(open, { onChange: (changedPath, text) => this.markChange(changedPath, text) });
        }
    }

    // The file's tab, opened first when it isn't open, for a command that edits its text.
    private async openForEditAsync(path: string): Promise<OpenFile | null> {
        if (!this.store.getState().openFiles.some((file) => file.path === path)) {
            await this.openFileAsync(path);
        }

        return this.store.getState().openFiles.find((file) => file.path === path) ?? null;
    }
}

// Where a new PDF from outside the workspace goes, or null when the picker is closed; a browser without one throws.
async function pickPdfSaveTargetAsync(name: string): Promise<FileSystemFileHandle | null> {
    if (typeof window.showSaveFilePicker !== 'function') {
        throw new Error('This browser cannot save files outside the workspace.');
    }

    try {
        return await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
        });
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return null;
        }

        throw error;
    }
}

function findInTree(tree: DirectoryEntry, path: string): FileEntry | null {
    if (path === '') {
        return tree;
    }

    for (const child of tree.children) {
        if (child.path === path) {
            return child;
        }

        if (isDirectoryEntry(child) && path.startsWith(`${child.path}/`)) {
            const found = findInTree(child, path);

            if (found != null) {
                return found;
            }
        }
    }

    return null;
}

async function collectAllFolderPathsAsync(
    directory: FileSystemDirectoryHandle,
    path: string,
    into: Set<string>,
): Promise<void> {
    for await (const entry of directory.values()) {
        if (entry.kind !== 'directory') {
            continue;
        }

        const childPath = path === '' ? entry.name : `${path}/${entry.name}`;
        into.add(childPath);
        await collectAllFolderPathsAsync(entry, childPath, into);
    }
}

// `candidate` when it is free, otherwise the first free `-copy`, `-copy-2`, `-copy-3`… name before the extension.
export function resolveCopyName(candidate: string, existingNames: ReadonlySet<string>): string {
    return isNameTaken(candidate, existingNames) ? nextCopyName(candidate, existingNames) : candidate;
}

// The live copy last built for each diff tab, so a render whose texts haven't changed hands the view the same tab
// and the compare stays mounted, with focus and caret, through unrelated store updates.
const liveDiffTabs = new WeakMap<DiffTab, DiffTab>();

function hasSameText(left: DiffSide | null, right: DiffSide | null): boolean {
    return left === right || (left != null && right != null && left.text === right.text);
}

// Points file sides of a diff at the open tab's current text, so unsaved edits show in the diff as they are made.
export function withLiveSides(tab: DiffTab, openFiles: ReadonlyArray<OpenFile>): DiffTab {
    const live = (side: DiffSide | null): DiffSide | null => {
        if (!isWorkspaceFileSide(side)) {
            return side;
        }

        const open = openFiles.find((file) => file.path === side.path);

        return open == null || holdsNoTextInMemory(open) || open.text === side.text ? side : { ...side, text: open.text };
    };
    const original = live(tab.original);
    const modified = live(tab.modified);

    if (original === tab.original && modified === tab.modified) {
        return tab;
    }

    const previous = liveDiffTabs.get(tab);

    if (previous != null && hasSameText(previous.original, original) && hasSameText(previous.modified, modified)) {
        return previous;
    }

    const next = { ...tab, original, modified };
    liveDiffTabs.set(tab, next);

    return next;
}

// Folders the Compare with… list leaves out: version control and installed packages. Build output stays in,
// since a built file is often what gets compared; Lookup leaves it out too, as it reads every file it lists.
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules']);
const FILE_LIST_LIMIT = 5000;

async function collectFilePathsAsync(directory: FileSystemDirectoryHandle, path: string, into: string[]): Promise<void> {
    for await (const entry of directory.values()) {
        if (into.length >= FILE_LIST_LIMIT) {
            return;
        }

        if (isTransientEntry(entry.name)) {
            continue;
        }

        const childPath = path === '' ? entry.name : `${path}/${entry.name}`;

        if (entry.kind === 'file') {
            into.push(childPath);
        }
        else if (!SKIPPED_FOLDERS.has(entry.name)) {
            await collectFilePathsAsync(entry, childPath, into);
        }
    }
}

// Text of an open tab for diffs; large tables, documents and previews hold none.
function openFileText(files: ReadonlyArray<OpenFile>, path: string): string | null {
    const file = files.find((item) => item.path === path);

    return file == null || holdsNoTextInMemory(file) ? null : file.text;
}

// Whether a file is text: an open tab knows from how it opened, and a file that isn't open goes by its type.
function holdsTextAt(files: ReadonlyArray<OpenFile>, path: string): boolean {
    const name = basename(path);
    const type = resolveFileType(name);
    const open = files.find((file) => file.path === path);

    if (open == null) {
        return type.isText;
    }

    if (open.binary === true || holdsNoText(name)) {
        return false;
    }

    // A file of unknown type that isn't marked binary opened as text, as its first bytes looked like text.
    return type.isText || type.id === 'unknown';
}

// An open file whose text was never read: a large table read from disk on demand, a document or preview shown from its File,
// or a file that isn't text.
function holdsNoTextInMemory(file: OpenFile): boolean {
    return file.large === true || file.binary === true || holdsNoText(basename(file.path));
}

// A file of an unknown type opens as text only when its first bytes look like text; every known type keeps its own handling.
async function isBinaryFileAsync(name: string, file: Blob): Promise<boolean> {
    return resolveFileType(name).id === 'unknown' && !await looksLikeTextFileAsync(file);
}

function previewRefusal(name: string): string {
    return `${name} can't be compared: it opens only as a preview.`;
}

function binaryRefusal(name: string): string {
    return `${name} can't be compared: it isn't text.`;
}

// Why a file can't be a side of a compare, or null when it can: a preview has no text, and neither has a file that isn't text.
async function compareRefusalAsync(name: string, file: Blob): Promise<string | null> {
    if (holdsNoText(name)) {
        return previewRefusal(name);
    }

    return await isBinaryFileAsync(name, file) ? binaryRefusal(name) : null;
}

// An open tab as a diff side. A file from outside the workspace counts as a file from disk,
// so the compare is not kept with the workspace.
function openTabSide(file: OpenFile): DiffSide {
    if (file.external != null) {
        const name = basename(file.path);

        return { label: name, path: name, source: 'disk', text: file.text, file: file.file };
    }

    return { label: file.path, path: file.path, source: 'open-tab', text: file.text, file: file.file };
}

// How many of the characters an encoding can't hold the Save as UTF-8 question names.
const UNREPRESENTABLE_SHOWN = 5;

// What a save writes, and the encoding the file is in from then on.
interface SaveBytes {
    readonly bytes: EncodedBytes;
    readonly encoding: TextEncoding;
}

// A workspace file's text as it opens: decoded in the encoding it is in, or empty for a file that holds no text.
async function textOfSnapshotAsync(snapshot: File, isEmpty: boolean): Promise<ReturnType<typeof textFromDisk>> {
    if (isEmpty) {
        return textFromDisk('');
    }

    const { text, encoding } = await readTextBlobAsync(snapshot);

    return textFromDisk(text, encoding);
}

interface DroppedContents {
    readonly file: File;
    readonly text: string;
    readonly encoding: TextEncoding;
    readonly large: boolean;
    readonly binary: boolean;
}

// The contents of a dropped file, or null when it can't be read, such as a folder the browser listed as a file.
async function readDroppedFileAsync(item: DroppedFile): Promise<DroppedContents | null> {
    try {
        const file = await item.readAsync();
        const large = isLargeTableFile(item.name, file.size);
        const binary = await isBinaryFileAsync(item.name, file);

        const { text, encoding } = large || binary || holdsNoText(item.name)
            ? { text: '', encoding: 'utf-8' as const }
            : await readTextBlobAsync(file);

        return { file, text, encoding, large, binary };
    }
    catch {
        return null;
    }
}

// One dropped item on its way into the workspace, with what already sits at its target path.
interface ImportStep {
    readonly item: DroppedItem;
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly existing: FileSystemHandleKind | null;
    readonly children: ReadonlyArray<ImportStep>;
}

interface ImportTally {
    files: number;
    folders: number;
    firstFile: string | null;
    firstFolder: string | null;
}

async function planImportAsync(options: {
    root: FileSystemDirectoryHandle;
    items: ReadonlyArray<DroppedItem>;
    folder: string;
    sourceFolder: string;
    folderExists: boolean;
}): Promise<ImportStep[]> {
    const { root, items, folder, sourceFolder, folderExists } = options;
    const steps: ImportStep[] = [];

    for (const item of items) {
        const targetPath = joinPath(folder, item.name);
        const sourcePath = joinPath(sourceFolder, item.name);
        const existing = folderExists ? await entryKindAsync(root, targetPath) : null;
        const children = item.kind === 'directory'
            ? await planImportAsync({
                root,
                items: await item.listAsync(),
                folder: targetPath,
                sourceFolder: sourcePath,
                folderExists: existing === 'directory',
            })
            : [];
        steps.push({ item, sourcePath, targetPath, existing, children });
    }

    return steps;
}

function flattenImportSteps(steps: ReadonlyArray<ImportStep>): ImportStep[] {
    return steps.flatMap((step) => [step, ...flattenImportSteps(step.children)]);
}

// A folder dropped onto a folder of the same name merges into it; any other existing entry is a clash.
function isImportClash(step: ImportStep): boolean {
    return step.existing != null && !(step.item.kind === 'directory' && step.existing === 'directory');
}

// "1 file", "2 files and 1 folder".
function filesAndFoldersLabel(files: number, folders: number): string {
    const parts = [
        files > 0 || folders === 0 ? countLabel(files, 'file') : null,
        folders > 0 ? countLabel(folders, 'folder') : null,
    ];

    return parts.filter((part) => part != null).join(' and ');
}
