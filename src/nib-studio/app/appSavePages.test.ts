import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDirectoryHandle, FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { buildTestPdf } from '../../common/pdf/testing/pdfBuilder.js';
import { createAppHarness, openHarnessWorkspaceAsync, type AppHarness } from '../testing/appHarness.js';
import { settleAsync, toastTexts } from '../testing/testHelpers.js';
import { showSavePagesDialogAsync, type OpenPdf, type SavePagesDialogOptions } from '../views/pdfSavePagesDialog.js';
import { mountPreview } from '../views/previewPane.js';
import { buildContextMenu, type Command, type CommandContext } from './commands.js';
import type { DroppedFile } from './droppedItems.js';
import { isExternalPath } from './store.js';

vi.mock('../views/previewPane.js', () => ({
    mountPreview: vi.fn((pane: HTMLElement) => {
        const element = document.createElement('div');
        element.className = 'preview-frame';
        pane.append(element);

        return { element, update: vi.fn(), destroy: vi.fn() };
    }),
}));

vi.mock('../views/pdfSavePagesDialog.js', () => ({
    showSavePagesDialogAsync: vi.fn(async () => false),
}));

const REPORT = buildTestPdf({ pages: [[612, 792], [612, 792], [612, 792]] });
const NEW_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

let harness: AppHarness;

// What the app asked the last Save pages dialog to do.
function dialogOptions(): SavePagesDialogOptions {
    const options = vi.mocked(showSavePagesDialogAsync).mock.calls.at(-1)?.[0];

    if (options == null) {
        throw new Error('No Save pages dialog was opened');
    }

    return options;
}

async function commandAsync(surface: 'tree' | 'tab', paths: ReadonlyArray<string>): Promise<{ command: Command; context: CommandContext }> {
    const registry = await harness.callAsync<ReadonlyArray<Command>>('buildCommandRegistry');
    const command = registry.find((candidate) => candidate.id === 'save-pages') as Command;
    const context = await harness.callAsync<CommandContext>('makeCommandContext', surface, paths[0]);

    return { command, context: surface === 'tree' ? { ...context, selectedPaths: paths } : context };
}

function menuLabels(command: Command, context: CommandContext): string[] {
    return buildContextMenu([command], context, context.surface).flatMap((group) => group.items.map((item) => item.label));
}

async function openOutsidePdfAsync(): Promise<string> {
    const desktop = new FakeDirectoryHandle('desktop');
    desktop.addFile('scan.pdf', REPORT);
    const handle = desktop.find('scan.pdf') as FakeFileHandle;
    const dropped: DroppedFile = {
        kind: 'file',
        name: 'scan.pdf',
        handle: handle as unknown as FileSystemFileHandle,
        readAsync: async () => await handle.getFile(),
    };
    await harness.callAsync('openExternalFileAsync', dropped);
    const path = harness.state().openFiles.find((file) => isExternalPath(file.path))?.path;

    if (path == null) {
        throw new Error('The PDF from outside did not open');
    }

    return path;
}

