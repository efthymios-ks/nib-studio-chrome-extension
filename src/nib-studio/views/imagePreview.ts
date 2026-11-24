import { canCountFrames, countImageFrames, FRAME_COUNT_MAX_BYTES } from '../../common/image/animationFrames.js';
import {
    exifMetadataGroups,
    formatOrientation,
    readExifTagsAsync,
    type ExifTags,
} from '../../common/image/exifMetadata.js';
import { readHeifImageSizeAsync } from '../../common/image/heifImageSize.js';
import {
    HEIC_NOT_DECODED_MESSAGE,
    IMAGE_HEADER_BYTES,
    imageFormatById,
    sniffImageFormat,
    type ImageFormat,
    type ImageFormatId,
} from '../../common/image/imageFormat.js';
import { readSvgInfo, SVG_INFO_MAX_BYTES, type SvgInfo } from '../../common/image/svgInfo.js';
import { cachePerFile } from '../../common/preview/fileCache.js';
import {
    compactGroups,
    fileMetadataGroup,
    formatDimensions,
    formatMegapixels,
    metadataGroup,
    type MetadataGroup,
} from '../../common/preview/metadataGroups.js';
import { h } from '../app/dom.js';
import { toast } from '../app/toast.js';
import { errorMessage } from '../../common/errorMessage.js';
import { canvasToPngAsync, copyPngToClipboardAsync, renderPngAsync } from './imageClipboard.js';
import { createWorkerImageDecoder, type DecodedPixels, type DecodeImageAsync } from './imageDecodeClient.js';
import { createPreviewFrame, type PreviewFrame } from './previewFrame.js';
import type { PreviewHandle } from './previewHandle.js';

export interface ImagePreviewOptions {
    readonly file: File;
    readonly fileName: string;
    readonly memoryKey: string;
    // The TIFF decoder; the shared decode worker unless a test gives another.
    readonly decodeImageAsync?: DecodeImageAsync;
}

// A format the preview draws: Chrome's own, or TIFF through the decode worker.
type ShowableFormat = ImageFormat & { readonly decoder: 'native' | 'tiff' };

interface ImageSize {
    readonly width: number;
    readonly height: number;
}

// An image shown in the frame, with what it takes to copy it and to let it go.
interface ShownImage {
    readonly element: HTMLImageElement | HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    readonly pageCount: number;
    readonly toPngAsync: () => Promise<Blob>;
    readonly dispose: () => void;
}

// An SVG without its own size is drawn at this width, keeping the shape of its viewBox.
const SVG_DEFAULT_WIDTH = 512;

// Formats whose EXIF exifr can read; the others never carry it.
const EXIF_FORMATS = new Set<ImageFormatId>(['jpeg', 'heic', 'avif', 'tiff', 'png']);

// A HEIC picture is never decoded, so it shows this, with its size and what its EXIF says under Info.
const HEIC_NOT_SHOWN_TITLE = 'This picture can\'t be shown here';
const HEIC_NOT_SHOWN_MESSAGE = `${HEIC_NOT_DECODED_MESSAGE} Its details are under Info.`;

// The format, the decoded TIFF pixels and the details of each File snapshot are read once while it lives,
// so switching tabs or an unrelated re-render never reads or decodes it again.
const sniffCachedAsync = cachePerFile(sniffFileAsync);
const decodePixelsCachedAsync = cachePerFile((
    file: File,
    decoder: Parameters<DecodeImageAsync>[0],
    decodeImageAsync: DecodeImageAsync,
) => decodeImageAsync(decoder, file));
const imageMetadataAsync = cachePerFile(readImageMetadataAsync);
const undecodedMetadataAsync = cachePerFile(readUndecodedMetadataAsync);

let sharedDecoder: DecodeImageAsync | null = null;

function defaultDecoder(): DecodeImageAsync {
    sharedDecoder ??= createWorkerImageDecoder();

    return sharedDecoder;
}

