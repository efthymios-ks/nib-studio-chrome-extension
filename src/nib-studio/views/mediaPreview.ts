import { mediaTypeLabel } from '../../common/preview/mediaFormat.js';
import {
    compactGroups,
    fileMetadataGroup,
    formatDimensions,
    formatDuration,
    metadataGroup,
    type MetadataGroup,
} from '../../common/preview/metadataGroups.js';
import { h } from '../app/dom.js';
import { createPreviewFrame } from './previewFrame.js';
import type { PreviewHandle } from './previewHandle.js';

export type MediaKind = 'audio' | 'video';

export interface MediaPreviewOptions {
    readonly file: File;
    readonly fileName: string;
    readonly memoryKey: string;
    readonly kind: MediaKind;
}

// The badge and the Info group of each kind.
const KIND_LABELS: Readonly<Record<MediaKind, string>> = Object.freeze({
    audio: 'Audio',
    video: 'Video',
});

// MediaError codes, as the messages a viewer sees.
const MEDIA_ERROR_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
    2: 'The file could not be read from disk.',
    3: 'The file is damaged, or it uses a codec Chrome can\'t decode.',
    4: 'Chrome can\'t play this file: its format or codec isn\'t supported, or the file is damaged.',
});

const NO_PICTURE_NOTE = 'No picture: Chrome can\'t show this video\'s picture, or the file holds sound only.';

// Shows an audio or video file with the browser's own controls, playing straight from a blob URL of the File,
// so the file is streamed from disk rather than read into memory. There is no zoom; the toolbar holds only Info.
export function mountMediaPreview(host: HTMLElement, options: MediaPreviewOptions): PreviewHandle {
    const kindLabel = KIND_LABELS[options.kind];
    const typeLabel = mediaTypeLabel(options.fileName, kindLabel);
    const frame = createPreviewFrame({
        memoryKey: options.memoryKey,
        typeLabel: kindLabel,
        zoom: false,
        label: `${kindLabel} preview of ${options.fileName}`,
    });
    host.append(frame.element);
    let current = options.file;
    let media: HTMLMediaElement | null = null;
    let url: string | null = null;

    const release = (): void => {
        if (media != null) {
            media.pause();
            media.removeAttribute('src');
            media.load();
            media = null;
        }

        if (url != null) {
            URL.revokeObjectURL(url);
            url = null;
        }
    };

    const load = (file: File): void => {
        release();
        frame.setNote(null);
        frame.setMetadata(null);
        const elementOptions = {
            class: 'preview-media',
            dataset: { kind: options.kind },
            attrs: { controls: true, preload: 'metadata' },
        };
        const element = options.kind === 'audio' ? h('audio', elementOptions) : h('video', elementOptions);
        const source = URL.createObjectURL(file);
        media = element;
        url = source;
        // The element is in place from the start, under the loading message, so it is never moved once it plays.
        frame.setContent(element);
        frame.showLoading(options.kind === 'audio' ? 'Opening the audio…' : 'Opening the video…');
        let isMeasuringDuration = false;

        const describe = (): void => {
            frame.setMetadata(mediaMetadata(file, typeLabel, element, options.kind));
        };

        element.addEventListener('loadedmetadata', () => {
            if (media !== element) {
                return;
            }

            frame.setContent(element);

            if (
                options.kind === 'video'
                && element instanceof HTMLVideoElement
                && element.videoWidth === 0
            ) {
                frame.setNote(NO_PICTURE_NOTE);
            }

            // A file recorded in the browser often has no length in its header; seeking to the end makes Chrome find it.
            if (!Number.isFinite(element.duration)) {
                isMeasuringDuration = true;
                element.currentTime = Number.MAX_SAFE_INTEGER;
            }

            describe();
        });
        element.addEventListener('durationchange', () => {
            if (
                media !== element
                || !isMeasuringDuration
                || !Number.isFinite(element.duration)
            ) {
                return;
            }

            isMeasuringDuration = false;
            element.currentTime = 0;
            describe();
        });
        element.addEventListener('error', () => {
            if (media !== element) {
                return;
            }

            const reason = MEDIA_ERROR_MESSAGES[element.error?.code ?? 0] ?? 'The file could not be opened.';
            frame.showMessage(options.kind === 'audio' ? 'This audio file can\'t be played' : 'This video can\'t be played', reason);
            frame.setMetadata([fileMetadataGroup(file, typeLabel)]);
        });
        element.src = source;
    };

    load(current);

    return {
        element: frame.element,
        update: (file) => {
            if (file == null || file === current) {
                return;
            }

            current = file;
            load(file);
        },
        destroy: () => {
            release();
            frame.destroy();
            frame.element.remove();
        },
    };
}

export function mediaMetadata(
    file: File,
    typeLabel: string,
    media: Pick<HTMLMediaElement, 'duration'> & Partial<Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>>,
    kind: MediaKind,
): MetadataGroup[] {
    const hasPicture = kind === 'video' && (media.videoWidth ?? 0) > 0 && (media.videoHeight ?? 0) > 0;

    return compactGroups([
        fileMetadataGroup(file, typeLabel),
        metadataGroup(KIND_LABELS[kind], [
            ['Duration', formatDuration(media.duration)],
            ['Dimensions', hasPicture ? formatDimensions(media.videoWidth ?? 0, media.videoHeight ?? 0) : null],
        ]),
    ]);
}