beforeEach(async () => {
    vi.mocked(mountPreview).mockClear();
    vi.mocked(showSavePagesDialogAsync).mockClear();
    harness = createAppHarness({
        'report.pdf': REPORT,
        'report-pages.pdf': REPORT,
        'documents/scan.pdf': REPORT,
        'notes.txt': 'one\n',
        'photo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    await openHarnessWorkspaceAsync(harness);
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('App Save pages command', () => {
    it('offers Save pages… for a PDF in the Explorer and on its tab, and for nothing else', async () => {
        await harness.callAsync('openFileAsync', 'report.pdf');
        await harness.callAsync('openFileAsync', 'notes.txt');

        const tree = await commandAsync('tree', ['report.pdf']);
        const tab = await commandAsync('tab', ['report.pdf']);

        expect(menuLabels(tree.command, tree.context)).toEqual(['Save pages…']);
        expect(menuLabels(tab.command, tab.context)).toEqual(['Save pages…']);

        for (const path of ['notes.txt', 'photo.png']) {
            const other = await commandAsync('tree', [path]);
            expect(other.command.enabledWhen(other.context), path).toBe(false);
        }

        const textTab = await commandAsync('tab', ['notes.txt']);
        expect(textTab.command.enabledWhen(textTab.context)).toBe(false);

        const two = await commandAsync('tree', ['report.pdf', 'report-pages.pdf']);
        expect(menuLabels(two.command, two.context)).toEqual([]);
    });

    it('offers Save pages… on the tab of a PDF from outside the workspace', async () => {
        const path = await openOutsidePdfAsync();
        const tab = await commandAsync('tab', [path]);

        expect(tab.command.enabledWhen(tab.context)).toBe(true);
    });

    it('opens the dialog from the Explorer with the file from disk and the next free name', async () => {
        const tree = await commandAsync('tree', ['report.pdf']);
        tree.command.run(tree.context);
        await settleAsync();
        const options = dialogOptions();

        expect(options.fileName).toBe('report.pdf');
        expect(options.suggestedName).toBe('report-pages-2.pdf');
        expect(options.saveLabel).toBe('Save');
        expect(options.destinationHint).toBe('It goes at the workspace root, next to report.pdf.');
        expect(options.open).toBeNull();
        expect(new Uint8Array(await options.file.arrayBuffer())).toEqual(REPORT);
    });

    it('checks the name as the app\'s other name boxes do, and against the files beside it', async () => {
        await harness.callAsync('savePdfPagesAsync', 'report.pdf', null);
        const { validateName } = dialogOptions();

        expect(validateName('report-pages-2.pdf')).toBeNull();
        expect(validateName('Report-Pages.pdf')).toBe('A file named report-pages.pdf already exists.');
        expect(validateName('notes/pages.pdf')).toBe('Name cannot contain slashes.');
        expect(validateName('..')).toBe('Reserved name.');
    });

    it('hands the dialog the preview\'s open document and the tab\'s snapshot', async () => {
        await harness.callAsync('openFileAsync', 'documents/scan.pdf');
        const tabFile = harness.state().openFiles.find((file) => file.path === 'documents/scan.pdf')?.file;
        const input = vi.mocked(mountPreview).mock.calls.at(-1)?.[1];
        const open = { document: {}, engine: {} } as unknown as OpenPdf;
        input?.onSavePdfPages?.(open);
        await settleAsync();
        const options = dialogOptions();

        expect(options.open).toBe(open);
        expect(options.file).toBe(tabFile);
        expect(options.suggestedName).toBe('scan-pages.pdf');
        expect(options.destinationHint).toBe('It goes in documents/, next to scan.pdf.');
    });
});

describe('App saving pages', () => {
    it('writes the new PDF next to the original, says so, shows it in the tree and opens it', async () => {
        await harness.callAsync('savePdfPagesAsync', 'documents/scan.pdf', null);
        const saved = await dialogOptions().saveAsync('scan-pages.pdf', NEW_PDF);
        await settleAsync();
        const written = harness.folder.find('documents/scan-pages.pdf') as FakeFileHandle;

        expect(saved).toBe(true);
        expect(written.data).toEqual(NEW_PDF);
        expect(toastTexts()).toContain('Saved scan-pages.pdf.');
        expect(harness.state().activePath).toBe('documents/scan-pages.pdf');
        expect(harness.state().selectedPath).toBe('documents/scan-pages.pdf');
        expect(harness.state().expandedPaths.has('documents')).toBe(true);
        expect(document.querySelector('.tree-row[data-path="documents/scan-pages.pdf"]')).not.toBeNull();
        expect(vi.mocked(mountPreview).mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'pdf', memoryKey: 'documents/scan-pages.pdf' });
    });

    it('never writes over a file of the same name, and says why', async () => {
        await harness.callAsync('savePdfPagesAsync', 'report.pdf', null);
        const existing = harness.folder.find('report-pages.pdf') as FakeFileHandle;

        await expect(dialogOptions().saveAsync('report-pages.pdf', NEW_PDF)).rejects.toThrow('A file named report-pages.pdf already exists.');
        expect(existing.data).toEqual(REPORT);
    });

    it('saves the pages of a PDF from outside the workspace where the file picker says, and opens them', async () => {
        const path = await openOutsidePdfAsync();
        const desktop = new FakeDirectoryHandle('desktop');
        const target = await desktop.getFileHandle('scan-pages.pdf', { create: true });
        const picker = vi.fn(async () => target);
        vi.stubGlobal('showSaveFilePicker', picker);
        await harness.callAsync('savePdfPagesAsync', path, null);
        const options = dialogOptions();

        expect(options.saveLabel).toBe('Save as…');
        expect(options.suggestedName).toBe('scan-pages.pdf');
        expect(options.destinationHint).toBe('A file picker asks where it goes.');
        expect(options.validateName('scan.pdf')).toBeNull();

        const saved = await options.saveAsync('scan-pages.pdf', NEW_PDF);
        await settleAsync();

        expect(saved).toBe(true);
        expect(picker).toHaveBeenCalledWith({
            suggestedName: 'scan-pages.pdf',
            types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        expect(target.data).toEqual(NEW_PDF);
        expect(toastTexts()).toContain('Saved scan-pages.pdf.');
        expect(harness.state().openFiles.filter((file) => isExternalPath(file.path)).map((file) => file.file?.name)).toEqual(['scan.pdf', 'scan-pages.pdf']);
    });

    it('shows only the Saved toast when the saved pages open in their own tab', async () => {
        const path = await openOutsidePdfAsync();
        const desktop = new FakeDirectoryHandle('desktop');
        const target = await desktop.getFileHandle('scan-pages.pdf', { create: true });
        vi.stubGlobal('showSaveFilePicker', vi.fn(async () => target));
        await harness.callAsync('savePdfPagesAsync', path, null);
        document.querySelectorAll('.toast').forEach((toast) => toast.remove());

        await dialogOptions().saveAsync('scan-pages.pdf', NEW_PDF);
        await settleAsync();

        expect(toastTexts()).toEqual(['Saved scan-pages.pdf.']);
    });

    it('still says a dropped file from outside the workspace opened from there', async () => {
        await openOutsidePdfAsync();

        expect(toastTexts()).toContain('Opened scan.pdf from outside the workspace.');
    });

    it('keeps the dialog open when the file picker is closed', async () => {
        const path = await openOutsidePdfAsync();
        vi.stubGlobal('showSaveFilePicker', vi.fn(async () => {
            throw new DOMException('The user aborted a request.', 'AbortError');
        }));
        await harness.callAsync('savePdfPagesAsync', path, null);

        expect(await dialogOptions().saveAsync('scan-pages.pdf', NEW_PDF)).toBe(false);
    });

    it('says when the browser can\'t save outside the workspace', async () => {
        const path = await openOutsidePdfAsync();
        vi.stubGlobal('showSaveFilePicker', undefined);
        await harness.callAsync('savePdfPagesAsync', path, null);

        await expect(dialogOptions().saveAsync('scan-pages.pdf', NEW_PDF)).rejects.toThrow('This browser cannot save files outside the workspace.');
    });

    it('says when the PDF can\'t be read', async () => {
        await harness.callAsync('savePdfPagesAsync', 'missing.pdf', null);

        expect(showSavePagesDialogAsync).not.toHaveBeenCalled();
        expect(toastTexts()).toContain('Could not read missing.pdf.');
    });
});
