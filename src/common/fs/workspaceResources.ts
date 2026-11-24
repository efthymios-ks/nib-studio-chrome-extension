import { encodeBase64Bytes } from '../encoding/base64.js';
import { IMAGE_HEADER_BYTES, sniffImageFormat, type ImageDecoderKind } from '../image/imageFormat.js';
import { errorMessage } from '../errorMessage.js';
import { findWorkspaceEntryAsync, type FolderListings } from './entryLookup.js';
import { getFileAsync } from './fileIo.js';

// What a page drawn from a workspace document reads from the workspace, by workspace path.
export interface DocumentResources {
    // A blob URL of a workspace image, or null when there is no such file.
    imageUrlAsync(path: string): Promise<string | null>;
    // The URL an image was read at already: a URL, null when it was missing,
    // undefined when it hasn't been read yet.
    peekImageUrl(path: string): string | null | undefined;
    // Why an image that was found has no URL, such as a HEIC picture, which is never decoded;
    // null otherwise.
    imageProblem(path: string): string | null;
    // The file as a data: URL, for pages that leave the studio and for style sheets,
    // whose fonts can't load from blobs.
    dataUrlAsync(path: string): Promise<string | null>;
    // A text file, such as a style sheet, with its path as it is on disk;
    // the text of its tab when that has unsaved edits.
    textAsync(path: string): Promise<{ readonly path: string; readonly text: string } | null>;
}

// Turns a picture Chrome can't draw, a TIFF or a HEIC, into a PNG; it throws, with a message to show,
// when it can't.
export type ConvertImageAsync = (decoder: Exclude<ImageDecoderKind, 'native'>, file: Blob) => Promise<Blob>;

export interface WorkspaceResourceOptions {
    // The unsaved text of a file's tab, by its path as it is on disk;
    // null when the file has no unsaved edits.
    readonly unsavedText?: (path: string) => string | null;
    // Without it, a TIFF or HEIC picture is handed over as it is.
    readonly convertImageAsync?: ConvertImageAsync;
}

export interface WorkspaceResources extends DocumentResources {
    // Revokes the blob URLs of images the page no longer shows.
    keepOnly(paths: Iterable<string>): void;
    // Forgets what was read from changed files or folders; returns whether the page asked for any of them,
    // found or not.
    forget(changedPaths: ReadonlyArray<string>): boolean;
    // Revokes every blob URL; reads after it find nothing.
    dispose(): void;
}

interface ImageEntry {
    promise: Promise<string | null>;
    url: string | null | undefined;
}

interface ReadFile {
    readonly path: string;
    readonly file: File;
}

interface ImageBytes {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly type: string;
}

const FALLBACK_TYPE = 'application/octet-stream';
const PNG_TYPE = 'image/png';

