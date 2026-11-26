import { encodeBase64, encodeBase64Bytes } from '../../common/encoding/base64.js';
import type { DiagramImage } from '../../common/markdown/documentDiagrams.js';
import { canvasToPngAsync } from './imageClipboard.js';
import { renderMermaidSvgAsync } from './mermaidBridge.js';

// Diagrams are drawn at twice their size, so they stay sharp in a document zoomed in or printed.
const DIAGRAM_SCALE = 2;

export interface SizedSvg {
    readonly svg: string;
    readonly width: number | null;
    readonly height: number | null;
}

// A Mermaid diagram as a picture for a document that leaves the studio: PNG on a white ground, which every editor
// pastes, or the SVG itself when the browser can't draw it as PNG.
export async function renderMermaidImageAsync(source: string): Promise<DiagramImage> {
    const svg = await renderMermaidSvgAsync(source, `copy-${Math.random().toString(36).slice(2, 8)}`);
    const sized = sizeSvg(svg);
    const svgUrl = `data:image/svg+xml;base64,${encodeBase64(sized.svg)}`;
    const pngUrl = await pngOrNullAsync(svgUrl, sized);

    return { url: pngUrl ?? svgUrl, width: sized.width, height: sized.height };
}

// Mermaid sizes its SVG to the width of the page it sits in; a picture on its own takes the size of its view box.
export function sizeSvg(svg: string): SizedSvg {
    const opening = /<svg\b[^>]*>/.exec(svg);
    const box = opening == null ? null : /\sviewBox="([^"]*)"/.exec(opening[0]);
    const numbers = (box?.[1] ?? '').trim().split(/[\s,]+/).map(Number);
    const width = numbers[2];
    const height = numbers[3];

    if (opening == null || numbers.length !== 4 || width == null || height == null || !(width > 0) || !(height > 0)) {
        return { svg, width: null, height: null };
    }

    const tag = opening[0]
        .replace(/\s(?:width|height)="[^"]*"/g, '')
        .replace(/^<svg/, `<svg width="${width}" height="${height}"`);

    return {
        svg: svg.slice(0, opening.index) + tag + svg.slice(opening.index + opening[0].length),
        width,
        height,
    };
}

async function pngOrNullAsync(svgUrl: string, sized: SizedSvg): Promise<string | null> {
    if (sized.width == null || sized.height == null) {
        return null;
    }

    try {
        const image = new Image();
        image.src = svgUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(sized.width * DIAGRAM_SCALE);
        canvas.height = Math.ceil(sized.height * DIAGRAM_SCALE);
        const context = canvas.getContext('2d');

        if (context == null) {
            return null;
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = await canvasToPngAsync(canvas);

        return `data:image/png;base64,${encodeBase64Bytes(new Uint8Array(await png.arrayBuffer()))}`;
    }
    catch {
        // A canvas the drawing tainted, or a picture that wouldn't decode, leaves the SVG.
        return null;
    }
}
