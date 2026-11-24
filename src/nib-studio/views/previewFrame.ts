import type { MetadataGroup } from '../../common/preview/metadataGroups.js';
import { clear, h } from '../app/dom.js';
import { shortcutLetter } from '../app/shortcutKey.js';
import { observeResize } from './observeResize.js';
import { readInfoPanelOpen, renderInfoPanel, writeInfoPanelOpen } from './previewInfoPanel.js';
import { formatZoomPercent, type FitMode, type Point, type Size } from './previewZoom.js';
import {
    BROWSER_CLOCK,
    createZoomController,
    type AnimationClock,
    type ViewerFit,
    type WheelZoomMode,
    type ZoomController,
    type ZoomRestore,
} from './previewZoomController.js';
import { createZoomMenu, type ZoomMenu, type ZoomMenuEntry } from './previewZoomMenu.js';

// How the content is zoomed: Reset's fit, a viewer's Fit page, or a scale of its own, such as 100% or one the wheel reached.
export type ZoomMode = 'fit' | 'fit-page' | 'scale';

export interface ZoomMenuOptions {
    // Shows one whole page: the scale and the content point to centre for a view of a given size.
    readonly fitPage: ViewerFit;
    // The fixed zooms the menu offers after Actual size, such as 0.5 for 50%.
    readonly steps: ReadonlyArray<number>;
}

export interface PreviewFrameOptions {
    // Keys the remembered zoom and scroll, which last until the tab closes; the tab's path.
    readonly memoryKey: string;
    // The badge naming the kind of file, such as "Image", "Video" or "PDF"; a "View only" badge always follows.
    readonly typeLabel: string;
    // Whether the content zooms. Without zoom the toolbar holds only the actions and Info.
    readonly zoom: boolean;
    // 'wheel': the plain wheel zooms at the pointer (images). 'ctrl-wheel': the wheel scrolls and Ctrl+wheel zooms (documents).
    readonly wheelZoom?: WheelZoomMode;
    // How Reset fits: the whole content, or its width (documents). Defaults to 'contain'.
    readonly fitMode?: FitMode;
    // Whether Reset may enlarge content smaller than the window. Defaults to false, so small images stay at 100%.
    readonly allowUpscaleOnFit?: boolean;
    // Whether dragging pans content larger than the window. Defaults to true.
    readonly dragToPan?: boolean;
    // Viewer-specific buttons, placed after Reset, such as Copy image.
    readonly actions?: ReadonlyArray<HTMLElement>;
    // Called once a zoom has rested, after the layer was laid out at the new scale: the moment to redraw crisply.
    readonly onZoomSettled?: (scale: number) => void;
    // Called for Ctrl+C while the content has focus and no text is selected.
    readonly onCopy?: () => void;
    // Turns the zoom level into a menu of Fit page, Reset's fit, Actual size and fixed zooms;
    // the button then names the mode rather than the scale.
    readonly zoomMenu?: ZoomMenuOptions;
    // Called when the zoom mode changes, such as when Fit page is chosen or a zoom leaves it.
    readonly onZoomModeChange?: (mode: ZoomMode) => void;
    // The accessible name of the content area, such as "Image preview".
    readonly label?: string;
    readonly clock?: AnimationClock;
    readonly prefersReducedMotion?: () => boolean;
}