// Shows an image file in the preview frame: zoom with the plain wheel, Copy image, and the Info panel.
export function mountImagePreview(host: HTMLElement, options: ImagePreviewOptions): PreviewHandle {
    const decodeImageAsync = options.decodeImageAsync ?? defaultDecoder();
    let current: File = options.file;
    let shown: ShownImage | null = null;
    let generation = 0;

    const copy = (): void => {
        if (shown == null) {
            return;
        }

        void copyShownImageAsync(shown);
    };
    const copyButton = h('button', {
        class: 'button',
        text: 'Copy image',
        dataset: { action: 'copy-image' },
        attrs: { type: 'button', title: 'Copy the image to the clipboard as PNG (Ctrl+C)', disabled: true },
        on: { click: copy },
    });
    const frame = createPreviewFrame({
        memoryKey: options.memoryKey,
        typeLabel: 'Image',
        zoom: true,
        wheelZoom: 'wheel',
        actions: [copyButton],
        onCopy: copy,
        label: `Image preview of ${options.fileName}`,
    });
    host.append(frame.element);

    // A HEIC picture: a message in place of it, and the details its file holds under Info.
    const showUndecodedAsync = async (file: File, format: ImageFormat, isCurrent: () => boolean): Promise<void> => {
        if (!isCurrent()) {
            return;
        }

        shown?.dispose();
        shown = null;
        frame.showMessage(HEIC_NOT_SHOWN_TITLE, HEIC_NOT_SHOWN_MESSAGE);
        const groups = await undecodedMetadataAsync(file, format);

        if (isCurrent()) {
            frame.setMetadata(groups);
        }
    };

    const loadAsync = async (file: File): Promise<void> => {
        generation += 1;
        const token = generation;
        const isCurrent = (): boolean => token === generation;
        copyButton.disabled = true;
        frame.showLoading('Opening the image…');
        frame.setMetadata(null);

        let format = imageFormatById('unknown');

        try {
            format = await sniffCachedAsync(file, options.fileName);

            if (!isShowable(format)) {
                await showUndecodedAsync(file, format, isCurrent);

                return;
            }

            const image = await showImageAsync(file, format, decodeImageAsync);

            if (!isCurrent()) {
                image.dispose();

                return;
            }

            shown?.dispose();
            shown = image;
            frame.setContent(image.element, { width: image.width, height: image.height });
            copyButton.disabled = false;
            const groups = await imageMetadataAsync(file, format, image);

            if (isCurrent()) {
                frame.setMetadata(groups);
            }
        }
        catch (error) {
            if (!isCurrent()) {
                return;
            }

            shown?.dispose();
            shown = null;
            showFailure(frame, error);
            frame.setMetadata([fileMetadataGroup(file, format.label)]);
        }
    };

    void loadAsync(current);

    return {
        element: frame.element,
        update: (file) => {
            if (file == null || file === current) {
                return;
            }

            current = file;
            void loadAsync(file);
        },
        destroy: () => {
            generation += 1;
            shown?.dispose();
            shown = null;
            frame.destroy();
            frame.element.remove();
        },
    };
}

function showFailure(frame: PreviewFrame, error: unknown): void {
    frame.showMessage('This image can\'t be shown', errorMessage(error));
}

async function copyShownImageAsync(image: ShownImage): Promise<void> {
    try {
        await copyPngToClipboardAsync(image.toPngAsync());
        toast('Image copied to the clipboard as PNG.', 'ok');
    }
    catch (error) {
        toast(`Could not copy the image: ${errorMessage(error)}`, 'fail');
    }
}

function isShowable(format: ImageFormat): format is ShowableFormat {
    return format.decoder !== 'heic';
}

async function sniffFileAsync(file: File, fileName: string): Promise<ImageFormat> {
    const header = new Uint8Array(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer());

    return sniffImageFormat(header, fileName);
}

async function showImageAsync(
    file: File,
    format: ShowableFormat,
    decodeImageAsync: DecodeImageAsync,
): Promise<ShownImage> {
    if (format.decoder === 'native') {
        return await showNativeImageAsync(file, format);
    }

    return showDecodedPixels(await decodePixelsCachedAsync(file, format.decoder, decodeImageAsync), file.name);
}

// Chrome decodes these itself from a blob URL of the File, which never reads the file into script memory.
// An SVG goes through <img> too, where its scripts never run.
async function showNativeImageAsync(file: File, format: ImageFormat): Promise<ShownImage> {
    const blob = format.id === 'unknown' || file.type === format.mime
        ? file
        : new Blob([file], { type: format.mime });
    const url = URL.createObjectURL(blob);
    const image = h('img', {
        class: 'preview-image',
        attrs: { alt: file.name, draggable: 'false', decoding: 'async' },
    });
    image.src = url;

    try {
        await image.decode();
    }
    catch {
        URL.revokeObjectURL(url);

        throw new Error('The file is damaged, or its data is not an image Chrome can read.');
    }

    const size = await naturalSizeAsync(image, file, format);

    return {
        element: image,
        width: size.width,
        height: size.height,
        pageCount: 1,
        toPngAsync: async () => await renderPngAsync(image, size.width, size.height),
        dispose: () => URL.revokeObjectURL(url),
    };
}

