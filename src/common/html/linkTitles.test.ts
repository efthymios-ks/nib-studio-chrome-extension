// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { titleWorkspaceLinks } from './linkTitles.js';

function linksOf(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;

    return container;
}

describe('titleWorkspaceLinks', () => {
    it('shows the resolved workspace path, after any title of the link\'s own', () => {
        const root = linksOf([
            '<a href="../data/users.csv">users</a>',
            '<a href="architecture.md#diffs" title="Diffs">diffs</a>',
            '<a href="/">root</a>',
            '<a href="https://example.com/">web</a>',
            '<a href="#top">top</a>',
            '<a href="../../outside.md">outside</a>',
        ].join(''));

        titleWorkspaceLinks(root, 'docs/links.md');

        expect([...root.querySelectorAll('a')].map((link) => link.getAttribute('title'))).toEqual([
            'data/users.csv',
            'Diffs\ndocs/architecture.md#diffs',
            '/',
            null,
            null,
            null,
        ]);
    });

    it('titles nothing in a file from outside the workspace', () => {
        const root = linksOf('<a href="guide.md">guide</a>');

        titleWorkspaceLinks(root, null);

        expect(root.querySelector('a')?.hasAttribute('title')).toBe(false);
    });
});
