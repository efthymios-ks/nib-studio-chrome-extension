import { describe, expect, it } from 'vitest';
import { computeVirtualWindow, scrollTopForRow, type VirtualWindowInput } from './virtualWindow.js';

const BASE: VirtualWindowInput = {
    scrollTop: 0,
    viewportHeight: 100,
    rowHeight: 20,
    rowCount: 100,
    overscan: 2,
    maxScrollHeight: 1_000_000,
};

describe('computeVirtualWindow', () => {
    it('renders the visible rows plus overscan below at the top of the list', () => {
        const window = computeVirtualWindow(BASE);

        expect(window).toEqual({ start: 0, end: 7, topPadding: 0, bottomPadding: 1860, totalHeight: 2000 });
    });

    it('keeps overscan on both sides in the middle of the list', () => {
        const window = computeVirtualWindow({ ...BASE, scrollTop: 400 });

        expect(window.start).toBe(18);
        expect(window.end).toBe(27);
        expect(window.topPadding).toBe(360);
        expect(window.topPadding + (window.end - window.start) * 20 + window.bottomPadding).toBe(window.totalHeight);
    });

    it('clamps to the last row when scrolled past the end', () => {
        const window = computeVirtualWindow({ ...BASE, scrollTop: 10_000 });

        expect(window.end).toBe(100);
        expect(window.bottomPadding).toBe(0);
    });

    it('returns an empty window for an empty list', () => {
        const window = computeVirtualWindow({ ...BASE, rowCount: 0 });

        expect(window).toEqual({ start: 0, end: 0, topPadding: 0, bottomPadding: 0, totalHeight: 0 });
    });

    it('caps the total height and maps the scroll position proportionally for very long lists', () => {
        const input = { ...BASE, rowCount: 1_000_000, maxScrollHeight: 10_000 };
        const top = computeVirtualWindow(input);
        const bottom = computeVirtualWindow({ ...input, scrollTop: 10_000 - 100 });

        expect(top.totalHeight).toBe(10_000);
        expect(top.start).toBe(0);
        expect(bottom.end).toBe(1_000_000);
        expect(bottom.topPadding + (bottom.end - bottom.start) * 20).toBeLessThanOrEqual(10_000);
    });
});

describe('scrollTopForRow', () => {
    it('is row times row height when the list fits', () => {
        expect(scrollTopForRow(10, BASE)).toBe(200);
    });

    it('maps rows proportionally onto the capped height and round-trips through the window', () => {
        const input = { ...BASE, rowCount: 1_000_000, maxScrollHeight: 10_000 };
        const scrollTop = scrollTopForRow(500_000, input);
        const window = computeVirtualWindow({ ...input, scrollTop });

        expect(scrollTop).toBeGreaterThan(0);
        expect(scrollTop).toBeLessThan(10_000);
        expect(window.start).toBeLessThanOrEqual(500_000);
        expect(window.end).toBeGreaterThan(500_000);
    });
});
