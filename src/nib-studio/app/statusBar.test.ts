import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiffTab } from './diffTabs.js';
import { renderStatusBar } from './statusBar.js';
import type { AppState } from './store.js';
import { Store } from './store.js';
import { openFileFixture } from '../testing/testHelpers.js';

vi.mock('../views/tableViewer.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('../views/tableViewer.js')>(),
    sheetLabelOf: (key: string) => (key === 'data/sales.xlsx' ? 'Sheet 2 of 3 · Q2' : null),
}));

function baseState(patch: Partial<AppState> = {}): AppState {
    return { ...new Store().getState(), ...patch };
}

function workspaceState(patch: Partial<AppState> = {}): AppState {
    return baseState({
        workspace: { id: 'w1', handle: {} as FileSystemDirectoryHandle, name: 'notes' },
        ...patch,
    });
}

function itemTexts(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.status-item')].map((item) => item.textContent ?? '');
}

describe('renderStatusBar', () => {
    afterEach(() => {
        for (const node of document.querySelectorAll('.modal-backdrop')) {
            node.remove();
        }
    });

    it('prompts for a workspace when none is open', () => {
        const container = document.createElement('footer');
        renderStatusBar(container, baseState());

        expect(itemTexts(container)).toEqual(['Pick a workspace folder to begin.']);
        expect(container.querySelector('.status-about')?.getAttribute('aria-label')).toBe('About & third-party licences');
    });

    it('shows the active file, its language, encoding and clean state', () => {
        const container = document.createElement('footer');
        renderStatusBar(container, workspaceState({ openFiles: [openFileFixture('docs/readme.md')], activePath: 'docs/readme.md' }));

        expect(itemTexts(container)).toEqual(['readme.md', 'Markdown', 'UTF-8', 'clean', 'Workspace: notes']);
        expect(container.querySelector<HTMLElement>('[data-tone="ok"]')?.textContent).toBe('clean');
    });

    it('counts unsaved files with a warning tone', () => {
        const container = document.createElement('footer');
        const files = [openFileFixture('a.json', '', { dirty: true }), openFileFixture('b.json', '', { dirty: true }), openFileFixture('c.json')];
        renderStatusBar(container, workspaceState({ openFiles: files, activePath: 'c.json' }));
        const warning = container.querySelector<HTMLElement>('[data-tone="warn"]');

        expect(warning?.textContent).toBe('2 unsaved');
        expect(itemTexts(container)[1]).toBe('JSON');
    });

    it('shows a dash when no tab is active, and no encoding', () => {
        const container = document.createElement('footer');
        renderStatusBar(container, workspaceState());

        expect(itemTexts(container)).toEqual(['—', '', 'clean', 'Workspace: notes']);
    });

    it('leaves the encoding out for workbooks, which are read as sheets, and keeps it for CSV and TSV', () => {
        const workbooks = ['book.xlsx', 'book.xls', 'book.xlsm', 'book.xlsb', 'book.xltx', 'book.xltm', 'book.ods'];

        for (const path of workbooks) {
            const container = document.createElement('footer');
            renderStatusBar(container, workspaceState({ openFiles: [openFileFixture(path)], activePath: path }));

            expect(itemTexts(container), path).not.toContain('UTF-8');
        }

        for (const path of ['rows.csv', 'rows.tsv']) {
            const container = document.createElement('footer');
            renderStatusBar(container, workspaceState({ openFiles: [openFileFixture(path)], activePath: path }));

            expect(itemTexts(container), path).toContain('UTF-8');
        }
    });

    it('leaves the encoding out for previews and files that aren\'t text', () => {
        const files = [openFileFixture('photo.png'), openFileFixture('report.pdf'), openFileFixture('firmware', '', { binary: true })];

        for (const file of files) {
            const container = document.createElement('footer');
            renderStatusBar(container, workspaceState({ openFiles: [file], activePath: file.path }));

            expect(itemTexts(container), file.path).not.toContain('UTF-8');
        }
    });

    it('labels the language for known and unknown extensions', () => {
        const cases: ReadonlyArray<[string, string]> = [
            ['a.ts', 'TypeScript'],
            ['a.tsx', 'TypeScript'],
            ['a.mjs', 'JavaScript'],
            ['a.html', 'HTML'],
            ['a.scss', 'CSS'],
            ['a.yaml', 'YAML'],
            ['a.markdown', 'Markdown'],
            ['Makefile', 'Text'],
            ['data.csv', 'CSV'],
            ['backup.tar.gz', 'Gzip-compressed tar archive'],
            ['song.mp3', 'MP3 audio'],
            ['clip.webm', 'WebM video'],
        ];

        for (const [path, label] of cases) {
            const container = document.createElement('footer');
            renderStatusBar(container, workspaceState({ openFiles: [openFileFixture(path)], activePath: path }));

            expect(itemTexts(container)[1], path).toBe(label);
        }
    });

    it('shows the compare title for an active diff tab', () => {
        const container = document.createElement('footer');
        const diff = createDiffTab(
            { label: 'a.json', path: 'a.json', source: 'file' },
            { label: 'b.json', path: 'b.json', source: 'file' },
        );
        renderStatusBar(container, workspaceState({ diffTabs: [diff], activePath: diff.id }));

        expect(itemTexts(container)[0]).toContain('a.json');
        expect(itemTexts(container)[0]).toContain('b.json');
        expect(itemTexts(container)[1]).toBe('Compare');
        expect(itemTexts(container)).not.toContain('UTF-8');
    });

    it('replaces previous content on each render', () => {
        const container = document.createElement('footer');
        renderStatusBar(container, workspaceState());
        renderStatusBar(container, baseState());

        expect(container.querySelectorAll('.status-about')).toHaveLength(1);
        expect(itemTexts(container)).toHaveLength(1);
    });

    it('opens the about dialog from the gear button', () => {
        const container = document.createElement('footer');
        renderStatusBar(container, baseState());
        container.querySelector<HTMLButtonElement>('.status-about')?.click();

        expect(document.querySelector('.modal-backdrop[data-role="about"]')).not.toBeNull();
    });

    it('names the sheet a workbook shows, after its type', () => {
        const container = document.createElement('footer');
        const files = [openFileFixture('data/sales.xlsx'), openFileFixture('data/one.xlsx')];
        renderStatusBar(container, workspaceState({ openFiles: files, activePath: 'data/sales.xlsx' }));

        expect(itemTexts(container)).toEqual(['sales.xlsx', 'Excel workbook', 'Sheet 2 of 3 · Q2', 'clean', 'Workspace: notes']);

        renderStatusBar(container, workspaceState({ openFiles: files, activePath: 'data/one.xlsx' }));

        expect(itemTexts(container)).toEqual(['one.xlsx', 'Excel workbook', 'clean', 'Workspace: notes']);
    });
});
