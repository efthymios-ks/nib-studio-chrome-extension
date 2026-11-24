import { describe, expect, it, vi } from 'vitest';
import { safeRenderMermaidAsync } from './mermaidBridge.js';

describe('safeRenderMermaidAsync', () => {
    it('returns the rendered SVG', async () => {
        const renderer = vi.fn(async () => '<svg>graph</svg>');

        await expect(safeRenderMermaidAsync(renderer, 'graph TD; A-->B')).resolves.toBe('<svg>graph</svg>');
        expect(renderer).toHaveBeenCalledWith('graph TD; A-->B');
    });

    it('returns null without a renderer', async () => {
        await expect(safeRenderMermaidAsync(undefined, 'graph TD; A-->B')).resolves.toBeNull();
    });

    it('returns null for empty or blank source without calling the renderer', async () => {
        const renderer = vi.fn(async () => '<svg></svg>');

        await expect(safeRenderMermaidAsync(renderer, '')).resolves.toBeNull();
        await expect(safeRenderMermaidAsync(renderer, '  \n\t')).resolves.toBeNull();
        expect(renderer).not.toHaveBeenCalled();
    });

    it('returns null when the renderer produces nothing', async () => {
        await expect(safeRenderMermaidAsync(async () => '', 'graph TD')).resolves.toBeNull();
    });

    it('returns null when the renderer throws', async () => {
        const renderer = async (): Promise<string> => {
            throw new Error('Parse error.');
        };

        await expect(safeRenderMermaidAsync(renderer, 'graph TD; A--')).resolves.toBeNull();
    });
});
