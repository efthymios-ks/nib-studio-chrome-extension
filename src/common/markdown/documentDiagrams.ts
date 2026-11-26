import { errorMessage } from '../errorMessage.js';
import type { MermaidBlock } from './preview.js';

// The preview's text for a diagram that can't be drawn, when the error gives no message of its own.
export const DIAGRAM_FAILED_MESSAGE = 'Mermaid render failed.';

// A diagram drawn as a picture, with its size in CSS pixels when known.
export interface DiagramImage {
    readonly url: string;
    readonly width: number | null;
    readonly height: number | null;
}

// Draws a Mermaid diagram as a picture; it throws, or gives null, when the diagram can't be drawn.
export type DrawDiagramAsync = (source: string) => Promise<DiagramImage | null>;

// What takes a diagram's place in a document: its picture when drawn, or, when it can't be drawn,
// what stands in for it, made from its source and the reason.
export interface DiagramElements {
    readonly drawn: (picture: HTMLImageElement) => Element;
    readonly failed: (source: string, message: string) => Element;
}

export interface DocumentDiagrams {
    readonly diagrams: ReadonlyArray<MermaidBlock>;
    readonly drawDiagramAsync: DrawDiagramAsync | undefined;
    readonly elements: DiagramElements;
}

// Diagrams as the preview shows them, for a page that reads like it: the picture in an `md-mermaid` block,
// or the preview's error text in an `md-mermaid-error` block.
export const PREVIEW_DIAGRAM_ELEMENTS: DiagramElements = Object.freeze({
    drawn: (picture: HTMLImageElement) => {
        const block = document.createElement('div');
        block.className = 'md-mermaid';
        block.append(picture);

        return block;
    },
    failed: (_source: string, message: string) => {
        const block = document.createElement('div');
        block.className = 'md-mermaid-error';
        block.textContent = message;

        return block;
    },
});

// Puts each Mermaid diagram of rendered Markdown in the place of its empty placeholder, drawn one after another.
export async function drawDocumentDiagramsAsync(html: string, drawing: DocumentDiagrams): Promise<string> {
    const template = document.createElement('template');
    template.innerHTML = html;

    for (const diagram of drawing.diagrams) {
        const placeholder = template.content.querySelector(`[data-mermaid-id="${diagram.id}"]`);
        placeholder?.replaceWith(await diagramElementAsync(diagram.source, drawing));
    }

    return template.innerHTML;
}

async function diagramElementAsync(source: string, drawing: DocumentDiagrams): Promise<Element> {
    const drawn = await drawOrMessageAsync(source, drawing.drawDiagramAsync);

    if (typeof drawn === 'string') {
        return drawing.elements.failed(source, drawn);
    }

    return drawing.elements.drawn(diagramPicture(drawn));
}

// The picture of a diagram, or why it can't be drawn, as the preview says it.
async function drawOrMessageAsync(
    source: string,
    drawDiagramAsync: DrawDiagramAsync | undefined,
): Promise<DiagramImage | string> {
    try {
        return await drawDiagramAsync?.(source) ?? DIAGRAM_FAILED_MESSAGE;
    }
    catch (error) {
        return errorMessage(error, DIAGRAM_FAILED_MESSAGE);
    }
}

function diagramPicture(image: DiagramImage): HTMLImageElement {
    const picture = document.createElement('img');
    picture.setAttribute('src', image.url);
    picture.setAttribute('alt', 'Mermaid diagram');

    if (image.width != null && image.height != null) {
        picture.setAttribute('width', String(Math.round(image.width)));
        picture.setAttribute('height', String(Math.round(image.height)));
    }

    return picture;
}
