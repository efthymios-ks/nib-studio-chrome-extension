import { describe, expect, it } from 'vitest';
import { readTreeAsync } from './directoryTree.js';
import type { DirectoryEntry, FileEntry } from './fileEntry.js';
import { FakeDirectoryHandle, asRoot } from './testing/fakeFileSystem.js';

function namesOf(entry: DirectoryEntry): string[] {
    return entry.children.map((child: FileEntry) => child.name);
}

function childDirectory(entry: DirectoryEntry, name: string): DirectoryEntry {
    const child = entry.children.find((candidate) => candidate.name === name);

    if (child == null || child.kind !== 'directory') {
        throw new Error(`${name} is not a directory.`);
    }

    return child as DirectoryEntry;
}

describe('readTreeAsync', () => {
    it('reads an empty root as an expanded directory', async () => {
        const tree = await readTreeAsync(asRoot(new FakeDirectoryHandle('project')));

        expect(tree).toEqual({ name: 'project', kind: 'directory', path: '', expanded: true, children: [] });
    });

    it('lists folders before files, each sorted naturally ignoring case', async () => {
        const root = new FakeDirectoryHandle('project');
        root.addFile('file10.txt', '');
        root.addFile('File2.txt', '');
        root.addFile('alpha.md', '');
        root.addDirectory('zeta');
        root.addDirectory('Beta');

        const tree = await readTreeAsync(asRoot(root));

        expect(namesOf(tree)).toEqual(['Beta', 'zeta', 'alpha.md', 'File2.txt', 'file10.txt']);
    });

    it('leaves folders collapsed and unread unless they are expanded', async () => {
        const root = new FakeDirectoryHandle('project');
        root.addFile('docs/guide.md', '');

        const tree = await readTreeAsync(asRoot(root));
        const docs = childDirectory(tree, 'docs');

        expect(docs).toEqual({ name: 'docs', kind: 'directory', path: 'docs', expanded: false, children: [] });
    });

    it('reads expanded folders recursively with joined paths', async () => {
        const root = new FakeDirectoryHandle('project');
        root.addFile('docs/guide/intro.md', '');
        root.addFile('docs/readme.md', '');
        root.addFile('docs/other/hidden.md', '');

        const tree = await readTreeAsync(asRoot(root), { expandedPaths: new Set(['docs', 'docs/guide']) });
        const docs = childDirectory(tree, 'docs');
        const guide = childDirectory(docs, 'guide');
        const other = childDirectory(docs, 'other');

        expect(docs.expanded).toBe(true);
        expect(namesOf(docs)).toEqual(['guide', 'other', 'readme.md']);
        expect(guide.children).toEqual([{ name: 'intro.md', kind: 'file', path: 'docs/guide/intro.md' }]);
        expect(other.expanded).toBe(false);
        expect(other.children).toEqual([]);
    });

    it('leaves out Chrome\'s temporary .crswap files, in expanded folders too', async () => {
        const root = new FakeDirectoryHandle('project');
        root.addFile('.nib-studio-configuration.json', '{}');
        root.addFile('.nib-studio-configuration.json.crswap', '');
        root.addFile('docs/guide.md', '');
        root.addFile('docs/guide.md.crswap', '');

        const tree = await readTreeAsync(asRoot(root), { expandedPaths: new Set(['docs']) });

        expect(namesOf(tree)).toEqual(['docs', '.nib-studio-configuration.json']);
        expect(namesOf(childDirectory(tree, 'docs'))).toEqual(['guide.md']);
    });

    it('does not read a nested folder whose parent is collapsed', async () => {
        const root = new FakeDirectoryHandle('project');
        root.addFile('docs/guide/intro.md', '');

        const tree = await readTreeAsync(asRoot(root), { expandedPaths: new Set(['docs/guide']) });

        expect(childDirectory(tree, 'docs').children).toEqual([]);
    });
});
