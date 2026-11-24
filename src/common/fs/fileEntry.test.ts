import { describe, expect, it } from 'vitest';
import { basename, extension, joinPath, parentPath, remapPath } from './fileEntry.js';

describe('fileEntry', () => {
    describe('joinPath', () => {
        it('joins parent and name', () => {
            expect(joinPath('docs', 'README.md')).toBe('docs/README.md');
        });

        it('returns the name when parent is empty', () => {
            expect(joinPath('', 'root')).toBe('root');
        });
    });

    describe('parentPath', () => {
        it('returns the folder containing the path', () => {
            expect(parentPath('docs/src/main.ts')).toBe('docs/src');
        });

        it('returns empty for a top-level entry', () => {
            expect(parentPath('README.md')).toBe('');
        });
    });

    describe('basename', () => {
        it('returns the last segment', () => {
            expect(basename('docs/src/main.ts')).toBe('main.ts');
        });

        it('returns the whole string when there is no slash', () => {
            expect(basename('main.ts')).toBe('main.ts');
        });
    });

    describe('extension', () => {
        it('returns the lowercase suffix after the last dot', () => {
            expect(extension('Readme.MD')).toBe('md');
        });

        it('returns empty for a dotfile', () => {
            expect(extension('.gitignore')).toBe('');
        });

        it('returns empty when there is no dot', () => {
            expect(extension('LICENSE')).toBe('');
        });
    });

    describe('remapPath', () => {
        it('rewrites the entry itself', () => {
            expect(remapPath('docs/a.md', 'docs/a.md', 'docs/b.md')).toBe('docs/b.md');
        });

        it('rewrites paths inside a renamed folder', () => {
            expect(remapPath('docs/guide/a.md', 'docs', 'notes')).toBe('notes/guide/a.md');
        });

        it('leaves siblings with a shared prefix alone', () => {
            expect(remapPath('docs-old/a.md', 'docs', 'notes')).toBe('docs-old/a.md');
        });
    });
});
