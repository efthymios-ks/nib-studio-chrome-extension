import { describe, expect, it } from 'vitest';
import { resolveWorkspaceReference, workspaceReferenceLabel } from './workspaceReference.js';

const DOCUMENT = 'docs/guide/links.md';

function pathOf(reference: string, documentPath = DOCUMENT): string | null {
    const resolved = resolveWorkspaceReference(reference, documentPath);

    return resolved.kind === 'workspace' ? resolved.path : null;
}

describe('resolveWorkspaceReference', () => {
    it('resolves a relative path against the document\'s folder', () => {
        expect(pathOf('images/chart.png')).toBe('docs/guide/images/chart.png');
        expect(pathOf('./images/chart.png')).toBe('docs/guide/images/chart.png');
        expect(pathOf('chart.png', 'README.md')).toBe('chart.png');
    });

    it('climbs folders with ..', () => {
        expect(pathOf('../README.md')).toBe('docs/README.md');
        expect(pathOf('../../data/users.csv')).toBe('data/users.csv');
        expect(pathOf('a/./b/../c.md')).toBe('docs/guide/a/c.md');
    });

    it('resolves a /-rooted path against the workspace folder', () => {
        expect(pathOf('/media/transparent.png')).toBe('media/transparent.png');
        expect(pathOf('/')).toBe('');
    });

    it('never resolves above the workspace folder', () => {
        expect(resolveWorkspaceReference('../../../secret.txt', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('/../secret.txt', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('../x.md', 'README.md')).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('..%2F..%2F..%2Fsecret.txt', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('..\\..\\..\\secret.txt', DOCUMENT)).toEqual({ kind: 'outside' });
    });

    it('treats disk paths and file: addresses as outside the workspace', () => {
        expect(resolveWorkspaceReference('C:\\Users\\me\\a.png', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('c:/temp/a.png', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('C:%5CUsers%5Ca.png', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('\\\\server\\share\\a.png', DOCUMENT)).toEqual({ kind: 'outside' });
        expect(resolveWorkspaceReference('file:///C:/a.png', DOCUMENT)).toEqual({ kind: 'outside' });
    });

    it('turns Windows backslashes into folders', () => {
        expect(pathOf('..\\..\\data\\users.csv')).toBe('data/users.csv');
        expect(pathOf('images%5Cchart.png')).toBe('docs/guide/images/chart.png');
    });

    it('decodes URL escapes after splitting off the query and fragment', () => {
        expect(pathOf('my%20file.md')).toBe('docs/guide/my file.md');
        expect(pathOf('%C3%BCber.md')).toBe('docs/guide/über.md');
        expect(pathOf('notes%23draft.md')).toBe('docs/guide/notes#draft.md');
        expect(pathOf('what%3F.md')).toBe('docs/guide/what?.md');
    });

    it('keeps malformed escapes as written', () => {
        expect(pathOf('100%.md')).toBe('docs/guide/100%.md');
    });

    it('drops the query and keeps the fragment', () => {
        expect(resolveWorkspaceReference('guide.md?raw=1#set%20up', DOCUMENT)).toEqual({
            kind: 'workspace',
            path: 'docs/guide/guide.md',
            fragment: 'set up',
        });
        expect(resolveWorkspaceReference('chart.png?v=2', DOCUMENT)).toEqual({
            kind: 'workspace',
            path: 'docs/guide/chart.png',
            fragment: null,
        });
        expect(resolveWorkspaceReference('../architecture.md#diffs', DOCUMENT)).toEqual({
            kind: 'workspace',
            path: 'docs/architecture.md',
            fragment: 'diffs',
        });
    });

    it('leads a bare query or an empty fragment back to the document itself', () => {
        expect(resolveWorkspaceReference('?page=2', DOCUMENT)).toEqual({ kind: 'workspace', path: DOCUMENT, fragment: null });
        expect(resolveWorkspaceReference('links.md#', DOCUMENT)).toEqual({ kind: 'workspace', path: DOCUMENT, fragment: null });
    });

    it('keeps in-document fragments apart', () => {
        expect(resolveWorkspaceReference('#release-notes', DOCUMENT)).toEqual({ kind: 'fragment', fragment: 'release-notes' });
        expect(resolveWorkspaceReference('#caf%C3%A9', DOCUMENT)).toEqual({ kind: 'fragment', fragment: 'café' });
    });

    it('leaves web, mailto and tel addresses to the browser', () => {
        for (const url of ['https://example.com/a.png', 'HTTP://example.com', 'mailto:me@example.com', 'tel:+301234', '//cdn.example.com/a.png']) {
            expect(resolveWorkspaceReference(url, DOCUMENT)).toEqual({ kind: 'web', url });
        }
    });

    it('keeps data and blob addresses inline', () => {
        expect(resolveWorkspaceReference('data:image/png;base64,AA', DOCUMENT)).toEqual({ kind: 'inline', url: 'data:image/png;base64,AA' });
        expect(resolveWorkspaceReference('blob:chrome-extension://id/uuid', DOCUMENT).kind).toBe('inline');
    });

    it('trims spaces and treats an empty address as empty', () => {
        expect(resolveWorkspaceReference('   ', DOCUMENT)).toEqual({ kind: 'empty' });
        expect(pathOf('  chart.png  ')).toBe('docs/guide/chart.png');
    });
});

describe('workspaceReferenceLabel', () => {
    it('names the workspace path with its fragment, and nothing for other addresses', () => {
        expect(workspaceReferenceLabel('../../data/users.csv', DOCUMENT)).toBe('data/users.csv');
        expect(workspaceReferenceLabel('../architecture.md#diffs', DOCUMENT)).toBe('docs/architecture.md#diffs');
        expect(workspaceReferenceLabel('/', DOCUMENT)).toBe('/');
        expect(workspaceReferenceLabel('https://example.com', DOCUMENT)).toBeNull();
        expect(workspaceReferenceLabel('#top', DOCUMENT)).toBeNull();
        expect(workspaceReferenceLabel('../../../x', DOCUMENT)).toBeNull();
    });
});
