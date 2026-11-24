import { describe, expect, it } from 'vitest';
import {
    anchoredLayout,
    clampScale,
    clampScroll,
    CONTENT_PADDING,
    contentPointAt,
    easeOutCubic,
    fitScale,
    formatZoomPercent,
    interpolatePoint,
    interpolateScale,
    nextZoomStep,
    visibleMargins,
    wheelDeltaPixels,
    wheelZoomFactor,
    ZOOM_MAX,
    ZOOM_MIN,
    ZoomAnimation,
    zoomLayout,
} from './previewZoom.js';

const VIEWPORT = { width: 800, height: 600 };

describe('nextZoomStep', () => {
    it('moves to the neighbouring stop, from a stop or from between stops', () => {
        expect(nextZoomStep(1, 1)).toBe(1.1);
        expect(nextZoomStep(1, -1)).toBe(0.9);
        expect(nextZoomStep(1.2, 1)).toBe(1.25);
        expect(nextZoomStep(1.2, -1)).toBe(1.1);
        expect(nextZoomStep(0.4733, 1)).toBe(0.5);
    });

    it('stops at the ends of the range', () => {
        expect(nextZoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
        expect(nextZoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
        expect(nextZoomStep(0.05, -1)).toBe(0.05);
    });
});

describe('clampScale', () => {
    it('keeps the scale between 10% and 800%', () => {
        expect(clampScale(20)).toBe(ZOOM_MAX);
        expect(clampScale(0.01)).toBe(ZOOM_MIN);
        expect(clampScale(Number.NaN)).toBe(1);
    });

    it('lets a fit below 10% through, so a huge image can still fit', () => {
        expect(clampScale(0.04, 0.04)).toBe(0.04);
        expect(clampScale(0.01, 0.04)).toBe(0.04);
    });
});

describe('wheel factors', () => {
    it('turns line and page deltas into pixels', () => {
        expect(wheelDeltaPixels(3, 0, 600)).toBe(3);
        expect(wheelDeltaPixels(3, 1, 600)).toBe(48);
        expect(wheelDeltaPixels(1, 2, 600)).toBe(600);
    });

    it('zooms continuously with the travel, in for up and out for down', () => {
        expect(wheelZoomFactor(-5)).toBeCloseTo(Math.exp(0.05), 10);
        expect(wheelZoomFactor(5)).toBeCloseTo(Math.exp(-0.05), 10);
        expect(wheelZoomFactor(0)).toBe(1);
        expect(wheelZoomFactor(-2) * wheelZoomFactor(-3)).toBeCloseTo(wheelZoomFactor(-5), 10);
    });

    it('caps one event, so a mouse notch zooms by about 22% instead of jumping', () => {
        expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.2), 10);
        expect(wheelZoomFactor(1000)).toBeCloseTo(Math.exp(-0.2), 10);
    });

    it('follows a pinch exactly, since Chrome sends deltaY = 100 × ln(scale)', () => {
        expect(wheelZoomFactor(-100 * Math.log(1.1))).toBeCloseTo(1.1, 10);
    });
});

describe('fitScale', () => {
    it('fits large content inside the padding', () => {
        expect(fitScale({ width: 1600, height: 1200 }, VIEWPORT, { mode: 'contain', allowUpscale: false })).toBeCloseTo(568 / 1200, 10);
    });

    it('never enlarges content that already fits, unless asked to', () => {
        expect(fitScale({ width: 200, height: 100 }, VIEWPORT, { mode: 'contain', allowUpscale: false })).toBe(1);
        expect(fitScale({ width: 200, height: 100 }, VIEWPORT, { mode: 'contain', allowUpscale: true })).toBeCloseTo(768 / 200, 10);
    });

    it('fits the width alone for documents', () => {
        expect(fitScale({ width: 600, height: 5000 }, VIEWPORT, { mode: 'width', allowUpscale: true })).toBeCloseTo(768 / 600, 10);
    });

    it('copes with empty content and an unsized viewport', () => {
        expect(fitScale({ width: 0, height: 0 }, VIEWPORT, { mode: 'contain', allowUpscale: false })).toBe(1);
        expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 }, { mode: 'contain', allowUpscale: false })).toBe(ZOOM_MIN);
    });
});

