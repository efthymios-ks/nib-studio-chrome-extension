import { describe, expect, it } from 'vitest';
import {
    DEFAULT_WORKSPACE_CONFIG,
    WORKSPACE_CONFIG_PATH,
    mergeWorkspaceConfig,
    readWorkspaceConfigAsync,
    writeWorkspaceConfigAsync,
    type WorkspaceConfig,
} from './workspaceConfig.js';
import { FakeDirectoryHandle, asRoot, textOf } from './testing/fakeFileSystem.js';

const SAVED_CONFIG: WorkspaceConfig = {
    openFiles: ['readme.md', 'data/orders.csv'],
    diffTabs: [{ original: 'a.json', modified: 'b.json', position: 2 }],
    activePath: 'readme.md',
    activeDiffTab: 0,
    expandedPaths: ['data'],
    activeSurface: 'hash',
};

describe('workspaceConfig', () => {
    describe('readWorkspaceConfigAsync', () => {
        it('returns the defaults when the file is missing', async () => {
            const root = new FakeDirectoryHandle('project');

            await expect(readWorkspaceConfigAsync(asRoot(root))).resolves.toBe(DEFAULT_WORKSPACE_CONFIG);
        });

        it('returns the defaults when the file is not valid JSON', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile(WORKSPACE_CONFIG_PATH, '{ broken');

            await expect(readWorkspaceConfigAsync(asRoot(root))).resolves.toBe(DEFAULT_WORKSPACE_CONFIG);
        });

        it('reads a saved configuration', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile(WORKSPACE_CONFIG_PATH, JSON.stringify(SAVED_CONFIG));

            await expect(readWorkspaceConfigAsync(asRoot(root))).resolves.toEqual(SAVED_CONFIG);
        });

        it('fills fields missing from an older file with defaults', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile(WORKSPACE_CONFIG_PATH, JSON.stringify({ openFiles: ['a.txt'] }));

            await expect(readWorkspaceConfigAsync(asRoot(root))).resolves.toEqual({
                ...DEFAULT_WORKSPACE_CONFIG,
                openFiles: ['a.txt'],
            });
        });
    });

    describe('writeWorkspaceConfigAsync', () => {
        it('writes indented JSON with a trailing newline', async () => {
            const root = new FakeDirectoryHandle('project');

            await writeWorkspaceConfigAsync(asRoot(root), SAVED_CONFIG);

            expect(textOf(root, WORKSPACE_CONFIG_PATH)).toBe(`${JSON.stringify(SAVED_CONFIG, null, 2)}\n`);
        });

        it('round-trips through read', async () => {
            const root = new FakeDirectoryHandle('project');

            await writeWorkspaceConfigAsync(asRoot(root), SAVED_CONFIG);

            await expect(readWorkspaceConfigAsync(asRoot(root))).resolves.toEqual(SAVED_CONFIG);
        });

        it('swallows write failures, and says it made no file', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addDirectory(WORKSPACE_CONFIG_PATH);

            await expect(writeWorkspaceConfigAsync(asRoot(root), SAVED_CONFIG)).resolves.toBe(false);
        });

        it('says whether the write made the file, which only the first one does', async () => {
            const root = new FakeDirectoryHandle('project');

            await expect(writeWorkspaceConfigAsync(asRoot(root), SAVED_CONFIG)).resolves.toBe(true);
            await expect(writeWorkspaceConfigAsync(asRoot(root), DEFAULT_WORKSPACE_CONFIG)).resolves.toBe(false);
            await expect(readWorkspaceConfigAsync(asRoot(root))).resolves.toEqual(DEFAULT_WORKSPACE_CONFIG);
        });
    });

    describe('mergeWorkspaceConfig', () => {
        it('keeps the base when nothing is stored', () => {
            expect(mergeWorkspaceConfig(DEFAULT_WORKSPACE_CONFIG, {})).toEqual(DEFAULT_WORKSPACE_CONFIG);
        });

        it('takes every valid stored field', () => {
            expect(mergeWorkspaceConfig(DEFAULT_WORKSPACE_CONFIG, SAVED_CONFIG)).toEqual(SAVED_CONFIG);
        });

        it('ignores fields of the wrong type', () => {
            const stored = {
                openFiles: 'readme.md',
                diffTabs: { original: 'a', modified: 'b', position: 0 },
                activeDiffTab: '1',
                expandedPaths: null,
                activeSurface: 'editor',
            } as unknown as Partial<WorkspaceConfig>;

            expect(mergeWorkspaceConfig(SAVED_CONFIG, stored)).toEqual(SAVED_CONFIG);
        });

        it('drops malformed diff tabs and keeps valid ones', () => {
            const valid = { original: 'x.txt', modified: 'y.txt', position: 1 };
            const stored = {
                diffTabs: [null, valid, { original: 'x.txt', modified: 'y.txt' }, { original: 1, modified: 'y', position: 0 }],
            } as unknown as Partial<WorkspaceConfig>;

            expect(mergeWorkspaceConfig(DEFAULT_WORKSPACE_CONFIG, stored).diffTabs).toEqual([valid]);
        });

        it('falls back to the base active path when the stored one is null', () => {
            const merged = mergeWorkspaceConfig(SAVED_CONFIG, { activePath: null });

            expect(merged.activePath).toBe('readme.md');
        });

        it('accepts an active diff tab of zero', () => {
            const base = { ...DEFAULT_WORKSPACE_CONFIG, activeDiffTab: 3 };

            expect(mergeWorkspaceConfig(base, { activeDiffTab: 0 }).activeDiffTab).toBe(0);
        });
    });
});
