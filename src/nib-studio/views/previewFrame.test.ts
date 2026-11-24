import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAnimationClock, setClientSize, type FakeAnimationClock } from '../testing/fakeAnimationClock.js';
import { createPreviewFrame, previewMemoryFor, prunePreviewMemories, type PreviewFrame, type PreviewFrameOptions } from './previewFrame.js';

let frames: PreviewFrame[] = [];
let time: FakeAnimationClock;

function mount(overrides: Partial<PreviewFrameOptions> = {}): PreviewFrame {
    const frame = createPreviewFrame({
        memoryKey: 'media/photo.png',
        typeLabel: 'Image',
        zoom: true,
        wheelZoom: 'wheel',
        clock: time.clock,
        prefersReducedMotion: () => false,
        ...overrides,
    });
    document.body.append(frame.element);
    setClientSize(frame.viewport, 800, 600);
    frames.push(frame);

    return frame;
}

function content(): HTMLElement {
    return document.createElement('canvas');
}

function button(frame: PreviewFrame, action: string): HTMLButtonElement {
    const found = frame.element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);

    if (found == null) {
        throw new Error(`No ${action} button`);
    }

    return found;
}

function zoomLabel(frame: PreviewFrame): string | null {
    return frame.element.querySelector('.preview-zoom-level')?.textContent ?? null;
}

// The toolbar's badges, buttons and zoom level that show, leaving out those inside a hidden group.
function visibleToolbarItems(frame: PreviewFrame): string[] {
    return [...frame.element.querySelectorAll<HTMLElement>('.preview-toolbar :is(.badge, button, output)')]
        .filter((item) => item.closest('[hidden]') == null)
        .map((item) => item.textContent ?? '');
}

function controlsBar(frame: PreviewFrame): HTMLElement {
    return frame.element.querySelector('.preview-controls') as HTMLElement;
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);

    return event;
}

beforeEach(() => {
    localStorage.clear();
    frames = [];
    time = createFakeAnimationClock();
    prunePreviewMemories([]);
});

afterEach(() => {
    for (const frame of frames) {
        frame.destroy();
        frame.element.remove();
    }
});

describe('createPreviewFrame toolbar', () => {
    it('shows the type badge, the zoom controls, the actions, Info and View only', () => {
        const copy = document.createElement('button');
        copy.textContent = 'Copy image';
        const frame = mount({ actions: [copy] });
        const toolbar = frame.element.querySelector('.preview-toolbar');

        expect([...toolbar?.querySelectorAll('.badge') ?? []].map((badge) => badge.textContent)).toEqual(['Image', 'View only']);
        expect([...toolbar?.querySelectorAll('button') ?? []].map((item) => item.textContent)).toEqual(['−', '+', 'Reset', 'Copy image', 'Info']);
        expect(button(frame, 'zoom-in').getAttribute('aria-label')).toBe('Zoom in');
        expect(zoomLabel(frame)).toBe('100%');
    });

    it('says what Reset fits: the window for pictures, the width for documents', () => {
        expect(button(mount(), 'zoom-reset').title).toBe('Fit to the window (0)');
        expect(button(mount({ fitMode: 'width' }), 'zoom-reset').title).toBe('Fit to the width (0)');
    });

    it('keeps the zoom controls off until there is content', () => {
        const frame = mount();

        expect(button(frame, 'zoom-in').disabled).toBe(true);
        frame.setContent(content(), { width: 400, height: 300 });
        expect(button(frame, 'zoom-in').disabled).toBe(false);
        expect(frame.element.dataset['state']).toBe('ready');
    });

    it('has only Info for content that does not zoom, which shows as it is', () => {
        const frame = mount({ zoom: false, typeLabel: 'Audio' });
        const audio = document.createElement('audio');
        frame.setContent(audio);

        expect([...frame.element.querySelectorAll('.preview-toolbar button')].map((item) => item.textContent)).toEqual(['Info']);
        expect(frame.viewport.firstElementChild).toBe(audio);
        expect(frame.viewport.dataset['mode']).toBe('static');
    });

    it('takes the focus for a click on a part that can\'t take it, such as a message or a badge, so its keys stay the preview\'s', () => {
        const frame = mount({ zoom: false, typeLabel: 'Archive' });

        expect(frame.element.getAttribute('tabindex')).toBe('-1');
        expect(frame.viewport.getAttribute('tabindex')).toBe('0');
    });

    it('swaps the actions', () => {
        const frame = mount();
        const action = document.createElement('button');
        action.textContent = 'Copy text';
        frame.setActions([action]);

        expect(frame.element.querySelector('.preview-actions')?.textContent).toBe('Copy text');
    });
});

