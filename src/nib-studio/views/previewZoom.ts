// The arithmetic of the preview frame's zoom: steps, wheel factors, fitting, layout and keeping a point under the pointer.
// Sizes and points are in CSS pixels; content points are in the content's own pixels at 100%.

export interface Size {
    readonly width: number;
    readonly height: number;
}

export interface Point {
    readonly x: number;
    readonly y: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;

// The stops the buttons and keys move between.
export const ZOOM_STEPS: ReadonlyArray<number> = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];

// The space kept around the content, so its edges never touch the frame.
export const CONTENT_PADDING = 16;

// The natural log of the zoom factor per pixel of wheel travel. A trackpad pinch arrives as Ctrl+wheel with
// deltaY = 100 × ln(scale), so this rate follows the fingers exactly.
export const WHEEL_ZOOM_RATE = 0.01;

// Each wheel event counts for at most this many pixels, so one mouse-wheel notch (about 100 pixels) zooms by about 22%
// rather than jumping, while the small deltas of a pinch or a smooth wheel pass through unchanged.
export const WHEEL_DELTA_CAP = 20;

const LINE_HEIGHT_PIXELS = 16;

const STEP_TOLERANCE = 0.001;

export type FitMode = 'contain' | 'width';

export function clampScale(scale: number, floor: number = ZOOM_MIN): number {
    if (!Number.isFinite(scale)) {
        return 1;
    }

    return Math.min(ZOOM_MAX, Math.max(Math.min(floor, ZOOM_MIN), scale));
}

// The next stop above or below `scale`; a scale between stops goes to the neighbouring stop, never past it.
export function nextZoomStep(scale: number, direction: 1 | -1): number {
    if (direction > 0) {
        return ZOOM_STEPS.find((step) => step > scale * (1 + STEP_TOLERANCE)) ?? ZOOM_MAX;
    }

    return [...ZOOM_STEPS].reverse().find((step) => step < scale * (1 - STEP_TOLERANCE)) ?? Math.min(scale, ZOOM_MIN);
}

// A wheel event's vertical travel in pixels, whatever unit the device reported it in.
export function wheelDeltaPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
    if (deltaMode === 1) {
        return deltaY * LINE_HEIGHT_PIXELS;
    }

    if (deltaMode === 2) {
        return deltaY * pageHeight;
    }

    return deltaY;
}

// Scrolling down zooms out and up zooms in, continuously, in proportion to the travel.
export function wheelZoomFactor(deltaPixels: number): number {
    const capped = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, deltaPixels));

    return Math.exp(-capped * WHEEL_ZOOM_RATE);
}

// The scale that fits the content in the viewport; it stays at 100% for content that already fits unless upscaling is allowed.
export function fitScale(
    content: Size,
    viewport: Size,
    options: { readonly mode: FitMode; readonly allowUpscale: boolean; readonly padding?: number },
): number {
    const padding = options.padding ?? CONTENT_PADDING;

    if (content.width <= 0 || content.height <= 0) {
        return 1;
    }

    const across = (viewport.width - 2 * padding) / content.width;
    const down = (viewport.height - 2 * padding) / content.height;
    const fit = options.mode === 'width' ? across : Math.min(across, down);

    if (!Number.isFinite(fit) || fit <= 0) {
        return ZOOM_MIN;
    }

    return Math.min(ZOOM_MAX, options.allowUpscale ? fit : Math.min(1, fit));
}

// Where the content sits at a scale: the scrollable area's size and the content's top-left corner in it.
// Content smaller than the viewport is centred; larger content scrolls, with the padding around it.
export interface ZoomLayout {
    readonly scale: number;
    readonly area: Size;
    readonly offset: Point;
}

export function zoomLayout(scale: number, content: Size, viewport: Size, padding: number = CONTENT_PADDING): ZoomLayout {
    const scaledWidth = content.width * scale;
    const scaledHeight = content.height * scale;
    // Rounded rather than raised, so a fitted image never shows scroll bars for a fraction of a pixel.
    const area = {
        width: Math.max(viewport.width, Math.round(scaledWidth + 2 * padding)),
        height: Math.max(viewport.height, Math.round(scaledHeight + 2 * padding)),
    };
    const offset = {
        x: Math.max(padding, (area.width - scaledWidth) / 2),
        y: Math.max(padding, (area.height - scaledHeight) / 2),
    };

    return { scale, area, offset };
}

// The blank the view shows beside the content at each edge, negative where the content runs past that edge.
export interface Margins {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export function visibleMargins(layout: ZoomLayout, content: Size, scroll: Point, viewport: Size): Margins {
    const left = layout.offset.x - scroll.x;
    const top = layout.offset.y - scroll.y;

