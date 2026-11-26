// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { DIAGRAM_FAILED_MESSAGE, drawDocumentDiagramsAsync, PREVIEW_DIAGRAM_ELEMENTS } from './documentDiagrams.js';
import { renderMarkdown } from './preview.js';

const PICTURE = 'data:image/png;base64,RElBR1JBTQ==';

function rendered(text: string): ReturnType<typeof renderMarkdown> {
    return renderMarkdown(text, { remoteImages: 'keep' });
}

describe('drawDocumentDiagramsAsync', () => {
    it('puts each diagram in its placeholder\'s place as a picture at its size', async () => {
        const preview = rendered('# Flow\n\n```mermaid\ngraph TD; A-->B\n```\n\nAfter.');
        const sources: string[] = [];

        const html = await drawDocumentDiagramsAsync(preview.html, {
            diagrams: preview.diagrams,
            drawDiagramAsync: async (source) => {
                sources.push(source);

                return { url: PICTURE, width: 120.4, height: 80 };
            },
            elements: PREVIEW_DIAGRAM_ELEMENTS,
        });

        expect(sources).toEqual(['graph TD; A-->B\n']);
        expect(html).toContain(`<div class="md-mermaid"><img src="${PICTURE}" alt="Mermaid diagram" width="120" height="80"></div>`);
        expect(html).toContain('<p>After.</p>');
        expect(html).not.toContain('data-mermaid-id');
    });

    it('leaves the size out when the diagram\'s size is unknown', async () => {
        const preview = rendered('```mermaid\ngraph TD; A-->B\n```');

        const html = await drawDocumentDiagramsAsync(preview.html, {
            diagrams: preview.diagrams,
            drawDiagramAsync: async () => ({ url: PICTURE, width: null, height: null }),
            elements: PREVIEW_DIAGRAM_ELEMENTS,
        });

        expect(html).toBe(`<div class="md-mermaid"><img src="${PICTURE}" alt="Mermaid diagram"></div>`);
    });

    it('shows the preview\'s error text in place of a diagram that can\'t be drawn', async () => {
        const preview = rendered('```mermaid\nnot a diagram\n```\n\n```mermaid\nthrows a string\n```\n\n```mermaid\nempty\n```');

        const html = await drawDocumentDiagramsAsync(preview.html, {
            diagrams: preview.diagrams,
            drawDiagramAsync: async (source) => {
                if (source.startsWith('not')) {
                    throw new Error('No diagram type detected matching given configuration for text: not a diagram');
                }

                if (source.startsWith('throws')) {
                    throw 'not an error';
                }

                return null;
            },
            elements: PREVIEW_DIAGRAM_ELEMENTS,
        });

        expect(html).toBe([
            '<div class="md-mermaid-error">No diagram type detected matching given configuration for text: not a diagram</div>',
            `<div class="md-mermaid-error">${DIAGRAM_FAILED_MESSAGE}</div>`,
            `<div class="md-mermaid-error">${DIAGRAM_FAILED_MESSAGE}</div>`,
        ].join(''));
        expect(DIAGRAM_FAILED_MESSAGE).toBe('Mermaid render failed.');
    });

    it('escapes the error text', async () => {
        const preview = rendered('```mermaid\nbad\n```');

        const html = await drawDocumentDiagramsAsync(preview.html, {
            diagrams: preview.diagrams,
            drawDiagramAsync: async () => {
                throw new Error('Expected <end> & more');
            },
            elements: PREVIEW_DIAGRAM_ELEMENTS,
        });

        expect(html).toBe('<div class="md-mermaid-error">Expected &lt;end&gt; &amp; more</div>');
    });

    it('fails every diagram with the preview\'s message when nothing draws them', async () => {
        const preview = rendered('```mermaid\ngraph TD; A-->B\n```');

        const html = await drawDocumentDiagramsAsync(preview.html, {
            diagrams: preview.diagrams,
            drawDiagramAsync: undefined,
            elements: PREVIEW_DIAGRAM_ELEMENTS,
        });

        expect(html).toBe(`<div class="md-mermaid-error">${DIAGRAM_FAILED_MESSAGE}</div>`);
    });

    it('builds a failed diagram from its source when the document asks for it', async () => {
        const preview = rendered('```mermaid\nbroken\n```');

        const html = await drawDocumentDiagramsAsync(preview.html, {
            diagrams: preview.diagrams,
            drawDiagramAsync: async () => null,
            elements: {
                drawn: (picture) => picture,
                failed: (source) => Object.assign(document.createElement('pre'), { textContent: source }),
            },
        });

        expect(html).toBe('<pre>broken\n</pre>');
    });
});
