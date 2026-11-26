import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFileHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { createAppHarness, openHarnessWorkspaceAsync, openPaths, treeRow, type AppHarness } from '../testing/appHarness.js';
import { settleAsync, stubMatchMedia, toastTexts } from '../testing/testHelpers.js';
import { NARROW_LAYOUT_QUERY } from './explorerDrawer.js';

vi.mock('../views/mermaidBridge.js', () => ({
    renderMermaidIntoAsync: vi.fn(async () => {}),
    renderMermaidSvgAsync: vi.fn(async () => '<svg></svg>'),
    buildMermaidTools: vi.fn(() => document.createElement('div')),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const LINKS_MD = [
    '# Links',
    '',
    '![Dot](../media/dot.png)',
    '',
    '- [Guide](guide.md)',
    '- [Setup](Guide.MD#set-up)',
    '- [Users](../data/users.csv)',
    '- [Data](../data/)',
    '- [Missing](missing.md)',
    '- [Page](page.html)',
].join('\n');

const LAYOUT_KEY = 'nib-studio/explorer-layout';

let harness: AppHarness;

function activeView(): string | undefined {
    return document.querySelector<HTMLElement>('[data-view][data-active="true"]')?.dataset['view'];
}

function previewLink(text: string): HTMLElement {
    const link = [...document.querySelectorAll<HTMLElement>('.markdown-preview a')].find((candidate) => candidate.textContent === text);

    if (link == null) {
        throw new Error(`No preview link ${text}`);
    }

    return link;
}

async function openLinksAsync(): Promise<void> {
    await harness.callAsync('openFileAsync', 'docs/links.md');
    await settleAsync();
}

async function createLinksHarnessAsync(): Promise<AppHarness> {
    const created = createAppHarness({
        'docs/links.md': LINKS_MD,
        'docs/guide.md': '# Guide\n\n## Set up\n\nSteps.\n',
        'docs/page.html': '<h1>Page</h1>',
        'data/users.csv': 'id,name\n1,Ada\n',
        'media/dot.png': PNG,
    });
    await openHarnessWorkspaceAsync(created);

    return created;
}

beforeEach(async () => {
    harness = await createLinksHarnessAsync();
    let counter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        counter += 1;

        return `blob:app/${counter}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    harness.app.dispose();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('App following links in previews', () => {
    it('shows the workspace image of a Markdown file in Preview', async () => {
        await openLinksAsync();

        expect(activeView()).toBe('preview');
        expect(document.querySelector('.markdown-preview img')?.getAttribute('src')).toBe('blob:app/1');
    });

    it('opens a linked file in a permanent tab and reveals it in the tree', async () => {
        await openLinksAsync();

        previewLink('Users').click();
        await settleAsync();

        expect(openPaths(harness)).toEqual(['docs/links.md', 'data/users.csv']);
        expect(harness.state().openFiles.find((file) => file.path === 'data/users.csv')?.preview).toBe(false);
        expect(harness.state().activePath).toBe('data/users.csv');
        expect(harness.state().expandedPaths.has('data')).toBe(true);
        expect(treeRow('data/users.csv').dataset['selected']).toBe('true');
    });

    it('opens a linked Markdown file at its heading in Preview, matching the name case-insensitively', async () => {
        const scrolled: string[] = [];
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
            scrolled.push(this.id);
        });
        await openLinksAsync();
        document.querySelector<HTMLElement>('[data-view="editor"]')?.click();
        await harness.callAsync('openFileAsync', 'docs/links.md');
        document.querySelector<HTMLElement>('[data-view="preview"]')?.click();

        previewLink('Setup').click();
        await settleAsync();

        expect(harness.state().activePath).toBe('docs/guide.md');
        expect(activeView()).toBe('preview');
        expect(scrolled).toContain('set-up');
    });

    it('expands and selects a linked folder in the Explorer', async () => {
        await openLinksAsync();

        previewLink('Data').click();
        await settleAsync();

        expect(harness.state().expandedPaths.has('data')).toBe(true);
        expect(treeRow('data').dataset['selected']).toBe('true');
        expect(openPaths(harness)).toEqual(['docs/links.md']);
    });

    it('says when a linked file isn\'t in the workspace', async () => {
        await openLinksAsync();

        previewLink('Missing').click();
        await settleAsync();

        expect(toastTexts()).toContain('docs/missing.md isn\'t in the workspace.');
        expect(openPaths(harness)).toEqual(['docs/links.md']);
    });

    it('opens a linked HTML file in its Preview', async () => {
        await openLinksAsync();

        previewLink('Page').click();
        await settleAsync();

        expect(harness.state().activePath).toBe('docs/page.html');
        expect(activeView()).toBe('preview');
        expect(document.querySelector('iframe.html-preview-frame')).not.toBeNull();
    });

    it('draws the preview\'s image again when it changes on disk', async () => {
        await openLinksAsync();
        (harness.folder.find('media/dot.png') as FakeFileHandle).data = new Uint8Array([...PNG, 1]);

        (harness.app as unknown as { pendingChangedPaths: Set<string> }).pendingChangedPaths.add('media/dot.png');
        await harness.callAsync('flushWatchRefreshAsync');
        await settleAsync();

        expect(document.querySelector('.markdown-preview img')?.getAttribute('src')).toBe('blob:app/2');
    });
});

describe('App following a link to a folder while the Explorer is out of view', () => {
    // The layout is read as the studio starts, so each test starts it again with the Explorer out of view.
    async function restartAsync(): Promise<void> {
        harness.app.dispose();
        document.body.replaceChildren();
        harness = await createLinksHarnessAsync();
    }

    afterEach(() => {
        localStorage.removeItem(LAYOUT_KEY);
        vi.unstubAllGlobals();
        delete document.body.dataset['explorerCollapsed'];
        delete document.body.dataset['explorerDrawer'];
    });

    it('brings a hidden Explorer back at its last width, with the folder selected', async () => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 280, collapsed: true }));
        await restartAsync();
        await openLinksAsync();
        expect(document.body.dataset['explorerCollapsed']).toBe('true');

        previewLink('Data').click();
        await settleAsync();

        expect(document.body.dataset['explorerCollapsed']).toBeUndefined();
        expect(document.documentElement.style.getPropertyValue('--explorer-width')).toBe('280px');
        expect(treeRow('data').dataset['selected']).toBe('true');
    });

    it('slides the Explorer drawer in on a narrow screen', async () => {
        stubMatchMedia(NARROW_LAYOUT_QUERY, true);
        await restartAsync();
        await openLinksAsync();
        expect(document.body.dataset['explorerDrawer']).toBeUndefined();

        previewLink('Data').click();
        await settleAsync();

        expect(document.body.dataset['explorerDrawer']).toBe('open');
        expect(treeRow('data').dataset['selected']).toBe('true');
    });

    it('leaves a hidden Explorer hidden for a linked file', async () => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 280, collapsed: true }));
        await restartAsync();
        await openLinksAsync();

        previewLink('Users').click();
        await settleAsync();

        expect(harness.state().activePath).toBe('data/users.csv');
        expect(document.body.dataset['explorerCollapsed']).toBe('true');
    });
});