describe('zoomLayout', () => {
    it('centres content smaller than the viewport, with no scrolling', () => {
        const layout = zoomLayout(1, { width: 400, height: 200 }, VIEWPORT);

        expect(layout.area).toEqual(VIEWPORT);
        expect(layout.offset).toEqual({ x: 200, y: 200 });
    });

    it('gives larger content a scrollable area with the padding around it', () => {
        const layout = zoomLayout(2, { width: 600, height: 400 }, VIEWPORT);

        expect(layout.area).toEqual({ width: 1200 + 2 * CONTENT_PADDING, height: 800 + 2 * CONTENT_PADDING });
        expect(layout.offset).toEqual({ x: CONTENT_PADDING, y: CONTENT_PADDING });
    });

    it('rounds the area so a fitted image never shows scroll bars for a fraction of a pixel', () => {
        const scale = fitScale({ width: 1600, height: 1200 }, VIEWPORT, { mode: 'contain', allowUpscale: false });

        expect(zoomLayout(scale, { width: 1600, height: 1200 }, VIEWPORT).area).toEqual(VIEWPORT);
    });
});

describe('anchoredLayout', () => {
    const content = { width: 600, height: 400 };

    it('keeps the content point under the anchor by scrolling once the content is larger', () => {
        const before = zoomLayout(2, content, VIEWPORT);
        const scroll = { x: 300, y: 150 };
        const anchor = { x: 500, y: 200 };
        const point = contentPointAt(anchor, scroll, before);
        const after = anchoredLayout(3, content, VIEWPORT, anchor, point);

        expect(contentPointAt(anchor, after.scroll, after.layout).x).toBeCloseTo(point.x, 10);
        expect(contentPointAt(anchor, after.scroll, after.layout).y).toBeCloseTo(point.y, 10);
        expect(after.layout.offset).toEqual({ x: CONTENT_PADDING, y: CONTENT_PADDING });
    });

    it('moves fitting content toward the anchor instead, without scrolling', () => {
        const small = { width: 200, height: 100 };
        const anchor = { x: 600, y: 300 };
        const point = contentPointAt(anchor, { x: 0, y: 0 }, zoomLayout(1, small, VIEWPORT));
        const after = anchoredLayout(1.5, small, VIEWPORT, anchor, point);

        expect(after.scroll).toEqual({ x: 0, y: 0 });
        expect(after.layout.area).toEqual(VIEWPORT);
        expect(contentPointAt(anchor, after.scroll, after.layout).x).toBeCloseTo(point.x, 10);
        expect(after.layout.offset.x).toBeLessThan((800 - 300) / 2);
    });

    it('keeps fitting content inside the padding when the anchor would push it out', () => {
        const small = { width: 200, height: 100 };
        const after = anchoredLayout(3, small, VIEWPORT, { x: 790, y: 300 }, { x: 0, y: 50 });

        expect(after.layout.offset.x).toBe(800 - 600 - CONTENT_PADDING);
    });

    it('clamps the scroll at the edges of larger content', () => {
        const after = anchoredLayout(4, content, VIEWPORT, { x: 0, y: 0 }, { x: 600, y: 400 });

        expect(after.scroll).toEqual({ x: after.layout.area.width - 800, y: after.layout.area.height - 600 });
    });

    it('holds the point when centred content grows past the view, keeping the blank the view showed beside it', () => {
        const page = { width: 600, height: 300 };
        const before = zoomLayout(1, page, VIEWPORT);
        const anchor = { x: 150, y: 300 };
        const point = contentPointAt(anchor, { x: 0, y: 0 }, before);
        const after = anchoredLayout(1.5, page, VIEWPORT, anchor, point, visibleMargins(before, page, { x: 0, y: 0 }, VIEWPORT));
        const held = contentPointAt(anchor, after.scroll, after.layout);

        expect(before.offset.x).toBe(100);
        expect(held.x).toBeCloseTo(point.x, 10);
        expect(held.y).toBeCloseTo(point.y, 10);
        expect(after.layout.offset.x).toBe(75);
        expect(after.layout.area.width).toBe(75 + 900 + CONTENT_PADDING);
        expect(after.scroll.x).toBe(0);
    });

    it('never opens more blank beside larger content than the padding or what the view showed', () => {
        const before = zoomLayout(2, content, VIEWPORT);
        const anchor = { x: 400, y: 300 };
        const point = contentPointAt(anchor, { x: 0, y: 0 }, before);
        const after = anchoredLayout(1.5, content, VIEWPORT, anchor, point, visibleMargins(before, content, { x: 0, y: 0 }, VIEWPORT));

        expect(after.layout.offset).toEqual({ x: CONTENT_PADDING, y: CONTENT_PADDING });
        expect(after.scroll).toEqual({ x: 0, y: 0 });
    });
});

