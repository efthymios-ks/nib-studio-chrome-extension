import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDiffDocumentHtmlAsync } from '../../common/diff/diffHtml.js';
import { buildMarkdownDiffDocument } from '../../common/diff/markdownDiffDocument.js';
import { renderMarkdown } from '../../common/markdown/preview.js';
import { attachMarkdownDiffControls } from './markdownDiffControls.js';
import { attachCodeCopyHandler } from './markdownCodeCopy.js';
import { buildMermaidTools } from './mermaidBridge.js';

const ORIGINAL = [
    '# Guide',
    '',
    'First paragraph.',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    'Last paragraph.',
    '',
].join('\n');

const MODIFIED = [
    '# Guide',
    '',
    'First paragraph, edited.',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> C',
    '```',
    '',
    'Last paragraph.',
    '',
    'A new closing paragraph.',
    '',
].join('\n');

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';

async function loadDiffDocumentAsync(): Promise<Document> {
    const diffDocument = buildMarkdownDiffDocument({
        original: { name: 'architecture.md', source: 'file', path: 'docs/architecture.md' },
        modified: { name: 'architecture-v2.md', source: 'file', path: 'docs/architecture-v2.md' },
        originalText: ORIGINAL,
        modifiedText: MODIFIED,
    });
    const html = await renderDiffDocumentHtmlAsync(diffDocument, { renderMermaid: async () => SVG });
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    for (const script of parsed.querySelectorAll('script')) {
        script.remove();
    }

    document.head.innerHTML = parsed.head.innerHTML;
    document.body.className = parsed.body.className;
    document.body.innerHTML = parsed.body.innerHTML;
    attachMarkdownDiffControls(document);

    return document;
}

function click(selector: string): void {
    const element = document.querySelector<HTMLElement>(selector);

    if (element == null) {
        throw new Error(`${selector} not found.`);
    }

    element.click();
}

describe('attachMarkdownDiffControls', () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // happy-dom has no layout, so report every element as rendered.
        vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('shows the real file names', async () => {
        const frame = await loadDiffDocumentAsync();

        expect(frame.querySelector('.md-meta')?.textContent).toContain('architecture.md');
        expect(frame.querySelector('.md-meta')?.textContent).toContain('architecture-v2.md');
        expect(frame.querySelector('.md-meta')?.textContent).not.toContain('original.md');
    });

    it('switches between Diff, Before and After', async () => {
        const frame = await loadDiffDocumentAsync();

        click('.md-bar [data-view="after"]');
        expect(frame.body.classList.contains('md-v-after')).toBe(true);
        expect(frame.querySelector('[data-view="after"]')?.getAttribute('aria-pressed')).toBe('true');

        click('.md-bar [data-view="before"]');
        expect(frame.body.classList.contains('md-v-before')).toBe(true);
        expect(frame.body.classList.contains('md-v-after')).toBe(false);
    });

    it('steps through changes', async () => {
        const frame = await loadDiffDocumentAsync();
        const total = frame.querySelectorAll('.md-nav a').length;

        expect(total).toBeGreaterThan(1);

        click('.md-bar [data-step="1"]');
        expect(frame.querySelector('.md-pos')?.textContent).toMatch(new RegExp(`^\\d+ / ${total}$`));
        expect(frame.querySelector('.md-flash')).not.toBeNull();
    });

    it('opens the side-by-side modal and moves inside it', async () => {
        const frame = await loadDiffDocumentAsync();
        const modal = frame.querySelector<HTMLElement>('.md-modal');

        click('.md-review');
        expect(modal?.hidden).toBe(false);
        expect(frame.querySelector('.md-side-after')?.childElementCount).toBeGreaterThan(0);

        const opened = Number.parseInt(frame.querySelector('.md-modal-pos')?.textContent ?? '', 10);
        expect(opened).toBeGreaterThan(1);

        click('.md-modal [data-move="-1"]');
        expect(frame.querySelector('.md-modal-pos')?.textContent).toMatch(new RegExp(`^${opened - 1} /`));

        click('.md-modal-x');
        expect(modal?.hidden).toBe(true);
    });

    it('jumps to a change from the Changes list', async () => {
        const frame = await loadDiffDocumentAsync();
        const links = frame.querySelectorAll<HTMLAnchorElement>('.md-nav a');
        const last = links[links.length - 1];
        const targetId = last?.getAttribute('href')?.slice(1) ?? '';

        last?.click();

        expect(frame.getElementById(targetId)?.classList.contains('md-flash')).toBe(true);
        expect(frame.querySelector('.md-modal')?.hasAttribute('hidden')).toBe(true);
    });

    it('copies Mermaid source and enlarges the diagram', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await loadDiffDocumentAsync();

        click('.md-copy');
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('flowchart LR'));

        click('.md-enlarge');
        expect(open).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), '_blank', 'noopener');
    });

    it('labels the controls in the UI language', async () => {
        const frame = await loadDiffDocumentAsync();
        const count = frame.querySelectorAll('.md-nav a').length;

        expect(frame.querySelector('.md-nav-h')?.textContent).toBe(`Changes (${count})`);
        expect(frame.querySelector('.md-copy')?.textContent).toContain('Copy Mermaid');
    });
});

describe('attachCodeCopyHandler', () => {
    it('copies a fenced code block', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const container = document.createElement('div');
        container.innerHTML = renderMarkdown('```ts\nconst answer = 42;\n```\n').html;
        document.body.append(container);
        attachCodeCopyHandler(container);

        container.querySelector<HTMLButtonElement>('.md-code-copy')?.click();
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledWith('const answer = 42;');
        container.remove();
    });
});

describe('buildMermaidTools', () => {
    it('copies the diagram source and opens the diagram in a new tab', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const tools = buildMermaidTools('flowchart LR\n  A --> B', SVG);

        tools.querySelector<HTMLButtonElement>('.md-mermaid-copy')?.click();
        await Promise.resolve();
        tools.querySelector<HTMLButtonElement>('.md-mermaid-enlarge')?.click();

        expect(writeText).toHaveBeenCalledWith('flowchart LR\n  A --> B');
        expect(open).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), '_blank', 'noopener');
        open.mockRestore();
    });
});