export interface PreviewFrame {
    readonly element: HTMLElement;
    // The scrolling area, for viewers that need its size or focus.
    readonly viewport: HTMLElement;
    // Shows a message over an empty frame while the content loads.
    showLoading(message?: string): void;
    // Replaces the content with a message centred in the view, such as why a file can't be shown.
    // Zoom is turned off, and the zoom controls, the actions and the controls bar hide until content is set again.
    showMessage(title: string, message: string): void;
    // Shows an element of the viewer's own centred in the view in place of the content, such as a password form;
    // like a message, it turns zoom off and hides the zoom controls, the actions and the controls bar.
    showPanel(panel: HTMLElement): void;
    // Shows the content. A zooming frame needs its size at 100% and lays it out at the scale it shows;
    // the element fills the layer, so give it width and height 100% or size its parts from --preview-scale.
    setContent(element: HTMLElement, size?: Size): void;
    // Tells a zooming frame its content changed size, keeping the scale.
    updateContentSize(size: Size): void;
    // Fills the Info panel; null shows that the details are still being read.
    setMetadata(groups: ReadonlyArray<MetadataGroup> | null): void;
    setActions(actions: ReadonlyArray<HTMLElement>): void;
    // A line above the content, such as a warning that only the sound can play; null removes it.
    setNote(text: string | null): void;
    // A bar of the viewer's own inputs under the toolbar, such as a font's sample text and axis sliders; null removes it.
    setControls(controls: HTMLElement | null): void;
    getScale(): number;
    zoomIn(): void;
    zoomOut(): void;
    reset(): void;
    // Shows one whole page through the zoom menu's Fit page; does nothing without a zoom menu.
    fitPage(): void;
    getZoomMode(): ZoomMode;
    zoomTo(scale: number, anchor?: Point): void;
    // Scrolls a content point (in 100% pixels) into view, smoothly unless reduced motion is asked for.
    scrollContentTo(point: Point, options?: { readonly smooth?: boolean; readonly align?: 'start' | 'center' }): void;
    destroy(): void;
}

export interface PreviewMemory {
    scale?: number;
    scroll?: Point;
    // A tab left at Fit page comes back at Fit page, fitted to the window as it is then.
    mode?: 'fit-page';
}

// Zoom and scroll of each open preview, so leaving its tab and coming back restores them.
const previewMemories = new Map<string, PreviewMemory>();

export function previewMemoryFor(key: string): PreviewMemory {
    let memory = previewMemories.get(key);

    if (memory == null) {
        memory = {};
        previewMemories.set(key, memory);
    }

    return memory;
}

// Forgets the previews whose tabs closed.
export function prunePreviewMemories(openKeys: ReadonlyArray<string>): void {
    const keep = new Set(openKeys);

    for (const key of [...previewMemories.keys()]) {
        if (!keep.has(key)) {
            previewMemories.delete(key);
        }
    }
}

// Typing in a box, such as a font preview's sample text, never zooms or pans.
export function isTextEntry(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') != null);
}

const ZOOM_KEYS: Readonly<Record<string, 'in' | 'out' | 'reset'>> = Object.freeze({
    '+': 'in',
    '=': 'in',
    '-': 'out',
    '_': 'out',
    '0': 'reset',
});

