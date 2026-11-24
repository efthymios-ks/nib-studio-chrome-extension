import { resolveWorkspaceReference } from '../fs/workspaceReference.js';
import type { DocumentResources } from '../fs/workspaceResources.js';

// The address of an image a page reads from the workspace, held here instead of `src` until it is read,
// so the browser never fetches it against the extension's own folder.
export const LOCAL_SOURCE_ATTRIBUTE = 'data-local-src';
// The `srcset` of a `<picture>` source whose candidates are read from the workspace.
export const LOCAL_SRCSET_ATTRIBUTE = 'data-local-srcset';
// Marks the placeholder shown after an image that can't be shown.
const IMAGE_PLACEHOLDER_ATTRIBUTE = 'data-image-placeholder';

export type ImageSourceKind = 'web' | 'inline' | 'local';

export interface LocalImageContext {
    // The document's path in the workspace; null for a file from outside the workspace.
    readonly documentPath: string | null;
    // Null when there is no workspace to read from.
    readonly resources: DocumentResources | null;
}

export type LocalImage =
    | { readonly kind: 'image'; readonly url: string }
    | { readonly kind: 'placeholder'; readonly label: string };

export interface SrcsetCandidate {
    readonly url: string;
    readonly descriptor: string;
}

export interface ResolveImagesOptions {
    // Blob URLs for pages shown in the studio; data: URLs for pages that leave it.
    readonly format: 'blob' | 'data';
    // The class of placeholders, styled by the page that shows them.
    readonly placeholderClass: string;
    // For data: URLs, the most image bytes the page takes in all; an image past it becomes a placeholder.
    readonly maxEmbeddedBytes?: number;
}

type ImageTarget =
    | { readonly kind: 'read'; readonly path: string; readonly resources: DocumentResources }
    | { readonly kind: 'url'; readonly url: string }
    | { readonly kind: 'placeholder'; readonly label: string };

// Web images, protocol-relative ones included; `data:` and `blob:` images; and every other address,
// read from the workspace or shown as a placeholder.
export function imageSourceKind(source: string): ImageSourceKind {
    const kind = resolveWorkspaceReference(source, '').kind;

    if (kind === 'web' || kind === 'inline') {
        return kind;
    }

    return 'local';
}

export function remoteImageLabel(source: string): string {
    return `Remote image not loaded (offline): ${source}`;
}

// Where an image leads: a workspace file to read, an address that loads as it is, or the placeholder's text.
export function localImageTarget(source: string, alt: string, context: LocalImageContext): ImageTarget {
    const resolved = resolveWorkspaceReference(source, context.documentPath ?? '');

    if (resolved.kind === 'empty') {
        return { kind: 'placeholder', label: alt === '' ? 'Image not shown: it has no address' : `Image not shown: ${alt}` };
    }

    if (resolved.kind === 'inline') {
        return { kind: 'url', url: resolved.url };
    }

    if (resolved.kind === 'web') {
        return { kind: 'placeholder', label: remoteImageLabel(source) };
    }

    if (context.documentPath == null || context.resources == null) {
        return { kind: 'placeholder', label: `Image not shown (file outside the workspace): ${source}` };
    }

    if (resolved.kind === 'outside') {
        return { kind: 'placeholder', label: `Image outside the workspace: ${source}` };
    }

    if (resolved.kind === 'fragment') {
        return { kind: 'placeholder', label: `Image not found: ${source}` };
    }

    return { kind: 'read', path: resolved.path, resources: context.resources };
}

// The image as it can show right away: from an address that needs no reading, or a blob URL read before.
export function peekLocalImage(source: string, alt: string, context: LocalImageContext): LocalImage | null {
    const target = localImageTarget(source, alt, context);

    if (target.kind !== 'read') {
        return settledTarget(target);
    }

    const url = target.resources.peekImageUrl(target.path);

    if (url === undefined) {
        return null;
    }

    return url == null ? unshownImage(source, target.path, target.resources) : { kind: 'image', url };
}

export async function loadLocalImageAsync(
    source: string,
    alt: string,
    context: LocalImageContext,
    format: ResolveImagesOptions['format'],
): Promise<LocalImage> {
    const target = localImageTarget(source, alt, context);

    if (target.kind !== 'read') {
        return settledTarget(target);
    }

    const url = format === 'blob'
        ? await target.resources.imageUrlAsync(target.path)
        : await target.resources.dataUrlAsync(target.path);

    return url == null ? unshownImage(source, target.path, target.resources) : { kind: 'image', url };
}

// The placeholder of a workspace image with no URL: why it can't show,
// such as a HEIC picture, which is never decoded,
// or that it isn't there.
function unshownImage(source: string, path: string, resources: DocumentResources): LocalImage {
    return { kind: 'placeholder', label: resources.imageProblem(path) ?? `Image not found: ${source}` };
}

