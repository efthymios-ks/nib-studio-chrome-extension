import { buildStandaloneHtml } from '../export/htmlExport.js';
import { escapeHtml } from '../html/escapeHtml.js';
import { drawDocumentDiagramsAsync, type DiagramElements, type DrawDiagramAsync } from './documentDiagrams.js';
import { LOCAL_SOURCE_ATTRIBUTE, LOCAL_SRCSET_ATTRIBUTE } from './localImages.js';
import { renderMarkdown } from './preview.js';

// A diagram's Mermaid source travels beside its picture in this attribute,
// so converting the page back to Markdown gives the diagram's code block again.
export const MERMAID_SOURCE_ATTRIBUTE = 'data-mermaid-source';

// The generator a converted page names; its title comes from its first heading or file name,
// so converting it back to Markdown doesn't add the title as a heading.
export const CONVERTED_PAGE_GENERATOR = 'Nib Studio';

export interface MarkdownToHtmlOptions {
    // The Markdown file's name, which titles a page without a heading.
    readonly fileName: string;
    // Draws a Mermaid diagram as a picture; without it, or when it fails, the diagram stays a code block.
    readonly drawDiagramAsync?: DrawDiagramAsync;
}

// A drawn diagram is its picture, with its source in an attribute; one that can't be drawn stays the code block it was.
const CONVERTED_DIAGRAM_ELEMENTS: DiagramElements = Object.freeze({
    drawn: (picture: HTMLImageElement, source: string) => {
        const block = document.createElement('div');
        block.className = 'md-mermaid';
        block.setAttribute(MERMAID_SOURCE_ATTRIBUTE, withoutFinalBreak(source));
        block.append(picture);

        return block;
    },
    failed: (source: string) => {
        const template = document.createElement('template');
        template.innerHTML = `<pre class="md-code language-mermaid"><code>${escapeHtml(source)}</code></pre>`;

        return template.content.firstElementChild ?? document.createElement('pre');
    },
});

// Converts Markdown to a standalone HTML5 page, ending in a line break: the preview's rendering and sanitising,
// with no Copy buttons, the export's style sheet, and each Mermaid diagram as its picture with its source beside it.
// Links and image addresses stay as written, so the page reads its pictures from beside it.
export async function markdownToHtmlDocumentAsync(
    markdown: string,
    options: MarkdownToHtmlOptions,
): Promise<string> {
    const rendered = renderMarkdown(markdown, { remoteImages: 'keep' });
    const drawnHtml = await drawDocumentDiagramsAsync(restoreImageAddresses(rendered.html), {
        diagrams: rendered.diagrams,
        drawDiagramAsync: options.drawDiagramAsync,
        elements: CONVERTED_DIAGRAM_ELEMENTS,
    });
    const bodyHtml = escapeDiagramSources(drawnHtml);
    const page = buildStandaloneHtml({
        title: pageTitle(bodyHtml, options.fileName),
        bodyHtml: bodyHtml.trim(),
        generator: CONVERTED_PAGE_GENERATOR,
    });

    return `${page}\n`;
}

// The renderer keeps a workspace image's address aside until the preview reads the file; the page loads it as written.
// The address goes back first among the attributes, where Markdown put it.
function restoreImageAddresses(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    const moves = [
        { from: LOCAL_SOURCE_ATTRIBUTE, to: 'src' },
        { from: LOCAL_SRCSET_ATTRIBUTE, to: 'srcset' },
    ];

    for (const move of moves) {
        for (const element of template.content.querySelectorAll(`[${move.from}]`)) {
            const others = [...element.attributes]
                .filter((attribute) => attribute.name !== move.from)
                .map((attribute) => [attribute.name, attribute.value] as const);
            const address = element.getAttribute(move.from) ?? '';
            others.forEach(([name]) => element.removeAttribute(name));
            element.removeAttribute(move.from);
            element.setAttribute(move.to, address);
            others.forEach(([name, value]) => element.setAttribute(name, value));
        }
    }

    return template.innerHTML;
}

// A diagram's source with `<` and `>` escaped in its attribute as well, whichever way the browser writes attributes,
// so no `-->` of the diagram reads as the end of a comment.
function escapeDiagramSources(html: string): string {
    return html.replace(
        new RegExp(`(${MERMAID_SOURCE_ATTRIBUTE}=")([^"]*)"`, 'g'),
        (_match, start: string, value: string) => `${start}${value.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`,
    );
}

// The text of the first heading, or the file name without its extension.
function pageTitle(bodyHtml: string, fileName: string): string {
    const template = document.createElement('template');
    template.innerHTML = bodyHtml;
    const headingText = template.content.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ?? '';
    const heading = headingText.replace(/\s+/g, ' ').trim();

    if (heading !== '') {
        return heading;
    }

    const name = fileName.replace(/\.[^.]+$/, '');

    return name === '' ? fileName : name;
}

function withoutFinalBreak(text: string): string {
    return text.replace(/\r?\n$/, '');
}