    return {
        left,
        top,
        right: viewport.width - left - content.width * layout.scale,
        bottom: viewport.height - top - content.height * layout.scale,
    };
}

// Lays the content out at `scale` with the content point `point` under the viewport point `anchor`.
// Along an axis where the content fits, it moves within the viewport, never past its padding, so zooming at the pointer
// works from the start. Along an axis where it is larger, it scrolls, and keeps as much blank beside it as the view showed
// before (`before`, the padding at least), so a zoom that takes centred content past the view holds the point too,
// while a zoom never opens a gap beside content that filled the view.
export function anchoredLayout(
    scale: number,
    content: Size,
    viewport: Size,
    anchor: Point,
    point: Point,
    before?: Margins,
): { readonly layout: ZoomLayout; readonly scroll: Point } {
    const across = placeAxis(content.width * scale, viewport.width, anchor.x, point.x * scale, {
        lead: Math.max(CONTENT_PADDING, before?.left ?? 0),
        trail: Math.max(CONTENT_PADDING, before?.right ?? 0),
    });
    const down = placeAxis(content.height * scale, viewport.height, anchor.y, point.y * scale, {
        lead: Math.max(CONTENT_PADDING, before?.top ?? 0),
        trail: Math.max(CONTENT_PADDING, before?.bottom ?? 0),
    });

    return {
        layout: {
            scale,
            area: { width: across.area, height: down.area },
            offset: { x: across.offset, y: down.offset },
        },
        scroll: { x: across.scroll, y: down.scroll },
    };
}

// The blank that larger content may keep before and after it along one axis.
interface AxisRoom {
    readonly lead: number;
    readonly trail: number;
}

function placeAxis(
    scaled: number,
    view: number,
    anchor: number,
    pointOffset: number,
    room: AxisRoom,
): { readonly area: number; readonly offset: number; readonly scroll: number } {
    if (scaled + 2 * CONTENT_PADDING <= view) {
        const offset = Math.min(Math.max(anchor - pointOffset, CONTENT_PADDING), view - scaled - CONTENT_PADDING);

        return { area: view, offset, scroll: 0 };
    }

    // Where the content's leading edge sits in the view: under the anchor where the room allows.
    const lead = Math.min(Math.max(anchor - pointOffset, view - scaled - room.trail), room.lead);
    const offset = Math.max(CONTENT_PADDING, lead);
    const area = Math.max(view, Math.round(offset + scaled + CONTENT_PADDING), Math.round(offset - lead + view));

    return { area, offset, scroll: Math.min(offset - lead, area - view) };
}

// The content point under a viewport point, given the scroll position.
export function contentPointAt(anchor: Point, scroll: Point, layout: ZoomLayout): Point {
    return {
        x: (anchor.x + scroll.x - layout.offset.x) / layout.scale,
        y: (anchor.y + scroll.y - layout.offset.y) / layout.scale,
    };
}

export function clampScroll(scroll: Point, layout: ZoomLayout, viewport: Size): Point {
    return {
        x: Math.min(Math.max(0, scroll.x), Math.max(0, layout.area.width - viewport.width)),
        y: Math.min(Math.max(0, scroll.y), Math.max(0, layout.area.height - viewport.height)),
    };
}

// The scroll position that puts a content point back under the same viewport point after the layout changed.
export function scrollToKeep(contentPoint: Point, anchor: Point, layout: ZoomLayout, viewport: Size): Point {
    const scroll = {
        x: layout.offset.x + contentPoint.x * layout.scale - anchor.x,
        y: layout.offset.y + contentPoint.y * layout.scale - anchor.y,
    };

    return clampScroll(scroll, layout, viewport);
}

export function easeOutCubic(progress: number): number {
    const clamped = Math.min(1, Math.max(0, progress));

    return 1 - (1 - clamped) ** 3;
}

// Zoom feels even when it moves by equal ratios, so the scale is interpolated geometrically.
export function interpolateScale(from: number, to: number, progress: number): number {
    if (progress <= 0) {
        return from;
    }

    if (progress >= 1) {
        return to;
    }

    return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * progress);
}

// An eased change of scale that a new target takes over from wherever it has got to, instead of queueing behind it.
export class ZoomAnimation {
    constructor(
        readonly from: number,
        readonly to: number,
        readonly start: number,
        readonly duration: number,
    ) {}

    progressAt(now: number): number {
        return this.duration <= 0 ? 1 : easeOutCubic((now - this.start) / this.duration);
    }

    valueAt(now: number): number {
        return interpolateScale(this.from, this.to, this.progressAt(now));
    }

    isDoneAt(now: number): boolean {
        return this.duration <= 0 || now - this.start >= this.duration;
    }

    retarget(to: number, now: number): ZoomAnimation {
        return new ZoomAnimation(this.valueAt(now), to, now, this.duration);
    }
}

export function interpolatePoint(from: Point, to: Point, progress: number): Point {
    return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

// "100%", "33%", "800%".
export function formatZoomPercent(scale: number): string {
    return `${Math.round(scale * 100)}%`;
}