// Reads workspace files for one page: images become blob URLs, kept while the page shows them,
// and every name matches exactly or else case-insensitively.
export function createWorkspaceResources(root: FileSystemDirectoryHandle, options: WorkspaceResourceOptions = {}): WorkspaceResources {
    const images = new Map<string, ImageEntry>();
    const dataUrls = new Map<string, Promise<string | null>>();
    const texts = new Map<string, Promise<{ path: string; text: string } | null>>();
    // Why a found image has no URL, by the path it was asked for.
    const problems = new Map<string, string>();
    // Every blob URL made and not yet revoked.
    const createdUrls = new Set<string>();
    // Every path asked for, lower case, found or not, so a file created later refreshes the page too.
    const requested = new Set<string>();
    let listings: FolderListings = new Map();
    let isDisposed = false;

    const readAsync = async (path: string): Promise<ReadFile | null> => {
        requested.add(path.toLowerCase());
        const entry = await findWorkspaceEntryAsync(root, path, listings);

        if (entry == null || entry.kind !== 'file' || isDisposed) {
            return null;
        }

        try {
            return { path: entry.path, file: await getFileAsync(root, entry.path) };
        }
        catch {
            return null;
        }
    };

    // The file's bytes and type, a picture Chrome can't draw turned into a PNG first; null when it can't be,
    // with the reason kept.
    const readShowableAsync = async (path: string, read: ReadFile): Promise<ImageBytes | null> => {
        const bytes = new Uint8Array(await read.file.arrayBuffer());
        const format = sniffImageFormat(bytes.subarray(0, IMAGE_HEADER_BYTES), read.file.name);

        if (format.decoder === 'native' || options.convertImageAsync == null) {
            return { bytes, type: mediaTypeOf(bytes, read.file) };
        }

        try {
            const png = await options.convertImageAsync(format.decoder, new Blob([bytes], { type: format.mime }));

            return { bytes: new Uint8Array(await png.arrayBuffer()), type: PNG_TYPE };
        }
        catch (error) {
            problems.set(path, errorMessage(error));

            return null;
        }
    };

    const loadImageUrlAsync = async (path: string): Promise<string | null> => {
        const read = await readAsync(path);
        const image = read == null ? null : await readShowableAsync(path, read);

        if (image == null || isDisposed) {
            return null;
        }

        const url = URL.createObjectURL(new Blob([image.bytes], { type: image.type }));
        createdUrls.add(url);

        return url;
    };

    const loadDataUrlAsync = async (path: string): Promise<string | null> => {
        const read = await readAsync(path);
        const image = read == null ? null : await readShowableAsync(path, read);

        return image == null ? null : `data:${image.type};base64,${encodeBase64Bytes(image.bytes)}`;
    };

    const loadTextAsync = async (path: string): Promise<{ path: string; text: string } | null> => {
        const read = await readAsync(path);

        if (read == null) {
            return null;
        }

        return { path: read.path, text: options.unsavedText?.(read.path) ?? await read.file.text() };
    };

    const revokeUnused = (): void => {
        const inUse = new Set([...images.values()].map((entry) => entry.url));

        for (const url of [...createdUrls]) {
            if (!inUse.has(url)) {
                URL.revokeObjectURL(url);
                createdUrls.delete(url);
            }
        }
    };

    return {
        imageUrlAsync: (path) => {
            const cached = images.get(path);

            if (cached != null) {
                return cached.promise;
            }

            const entry: ImageEntry = { promise: Promise.resolve(null), url: undefined };
            entry.promise = (async () => {
                const url = await loadImageUrlAsync(path);
                entry.url = url;

                return url;
            })();
            images.set(path, entry);

            return entry.promise;
        },
        peekImageUrl: (path) => images.get(path)?.url,
        imageProblem: (path) => problems.get(path) ?? null,
        dataUrlAsync: (path) => cachedAsync(dataUrls, path, loadDataUrlAsync),
        textAsync: (path) => cachedAsync(texts, path, loadTextAsync),
        keepOnly: (paths) => {
            const keep = new Set(paths);

            for (const [path, entry] of [...images]) {
                if (!keep.has(path) && entry.url !== undefined) {
                    images.delete(path);
                }
            }

            revokeUnused();
        },
        forget: (changedPaths) => {
            const changed = changedPaths.map((path) => path.toLowerCase());
            const touches = (path: string): boolean => {
                const folded = path.toLowerCase();

                return changed.some((candidate) => candidate === '' || folded === candidate || folded.startsWith(`${candidate}/`));
            };
            listings = new Map();

            for (const cache of [images, dataUrls, texts, problems]) {
                for (const path of [...cache.keys()]) {
                    if (touches(path)) {
                        cache.delete(path);
                    }
                }
            }

            return [...requested].some(touches);
        },
        dispose: () => {
            isDisposed = true;
            images.clear();
            dataUrls.clear();
            texts.clear();
            problems.clear();
            revokeUnused();
        },
    };
}

// An image's type from its bytes, so a misnamed picture still shows;
// other files keep the type the browser gave them.
function mediaTypeOf(bytes: Uint8Array, file: File): string {
    const format = sniffImageFormat(bytes.subarray(0, IMAGE_HEADER_BYTES), file.name);

    if (format.id !== 'unknown') {
        return format.mime;
    }

    return file.type === '' ? FALLBACK_TYPE : file.type;
}

function cachedAsync<T>(cache: Map<string, Promise<T>>, path: string, loadAsync: (path: string) => Promise<T>): Promise<T> {
    const cached = cache.get(path);

    if (cached != null) {
        return cached;
    }

    const loading = loadAsync(path);
    cache.set(path, loading);

    return loading;
}
