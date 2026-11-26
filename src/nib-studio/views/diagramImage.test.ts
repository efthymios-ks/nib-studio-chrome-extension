import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMermaidImageAsync, sizeSvg } from './diagramImage.js';

vi.mock('./mermaidBridge.js', () => ({
    renderMermaidSvgAsync: vi.fn(async () => '<svg id="m" width="100%" style="max-width: 120px;" viewBox="0 0 120 80"><g></g></svg>'),
}));

afterEach(() => {
    vi.restoreAllMocks();
});

describe('sizeSvg', () => {
    it('gives the SVG the size of its view box in place of the page\'s width', () => {
        const sized = sizeSvg('<svg id="m" width="100%" viewBox="-8 -8 120.5 80"><g/></svg>');

        expect(sized).toEqual({ svg: '<svg width="120.5" height="80" id="m" viewBox="-8 -8 120.5 80"><g/></svg>', width: 120.5, height: 80 });
    });

    it('leaves an SVG without a usable view box as it is', () => {
        expect(sizeSvg('<svg><g/></svg>')).toEqual({ svg: '<svg><g/></svg>', width: null, height: null });
        expect(sizeSvg('<svg viewBox="0 0 0 10"></svg>').width).toBeNull();
    });
});

describe('renderMermaidImageAsync', () => {
    it('falls back to the SVG itself when the browser can\'t draw it as PNG', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);

        const image = await renderMermaidImageAsync('graph TD; A-->B');

        expect(image.url).toMatch(/^data:image\/svg\+xml;base64,/);
        expect(atob(image.url.split(',')[1] ?? '')).toContain('<svg width="120" height="80"');
        expect([image.width, image.height]).toEqual([120, 80]);
    });

    it('draws the diagram as PNG at twice its size on a white ground', async () => {
        const fillRect = vi.fn();
        const drawImage = vi.fn();
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect, drawImage, fillStyle: '' } as unknown as RenderingContext);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
            expect([this.width, this.height]).toEqual([240, 160]);
            callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
        });

        const image = await renderMermaidImageAsync('graph TD; A-->B');

        expect(image.url).toBe('data:image/png;base64,AQID');
        expect(fillRect).toHaveBeenCalledWith(0, 0, 240, 160);
        expect(drawImage).toHaveBeenCalledTimes(1);
    });
});