describe('visibleMargins', () => {
    it('measures the blank beside the content, negative where it runs past the view', () => {
        const layout = zoomLayout(2, { width: 600, height: 400 }, VIEWPORT);

        expect(visibleMargins(layout, { width: 600, height: 400 }, { x: 100, y: 0 }, VIEWPORT)).toEqual({
            left: CONTENT_PADDING - 100,
            top: CONTENT_PADDING,
            right: 800 - (CONTENT_PADDING - 100) - 1200,
            bottom: 600 - CONTENT_PADDING - 800,
        });
    });
});

describe('clampScroll', () => {
    it('keeps the scroll inside the area', () => {
        const layout = zoomLayout(2, { width: 600, height: 400 }, VIEWPORT);

        expect(clampScroll({ x: -5, y: 9999 }, layout, VIEWPORT)).toEqual({ x: 0, y: layout.area.height - 600 });
    });
});

describe('animation', () => {
    it('eases out and interpolates scale by ratio', () => {
        expect(easeOutCubic(0)).toBe(0);
        expect(easeOutCubic(1)).toBe(1);
        expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
        expect(interpolateScale(1, 4, 0.5)).toBeCloseTo(2, 10);
        expect(interpolatePoint({ x: 0, y: 10 }, { x: 10, y: 0 }, 0.25)).toEqual({ x: 2.5, y: 7.5 });
    });

    it('reaches its target after its duration', () => {
        const animation = new ZoomAnimation(1, 2, 100, 180);

        expect(animation.valueAt(100)).toBe(1);
        expect(animation.valueAt(190)).toBeGreaterThan(1);
        expect(animation.valueAt(190)).toBeLessThan(2);
        expect(animation.isDoneAt(279)).toBe(false);
        expect(animation.valueAt(280)).toBe(2);
        expect(animation.isDoneAt(280)).toBe(true);
    });

    it('retargets from where it has got to, without a jump and without queueing', () => {
        const animation = new ZoomAnimation(1, 2, 0, 180);
        const midway = animation.valueAt(60);
        const retargeted = animation.retarget(3, 60);

        expect(retargeted.valueAt(60)).toBeCloseTo(midway, 10);
        expect(retargeted.to).toBe(3);
        expect(retargeted.valueAt(240)).toBe(3);
    });

    it('lands at once with no duration', () => {
        expect(new ZoomAnimation(1, 2, 0, 0).valueAt(0)).toBe(2);
    });
});

describe('formatZoomPercent', () => {
    it('rounds to a whole percent', () => {
        expect(formatZoomPercent(1)).toBe('100%');
        expect(formatZoomPercent(0.4733)).toBe('47%');
        expect(formatZoomPercent(8)).toBe('800%');
    });
});