export function tooLargeToEmbedLabel(source: string, maxEmbeddedBytes: number): string {
    return `Image too large to embed: the page holds at most ${formatMegabytes(maxEmbeddedBytes)} of images (${source})`;
}

// The bytes a data: URL holds, from the length of its Base64.
export function dataUrlByteLength(url: string): number {
    const comma = url.indexOf(',');
    const payload = url.slice(comma + 1);
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;

    return Math.floor(payload.length * 3 / 4) - padding;
}

function formatMegabytes(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Shows every image held for the workspace (`data-local-src`) and the `<picture>` sources read from it;
// an image that can't show is hidden, with a placeholder after it. Run again,
// it brings back images that appeared.
// Returns the workspace paths it asked for, found or not.
export async function resolveLocalImagesAsync(
    root: ParentNode,
    context: LocalImageContext,
    options: ResolveImagesOptions,
): Promise<Set<string>> {
    const paths = new Set<string>();
    const pending: Array<Promise<void>> = [];
    const budget = options.format === 'data' && options.maxEmbeddedBytes != null
        ? createEmbedBudget(options.maxEmbeddedBytes)
        : null;
    // In document order, so the budget goes to the images that come first.
    const elements = [...root.querySelectorAll<HTMLElement>(`img[${LOCAL_SOURCE_ATTRIBUTE}], source[${LOCAL_SRCSET_ATTRIBUTE}]`)];

    for (const element of elements) {
        if (element.localName === 'source') {
            pending.push(resolveSourceAsync(element, context, options.format, paths, budget?.slot() ?? null));
            continue;
        }

        const source = element.getAttribute(LOCAL_SOURCE_ATTRIBUTE) ?? '';
        const alt = element.getAttribute('alt') ?? '';
        const target = localImageTarget(source, alt, context);

        if (target.kind === 'read') {
            paths.add(target.path);
        }

        const ready = options.format === 'blob' ? peekLocalImage(source, alt, context) : null;

        if (ready != null) {
            showImage(element, ready, options.placeholderClass);
            continue;
        }

        const slot = budget?.slot() ?? null;
        pending.push((async () => {
            const loaded = await loadLocalImageAsync(source, alt, context, options.format);
            // A data: address written in the document is part of it already, so only workspace files count.
            const embedded = loaded.kind === 'image' && target.kind === 'read' ? [loaded.url] : [];
            const fits = slot == null || await slot.takeAsync(embedded);
            const shown = fits ? loaded : { kind: 'placeholder' as const, label: tooLargeToEmbedLabel(source, budget?.maxBytes ?? 0) };
            showImage(element, shown, options.placeholderClass);
        })());
    }

    await Promise.all(pending);

    return paths;
}

// An image's turn at the budget: it waits for the images before it, then takes its bytes when they fit.
// Every slot must take its turn once, with no URLs when its image shows nothing.
interface EmbedSlot {
    takeAsync(urls: ReadonlyArray<string>): Promise<boolean>;
}

interface EmbedBudget {
    readonly maxBytes: number;
    // Called in document order.
    slot(): EmbedSlot;
}

// Shares the most bytes a page embeds among its images in document order,
// whatever order they finish reading in.
// An image that would go past it takes nothing, and a smaller one after it may still fit.
function createEmbedBudget(maxBytes: number): EmbedBudget {
    let used = 0;
    let previousTurn: Promise<void> = Promise.resolve();

    return {
        maxBytes,
        slot: () => {
            const before = previousTurn;
            let finishTurn = (): void => {};
            previousTurn = new Promise<void>((resolve) => {
                finishTurn = resolve;
            });

            return {
                takeAsync: async (urls) => {
                    await before;
                    const bytes = urls.reduce((total, url) => total + dataUrlByteLength(url), 0);
                    const fits = used + bytes <= maxBytes;

                    if (fits) {
                        used += bytes;
                    }

                    finishTurn();

                    return fits;
                },
            };
        },
    };
}

// Puts the workspace images of rendered Markdown inside it as data: URLs, for a page that leaves the studio;
// an image that can't be read, or past `maxEmbeddedBytes`, becomes its placeholder,
// and nothing is left waiting for the workspace.
export async function embedLocalImagesAsync(
    html: string,
    context: LocalImageContext,
    options: { readonly placeholderClass: string; readonly maxEmbeddedBytes?: number },
): Promise<string> {
    const template = document.createElement('template');
    template.innerHTML = html;
    const root = template.content;
    await resolveLocalImagesAsync(root, context, { format: 'data', ...options });

    for (const image of [...root.querySelectorAll(`img[${LOCAL_SOURCE_ATTRIBUTE}]`)]) {
        if (image.hasAttribute('hidden')) {
            image.remove();
        }
        else {
            image.removeAttribute(LOCAL_SOURCE_ATTRIBUTE);
        }
    }

    for (const source of [...root.querySelectorAll(`source[${LOCAL_SRCSET_ATTRIBUTE}]`)]) {
        source.removeAttribute(LOCAL_SRCSET_ATTRIBUTE);

        if (!source.hasAttribute('srcset')) {
            source.remove();
        }
    }

    for (const placeholder of [...root.querySelectorAll(`[${IMAGE_PLACEHOLDER_ATTRIBUTE}]`)]) {
        placeholder.removeAttribute(IMAGE_PLACEHOLDER_ATTRIBUTE);
    }

    return template.innerHTML;
}

// Splits a `srcset` into its image addresses and their width or density descriptors, as browsers do:
// an address runs to the next space, so a comma inside it, as in a data: address, stays part of it.
export function parseSrcset(value: string): SrcsetCandidate[] {
    const candidates: SrcsetCandidate[] = [];
    let position = 0;

    while (position < value.length) {
        while (position < value.length && /[\s,]/.test(value.charAt(position))) {
            position += 1;
        }

        if (position >= value.length) {
            break;
        }

        let end = position;

        while (end < value.length && !/\s/.test(value.charAt(end))) {
            end += 1;
        }

        const url = value.slice(position, end);
        position = end;

        if (url.endsWith(',')) {
            candidates.push({ url: url.replace(/,+$/, ''), descriptor: '' });
            continue;
        }

        const comma = value.indexOf(',', position);
        const descriptorEnd = comma < 0 ? value.length : comma;
        candidates.push({ url, descriptor: value.slice(position, descriptorEnd).trim() });
        position = descriptorEnd + 1;
    }

    return candidates;
}

export function formatSrcset(candidates: ReadonlyArray<SrcsetCandidate>): string {
    return candidates
        .map((candidate) => (candidate.descriptor === '' ? candidate.url : `${candidate.url} ${candidate.descriptor}`))
        .join(', ');
}

async function resolveSourceAsync(
    element: HTMLElement,
    context: LocalImageContext,
    format: ResolveImagesOptions['format'],
    paths: Set<string>,
    slot: EmbedSlot | null,
): Promise<void> {
    const candidates = parseSrcset(element.getAttribute(LOCAL_SRCSET_ATTRIBUTE) ?? '');
    const resolved = await Promise.all(candidates.map(async (candidate) => {
        const target = localImageTarget(candidate.url, '', context);

        if (target.kind === 'read') {
            paths.add(target.path);
        }

        const image = await loadLocalImageAsync(candidate.url, '', context, format);

        return image.kind === 'image' ? { url: image.url, descriptor: candidate.descriptor } : null;
    }));

    const shown = resolved.filter((candidate): candidate is SrcsetCandidate => candidate != null);
    const isComplete = shown.length > 0 && shown.length === candidates.length;
    const fits = slot == null || await slot.takeAsync(isComplete ? shown.map((candidate) => candidate.url) : []);

    // A source with a candidate that can't show, or that doesn't fit, is left out,
    // so the picture falls back to its own image.
    if (!isComplete || !fits) {
        element.removeAttribute('srcset');

        return;
    }

    element.setAttribute('srcset', formatSrcset(shown));
}

function settledTarget(target: Exclude<ImageTarget, { kind: 'read' }>): LocalImage {
    return target.kind === 'url' ? { kind: 'image', url: target.url } : { kind: 'placeholder', label: target.label };
}

function showImage(image: HTMLElement, outcome: LocalImage, placeholderClass: string): void {
    const next = image.nextElementSibling;
    const placeholder = next?.hasAttribute(IMAGE_PLACEHOLDER_ATTRIBUTE) === true ? next : null;

    if (outcome.kind === 'image') {
        image.removeAttribute('hidden');

        if (image.getAttribute('src') !== outcome.url) {
            image.setAttribute('src', outcome.url);
        }

        placeholder?.remove();

        return;
    }

    image.setAttribute('hidden', '');
    image.removeAttribute('src');
    const alt = image.getAttribute('alt') ?? '';
    const shown = placeholder ?? image.ownerDocument.createElement('span');
    shown.className = placeholderClass;
    shown.setAttribute(IMAGE_PLACEHOLDER_ATTRIBUTE, '');
    shown.setAttribute('title', alt === '' ? image.getAttribute(LOCAL_SOURCE_ATTRIBUTE) ?? '' : alt);
    shown.textContent = outcome.label;

    if (placeholder == null) {
        image.after(shown);
    }
}