// An SVG with only a viewBox has no natural size of its own, so it gets one with the viewBox's shape.
async function naturalSizeAsync(
    image: HTMLImageElement,
    file: File,
    format: ImageFormat,
): Promise<ImageSize> {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        return { width: image.naturalWidth, height: image.naturalHeight };
    }

    const box = format.id === 'svg' ? viewBoxSize(await readSvgInfoAsync(file)) : null;

    if (box == null) {
        return { width: SVG_DEFAULT_WIDTH, height: SVG_DEFAULT_WIDTH / 2 };
    }

    const height = Math.max(1, Math.round(SVG_DEFAULT_WIDTH * box.height / box.width));

    return { width: SVG_DEFAULT_WIDTH, height };
}

function viewBoxSize(info: SvgInfo | null): ImageSize | null {
    const parts = info?.viewBox?.split(/[\s,]+/).map(Number) ?? [];
    const width = parts[2];
    const height = parts[3];

    return width != null && height != null && width > 0 && height > 0 ? { width, height } : null;
}

function showDecodedPixels(decoded: DecodedPixels, name: string): ShownImage {
    const canvas = h('canvas', { class: 'preview-image', attrs: { role: 'img', 'aria-label': name } });
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext('2d');

    if (context == null) {
        throw new Error('The browser gave no canvas to draw the image on.');
    }

    context.putImageData(new ImageData(decoded.pixels, decoded.width, decoded.height), 0, 0);

    return {
        element: canvas,
        width: decoded.width,
        height: decoded.height,
        pageCount: decoded.pageCount,
        toPngAsync: async () => await canvasToPngAsync(canvas),
        dispose: () => {},
    };
}

async function readSvgInfoAsync(file: Blob): Promise<SvgInfo | null> {
    try {
        return readSvgInfo(await file.slice(0, SVG_INFO_MAX_BYTES).text());
    }
    catch {
        return null;
    }
}

// The File, Image, Camera and Location groups; each part that can't be read is simply left out.
async function readImageMetadataAsync(
    file: File,
    format: ImageFormat,
    image: Pick<ShownImage, 'width' | 'height' | 'pageCount'>,
): Promise<ReadonlyArray<MetadataGroup>> {
    const [tags, frames, svg] = await Promise.all([
        EXIF_FORMATS.has(format.id) ? readExifTagsAsync(file) : Promise.resolve<ExifTags | null>(null),
        countFramesAsync(file, format),
        format.id === 'svg' ? readSvgInfoAsync(file) : Promise.resolve(null),
    ]);
    const isAnimated = frames != null && frames > 1;
    const typeLabel = isAnimated && format.id === 'png' ? 'Animated PNG image' : format.label;

    return compactGroups([
        fileMetadataGroup(file, typeLabel),
        metadataGroup('Image', [
            ['Dimensions', formatDimensions(image.width, image.height)],
            ['Megapixels', formatMegapixels(image.width, image.height)],
            ['Frames', isAnimated ? `${frames.toLocaleString('en-US')} (animated)` : null],
            ['Pages', image.pageCount > 1 ? `${image.pageCount.toLocaleString('en-US')}, the first is shown` : null],
            ['Orientation', formatOrientation(tags?.Orientation)],
            ['SVG width', svg?.width],
            ['SVG height', svg?.height],
            ['viewBox', svg?.viewBox],
        ]),
        ...exifMetadataGroups(tags),
    ]);
}

// The File group, the size a HEIC's own properties give without decoding it, its orientation,
// and what the EXIF says about the camera and the place.
async function readUndecodedMetadataAsync(file: File, format: ImageFormat): Promise<ReadonlyArray<MetadataGroup>> {
    const [tags, size] = await Promise.all([
        EXIF_FORMATS.has(format.id) ? readExifTagsAsync(file) : Promise.resolve<ExifTags | null>(null),
        format.id === 'heic' ? readHeifImageSizeAsync(file) : Promise.resolve(null),
    ]);

    return compactGroups([
        fileMetadataGroup(file, format.label),
        metadataGroup('Image', [
            ['Dimensions', size == null ? null : formatDimensions(size.width, size.height)],
            ['Megapixels', size == null ? null : formatMegapixels(size.width, size.height)],
            ['Orientation', formatOrientation(tags?.Orientation)],
        ]),
        ...exifMetadataGroups(tags),
    ]);
}

async function countFramesAsync(file: File, format: ImageFormat): Promise<number | null> {
    if (!canCountFrames(format.id) || file.size > FRAME_COUNT_MAX_BYTES) {
        return null;
    }

    try {
        return countImageFrames(new Uint8Array(await file.arrayBuffer()), format.id);
    }
    catch {
        return null;
    }
}
