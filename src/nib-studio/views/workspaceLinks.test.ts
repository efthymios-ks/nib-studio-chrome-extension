import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachWorkspaceLinks, followLink, handleWorkspaceLinkClick, linkActionFor, type WorkspaceLinkOptions } from './workspaceLinks.js';
import { toastTexts } from '../testing/testHelpers.js';

function linkIn(container: HTMLElement, href: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.setAttribute('href', href);
    link.innerHTML = '<span>text</span>';
    container.append(link);

    return link;
}

function click(target: Element, init: MouseEventInit = {}, type = 'click'): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);

    return event;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('linkActionFor', () => {
    it('opens workspace files and folders, with their fragment', () => {
        expect(linkActionFor('architecture.md#diffs', 'docs/links.md')).toEqual({ kind: 'open', target: { path: 'docs/architecture.md', fragment: 'diffs' } });
        expect(linkActionFor('../data/users.csv', 'docs/links.md')).toEqual({ kind: 'open', target: { path: 'data/users.csv', fragment: null } });
        expect(linkActionFor('/media/', 'docs/links.md')).toEqual({ kind: 'open', target: { path: 'media', fragment: null } });
        expect(linkActionFor('..\\README.md', 'docs/links.md')).toEqual({ kind: 'open', target: { path: 'README.md', fragment: null } });
    });

    it('leaves web, mailto, tel and in-page links to the browser', () => {
        expect(linkActionFor('https://example.com/', 'docs/links.md')).toEqual({ kind: 'follow' });
        expect(linkActionFor('mailto:team@example.com', 'docs/links.md')).toEqual({ kind: 'follow' });
        expect(linkActionFor('tel:+302100000000', null)).toEqual({ kind: 'follow' });
        expect(linkActionFor('#setup', null)).toEqual({ kind: 'fragment', fragment: 'setup' });
    });

    it('refuses paths outside the workspace and relative links of files from outside it', () => {
        expect(linkActionFor('../../secret.md', 'docs/links.md')).toEqual({ kind: 'refuse', message: '../../secret.md is outside the workspace.' });
        expect(linkActionFor('guide.md', null)).toEqual({ kind: 'refuse', message: 'guide.md can\'t be opened from a file outside the workspace.' });
    });

    it('ignores an empty address', () => {
        expect(linkActionFor('', 'docs/links.md')).toEqual({ kind: 'ignore' });
    });
});

describe('handleWorkspaceLinkClick', () => {
    function options(overrides: Partial<WorkspaceLinkOptions> = {}): WorkspaceLinkOptions {
        return { documentPath: 'docs/links.md', onOpen: vi.fn(), ...overrides };
    }

    it('opens a workspace link in the studio instead of following it', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const link = linkIn(container, 'guide.md#setup');
        const settings = options();
        container.addEventListener('click', (event) => handleWorkspaceLinkClick(event, settings));

        const event = click(link.firstElementChild!);

        expect(event.defaultPrevented).toBe(true);
        expect(settings.onOpen).toHaveBeenCalledWith({ path: 'docs/guide.md', fragment: 'setup' });
    });

    it('opens web, mailto and tel links in a new browser tab, never in the studio\'s own', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const settings = options();
        container.addEventListener('click', (event) => handleWorkspaceLinkClick(event, settings));

        for (const href of ['https://example.com/', 'mailto:team@example.com', 'tel:+302100000000']) {
            expect(click(linkIn(container, href)).defaultPrevented, href).toBe(true);
        }

        expect(open.mock.calls).toEqual([
            ['https://example.com/', '_blank', 'noopener,noreferrer'],
            ['mailto:team@example.com', '_blank', 'noopener,noreferrer'],
            ['tel:+302100000000', '_blank', 'noopener,noreferrer'],
        ]);
        expect(settings.onOpen).not.toHaveBeenCalled();
        open.mockRestore();
    });

    it('lets the browser follow in-page links, and hands web and in-page links to a page that takes them', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const web = linkIn(container, 'https://example.com/');
        const inPage = linkIn(container, '#top');
        let settings = options();
        container.addEventListener('click', (event) => handleWorkspaceLinkClick(event, settings));
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);

        expect(click(inPage).defaultPrevented).toBe(false);
        open.mockRestore();

        const onFollow = vi.fn();
        const onFragment = vi.fn();
        settings = options({ onFollow, onFragment });

        expect(click(web).defaultPrevented).toBe(true);
        expect(click(inPage).defaultPrevented).toBe(true);
        expect(onFollow).toHaveBeenCalledWith('https://example.com/');
        expect(onFragment).toHaveBeenCalledWith('top');
        expect(settings.onOpen).not.toHaveBeenCalled();
    });

    it('says why a link can\'t be opened', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const link = linkIn(container, 'guide.md');
        const settings = options({ documentPath: null });
        container.addEventListener('click', (event) => handleWorkspaceLinkClick(event, settings));

        expect(click(link).defaultPrevented).toBe(true);
        expect(settings.onOpen).not.toHaveBeenCalled();
        expect(toastTexts()).toContain('guide.md can\'t be opened from a file outside the workspace.');
    });

    it('ignores clicks outside links', () => {
        const container = document.createElement('div');
        container.innerHTML = '<p>plain</p>';
        document.body.append(container);
        const settings = options();
        container.addEventListener('click', (event) => handleWorkspaceLinkClick(event, settings));

        expect(click(container.querySelector('p')!).defaultPrevented).toBe(false);
        expect(settings.onOpen).not.toHaveBeenCalled();
    });
});

describe('attachWorkspaceLinks', () => {
    it('opens workspace links on a click or a middle click, and lets go when detached', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const workspaceLink = linkIn(container, '../README.md');
        const webLink = linkIn(container, 'https://example.com/');
        const onOpen = vi.fn();
        const detach = attachWorkspaceLinks(container, () => ({ documentPath: 'docs/links.md', onOpen }));

        click(workspaceLink);
        expect(click(workspaceLink, { button: 1 }, 'auxclick').defaultPrevented).toBe(true);
        expect(click(webLink, { button: 1 }, 'auxclick').defaultPrevented).toBe(false);

        expect(onOpen).toHaveBeenCalledTimes(2);

        detach();
        click(workspaceLink);

        expect(onOpen).toHaveBeenCalledTimes(2);
    });
});

describe('followLink', () => {
    it('follows a link of a page the studio can\'t reach into, as a click on it does', () => {
        const onOpen = vi.fn();
        const onFollow = vi.fn();
        const onFragment = vi.fn();
        const options: WorkspaceLinkOptions = { documentPath: 'docs/page.html', onOpen, onFollow, onFragment };

        followLink('guide.md#setup', options);
        followLink('https://example.com/', options);
        followLink('#top', options);
        followLink('../../outside.md', options);
        followLink('', options);

        expect(onOpen).toHaveBeenCalledWith({ path: 'docs/guide.md', fragment: 'setup' });
        expect(onFollow).toHaveBeenCalledWith('https://example.com/');
        expect(onFragment).toHaveBeenCalledWith('top');
        expect(toastTexts()).toContain('../../outside.md is outside the workspace.');
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('opens a web link in a new browser tab when the page takes none itself', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);

        followLink('tel:+441234567890', { documentPath: null, onOpen: vi.fn() });

        expect(open).toHaveBeenCalledWith('tel:+441234567890', '_blank', 'noopener,noreferrer');
        open.mockRestore();
    });
});
