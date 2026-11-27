import { describe, expect, it } from 'vitest';

import { compareMarkdown } from './comparer.js';
import { renderDiffHtmlAsync } from './htmlRenderer.js';
import type { MarkdownDiff, MermaidRenderer } from './types.js';

const diffOf = (original: string, modified: string): MarkdownDiff => {
    return compareMarkdown(original, modified, {
        includeUnchanged: true,
        originalName: 'original.md',
        modifiedName: 'modified.md',
    });
};

// Compares both texts and draws the page, as a caller holding only the two texts does.
const pageOfAsync = async (original: string, modified: string, options: { title?: string; changesOnly?: boolean } = {}): Promise<string> => {
    const diff = compareMarkdown(original, modified, { includeUnchanged: !(options.changesOnly ?? false) });
    const { html } = await renderDiffHtmlAsync(diff, options);

    return html;
};

describe('renderDiffHtmlAsync — basic structure', () => {
    it('emits the Changes index, floating view bar and modal markup', async () => {
        const original = '# Title\n\nFirst paragraph.\n';
        const modified = '# Title\n\nFirst paragraph edited.\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).toContain('<div class="md-nav">');
        expect(html).toContain('Changes (');
        expect(html).toContain('<div class="md-bar"');
        expect(html).toContain('data-view="diff"');
        expect(html).toContain('data-view="before"');
        expect(html).toContain('data-view="after"');
        expect(html).toContain('class="md-modal"');
        expect(html).toContain('md-side-before');
        expect(html).toContain('md-side-after');
    });

    it('produces ins/del hunks on a tweaked paragraph', async () => {
        const original = 'The quick brown fox jumps over the lazy dog.';
        const modified = 'The quick brown fox leaps over the lazy dog.';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).toContain('<ins>');
        expect(html).toContain('<del>');
        expect(html).toContain('id="chg1"');
    });

    it('wraps a pure paragraph addition in md-blk-add + md-block', async () => {
        const original = '# Title\n\nFirst.\n';
        const modified = '# Title\n\nFirst.\n\nSecond added.\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).toContain('md-blk-add');
        expect(html).toContain('md-block');
    });

    it('wraps a pure paragraph removal in md-blk-del + md-block', async () => {
        const original = '# Title\n\nFirst.\n\nSecond.\n';
        const modified = '# Title\n\nFirst.\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).toContain('md-blk-del');
        expect(html).toContain('md-block');
    });

    it('groups the Changes index by nearest heading', async () => {
        const original = '# A\n\npara1.\n\n# B\n\npara2.\n';
        const modified = '# A\n\npara1 edited.\n\n# B\n\npara2 edited.\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        // Each section gets its own md-sec div with md-sec-h heading.
        expect(html).toMatch(/<div class="md-sec">.*?A.*?<\/div>/s);
        expect(html).toMatch(/<div class="md-sec">.*?B.*?<\/div>/s);
    });

    it('omits unchanged blocks when changesOnly is on', async () => {
        const original = '# Title\n\nUnchanged paragraph.\n\nSecond paragraph.\n';
        const modified = '# Title\n\nUnchanged paragraph.\n\nSecond paragraph edited.\n';
        const diff = diffOf(original, modified);

        const full = await renderDiffHtmlAsync(diff);
        const only = await renderDiffHtmlAsync(diff, { changesOnly: true });

        expect(full.html).toContain('Unchanged paragraph');
        expect(only.html).not.toContain('Unchanged paragraph');
        // Index stays non-empty either way.
        expect(only.html).toContain('Changes (');
    });

    it('renders column and row band classes for a changed table', async () => {
        const original = [
            '| Name | Role |',
            '|------|------|',
            '| Alice | lead |',
            '',
        ].join('\n');
        const modified = [
            '| Name | Role | Shift |',
            '|------|------|-------|',
            '| Alice | lead | day |',
            '| Bob | junior | night |',
            '',
        ].join('\n');
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).toContain('md-col-add');
        expect(html).toContain('md-row-add');
    });

    it('does not fetch any external resources', async () => {
        const diff = diffOf('# A\n\npara.\n', '# A\n\npara edited.\n');
        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).not.toMatch(/https?:\/\//i);
        expect(html).not.toMatch(/<link\s+[^>]*href=/i);
        expect(html).not.toMatch(/<script\s+[^>]*src=/i);
    });
});

