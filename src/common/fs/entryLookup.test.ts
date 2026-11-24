import { describe, expect, it, vi } from 'vitest';
import { findWorkspaceEntryAsync, type FolderListings } from './entryLookup.js';
import { asRoot, FakeDirectoryHandle } from './testing/fakeFileSystem.js';

function workspace(): FakeDirectoryHandle {
    const folder = new FakeDirectoryHandle('workspace');
    folder.addFile('README.md', '# Read me');
    folder.addFile('docs/Guide.md', '# Guide');
    folder.addFile('docs/images/Chart.PNG', new Uint8Array([1]));
    folder.addDirectory('data/empty');

    return folder;
}

describe('findWorkspaceEntryAsync', () => {
    it('finds files and folders by their exact path', async () => {
        const root = asRoot(workspace());

        expect(await findWorkspaceEntryAsync(root, 'docs/Guide.md')).toEqual({ path: 'docs/Guide.md', kind: 'file' });
        expect(await findWorkspaceEntryAsync(root, 'data/empty')).toEqual({ path: 'data/empty', kind: 'directory' });
        expect(await findWorkspaceEntryAsync(root, '')).toEqual({ path: '', kind: 'directory' });
    });

    it('falls back to a case-insensitive match and names the entry as it is on disk', async () => {
        const root = asRoot(workspace());

        expect(await findWorkspaceEntryAsync(root, 'DOCS/guide.md')).toEqual({ path: 'docs/Guide.md', kind: 'file' });
        expect(await findWorkspaceEntryAsync(root, 'docs/Images/chart.png')).toEqual({ path: 'docs/images/Chart.PNG', kind: 'file' });
        expect(await findWorkspaceEntryAsync(root, 'readme.MD')).toEqual({ path: 'README.md', kind: 'file' });
    });

    it('prefers the exact name when a folder holds names differing only in case', async () => {
        const folder = workspace();
        folder.addFile('docs/guide.md', '# lower');
        const root = asRoot(folder);

        expect(await findWorkspaceEntryAsync(root, 'docs/guide.md')).toEqual({ path: 'docs/guide.md', kind: 'file' });
        expect(await findWorkspaceEntryAsync(root, 'docs/Guide.md')).toEqual({ path: 'docs/Guide.md', kind: 'file' });
    });

    it('finds nothing for a missing name or a path through a file', async () => {
        const root = asRoot(workspace());

        expect(await findWorkspaceEntryAsync(root, 'docs/missing.md')).toBeNull();
        expect(await findWorkspaceEntryAsync(root, 'nowhere/a.md')).toBeNull();
        expect(await findWorkspaceEntryAsync(root, 'README.md/inner')).toBeNull();
    });

    it('lists each folder once when lookups share their listings', async () => {
        const folder = workspace();
        const docs = folder.find('docs') as FakeDirectoryHandle;
        const values = vi.spyOn(docs, 'values');
        const listings: FolderListings = new Map();

        await findWorkspaceEntryAsync(asRoot(folder), 'docs/Guide.md', listings);
        await findWorkspaceEntryAsync(asRoot(folder), 'docs/images/Chart.PNG', listings);

        expect(values).toHaveBeenCalledTimes(1);
    });
});
