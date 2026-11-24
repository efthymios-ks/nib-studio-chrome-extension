import { describe, expect, it } from 'vitest';
import { readSvgInfo } from './svgInfo.js';

describe('readSvgInfo', () => {
    it('reads width, height and viewBox from the root element', () => {
        const text = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="320" height=\'200\' viewBox="0 0 160 100"><rect/></svg>';

        expect(readSvgInfo(text)).toEqual({ width: '320', height: '200', viewBox: '0 0 160 100' });
    });

    it('gives null for missing attributes', () => {
        expect(readSvgInfo('<svg viewBox=" 0 0 24 24 "></svg>')).toEqual({ width: null, height: null, viewBox: '0 0 24 24' });
    });

    it('is not fooled by a ">" inside a quoted attribute', () => {
        expect(readSvgInfo('<svg data-note="a > b" width="10mm" height="5mm">')).toEqual({ width: '10mm', height: '5mm', viewBox: null });
    });

    it('ignores nested elements and gives null without a root', () => {
        expect(readSvgInfo('<svg width="4"><svg width="9"/></svg>')?.width).toBe('4');
        expect(readSvgInfo('<html></html>')).toBeNull();
    });
});
