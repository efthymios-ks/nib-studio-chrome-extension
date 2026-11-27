import { Window as HappyWindow } from 'happy-dom';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { compareMarkdown } from './comparer.js';
import { renderDiffHtmlAsync } from './htmlRenderer.js';
import type { MermaidRenderer } from './types.js';

// The page's own script, run as a browser runs it, in a window of its own that has no network:
// its buttons copy, enlarge and switch views without `fetch` or a window of their own.
const ORIGINAL = [
    '# Notes',
    '',
    '```mermaid',
    'flowchart LR',
    '    Café --> Shop',
    '```',
    '',
    '| City | Sales |',
    '| --- | --- |',
    '| Patras | 12 |',
    '',
].join('\n');
const MODIFIED = [
    '# Notes',
    '',
    '```mermaid',
    'flowchart LR',
    '    Café --> Bakery',
    '```',
    '',
    '| City | Sales |',
    '| --- | --- |',
    '| Patras | 14 |',
    '',
].join('\n');

const svgOf: MermaidRenderer = async (source) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" style="max-width: 40px;"><text>${source.length}</text></svg>`;

interface LoadedPage {
    readonly window: HappyWindow;
    readonly document: Document;
    readonly fetch: Mock;
    readonly open: Mock;
    readonly writeText: Mock<(text: string) => Promise<void>>;
    readonly script: string;
}

let loaded: LoadedPage | null = null;

afterEach(async () => {
    await loaded?.window.happyDOM.close();
    loaded = null;
});

// Writes the exported page into a window, then runs its scripts with that window's globals.
async function loadPageAsync(): Promise<LoadedPage> {
    const diff = compareMarkdown(ORIGINAL, MODIFIED, { includeUnchanged: true });
    const { html } = await renderDiffHtmlAsync(diff, { renderMermaid: svgOf });
    const scripts = [...html.matchAll(/<script>([^]*?)<\/script>/g)].map((match) => match[1] ?? '');
    const happy = new HappyWindow({ url: 'file:///C:/exports/notes.diff.html', width: 1200, height: 800 });
    const document = happy.document as unknown as Document;
    document.write(html.replace(/<script>[^]*?<\/script>/g, ''));
    document.close();
    const fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
    });
    const open = vi.fn(() => null);
    Object.assign(happy, { open });
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(happy.navigator, 'clipboard', { configurable: true, value: { writeText } });

    for (const script of scripts) {
        const run = new Function(
            'window',
            'document',
            'navigator',
            'localStorage',
            'getComputedStyle',
            'requestAnimationFrame',
            'setTimeout',
            'clearTimeout',
            'fetch',
            script,
        );
        run(
            happy,
            document,
            happy.navigator,
            happy.localStorage,
            happy.getComputedStyle.bind(happy),
            happy.requestAnimationFrame.bind(happy),
            happy.setTimeout.bind(happy),
            happy.clearTimeout.bind(happy),
            fetch,
        );
    }

    loaded = { window: happy, document, fetch, open, writeText, script: scripts.join('\n') };

    return loaded;
}

function click(page: LoadedPage, element: Element | null | undefined): void {
    if (element == null) {
        throw new Error('Nothing to click');
    }

    element.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
}

function copyButton(page: LoadedPage, label: string): HTMLButtonElement {
    const button = [...page.document.querySelectorAll<HTMLButtonElement>('.md-body .md-copy')].find((candidate) => candidate.textContent?.includes(label));

    if (button == null) {
        throw new Error(`No ${label} button`);
    }

    return button;
}

async function settleAsync(): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
        await Promise.resolve();
    }
}

describe('the exported Markdown diff page\'s script', () => {
    it('fetches nothing and opens no window of its own', async () => {
        const page = await loadPageAsync();

        expect(page.script).not.toMatch(/\bfetch\s*\(|\.open\s*\(|createObjectURL/);
    });

    it('copies a diagram\'s Mermaid source and a table\'s Markdown, and says so once the clipboard has it', async () => {
        const page = await loadPageAsync();
        const mermaid = copyButton(page, 'Copy Mermaid');
        const table = copyButton(page, 'Copy table');

        click(page, mermaid);
        click(page, table);
        await settleAsync();

        expect(page.writeText.mock.calls.map(([text]) => text)).toEqual([
            'flowchart LR\n    Café --> Shop',
            '| City | Sales |\n| --- | --- |\n| Patras | 14 |',
        ]);
        expect([mermaid.textContent, table.textContent]).toEqual(['Copied', 'Copied']);
    });

    it('copies through a selection when the clipboard refuses, and says when that fails too, with no error left unhandled', async () => {
        const page = await loadPageAsync();
        const button = copyButton(page, 'Copy Mermaid');
        const label = button.textContent;
        page.writeText.mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
        const execCommand = vi.fn((_command: string) => true);
        Object.assign(page.document, { execCommand });

        click(page, button);
        await settleAsync();

        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(button.textContent).toBe('Copied');
        expect(page.document.querySelector('textarea')).toBeNull();

        execCommand.mockReturnValue(false);
        click(page, button);
        await settleAsync();

        expect(button.textContent).toBe('Copy failed');

        await new Promise((resolve) => setTimeout(resolve, 1300));

        expect(button.textContent).toBe(label);
    });

    it('enlarges a diagram in a dialog of its own, showing the diagram\'s own data: picture, with no fetch or window', async () => {
        const page = await loadPageAsync();
        const zoom = page.document.querySelector<HTMLDialogElement>('.md-zoom')!;
        const enlarge = page.document.querySelector('.md-body .md-enlarge');
        const picture = enlarge?.closest('.md-pane, .md-diff, .md-mermaid')?.querySelector('img')?.getAttribute('src');

        expect(zoom.open).toBe(false);
        expect(zoom.querySelector('img')).toBeNull();
        expect(picture).toMatch(/^data:image\/svg\+xml;base64,/);

        click(page, enlarge);
        const shown = zoom.querySelector('img');

        expect(zoom.open).toBe(true);
        expect(shown?.getAttribute('src')).toBe(picture);
        expect(page.document.documentElement.classList.contains('md-locked')).toBe(true);

        click(page, shown);

        expect(zoom.classList.contains('md-zoom-in')).toBe(true);

        click(page, shown);

        expect(zoom.classList.contains('md-zoom-in')).toBe(false);

        click(page, zoom.querySelector('.md-zoom-x'));

        expect(zoom.open).toBe(false);
        expect(zoom.querySelector('img')).toBeNull();
        expect(page.document.documentElement.classList.contains('md-locked')).toBe(false);
        expect(page.fetch).not.toHaveBeenCalled();
        expect(page.open).not.toHaveBeenCalled();
    });

    it('enlarges a diagram from the side-by-side view over it, and leaves that view open once closed', async () => {
        const page = await loadPageAsync();
        const zoom = page.document.querySelector<HTMLDialogElement>('.md-zoom')!;
        const modal = page.document.querySelector<HTMLElement>('.md-modal')!;
        const diagram = page.document.querySelector('.md-body .md-enlarge')?.closest('[id^="chg"]');

        click(page, diagram);

        expect(modal.hidden).toBe(false);

        click(page, modal.querySelector('.md-side-after .md-enlarge'));

        expect(zoom.open).toBe(true);

        page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);

        expect(modal.hidden).toBe(false);

        click(page, zoom);

        expect(zoom.open).toBe(false);
        expect(modal.hidden).toBe(false);
        expect(page.document.documentElement.classList.contains('md-locked')).toBe(true);
    });
});
