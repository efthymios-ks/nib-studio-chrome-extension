import {
    createWorkspaceResources,
    type ConvertImageAsync,
    type WorkspaceResourceOptions,
    type WorkspaceResources,
} from '../../common/fs/workspaceResources.js';
import { HEIC_NOT_DECODED_MESSAGE } from '../../common/image/imageFormat.js';
import { createWorkerImageDecoder, type DecodeImageAsync } from './imageDecodeClient.js';
import { pixelsToPngAsync } from './imageClipboard.js';

export interface DocumentImageConverterOptions {
    readonly decodeImageAsync?: DecodeImageAsync;
    readonly encodePngAsync?: typeof pixelsToPngAsync;
}

let sharedDecoder: DecodeImageAsync | null = null;

// The image decode worker, started on the first TIFF picture a document shows.
function defaultDecoder(): DecodeImageAsync {
    sharedDecoder ??= createWorkerImageDecoder();

    return sharedDecoder;
}

// Turns the TIFF pictures of Markdown and HTML documents into PNG, which an <img> can show,
// with the image preview's decoder in the decode worker. A HEIC picture is never decoded,
// so its placeholder says so instead.
export function createDocumentImageConverter(options: DocumentImageConverterOptions = {}): ConvertImageAsync {
    const encodePngAsync = options.encodePngAsync ?? pixelsToPngAsync;

    return async (decoder, file) => {
        if (decoder === 'heic') {
            throw new Error(HEIC_NOT_DECODED_MESSAGE);
        }

        const decodeImageAsync = options.decodeImageAsync ?? defaultDecoder();

        return await encodePngAsync(await decodeImageAsync(decoder, file));
    };
}

// What a Markdown or HTML document reads from the workspace, its TIFF pictures shown as PNG.
export function createDocumentResources(
    root: FileSystemDirectoryHandle,
    options: Omit<WorkspaceResourceOptions, 'convertImageAsync'> = {},
): WorkspaceResources {
    return createWorkspaceResources(root, { ...options, convertImageAsync: createDocumentImageConverter() });
}
