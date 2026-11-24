import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleAsync } from '../testing/testHelpers.js';

const { initialize, render } = vi.hoisted(() => ({
    initialize: vi.fn(),
    render: vi.fn(async (id: string, source: string) => ({ svg: `<svg id="${id}" data-source="${source}"></svg>` })),
}));

vi.mock('mermaid', () => ({ default: { initialize, render } }));

const { buildMermaidTools, renderMermaidIntoAsync, renderMermaidSvgAsync } = await import('./mermaidBridge.js');

describe('mermaidBridge', () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        render.mockClear();
        writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('renderMermaidSvgAsync', () => {
        it('initialises mermaid once in strict mode and returns the rendered svg', async () => {
            const first = await renderMermaidSvgAsync('graph TD; A-->B', 'one');
            await renderMermaidSvgAsync('graph TD; B-->C', 'two');

            expect(first).toContain('id="one"');
            expect(initialize).toHaveBeenCalledTimes(1);
            expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' }));
            expect(render).toHaveBeenCalledWith('two', 'graph TD; B-->C');
        });
    });

    describe('renderMermaidIntoAsync', () => {
        it('fills the placeholder with the svg and the diagram tools', async () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'md-mermaid';

            await renderMermaidIntoAsync(placeholder, 'graph TD; A-->B', 'd1');

            expect(placeholder.querySelector('svg')?.id).toMatch(/^nib-d1-/);
            expect(placeholder.querySelector('.md-mermaid-tools .md-mermaid-copy')?.textContent).toBe('Copy Mermaid');
            expect(placeholder.querySelector('.md-mermaid-tools .md-mermaid-enlarge')?.textContent).toBe('Enlarge');
        });

        it('turns the placeholder into an error message when rendering fails', async () => {
            render.mockRejectedValueOnce(new Error('Parse error on line 1'));
            const placeholder = document.createElement('div');
            placeholder.className = 'md-mermaid';

            await renderMermaidIntoAsync(placeholder, 'not a diagram', 'd2');

            expect(placeholder.classList.contains('md-mermaid')).toBe(false);
            expect(placeholder.classList.contains('md-mermaid-error')).toBe(true);
            expect(placeholder.textContent).toBe('Parse error on line 1');
        });
    });

    describe('buildMermaidTools', () => {
        it('copies the diagram source to the clipboard', async () => {
            const tools = buildMermaidTools('graph LR; X-->Y', '<svg></svg>');
            document.body.append(tools);

            tools.querySelector<HTMLButtonElement>('.md-mermaid-copy')!.click();
            await settleAsync();

            expect(writeText).toHaveBeenCalledWith('graph LR; X-->Y');
            expect(document.querySelector('.toast')?.textContent).toBe('Mermaid source copied.');
        });

        it('opens the svg as a blob in a new tab when enlarged', () => {
            const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram');
            const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            const open = vi.spyOn(window, 'open').mockReturnValue(null);
            const tools = buildMermaidTools('graph', '<svg></svg>');

            tools.querySelector<HTMLButtonElement>('.md-mermaid-enlarge')!.click();

            const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
            expect(blob.type).toBe('image/svg+xml');
            expect(open).toHaveBeenCalledWith('blob:diagram', '_blank', 'noopener');
            open.mockRestore();
            createObjectURL.mockRestore();
            revokeObjectURL.mockRestore();
        });
    });
});