describe('renderDiffHtmlAsync — mermaid pathway', () => {
    const svgOf: MermaidRenderer = async (source: string) => {
        return `<svg xmlns="http://www.w3.org/2000/svg" aria-label="${source.length}"><g/></svg>`;
    };

    it('renders md-pane-b and md-pane-a with an svg when renderer is supplied', async () => {
        const original = '```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '```mermaid\ngraph TD\nA --> C\n```\n';
        const diff = diffOf(original, modified);

        const { html, stats } = await renderDiffHtmlAsync(diff, { renderMermaid: svgOf });

        expect(html).toContain('md-pane-b');
        expect(html).toContain('md-pane-a');
        // The SVG is base64'd into a data URL.
        expect(html).toContain('data:image/svg+xml;base64,');
        expect(stats.diagramsDrawn).toBeGreaterThanOrEqual(2);
    });

    it('falls back to a diffed code block when no renderer is supplied', async () => {
        const original = '```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '```mermaid\ngraph TD\nA --> C\n```\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).not.toContain('data:image/svg+xml;base64,');
        expect(html).toContain('md-src');
    });

    it('shows a New badge for an added diagram', async () => {
        const original = '# Title\n\npara.\n';
        const modified = '# Title\n\npara.\n\n```mermaid\ngraph TD\nA --> B\n```\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff, { renderMermaid: svgOf });

        expect(html).toContain('md-badge-new');
        expect(html).toMatch(/md-blk-add[^"]*"[^>]*>\s*<div class="md-badge md-badge-new">New<\/div>/);
    });

    it('shows a Removed badge for a removed diagram', async () => {
        const original = '# Title\n\npara.\n\n```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '# Title\n\npara.\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff, { renderMermaid: svgOf });

        expect(html).toContain('md-badge-old');
        expect(html).toMatch(/md-blk-del[^"]*"[^>]*>\s*<div class="md-badge md-badge-old">Removed<\/div>/);
    });

    it('counts a mermaid render failure as a diagramsFailed', async () => {
        const failingRenderer: MermaidRenderer = async () => null;
        const original = '```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '```mermaid\ngraph TD\nA --> C\n```\n';
        const diff = diffOf(original, modified);

        const { stats } = await renderDiffHtmlAsync(diff, { renderMermaid: failingRenderer });

        expect(stats.diagramsFailed).toBeGreaterThan(0);
        expect(stats.diagramsDrawn).toBe(0);
    });

    it('prints without its buttons, bar and tabs, and prints both sides of a changed diagram, each named', async () => {
        const original = '```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '```mermaid\ngraph TD\nA --> C\n```\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff, { renderMermaid: svgOf });
        const print = /@media print\{([^]*?)\n\}/.exec(html)?.[1] ?? '';

        expect(html).toContain('Copy Mermaid');
        expect(print).toContain('.md-bar,.md-modal,.md-lens,.md-tools,.md-tabbar,.md-zoom{display:none!important;}');
        expect(print).toContain('.md-v-diff .md-panes .md-pane{display:block!important;}');
        expect(print).toContain('.md-v-diff .md-pane-b::before{content:"Before";}');
        expect(print).toContain('.md-v-diff .md-pane-a::before{content:"After";}');
    });
});

describe('renderDiffHtmlAsync — code gutters', () => {
    it('emits md-add and md-del line classes for a code change', async () => {
        const original = '```ts\nconst x = 1;\nconst y = 2;\n```\n';
        const modified = '```ts\nconst x = 1;\nconst y = 42;\n```\n';
        const diff = diffOf(original, modified);

        const { html } = await renderDiffHtmlAsync(diff);

        expect(html).toContain('md-l md-add');
        expect(html).toContain('md-l md-del');
    });
});

describe('renderDiffHtmlAsync — end to end', () => {
    it('produces Changes (0) and no diff markers when inputs are identical', async () => {
        const source = '# Title\n\nSame text both sides.\n';
        const html = await pageOfAsync(source, source);

        expect(html).toContain('Changes (0)');
        expect(html).not.toContain('<ins>');
        expect(html).not.toContain('<del>');
        // Classes appear in the inline CSS declarations, so check attribute usage, not string presence.
        expect(html).not.toMatch(/class="[^"]*\bmd-blk-add\b/);
        expect(html).not.toMatch(/class="[^"]*\bmd-blk-del\b/);
    });

    it('counts the number of changed blocks in the nav', async () => {
        const original = '# A\n\nFirst.\n\n# B\n\nSecond.\n';
        const modified = '# A\n\nFirst edited.\n\n# B\n\nSecond.\n\nNew para.\n';
        const html = await pageOfAsync(original, modified);

        // One modified paragraph and one added paragraph.
        expect(html).toContain('Changes (2)');
        expect(html).toContain('id="chg1"');
        expect(html).toContain('id="chg2"');
    });

    it('emits readable labels, not bare diff fragments', async () => {
        const html = await pageOfAsync('The old sentence here.', 'The new sentence here.');

        // The nav label is a window of the new text, not a bare "new".
        const labelMatch = html.match(/<span class="md-c-l">([^<]+)<\/span>/);
        expect(labelMatch).not.toBeNull();
        expect(labelMatch![1]!.length).toBeGreaterThan(3);
        expect(labelMatch![1]).toContain('sentence');
    });

    it('is self-contained: no external style or script URLs', async () => {
        const html = await pageOfAsync('# A\n\npara.\n', '# A\n\npara edit.\n');

        expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet/i);
        expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
        expect(html).not.toMatch(/https?:\/\//);
    });

    it('respects the title option', async () => {
        const html = await pageOfAsync('x', 'y', { title: 'My Doc' });

        expect(html).toContain('<title>My Doc &mdash; diff</title>');
        expect(html).toContain('<h1 class="md-title">My Doc</h1>');
    });

    it('honours changesOnly by omitting the unchanged body', async () => {
        const original = '# A\n\nUnchanged.\n\nFirst.\n';
        const modified = '# A\n\nUnchanged.\n\nFirst edited.\n';
        const html = await pageOfAsync(original, modified, { changesOnly: true });

        expect(html).not.toContain('Unchanged.');
        expect(html).toContain('Changes (');
    });
});