// The shared frame of every file preview: a toolbar with zoom, the viewer's actions and Info,
// a scrolling content area, and the Info panel beside it (below it on narrow screens).
export function createPreviewFrame(options: PreviewFrameOptions): PreviewFrame {
    const memory = previewMemoryFor(options.memoryKey);
    let contentSize: Size | null = null;
    let isOpen = readInfoPanelOpen();
    let isMessageShown = false;
    let hasControls = false;
    let shownMode: ZoomMode = 'fit';
    // While new content is put in place the mode passes through Reset's fit, which is neither told nor remembered.
    let isPlacingContent = false;

    const zoomLevel = h('output', { class: 'preview-zoom-level', text: '100%', aria: { label: 'Zoom level' } });
    const zoomMenu: ZoomMenu | null = options.zoomMenu == null ? null : createZoomMenu({ entries: () => zoomMenuEntries() });
    const zoomButton = (action: string, text: string, label: string, title: string): HTMLButtonElement => h('button', {
        class: 'button preview-zoom-button',
        text,
        dataset: { action },
        attrs: { type: 'button', title, 'aria-label': label, disabled: true },
    });
    const zoomOutButton = zoomButton('zoom-out', '−', 'Zoom out', 'Zoom out (−)');
    const zoomInButton = zoomButton('zoom-in', '+', 'Zoom in', 'Zoom in (+)');
    const resetButton = h('button', {
        class: 'button',
        text: 'Reset',
        dataset: { action: 'zoom-reset' },
        attrs: { type: 'button', title: options.fitMode === 'width' ? 'Fit to the width (0)' : 'Fit to the window (0)', disabled: true },
    });
    const zoomGroup = options.zoom
        ? h('div', {
            class: 'toolbar-group preview-zoom',
            attrs: { role: 'group', 'aria-label': 'Zoom' },
            children: [zoomOutButton, zoomMenu?.element ?? zoomLevel, zoomInButton, resetButton],
        })
        : null;
    const actionsGroup = h('div', { class: 'toolbar-group preview-actions', children: options.actions ?? [] });
    const infoButton = h('button', {
        class: 'button',
        text: 'Info',
        dataset: { action: 'info' },
        attrs: { type: 'button', title: 'Show or hide the file details', 'aria-pressed': String(isOpen) },
    });
    const toolbar = h('div', {
        class: 'editor-toolbar preview-toolbar',
        attrs: { role: 'toolbar', 'aria-label': `${options.typeLabel} preview` },
        children: [
            h('div', { class: 'toolbar-group', children: [h('span', { class: 'badge', text: options.typeLabel })] }),
            zoomGroup,
            actionsGroup,
            h('span', { class: 'toolbar-spacer' }),
            h('div', { class: 'toolbar-group', children: [infoButton, h('span', { class: 'badge', text: 'View only' })] }),
        ],
    });

    const layer = h('div', { class: 'preview-layer' });
    const area = h('div', { class: 'preview-area', children: [layer] });
    const viewport = h('div', {
        class: 'preview-viewport',
        dataset: { mode: options.zoom ? 'zoom' : 'static' },
        attrs: { tabindex: '0', role: 'region', 'aria-label': options.label ?? `${options.typeLabel} preview` },
    });
    const status = h('div', { class: 'preview-status', attrs: { hidden: true } });
    const note = h('div', { class: 'editor-note preview-note', attrs: { role: 'note', hidden: true } });
    const controlsBar = h('div', { class: 'preview-controls', attrs: { hidden: true } });
    const stage = h('div', { class: 'preview-stage', children: [viewport, status] });
    const info = h('aside', { class: 'preview-info', attrs: { 'aria-label': 'File details' } });
    const body = h('div', { class: 'preview-body', children: [stage, info] });
    // A click on a part that can't take the focus, such as a message, a badge or Info, focuses the frame,
    // so the keys that follow reach its handlers rather than the browser's.
    const element = h('div', {
        class: 'preview-frame',
        attrs: { tabindex: '-1' },
        children: [toolbar, controlsBar, note, body],
    });

    const setZoomEnabled = (isEnabled: boolean): void => {
        for (const button of [zoomOutButton, zoomInButton, resetButton]) {
            button.disabled = !isEnabled;
        }

        zoomMenu?.setEnabled(isEnabled);
    };

    // The zoom, the viewer's actions and its controls act on the content, so they hide while a message replaces it;
    // the type badge, Info and View only stay.
    const showContentTools = (): void => {
        if (zoomGroup != null) {
            zoomGroup.hidden = isMessageShown;
        }

        actionsGroup.hidden = isMessageShown;
        controlsBar.hidden = isMessageShown || !hasControls;
    };

    const showInfo = (open: boolean): void => {
        isOpen = open;
        element.dataset['infoOpen'] = String(open);
        info.hidden = !open;
        infoButton.setAttribute('aria-pressed', String(open));
        infoButton.dataset['active'] = String(open);
    };

    const controller: ZoomController | null = options.zoom
        ? createZoomController({
            viewport,
            area,
            layer,
            wheelZoom: options.wheelZoom ?? 'ctrl-wheel',
            fitMode: options.fitMode ?? 'contain',
            allowUpscaleOnFit: options.allowUpscaleOnFit ?? false,
            dragToPan: options.dragToPan ?? true,
            clock: options.clock,
            prefersReducedMotion: options.prefersReducedMotion,
            onScaleChange: (scale) => {
                showZoomLevel(scale);
            },
            onSettled: (scale) => {
                rememberZoom();
                options.onZoomSettled?.(scale);
            },
            onScroll: (scroll) => {
                if (controller?.isFitted() === false && !controller.hasViewerFit()) {
                    memory.scroll = scroll;
                }
            },
        })
        : null;

    const zoomMode = (): ZoomMode => {
        if (controller?.hasViewerFit() === true) {
            return 'fit-page';
        }

        return controller?.isFitted() === false ? 'scale' : 'fit';
    };

    const fitLabel = options.fitMode === 'width' ? 'Fit width' : 'Fit window';

    // The menu's button names a fit, and its tooltip gives the scale it comes to.
    const showZoomLevel = (scale: number): void => {
        const percent = formatZoomPercent(scale);

        if (zoomMenu == null) {
            zoomLevel.textContent = percent;
        }
        else {
            const labels: Readonly<Record<ZoomMode, string>> = { 'fit': fitLabel, 'fit-page': 'Fit page', 'scale': percent };
            zoomMenu.setLabel(labels[zoomMode()], `Zoom ${percent}`);
        }

        if (!isPlacingContent) {
            followMode();
        }
    };

    const followMode = (): void => {
        const mode = zoomMode();

        if (mode === shownMode) {
            return;
        }

        shownMode = mode;
        rememberZoom();
        options.onZoomModeChange?.(mode);
    };

    // A fitted preview is not remembered, so coming back fits it to the window as it is then.
    const rememberZoom = (): void => {
        if (controller?.hasViewerFit() === true) {
            memory.mode = 'fit-page';
            delete memory.scale;
            delete memory.scroll;

            return;
        }

        delete memory.mode;

        if (controller == null || controller.isFitted()) {
            delete memory.scale;
            delete memory.scroll;

            return;
        }

        memory.scale = controller.getScale();
        memory.scroll = controller.getScroll();
    };

    const fitPage = (): void => {
        if (controller == null || contentSize == null || options.zoomMenu == null) {
            return;
        }

        controller.fitTo(options.zoomMenu.fitPage);
        followMode();
    };

    const zoomToScale = (scale: number): void => {
        if (contentSize != null) {
            controller?.zoomTo(scale);
            followMode();
        }
    };

    // Fit page, Reset's fit and Actual size, then the fixed zooms; a zoom elsewhere checks none of them.
    const zoomMenuEntries = (): ZoomMenuEntry[] => {
        const mode = zoomMode();
        const scale = controller?.getScale() ?? 1;
        const isAt = (step: number): boolean => mode === 'scale' && Math.abs(scale - step) < 0.0005;
        const steps = (options.zoomMenu?.steps ?? []).map((step) => ({
            label: formatZoomPercent(step),
            action: `zoom-${Math.round(step * 100)}`,
            isChecked: isAt(step),
            onSelect: () => zoomToScale(step),
        }));

        return [
            { label: 'Fit page', action: 'zoom-fit-page', isChecked: mode === 'fit-page', onSelect: fitPage },
            { label: fitLabel, action: 'zoom-fit', isChecked: mode === 'fit', onSelect: () => runZoom('reset') },
            { label: 'Actual size', action: 'zoom-actual-size', isChecked: isAt(1), onSelect: () => zoomToScale(1) },
            null,
            ...steps,
        ];
    };

    const runZoom = (action: 'in' | 'out' | 'reset'): void => {
        if (controller == null || contentSize == null) {
            return;
        }

        if (action === 'in') {
            controller.zoomIn();
        }

        if (action === 'out') {
            controller.zoomOut();
        }

        if (action === 'reset') {
            controller.reset();
        }

        followMode();
    };

    zoomOutButton.addEventListener('click', () => runZoom('out'));
    zoomInButton.addEventListener('click', () => runZoom('in'));
    resetButton.addEventListener('click', () => runZoom('reset'));
    infoButton.addEventListener('click', () => {
        showInfo(!isOpen);
        writeInfoPanelOpen(isOpen);
    });

    // Anywhere in a preview, Ctrl with +, - or 0 never zooms the browser page: it zooms the content of a preview that zooms,
    // when there is content. Ctrl+F never opens the browser's find bar; a viewer's Find box, when it shows one, takes it.
    element.addEventListener('keydown', (event) => {
        if (event.altKey) {
            return;
        }

        if (event.ctrlKey || event.metaKey) {
            const selection = window.getSelection()?.toString() ?? '';
            const zoomAction = ZOOM_KEYS[event.key];
            const letter = shortcutLetter(event);

            if (letter === 'c' && options.onCopy != null && viewport.contains(event.target as Node) && selection === '') {
                event.preventDefault();
                options.onCopy();
            }

            if (letter === 'f') {
                event.preventDefault();
            }

            if (zoomAction != null) {
                event.preventDefault();
                runZoom(zoomAction);
            }

            return;
        }

        const action = ZOOM_KEYS[event.key];

        if (action == null || controller == null || contentSize == null || isTextEntry(event.target)) {
            return;
        }

        event.preventDefault();
        runZoom(action);
    });

    // Ctrl+wheel anywhere in a preview never zooms the browser page, a message or a preview that doesn't zoom included;
    // over the content of a preview that zooms, the zoom controller zooms it.
    element.addEventListener('wheel', (event) => {
        if (event.ctrlKey) {
            event.preventDefault();
        }
    }, { passive: false });

    // A resize or the Info panel opening changes the room for the content. The border box is watched,
    // so scroll bars that a zoom brings or takes away never move the content.
    const stopObserving = observeResize(viewport, () => controller?.relayout(), {
        box: 'border-box',
        frames: options.clock ?? BROWSER_CLOCK,
    });

    showInfo(isOpen);
    renderInfoPanel(info, null);

    // Shows content of a new size, at Fit page when `fitsPage`, otherwise fitted or at `restore`.
    const placeContent = (size: Size, restore: ZoomRestore | null, fitsPage: boolean): void => {
        isPlacingContent = true;
        controller?.setContentSize(size, restore);

        if (fitsPage && options.zoomMenu != null) {
            controller?.fitTo(options.zoomMenu.fitPage, { animate: false });
        }

        isPlacingContent = false;
        showZoomLevel(controller?.getScale() ?? 1);
    };

    const showStatus = (content: ReadonlyArray<HTMLElement>): void => {
        clear(status);
        status.append(...content);
        status.hidden = false;
    };

    const showInPlaceOfContent = (children: ReadonlyArray<HTMLElement>, state: 'message' | 'panel'): void => {
        contentSize = null;
        setZoomEnabled(false);
        clear(layer);
        clear(viewport);
        viewport.append(area);
        showStatus(children);
        element.dataset['state'] = state;
        isMessageShown = true;
        showContentTools();
    };

    return {
        element,
        viewport,
        showLoading: (message = 'Loading…') => {
            showStatus([h('p', { class: 'preview-status-text', text: message })]);
            element.dataset['state'] = 'loading';
        },
        showMessage: (title, message) => showInPlaceOfContent([h('h2', { text: title }), h('p', { text: message })], 'message'),
        showPanel: (panel) => showInPlaceOfContent([panel], 'panel'),
        setContent: (content, size) => {
            status.hidden = true;
            element.dataset['state'] = 'ready';
            isMessageShown = false;
            showContentTools();

            if (controller == null || size == null) {
                // Content shown already stays put, so a playing video is never taken out of the page.
                if (viewport.childElementCount !== 1 || viewport.firstElementChild !== content) {
                    clear(viewport);
                    viewport.append(content);
                }

                return;
            }

            clear(viewport);
            clear(layer);
            layer.append(content);
            viewport.append(area);
            contentSize = size;
            setZoomEnabled(true);
            const fitsPage = memory.mode === 'fit-page' && options.zoomMenu != null;
            const restore = memory.scale == null || fitsPage ? null : { scale: memory.scale, scroll: memory.scroll ?? { x: 0, y: 0 } };
            placeContent(size, restore, fitsPage);
        },
        updateContentSize: (size) => {
            if (controller == null || contentSize == null) {
                return;
            }

            contentSize = size;
            isPlacingContent = true;
            controller.resizeContent(size);
            isPlacingContent = false;
            showZoomLevel(controller.getScale());
        },
        setMetadata: (groups) => renderInfoPanel(info, groups),
        setActions: (actions) => {
            clear(actionsGroup);
            actionsGroup.append(...actions);
        },
        setNote: (text) => {
            note.textContent = text ?? '';
            note.hidden = text == null;
        },
        setControls: (controls) => {
            clear(controlsBar);

            if (controls != null) {
                controlsBar.append(controls);
            }

            hasControls = controls != null;
            showContentTools();
        },
        getScale: () => controller?.getScale() ?? 1,
        zoomIn: () => runZoom('in'),
        zoomOut: () => runZoom('out'),
        reset: () => runZoom('reset'),
        fitPage,
        getZoomMode: zoomMode,
        zoomTo: (scale, anchor) => {
            if (contentSize != null) {
                controller?.zoomTo(scale, anchor);
                followMode();
            }
        },
        scrollContentTo: (point, scrollOptions) => controller?.scrollContentTo(point, scrollOptions),
        destroy: () => {
            controller?.destroy();
            zoomMenu?.destroy();
            stopObserving();
        },
    };
}
