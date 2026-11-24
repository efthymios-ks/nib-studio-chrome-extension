import {
    anchoredLayout,
    clampScale,
    clampScroll,
    contentPointAt,
    fitScale,
    interpolatePoint,
    nextZoomStep,
    scrollToKeep,
    visibleMargins,
    wheelDeltaPixels,
    wheelZoomFactor,
    ZoomAnimation,
    zoomLayout,
    type FitMode,
    type Margins,
    type Point,
    type Size,
    type ZoomLayout,
} from './previewZoom.js';

// How the plain mouse wheel behaves: 'wheel' zooms (images), 'ctrl-wheel' scrolls and leaves zooming to Ctrl+wheel (documents).
export type WheelZoomMode = 'wheel' | 'ctrl-wheel';

// Animation frames and timers, so tests can drive time by hand.
export interface AnimationClock {
    now(): number;
    requestFrame(callback: () => void): number;
    cancelFrame(handle: number): void;
    setTimer(callback: () => void, milliseconds: number): number;
    clearTimer(handle: number): void;
}

export interface ZoomControllerOptions {
    // The scroll container, with the sized area inside it and the content layer inside that.
    readonly viewport: HTMLElement;
    readonly area: HTMLElement;
    readonly layer: HTMLElement;
    readonly wheelZoom: WheelZoomMode;
    readonly fitMode: FitMode;
    readonly allowUpscaleOnFit: boolean;
    readonly dragToPan: boolean;
    // Called on every change of the shown scale, animation frames included, for the zoom label.
    readonly onScaleChange: (scale: number) => void;
    // Called once the scale has rested for SETTLE_DELAY_MS, after the layer was laid out at that scale.
    readonly onSettled: (scale: number) => void;
    // Called when the view scrolls or pans, for the per-tab memory.
    readonly onScroll?: (scroll: Point) => void;
    readonly clock?: AnimationClock;
    readonly prefersReducedMotion?: () => boolean;
}

// A fit a viewer works out for each size of the view, such as one whole page of a document:
// the scale, and the content point to put in the middle of the view; null when there is nothing to fit.
// `middle` is the content point that was in the middle of the view before it changed size, when it did.
export type ViewerFit = (view: Size, middle?: Point) => { readonly scale: number; readonly point: Point } | null;

export interface ZoomRestore {
    readonly scale: number;
    readonly scroll: Point;
}

export interface ZoomController {
    // Shows content of this size at 100%: fitted and centred, or at a remembered scale and scroll.
    setContentSize(size: Size, restore?: ZoomRestore | null): void;
    // Takes a new size of the same content, such as a page that grew when a picture arrived late,
    // keeping the zoom or the fit, and the point in the middle of the view.
    resizeContent(size: Size): void;
    getScale(): number;
    getScroll(): Point;
    // True until the user zooms; a fitted preview fits again when the window changes size.
    isFitted(): boolean;
    zoomIn(): void;
    zoomOut(): void;
    // Fits the content to the window and centres it, animated.
    reset(): void;
    // Zooms to a fit of the viewer's own, eased unless `animate` is false, and keeps to it whenever the view
    // changes size, until the next zoom.
    fitTo(fit: ViewerFit, options?: { readonly animate?: boolean }): void;
    // Whether the content is held at a viewer's fit.
    hasViewerFit(): boolean;
    // Animates to a scale, keeping the viewport point `anchor` (the centre by default) fixed.
    zoomTo(scale: number, anchor?: Point): void;
    // Changes the scale at once by a factor, keeping `anchor` fixed; this is what the wheel does.
    zoomBy(factor: number, anchor: Point): void;
    // Scrolls a content point to the top left (or the centre) of the viewport, smoothly unless motion is reduced.
    scrollContentTo(point: Point, options?: { readonly smooth?: boolean; readonly align?: 'start' | 'center' }): void;
    // Lays the content out again after the viewport changed size.
    relayout(): void;
    destroy(): void;
}

// How long buttons, keys and Reset take to reach their scale.
export const ZOOM_ANIMATION_MS = 180;

// How long the scale must rest before the content is laid out again at full sharpness.
export const SETTLE_DELAY_MS = 150;

export const BROWSER_CLOCK: AnimationClock = {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(() => callback()),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimer: (handle) => window.clearTimeout(handle),
};

export function prefersReducedMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PendingWheel {
    factor: number;
    anchor: Point;
}