describe('createPreviewFrame zoom', () => {
    it('zooms with the buttons, animated, and fits again with Reset', () => {
        const settled = vi.fn();
        const frame = mount({ onZoomSettled: settled });
        frame.setContent(content(), { width: 400, height: 300 });
        button(frame, 'zoom-in').click();
        time.advance(400);

        expect(zoomLabel(frame)).toBe('110%');
        expect(settled).toHaveBeenCalledWith(frame.getScale());

        button(frame, 'zoom-out').click();
        button(frame, 'zoom-out').click();
        time.advance(400);
        expect(zoomLabel(frame)).toBe('90%');

        button(frame, 'zoom-reset').click();
        time.advance(400);
        expect(zoomLabel(frame)).toBe('100%');
    });

    it('takes +, - and 0 while the preview has focus, and leaves Alt keys alone', () => {
        const frame = mount();
        frame.setContent(content(), { width: 400, height: 300 });

        expect(press(frame.viewport, '+').defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('110%');

        press(frame.viewport, '=');
        time.advance(400);
        expect(zoomLabel(frame)).toBe('125%');

        press(frame.viewport, '-');
        time.advance(400);
        expect(zoomLabel(frame)).toBe('110%');

        press(frame.viewport, '0');
        time.advance(400);
        expect(zoomLabel(frame)).toBe('100%');

        expect(press(frame.viewport, '+', { altKey: true }).defaultPrevented).toBe(false);
        expect(press(frame.viewport, 'x').defaultPrevented).toBe(false);
    });

    it('zooms the content with Ctrl and +, - or 0 anywhere in the frame, never the browser page', () => {
        const frame = mount({ wheelZoom: 'ctrl-wheel' });
        frame.setContent(content(), { width: 400, height: 300 });
        const toolbar = frame.element.querySelector<HTMLElement>('.preview-toolbar')!;
        const input = document.createElement('input');
        toolbar.append(input);

        expect(press(frame.viewport, '=', { ctrlKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('110%');

        expect(press(toolbar, '+', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('125%');

        expect(press(input, '-', { ctrlKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('110%');

        expect(press(frame.viewport, '0', { metaKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('100%');

        expect(press(frame.viewport, '+', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    });

    it('keeps Ctrl with +, - or 0 from the browser page before there is content, and in a frame that doesn\'t zoom', () => {
        const zooming = mount();
        const still = mount({ zoom: false, typeLabel: 'Audio' });
        still.setContent(content());

        for (const key of ['=', '+', '-', '0']) {
            expect(press(zooming.viewport, key, { ctrlKey: true }).defaultPrevented, key).toBe(true);
            expect(press(still.viewport, key, { ctrlKey: true }).defaultPrevented, key).toBe(true);
            expect(press(still.element.querySelector<HTMLElement>('.preview-toolbar')!, key, { metaKey: true }).defaultPrevented, key).toBe(true);
        }
    });

    it('keeps Ctrl with +, - or 0 from the browser page while a message or a panel shows, without zooming', () => {
        const frame = mount({ wheelZoom: 'ctrl-wheel' });
        frame.setContent(content(), { width: 400, height: 300 });
        frame.showMessage('Can\'t show it', 'Why not.');
        const status = frame.element.querySelector<HTMLElement>('.preview-status')!;

        expect(press(status, '=', { ctrlKey: true }).defaultPrevented).toBe(true);
        frame.showPanel(document.createElement('form'));
        expect(press(status, '-', { ctrlKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('100%');
    });

    it('keeps Ctrl+F from the browser\'s find bar anywhere in a frame, with or without zoom, and while a message or panel shows', () => {
        const zooming = mount();
        const still = mount({ zoom: false, typeLabel: 'Archive' });
        still.showMessage('This archive has no preview', 'Open it with an archive tool.');

        expect(press(zooming.viewport, 'f', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(press(zooming.element.querySelector<HTMLElement>('.preview-toolbar')!, 'F', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
        expect(press(still.element.querySelector<HTMLElement>('.preview-status')!, 'f', { metaKey: true }).defaultPrevented).toBe(true);

        const form = document.createElement('form');
        const input = document.createElement('input');
        form.append(input);
        zooming.showPanel(form);

        expect(press(input, 'f', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(press(input, 'f').defaultPrevented).toBe(false);
        expect(press(zooming.viewport, 'f', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    });

    it('keeps Ctrl+wheel over the toolbar and the Info panel from zooming the page, and zooms only over the content', () => {
        const frame = mount({ wheelZoom: 'ctrl-wheel' });
        frame.setContent(content(), { width: 400, height: 300 });
        const wheel = (target: Element, init: WheelEventInit): WheelEvent => {
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
            Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
            target.dispatchEvent(event);

            return event;
        };

        expect(wheel(frame.element.querySelector('.preview-toolbar')!, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
        expect(wheel(frame.element.querySelector('.preview-info')!, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).toBe('100%');

        expect(wheel(frame.element.querySelector('.preview-info')!, { deltaY: 100 }).defaultPrevented).toBe(false);
        expect(wheel(frame.viewport, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(frame)).not.toBe('100%');
    });

    it('keeps Ctrl+wheel from zooming the page over a frame that doesn\'t zoom, and over a message, without zooming', () => {
        const wheel = (target: Element): WheelEvent => {
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
            Object.defineProperty(event, 'ctrlKey', { value: true });
            target.dispatchEvent(event);

            return event;
        };
        const still = mount({ zoom: false, typeLabel: 'Video' });
        still.setContent(content());
        const zooming = mount({ wheelZoom: 'ctrl-wheel' });
        zooming.setContent(content(), { width: 400, height: 300 });
        zooming.showMessage('Can\'t show it', 'Why not.');

        expect(wheel(still.viewport).defaultPrevented).toBe(true);
        expect(wheel(still.element.querySelector('.preview-toolbar')!).defaultPrevented).toBe(true);
        expect(wheel(zooming.element.querySelector('.preview-status')!).defaultPrevented).toBe(true);
        time.advance(400);
        expect(zoomLabel(zooming)).toBe('100%');
    });

    it('never zooms while typing in a box inside the frame', () => {
        const frame = mount();
        frame.setContent(content(), { width: 400, height: 300 });
        const input = document.createElement('input');
        frame.element.querySelector('.preview-toolbar')?.append(input);

        expect(press(input, '+').defaultPrevented).toBe(false);
        expect(press(input, '0').defaultPrevented).toBe(false);
    });

    it('ignores zoom keys and buttons before there is content', () => {
        const frame = mount();

        expect(press(frame.viewport, '+').defaultPrevented).toBe(false);
        frame.zoomIn();
        time.advance(400);
        expect(zoomLabel(frame)).toBe('100%');
    });

    it('copies with Ctrl+C in the content, unless text is selected', () => {
        const onCopy = vi.fn();
        const frame = mount({ onCopy });
        frame.setContent(content(), { width: 400, height: 300 });

        expect(press(frame.viewport, 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(onCopy).toHaveBeenCalledTimes(1);

        press(frame.element.querySelector('.preview-info') as HTMLElement, 'c', { ctrlKey: true });
        expect(onCopy).toHaveBeenCalledTimes(1);

        const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Name' } as Selection);

        try {
            expect(press(frame.viewport, 'C', { metaKey: true }).defaultPrevented).toBe(false);
            expect(onCopy).toHaveBeenCalledTimes(1);
        }
        finally {
            selection.mockRestore();
        }
    });
});

describe('createPreviewFrame resizing', () => {
    interface FakeResizeEntry {
        readonly contentRect: { readonly width: number; readonly height: number };
        readonly borderBoxSize?: ReadonlyArray<{ readonly inlineSize: number; readonly blockSize: number }>;
    }

    class FakeResizeObserver {
        static latest: FakeResizeObserver | null = null;

        box: string | null = null;
        disconnected = false;

        constructor(readonly callback: (entries: ReadonlyArray<FakeResizeEntry>) => void) {
            FakeResizeObserver.latest = this;
        }

        observe(_target: Element, options?: { readonly box?: string }): void {
            this.box = options?.box ?? null;
        }

        disconnect(): void {
            this.disconnected = true;
        }

        report(width: number, height: number, border?: { readonly width: number; readonly height: number }): void {
            const borderBoxSize = border == null ? undefined : [{ inlineSize: border.width, blockSize: border.height }];
            this.callback([{ contentRect: { width, height }, borderBoxSize }]);
        }
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lays out again once per frame for a new size, and skips a size it already handled', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const settled = vi.fn();
        const frame = mount({ onZoomSettled: settled });
        frame.setContent(content(), { width: 1600, height: 1200 });
        const observer = FakeResizeObserver.latest as FakeResizeObserver;
        observer.report(800, 600);
        time.advance(16);
        settled.mockClear();

        observer.report(800, 600);
        time.advance(16);
        expect(settled).not.toHaveBeenCalled();

        setClientSize(frame.viewport, 400, 300);
        observer.report(400, 300);
        observer.report(400, 300);
        observer.report(400, 300);
        expect(zoomLabel(frame)).toBe('47%');
        time.advance(16);

        expect(settled).toHaveBeenCalledTimes(1);
        expect(zoomLabel(frame)).toBe('22%');
    });

    it('watches the border box, so scroll bars that a zoom brings or takes away never move the content', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const settled = vi.fn();
        const frame = mount({ onZoomSettled: settled });
        frame.setContent(content(), { width: 1600, height: 1200 });
        const observer = FakeResizeObserver.latest as FakeResizeObserver;
        observer.report(800, 600, { width: 800, height: 600 });
        time.advance(16);
        settled.mockClear();

        setClientSize(frame.viewport, 783, 583);
        observer.report(783, 583, { width: 800, height: 600 });
        time.advance(16);

        expect(observer.box).toBe('border-box');
        expect(settled).not.toHaveBeenCalled();
    });

    it('stops observing once destroyed', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const frame = mount();
        frame.destroy();

        expect(FakeResizeObserver.latest?.disconnected).toBe(true);
    });
});

describe('createPreviewFrame memory', () => {
    it('remembers a chosen zoom for the tab and restores it in a new frame', () => {
        const first = mount();
        first.setContent(content(), { width: 1600, height: 1200 });
        first.zoomTo(2);
        time.advance(400);

        expect(previewMemoryFor('media/photo.png').scale).toBe(2);
        first.destroy();

        const second = mount();
        second.setContent(content(), { width: 1600, height: 1200 });

        expect(second.getScale()).toBe(2);
        expect(zoomLabel(second)).toBe('200%');
    });

    it('forgets the zoom of a fitted preview, so it fits the window when it comes back', () => {
        const frame = mount();
        frame.setContent(content(), { width: 1600, height: 1200 });
        frame.zoomTo(2);
        time.advance(400);
        frame.reset();
        time.advance(400);

        expect(previewMemoryFor('media/photo.png').scale).toBeUndefined();
    });

    it('forgets the previews of closed tabs', () => {
        previewMemoryFor('a.png').scale = 3;
        previewMemoryFor('b.png').scale = 2;
        prunePreviewMemories(['b.png']);

        expect(previewMemoryFor('a.png').scale).toBeUndefined();
        expect(previewMemoryFor('b.png').scale).toBe(2);
    });

    it('keeps the zoom when the content changes size', () => {
        const frame = mount();
        frame.setContent(content(), { width: 1600, height: 1200 });
        frame.zoomTo(2);
        time.advance(400);
        frame.updateContentSize({ width: 1600, height: 2400 });

        expect(frame.getScale()).toBe(2);
    });
});

describe('createPreviewFrame Info panel and messages', () => {
    it('toggles the Info panel and remembers it for every preview', () => {
        const frame = mount();
        const info = frame.element.querySelector<HTMLElement>('.preview-info');

        expect(info?.hidden).toBe(true);
        expect(button(frame, 'info').getAttribute('aria-pressed')).toBe('false');

        button(frame, 'info').click();

        expect(info?.hidden).toBe(false);
        expect(frame.element.dataset['infoOpen']).toBe('true');
        expect(button(frame, 'info').dataset['active']).toBe('true');
        expect(localStorage.getItem('nib-studio/preview-info-open')).toBe('true');
        expect(mount().element.querySelector<HTMLElement>('.preview-info')?.hidden).toBe(false);
    });

    it('shows the details, and that they are being read', () => {
        const frame = mount();

        expect(frame.element.querySelector('.preview-info')?.textContent).toBe('Reading details…');
        frame.setMetadata([{ title: 'File', rows: [{ label: 'Name', value: 'photo.png' }] }]);
        expect(frame.element.querySelector('.preview-info-value')?.textContent).toBe('photo.png');
    });

    it('shows loading, then a message that turns zoom off', () => {
        const frame = mount();
        frame.showLoading('Opening the image…');
        const status = frame.element.querySelector<HTMLElement>('.preview-status');

        expect(status?.hidden).toBe(false);
        expect(status?.textContent).toBe('Opening the image…');
        expect(frame.element.dataset['state']).toBe('loading');

        frame.setContent(content(), { width: 10, height: 10 });
        expect(status?.hidden).toBe(true);

        frame.showMessage('This image can\'t be shown', 'The file is damaged.');
        expect(status?.querySelector('h2')?.textContent).toBe('This image can\'t be shown');
        expect(frame.element.dataset['state']).toBe('message');
        expect(button(frame, 'zoom-in').disabled).toBe(true);
        expect(frame.element.querySelector('.preview-layer')?.childElementCount).toBe(0);
    });

    it('hides the zoom controls, the actions and the controls bar while a message shows, keeping the badges and Info', () => {
        const copy = document.createElement('button');
        copy.textContent = 'Copy image';
        const frame = mount({ actions: [copy] });
        frame.setControls(document.createElement('input'));
        frame.setContent(content(), { width: 10, height: 10 });

        expect(visibleToolbarItems(frame)).toEqual(['Image', '−', '100%', '+', 'Reset', 'Copy image', 'Info', 'View only']);
        expect(controlsBar(frame).hidden).toBe(false);

        frame.showMessage('This image can\'t be shown', 'The file is damaged.');

        expect(visibleToolbarItems(frame)).toEqual(['Image', 'Info', 'View only']);
        expect(controlsBar(frame).hidden).toBe(true);
    });

    it('keeps them hidden through new actions, new controls and loading, and brings them back with content', () => {
        const frame = mount();
        frame.showMessage('This document can\'t be shown', 'It is damaged.');
        const action = document.createElement('button');
        action.textContent = 'Copy text';
        frame.setActions([action]);
        frame.setControls(document.createElement('input'));
        frame.showLoading();

        expect(visibleToolbarItems(frame)).toEqual(['Image', 'Info', 'View only']);
        expect(controlsBar(frame).hidden).toBe(true);

        frame.setContent(content(), { width: 10, height: 10 });

        expect(visibleToolbarItems(frame)).toEqual(['Image', '−', '100%', '+', 'Reset', 'Copy text', 'Info', 'View only']);
        expect(controlsBar(frame).hidden).toBe(false);
    });

    it('brings back the actions, but not a controls bar the viewer never set, for content that does not zoom', () => {
        const frame = mount({ zoom: false, typeLabel: 'Archive' });
        frame.showMessage('This archive can\'t be shown', 'Open it with an archive tool.');

        expect(visibleToolbarItems(frame)).toEqual(['Archive', 'Info', 'View only']);

        frame.setContent(document.createElement('form'));

        expect(frame.element.querySelector<HTMLElement>('.preview-actions')?.hidden).toBe(false);
        expect(controlsBar(frame).hidden).toBe(true);
    });

    it('shows and removes a note', () => {
        const frame = mount();
        const note = frame.element.querySelector<HTMLElement>('.preview-note');
        frame.setNote('No picture.');

        expect(note?.hidden).toBe(false);
        expect(note?.textContent).toBe('No picture.');
        frame.setNote(null);
        expect(note?.hidden).toBe(true);
    });

    it('stops zooming once destroyed', () => {
        const frame = mount();
        frame.setContent(content(), { width: 400, height: 300 });
        frame.destroy();
        const event = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
        frame.viewport.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });
});

describe('createPreviewFrame panels', () => {
    it('shows a panel of the viewer’s own in place of the content, with the zoom, actions and controls hidden', () => {
        const action = document.createElement('button');
        const frame = mount({ actions: [action] });
        frame.setControls(document.createElement('input'));
        frame.setContent(content(), { width: 1600, height: 1200 });
        const form = document.createElement('form');
        frame.showPanel(form);
        const isHidden = (element: Element | null): boolean => element?.closest('[hidden]') != null;

        expect(frame.element.dataset['state']).toBe('panel');
        expect(frame.element.querySelector('.preview-status')?.contains(form)).toBe(true);
        expect(isHidden(frame.element.querySelector('.preview-zoom'))).toBe(true);
        expect(isHidden(action)).toBe(true);
        expect(isHidden(frame.element.querySelector('.preview-controls'))).toBe(true);
        expect(button(frame, 'zoom-in').disabled).toBe(true);
        expect(frame.element.querySelector('.preview-layer')?.childElementCount).toBe(0);
        frame.setContent(content(), { width: 1600, height: 1200 });

        expect(isHidden(action) || isHidden(frame.element.querySelector('.preview-zoom'))).toBe(false);
        expect(frame.element.querySelector('.preview-status')?.hasAttribute('hidden')).toBe(true);
    });
});

describe('createPreviewFrame zoom menu', () => {
    const DOCUMENT = { width: 800, height: 3000 };
    const PAGE_FIT = { scale: 0.5, point: { x: 400, y: 1500 } };

    function menuFrame(overrides: Partial<PreviewFrameOptions> = {}): PreviewFrame {
        return mount({
            memoryKey: 'documents/report.pdf',
            typeLabel: 'PDF',
            wheelZoom: 'ctrl-wheel',
            fitMode: 'width',
            dragToPan: false,
            zoomMenu: { fitPage: () => PAGE_FIT, steps: [0.5, 2] },
            ...overrides,
        });
    }

    function menuItems(frame: PreviewFrame): HTMLButtonElement[] {
        return [...frame.element.querySelectorAll<HTMLButtonElement>('.preview-zoom-menu [role="menuitemradio"]')];
    }

    function choose(frame: PreviewFrame, action: string): void {
        button(frame, 'zoom-menu').click();
        button(frame, action).click();
        time.advance(400);
    }

    it('names the mode on the zoom button, with the scale in its tooltip', () => {
        const frame = menuFrame();
        frame.setContent(content(), DOCUMENT);

        expect(zoomLabel(frame)).toBe('Fit width');
        expect(button(frame, 'zoom-menu').title).toBe(`Zoom ${Math.round(((800 - 32) / 800) * 100)}%`);
        expect(visibleToolbarItems(frame)).toEqual(['PDF', '−', 'Fit width', '+', 'Reset', 'Info', 'View only']);
    });

    it('opens a menu of the fits, Actual size and the steps, the current one checked, and closes on a choice', () => {
        const frame = menuFrame();
        frame.setContent(content(), DOCUMENT);
        button(frame, 'zoom-menu').click();

        expect(button(frame, 'zoom-menu').getAttribute('aria-expanded')).toBe('true');
        expect(menuItems(frame).map((item) => `${item.textContent}:${item.getAttribute('aria-checked')}`)).toEqual([
            'Fit page:false', 'Fit width:true', 'Actual size:false', '50%:false', '200%:false',
        ]);
        button(frame, 'zoom-200').click();
        time.advance(400);

        expect(frame.element.querySelector('.preview-zoom-menu')?.hasAttribute('hidden')).toBe(true);
        expect(zoomLabel(frame)).toBe('200%');
        expect(frame.getZoomMode()).toBe('scale');
    });

    it('fits a page with Fit page, and tells the viewer when the mode changes', () => {
        const modes: string[] = [];
        const frame = menuFrame({ onZoomModeChange: (mode) => modes.push(mode) });
        frame.setContent(content(), DOCUMENT);
        choose(frame, 'zoom-fit-page');

        expect(zoomLabel(frame)).toBe('Fit page');
        expect(frame.getScale()).toBeCloseTo(0.5, 6);
        choose(frame, 'zoom-actual-size');

        expect(zoomLabel(frame)).toBe('100%');
        frame.reset();
        time.advance(400);

        expect(modes).toEqual(['fit-page', 'scale', 'fit']);
    });

    it('remembers Fit page for the tab and fits the page again in a new frame', () => {
        const first = menuFrame();
        first.setContent(content(), DOCUMENT);
        first.fitPage();
        time.advance(400);

        expect(previewMemoryFor('documents/report.pdf')).toEqual({ mode: 'fit-page' });
        first.destroy();
        const second = menuFrame();
        second.setContent(content(), DOCUMENT);

        expect(second.getZoomMode()).toBe('fit-page');
        expect(second.getScale()).toBeCloseTo(0.5, 6);
        second.zoomTo(2);
        time.advance(400);

        expect(previewMemoryFor('documents/report.pdf').mode).toBeUndefined();
    });

    it('keeps Fit page when the content changes size', () => {
        const frame = menuFrame();
        frame.setContent(content(), DOCUMENT);
        frame.fitPage();
        time.advance(400);
        frame.updateContentSize({ width: 800, height: 4000 });

        expect(frame.getZoomMode()).toBe('fit-page');
    });

    it('moves through the menu with the arrow keys and closes it with Escape, back on the button', () => {
        const frame = menuFrame();
        frame.setContent(content(), DOCUMENT);
        press(button(frame, 'zoom-menu'), 'ArrowDown');

        expect(document.activeElement).toBe(button(frame, 'zoom-fit'));
        press(document.activeElement as HTMLElement, 'ArrowDown');

        expect(document.activeElement).toBe(button(frame, 'zoom-actual-size'));
        press(document.activeElement as HTMLElement, 'ArrowUp');
        press(document.activeElement as HTMLElement, 'ArrowUp');
        press(document.activeElement as HTMLElement, 'ArrowUp');

        expect(document.activeElement).toBe(button(frame, 'zoom-200'));
        press(document.activeElement as HTMLElement, 'Escape');

        expect(frame.element.querySelector('.preview-zoom-menu')?.hasAttribute('hidden')).toBe(true);
        expect(document.activeElement).toBe(button(frame, 'zoom-menu'));
    });

    it('closes the menu with Escape after a click opened it, with the focus still on the button', () => {
        const frame = menuFrame();
        frame.setContent(content(), DOCUMENT);
        button(frame, 'zoom-menu').focus();
        button(frame, 'zoom-menu').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

        expect(document.activeElement).toBe(button(frame, 'zoom-menu'));
        const escape = press(button(frame, 'zoom-menu'), 'Escape');

        expect(escape.defaultPrevented).toBe(true);
        expect(frame.element.querySelector('.preview-zoom-menu')?.hasAttribute('hidden')).toBe(true);
        expect(press(button(frame, 'zoom-menu'), 'Escape').defaultPrevented).toBe(false);
    });

    it('closes the menu on a press outside it, and keeps the button off without content', () => {
        const frame = menuFrame();

        expect(button(frame, 'zoom-menu').disabled).toBe(true);
        frame.setContent(content(), DOCUMENT);
        button(frame, 'zoom-menu').click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        expect(frame.element.querySelector('.preview-zoom-menu')?.hasAttribute('hidden')).toBe(true);
    });

    it('leaves the zoom level as plain text for a frame without the menu', () => {
        const frame = mount();
        frame.setContent(content(), { width: 1600, height: 1200 });
        frame.fitPage();

        expect(frame.element.querySelector('.preview-zoom-level')?.tagName).toBe('OUTPUT');
        expect(frame.getZoomMode()).toBe('fit');
    });
});
