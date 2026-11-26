import { describe, expect, it } from 'vitest';
import { detectCollisions, isDescendant, sourcesOutsideFolder } from './dragDrop.js';

describe('isDescendant', () => {
    it('is true when target equals source', () => {
        expect(isDescendant('src/a', 'src/a')).toBe(true);
    });

    it('is true when target is nested under source', () => {
        expect(isDescendant('src/a/b', 'src/a')).toBe(true);
        expect(isDescendant('src/a/b/c', 'src/a')).toBe(true);
    });

    it('is false for sibling folders that share a prefix', () => {
        expect(isDescendant('src/alpha-beta', 'src/alpha')).toBe(false);
    });

    it('is false for unrelated paths', () => {
        expect(isDescendant('docs/intro.md', 'src')).toBe(false);
    });

    it('is false when source is empty', () => {
        expect(isDescendant('anywhere', '')).toBe(false);
    });
});

describe('detectCollisions', () => {
    it('returns the sources whose name already exists in the target', () => {
        const collisions = detectCollisions(
            ['src/a.ts', 'src/b.ts', 'src/c.ts'],
            'dist',
            new Set(['a.ts', 'c.ts']),
        );

        expect(collisions.map((collision) => collision.name)).toEqual(['a.ts', 'c.ts']);
        expect(collisions[0]?.sourcePath).toBe('src/a.ts');
        expect(collisions[0]?.targetPath).toBe('dist/a.ts');
    });

    it('finds a name that differs only in case, naming the entry already there', () => {
        const collisions = detectCollisions(['src/Notes.md'], 'docs', new Set(['notes.md', 'other.md']));

        expect(collisions).toEqual([{ sourcePath: 'src/Notes.md', targetPath: 'docs/notes.md', name: 'Notes.md' }]);
    });

    it('builds a root-relative target path when target folder is empty', () => {
        const collisions = detectCollisions(
            ['src/a.ts'],
            '',
            new Set(['a.ts']),
        );

        expect(collisions[0]?.targetPath).toBe('a.ts');
    });

    it('returns an empty list when nothing collides', () => {
        const collisions = detectCollisions(['src/a.ts'], 'dist', new Set(['b.ts']));

        expect(collisions).toEqual([]);
    });
});

describe('sourcesOutsideFolder', () => {
    it('leaves out a file dropped on the folder it is in', () => {
        expect(sourcesOutsideFolder(['documents/report.doc'], 'documents')).toEqual([]);
    });

    it('leaves out a file at the root dropped on the root', () => {
        expect(sourcesOutsideFolder(['notes.txt'], '')).toEqual([]);
    });

    it('leaves out a folder dropped on the folder that holds it', () => {
        expect(sourcesOutsideFolder(['documents/drafts'], 'documents')).toEqual([]);
    });

    it('keeps, in order, only the items of a mixed selection that come from elsewhere', () => {
        expect(sourcesOutsideFolder(
            ['notes.txt', 'documents/report.doc', 'archive/old.txt', 'documents/drafts'],
            'documents',
        )).toEqual(['notes.txt', 'archive/old.txt']);
    });

    it('keeps an item from a subfolder of the target, which is not in the target itself', () => {
        expect(sourcesOutsideFolder(['documents/drafts/plan.md'], 'documents')).toEqual(['documents/drafts/plan.md']);
    });
});
