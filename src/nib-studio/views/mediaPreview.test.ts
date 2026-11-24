import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaMetadata, mountMediaPreview, type MediaKind } from './mediaPreview.js';
import type { PreviewHandle } from './previewHandle.js';

let host: HTMLElement;
let handles: PreviewHandle[];

function mount(file: File, kind: MediaKind): PreviewHandle {
    const handle = mountMediaPreview(host, { file, fileName: file.name, memoryKey: `media/${file.name}`, kind });
    handles.push(handle);

    return handle;
}

function media(): HTMLMediaElement {
    const element = host.querySelector<HTMLMediaElement>('.preview-media');

    if (element == null) {
        throw new Error('No media element');
    }

    return element;
}

// happy-dom plays nothing, so the element is given what the browser would read from the file.
function loadMetadata(element: HTMLMediaElement, values: { duration: number; videoWidth?: number; videoHeight?: number }): void {
    let duration = values.duration;
    Object.defineProperty(element, 'duration', { configurable: true, get: () => duration });
    Object.defineProperty(element, 'videoWidth', { configurable: true, get: () => values.videoWidth ?? 0 });
    Object.defineProperty(element, 'videoHeight', { configurable: true, get: () => values.videoHeight ?? 0 });
    element.dispatchEvent(new Event('loadedmetadata'));
    Object.defineProperty(element, 'setDuration', { configurable: true, value: (next: number) => { duration = next; } });
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

function frameState(): string | undefined {
    return host.querySelector<HTMLElement>('.preview-frame')?.dataset['state'];
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    handles = [];
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
    vi.restoreAllMocks();
});

describe('mountMediaPreview', () => {
    it('plays audio from a blob URL of the File with native controls, and lists its length', () => {
        mount(new File(['RIFF'], 'tone.wav', { type: 'audio/wav' }), 'audio');
        const element = media();

        expect(element.tagName).toBe('AUDIO');
        expect(element.hasAttribute('controls')).toBe(true);
        expect(element.getAttribute('preload')).toBe('metadata');
        expect(element.getAttribute('src')).toMatch(/^blob:/);
        expect(frameState()).toBe('loading');

        loadMetadata(element, { duration: 2.04 });

        expect(frameState()).toBe('ready');
        expect(rows()['File/Type']).toBe('WAV audio');
        expect(rows()['Audio/Duration']).toBe('0:02.0');
        expect([...host.querySelectorAll('.preview-toolbar .badge')].map((badge) => badge.textContent)).toEqual(['Audio', 'View only']);
        expect([...host.querySelectorAll('.preview-toolbar button')].map((button) => button.textContent)).toEqual(['Info']);
    });

    it('lists the size of a video and warns when there is no picture', () => {
        mount(new File(['x'], 'clip.mp4', { type: 'video/mp4' }), 'video');
        loadMetadata(media(), { duration: 75, videoWidth: 320, videoHeight: 180 });

        expect(media().tagName).toBe('VIDEO');
        expect(rows()['Video/Dimensions']).toBe('320 × 180 pixels');
        expect(rows()['Video/Duration']).toBe('1:15');
        expect(host.querySelector<HTMLElement>('.preview-note')?.hidden).toBe(true);

        mount(new File(['x'], 'sound-only.mov'), 'video');
        const second = host.querySelectorAll<HTMLMediaElement>('.preview-media')[1] as HTMLMediaElement;
        loadMetadata(second, { duration: 3 });

        expect(host.querySelectorAll<HTMLElement>('.preview-note')[1]?.textContent).toMatch(/^No picture/);
    });

    it('finds the length of a recording whose header has none by seeking to its end', () => {
        mount(new File(['x'], 'voice.weba'), 'audio');
        const element = media();
        loadMetadata(element, { duration: Number.POSITIVE_INFINITY });

        expect(element.currentTime).toBe(Number.MAX_SAFE_INTEGER);
        expect(rows()['Audio/Duration']).toBeUndefined();

        (element as unknown as { setDuration: (value: number) => void }).setDuration(3.04);
        element.dispatchEvent(new Event('durationchange'));

        expect(element.currentTime).toBe(0);
        expect(rows()['Audio/Duration']).toBe('0:03.0');
    });

    it('shows a clear message for a file Chrome can\'t play', () => {
        mount(new File(['not a video'], 'damaged.mkv'), 'video');
        const element = media();
        Object.defineProperty(element, 'error', { configurable: true, get: () => ({ code: 4 }) });
        element.dispatchEvent(new Event('error'));

        expect(frameState()).toBe('message');
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This video can\'t be played');
        expect(host.querySelector('.preview-status p')?.textContent).toMatch(/format or codec isn't supported/);
        expect(rows()['File/Type']).toBe('Matroska video');
    });

    it('keeps the same snapshot and loads a new one', () => {
        const file = new File(['a'], 'tone.wav');
        const handle = mount(file, 'audio');
        const first = media();
        handle.update(file);

        expect(media()).toBe(first);

        handle.update(new File(['b'], 'tone.wav'));
        expect(media()).not.toBe(first);
        expect(first.hasAttribute('src')).toBe(false);
    });

    it('stops, lets go of the blob URL and leaves the page when destroyed', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const handle = mount(new File(['a'], 'clip.webm'), 'video');
        const element = media();
        const url = element.getAttribute('src');
        const pause = vi.spyOn(element, 'pause');
        handle.destroy();

        expect(pause).toHaveBeenCalled();
        expect(revoke).toHaveBeenCalledWith(url);
        expect(host.querySelector('.preview-frame')).toBeNull();
    });
});

describe('mediaMetadata', () => {
    it('lists the file and the media rows', () => {
        const file = new File(['abc'], 'song.mp3', { lastModified: 0 });

        expect(mediaMetadata(file, 'MP3 audio', { duration: 187 }, 'audio').map((group) => group.title)).toEqual(['File', 'Audio']);
        // A length or size it doesn't know is left out, as other previews leave out what they don't know.
        expect(mediaMetadata(file, 'MP4 video', { duration: Number.NaN, videoWidth: 0, videoHeight: 0 }, 'video').map((group) => group.title))
            .toEqual(['File']);
    });
});
