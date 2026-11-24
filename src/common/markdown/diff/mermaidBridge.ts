import type { MermaidRenderer } from './types.js';

export type { MermaidRenderer };

// The SVG, or null when there is no renderer, no source or the renderer fails, so the diagram shows as code.
export const safeRenderMermaidAsync = async (
    renderer: MermaidRenderer | undefined,
    source: string,
): Promise<string | null> => {
    if (renderer == null) {
        return null;
    }

    if (source === '' || /^\s*$/.test(source)) {
        return null;
    }

    try {
        const svg = await renderer(source);
        if (svg == null || svg === '') {
            return null;
        }

        return svg;
    }
    catch {
        return null;
    }
};