// A running zoom: the scale eases to its target while the content point under `anchor` moves from `pointFrom`
// to `pointTo`. They are the same point for a zoom; Reset moves it to the content's centre so the fit ends centred.
interface RunningZoom {
    readonly scale: ZoomAnimation;
    readonly anchor: Point;
    readonly pointFrom: Point;
    readonly pointTo: Point;
}

interface Pan {
    readonly pointerId: number;
    readonly start: Point;
    readonly scroll: Point;
}

// Drives zoom and pan for a preview frame. During a zoom the already drawn layer is only scaled with a CSS transform;
// once the scale rests it is laid out at the new size, so images and redrawn pages end up sharp.
export function createZoomController(options: ZoomControllerOptions): ZoomController {
    const { viewport, area, layer } = options;
    const clock = options.clock ?? BROWSER_CLOCK;
    const reducedMotion = options.prefersReducedMotion ?? prefersReducedMotion;
    let content: Size = { width: 0, height: 0 };
    let layout: ZoomLayout = { scale: 1, area: { width: 0, height: 0 }, offset: { x: 0, y: 0 } };
    // The viewport size the layout was made for, so a resize can keep the point that was in the middle.
    let layoutViewport: Size = { width: 0, height: 0 };
    let settledScale = 1;
    let fitted = true;
    let viewerFit: ViewerFit | null = null;
    let running: RunningZoom | null = null;
    let frameHandle: number | null = null;
    let settleHandle: number | null = null;
    let pendingWheel: PendingWheel | null = null;
    let pan: Pan | null = null;
    // The scroll position last asked for, kept unrounded so repeated zooms at one point don't drift.
    let requestedScroll: Point | null = null;
    // The content point the reader has in the middle of the view, as last zoomed or scrolled to. A resize keeps it,
    // even through a view too small to put it in the middle, and it is never read back from a scroll position
    // the browser cut short because the view changed size.
    let middle: Point | null = null;

    const viewportSize = (): Size => ({ width: viewport.clientWidth, height: viewport.clientHeight });
    const currentFit = (): number => fitScale(content, viewportSize(), { mode: options.fitMode, allowUpscale: options.allowUpscaleOnFit });
    const clamp = (value: number): number => clampScale(value, currentFit());
    const centre = (): Point => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
    const contentCentre = (): Point => ({ x: content.width / 2, y: content.height / 2 });
    // Where a fit leaves the content point that was in the middle of the view: a picture fits centred,
    // while a document fitted to its width is centred across and stays at the line being read.
    const fitPoint = (middle: Point): Point => (options.fitMode === 'width' ? { x: content.width / 2, y: middle.y } : contentCentre());

    const readScroll = (): Point => {
        const actual = { x: viewport.scrollLeft, y: viewport.scrollTop };

        if (requestedScroll != null && Math.abs(requestedScroll.x - actual.x) < 1 && Math.abs(requestedScroll.y - actual.y) < 1) {
            return requestedScroll;
        }

        return actual;
    };

    const writeScroll = (scroll: Point): void => {
        requestedScroll = scroll;
        middle = contentPointAt(centre(), scroll, layout);
        viewport.scrollLeft = scroll.x;
        viewport.scrollTop = scroll.y;
    };

    // Sizes the scrollable area and places the layer; between settles the layer keeps its laid-out size
    // and only its transform follows the scale.
    const applyLayout = (next: ZoomLayout): void => {
        layout = next;
        layoutViewport = viewportSize();
        area.style.width = `${next.area.width}px`;
        area.style.height = `${next.area.height}px`;
        layer.style.transform = `translate(${next.offset.x}px, ${next.offset.y}px) scale(${next.scale / settledScale})`;
        viewport.dataset['pannable'] = String(options.dragToPan && (next.area.width > viewport.clientWidth || next.area.height > viewport.clientHeight));
    };

    const layOutLayer = (): void => {
        layer.style.width = `${content.width * settledScale}px`;
        layer.style.height = `${content.height * settledScale}px`;
        layer.style.setProperty('--preview-scale', String(settledScale));
        layer.dataset['pixelated'] = String(settledScale > 2);
    };

    const show = (next: { readonly layout: ZoomLayout; readonly scroll: Point }): void => {
        applyLayout(next.layout);
        writeScroll(next.scroll);
        options.onScaleChange(next.layout.scale);
    };

    // Shows `scale` with the content point `point` under the viewport point `anchor`. The blank beside the content
    // is kept from `before`, or from the view as it is now.
    const showAt = (scale: number, anchor: Point, point: Point, before?: Margins): void => {
        const view = viewportSize();
        const margins = before ?? visibleMargins(layout, content, readScroll(), view);
        show(anchoredLayout(scale, content, view, anchor, point, margins));
    };

    // The content point that was in the middle of the view the layout was made for, and the blank beside the content then.
    const placeBeforeResize = (): { readonly point: Point; readonly margins: Margins } => {
        const previousCentre = { x: layoutViewport.width / 2, y: layoutViewport.height / 2 };
        const point = middle ?? contentPointAt(previousCentre, readScroll(), layout);
        const scroll = {
            x: layout.offset.x + point.x * layout.scale - previousCentre.x,
            y: layout.offset.y + point.y * layout.scale - previousCentre.y,
        };

        return { point, margins: visibleMargins(layout, content, scroll, layoutViewport) };
    };

    // Shows the viewer's fit for the view as it is now; false when it has nothing to fit.
    const showViewerFit = (fit: ViewerFit, before?: Point): boolean => {
        const target = fit(viewportSize(), before);

        if (target == null) {
            return false;
        }

        showAt(clamp(target.scale), centre(), target.point);
        middle = target.point;

        return true;
    };

    const showCentred = (scale: number, scroll: Point): void => {
        const centred = zoomLayout(scale, content, viewportSize());
        show({ layout: centred, scroll: clampScroll(scroll, centred, viewportSize()) });
    };

    // Fits the content to the view again, keeping the line being read in the middle when fitted to the width.
    const refit = (): void => {
        if (options.fitMode !== 'width') {
            showCentred(currentFit(), { x: 0, y: 0 });

            return;
        }

        const before = placeBeforeResize();
        showAt(currentFit(), centre(), fitPoint(before.point), before.margins);
        middle = fitPoint(before.point);
    };

    const settle = (): void => {
        settleHandle = null;

        if (running != null || pendingWheel != null) {
            scheduleSettle();

            return;
        }

        delete viewport.dataset['zooming'];

        if (settledScale === layout.scale) {
            return;
        }

        settledScale = layout.scale;
        layOutLayer();
        applyLayout(layout);
        options.onSettled(settledScale);
    };

    const scheduleSettle = (): void => {
        if (settleHandle != null) {
            clock.clearTimer(settleHandle);
        }

        settleHandle = clock.setTimer(settle, SETTLE_DELAY_MS);
    };

    const settleNow = (): void => {
        if (settleHandle != null) {
            clock.clearTimer(settleHandle);
            settleHandle = null;
        }

        settle();
    };

    const valueOf = (zoom: RunningZoom, now: number): { readonly scale: number; readonly point: Point } => ({
        scale: zoom.scale.valueAt(now),
        point: interpolatePoint(zoom.pointFrom, zoom.pointTo, zoom.scale.progressAt(now)),
    });

    // Stops a running zoom where it has got to, so the wheel can take over from there.
    const stopRunning = (now: number): void => {
        if (running != null) {
            const { scale, point } = valueOf(running, now);
            showAt(scale, running.anchor, point);
            running = null;
        }
    };

    const onFrame = (): void => {
        frameHandle = null;
        const now = clock.now();

        if (pendingWheel != null) {
            const wheel = pendingWheel;
            pendingWheel = null;
            stopRunning(now);
            showAt(clamp(layout.scale * wheel.factor), wheel.anchor, contentPointAt(wheel.anchor, readScroll(), layout));
        }

        if (running != null) {
            const { scale, point } = valueOf(running, now);
            showAt(scale, running.anchor, point);

            if (running.scale.isDoneAt(now)) {
                running = null;

                // Scroll bars that came or went during a Reset change the room, so the fit is measured once more.
                if (fitted && Math.abs(currentFit() - layout.scale) > 1e-6) {
                    layoutViewport = viewportSize();
                    refit();
                }
            }
            else {
                requestFrame();
            }
        }

        scheduleSettle();
    };

    const requestFrame = (): void => {
        if (frameHandle == null) {
            frameHandle = clock.requestFrame(onFrame);
        }
    };

    // The scale buttons and keys step from: where a running zoom is heading, so quick presses add up.
    const targetScale = (): number => running?.scale.to ?? layout.scale;

    const animateTo = (target: number, anchor: Point, pointTo: ((pointFrom: Point) => Point) | null): void => {
        const now = clock.now();
        const next = clamp(target);
        const current = running == null ? { scale: layout.scale, point: contentPointAt(anchor, readScroll(), layout) } : valueOf(running, now);
        const pointFrom = running == null || running.anchor.x !== anchor.x || running.anchor.y !== anchor.y
            ? contentPointAt(anchor, readScroll(), layout)
            : current.point;
        const end = pointTo?.(pointFrom) ?? pointFrom;
        viewport.dataset['zooming'] = 'true';

        if (reducedMotion()) {
            running = null;
            showAt(next, anchor, end);
            settleNow();

            return;
        }

        const scale = running == null
            ? new ZoomAnimation(current.scale, next, now, ZOOM_ANIMATION_MS)
            : running.scale.retarget(next, now);
        running = { scale, anchor, pointFrom, pointTo: end };
        requestFrame();
    };

    const isOnScrollbar = (event: PointerEvent): boolean => {
        const rect = viewport.getBoundingClientRect();

        return event.clientX - rect.left - viewport.clientLeft >= viewport.clientWidth
            || event.clientY - rect.top - viewport.clientTop >= viewport.clientHeight;
    };

    const onWheel = (event: WheelEvent): void => {
        const zooms = options.wheelZoom === 'wheel'
            ? event.deltaY !== 0 && !event.shiftKey
            : event.ctrlKey;

        if (!zooms || content.width <= 0) {
            return;
        }

        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const anchor = { x: event.clientX - rect.left - viewport.clientLeft, y: event.clientY - rect.top - viewport.clientTop };
        const factor = wheelZoomFactor(wheelDeltaPixels(event.deltaY, event.deltaMode, viewport.clientHeight));
        fitted = false;
        viewerFit = null;
        viewport.dataset['zooming'] = 'true';
        pendingWheel = { factor: (pendingWheel?.factor ?? 1) * factor, anchor };
        requestFrame();
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (
            !options.dragToPan
            || event.button !== 0
            || viewport.dataset['pannable'] !== 'true'
            || isOnScrollbar(event)
        ) {
            return;
        }

        event.preventDefault();
        viewport.focus({ preventScroll: true });
        pan = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, scroll: readScroll() };
        viewport.setPointerCapture?.(event.pointerId);
        viewport.dataset['panning'] = 'true';
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (pan == null || event.pointerId !== pan.pointerId) {
            return;
        }

        const scroll = { x: pan.scroll.x - (event.clientX - pan.start.x), y: pan.scroll.y - (event.clientY - pan.start.y) };
        writeScroll(clampScroll(scroll, layout, viewportSize()));
    };

    const onPointerUp = (event: PointerEvent): void => {
        if (pan == null || event.pointerId !== pan.pointerId) {
            return;
        }

        pan = null;
        viewport.releasePointerCapture?.(event.pointerId);
        delete viewport.dataset['panning'];
    };

    // Whether the scroll position is the one last asked for, or that one cut short by the browser at the end of the area,
    // as when a scroll bar going away makes the view taller.
    const isAskedFor = (actual: Point): boolean => {
        if (requestedScroll == null) {
            return false;
        }

        const ends = { x: viewport.scrollWidth - viewport.clientWidth, y: viewport.scrollHeight - viewport.clientHeight };
        const fits = (axis: 'x' | 'y'): boolean => Math.abs((requestedScroll?.[axis] ?? 0) - actual[axis]) < 1
            || (actual[axis] < (requestedScroll?.[axis] ?? 0) && actual[axis] >= ends[axis] - 1);

        return fits('x') && fits('y');
    };

    const onScroll = (): void => {
        const actual = { x: viewport.scrollLeft, y: viewport.scrollTop };
        // A scroll that comes with a change of size is the browser keeping the old scroll position inside the view,
        // not the reader moving, so the middle stays as it was until the layout follows the new size.
        const isResizing = viewport.clientWidth !== layoutViewport.width || viewport.clientHeight !== layoutViewport.height;

        if (!isAskedFor(actual) && !isResizing) {
            requestedScroll = null;
            middle = contentPointAt(centre(), actual, layout);
        }

        options.onScroll?.(actual);
    };

    // An image dragged to pan never starts the browser's own drag, which would read as a file being dropped.
    const onDragStart = (event: DragEvent): void => {
        if (options.dragToPan) {
            event.preventDefault();
        }
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove, { passive: true });
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('dragstart', onDragStart);

    return {
        setContentSize: (size, restore) => {
            content = size;
            running = null;
            pendingWheel = null;
            fitted = restore == null;
            viewerFit = null;
            const scale = restore == null ? currentFit() : clamp(restore.scale);
            settledScale = scale;
            layOutLayer();
            showCentred(scale, restore?.scroll ?? { x: 0, y: 0 });
        },
        resizeContent: (size) => {
            const keep = middle;

            if (content.width <= 0 || keep == null) {
                return;
            }

            stopRunning(clock.now());
            pendingWheel = null;
            content = size;
            layOutLayer();

            if (viewerFit != null && showViewerFit(viewerFit, keep)) {
                settleNow();

                return;
            }

            if (fitted && options.fitMode !== 'width') {
                showCentred(currentFit(), { x: 0, y: 0 });
                settleNow();

                return;
            }

            const point = fitted ? fitPoint(keep) : keep;
            showAt(fitted ? currentFit() : layout.scale, centre(), point);
            middle = point;
            settleNow();
        },
        getScale: () => layout.scale,
        getScroll: () => readScroll(),
        isFitted: () => fitted,
        zoomIn: () => {
            fitted = false;
            viewerFit = null;
            animateTo(nextZoomStep(targetScale(), 1), centre(), null);
        },
        zoomOut: () => {
            fitted = false;
            viewerFit = null;
            animateTo(nextZoomStep(targetScale(), -1), centre(), null);
        },
        reset: () => {
            fitted = true;
            viewerFit = null;
            animateTo(currentFit(), centre(), fitPoint);
        },
        fitTo: (fit, fitOptions) => {
            const target = content.width > 0 ? fit(viewportSize()) : null;

            if (target == null) {
                return;
            }

            fitted = false;
            viewerFit = fit;

            if (fitOptions?.animate === false) {
                running = null;
                pendingWheel = null;
                showViewerFit(fit);
                settleNow();

                return;
            }

            animateTo(target.scale, centre(), () => target.point);
        },
        hasViewerFit: () => viewerFit != null,
        zoomTo: (target, anchor) => {
            fitted = false;
            viewerFit = null;
            animateTo(target, anchor ?? centre(), null);
        },
        zoomBy: (factor, anchor) => {
            fitted = false;
            viewerFit = null;
            stopRunning(clock.now());
            showAt(clamp(layout.scale * factor), anchor, contentPointAt(anchor, readScroll(), layout));
            viewport.dataset['zooming'] = 'true';
            scheduleSettle();
        },
        scrollContentTo: (point, scrollOptions) => {
            const size = viewportSize();
            const anchor = scrollOptions?.align === 'center' ? { x: size.width / 2, y: size.height / 2 } : { x: 0, y: 0 };
            const target = scrollToKeep(point, anchor, layout, size);
            const isSmooth = (scrollOptions?.smooth ?? true) && !reducedMotion();
            requestedScroll = null;
            middle = contentPointAt(centre(), target, layout);

            if (typeof viewport.scrollTo === 'function') {
                viewport.scrollTo({ left: target.x, top: target.y, behavior: isSmooth ? 'smooth' : 'auto' });

                return;
            }

            writeScroll(target);
        },
        relayout: () => {
            // A view with no room, as while the window is very narrow, has no middle to keep, so the place is kept
            // for when it has room again.
            if (content.width <= 0 || running != null || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) {
                return;
            }

            const before = placeBeforeResize();

            if (viewerFit != null && showViewerFit(viewerFit, before.point)) {
                settleNow();

                return;
            }

            if (fitted) {
                refit();
                settleNow();

                return;
            }

            showAt(layout.scale, centre(), before.point, before.margins);
            middle = before.point;
        },
        destroy: () => {
            if (frameHandle != null) {
                clock.cancelFrame(frameHandle);
            }

            if (settleHandle != null) {
                clock.clearTimer(settleHandle);
            }

            viewport.removeEventListener('wheel', onWheel);
            viewport.removeEventListener('pointerdown', onPointerDown);
            viewport.removeEventListener('pointermove', onPointerMove);
            viewport.removeEventListener('pointerup', onPointerUp);
            viewport.removeEventListener('pointercancel', onPointerUp);
            viewport.removeEventListener('scroll', onScroll);
            viewport.removeEventListener('dragstart', onDragStart);
        },
    };
}
