import { encodeBase64 } from '../encoding/base64.js';
import { resolveWorkspaceReference } from '../fs/workspaceReference.js';
import type { DocumentResources } from '../fs/workspaceResources.js';
import {
    imageSourceKind,
    LOCAL_SOURCE_ATTRIBUTE,
    LOCAL_SRCSET_ATTRIBUTE,
    parseSrcset,
    resolveLocalImagesAsync,
    type LocalImageContext,
} from '../markdown/localImages.js';
import { titleWorkspaceLinks } from './linkTitles.js';
import { inlineStyleSheetAsync, rewriteUrlsAsync, type StyleSheetContext } from './styleSheets.js';

export interface HtmlPreviewDocument {
    // The page the sandbox page draws, scripts included.
    readonly html: string;
    // Every workspace path the page read, found or not, so a change to one of them refreshes it.
    readonly paths: ReadonlySet<string>;
}

const HTML_PREVIEW_PLACEHOLDER_CLASS = 'nib-image-placeholder';

// Attributes that load a file. Links (`a`, `area`) and images (`img`,
// `<picture>` sources) have their own handling.
const RESOURCE_ATTRIBUTES = Object.freeze(['src', 'poster', 'background', 'href', 'xlink:href']);
const LINK_TAGS = new Set(['a', 'area']);
// Elements whose `src` has handling of its own: images and scripts.
const OWN_SOURCE_TAGS = new Set(['img', 'script']);
const SCRIPT_DATA_URL_PREFIX = 'data:text/javascript;charset=utf-8;base64,';
// Frames and embedded objects, which the sandbox page never shows: it refuses every frame with an address,
// and a frame's `srcdoc` would run scripts with WebRTC, which no content security policy governs.
const FRAME_SELECTOR = 'iframe, frame, frameset, object, embed, fencedframe, portal';

const PLACEHOLDER_STYLE = `.${HTML_PREVIEW_PLACEHOLDER_CLASS} {
    display: inline-block;
    max-width: 100%;
    padding: 4px 8px;
    border: 1px dashed #94a3b8;
    border-radius: 6px;
    color: #475569;
    background: #f8fafc;
    font: 12px/1.4 system-ui, sans-serif;
    overflow-wrap: anywhere;
}`;

// Makes an HTML file self-contained for the sandbox page, which runs its scripts with no network:
// linked workspace style sheets and scripts are read in, images and other files become data: URLs,
// and nothing from the web or outside the workspace loads. The page's own scripts and handlers stay as written.
export async function buildHtmlPreviewAsync(text: string, context: LocalImageContext): Promise<HtmlPreviewDocument> {
    const page = new DOMParser().parseFromString(text, 'text/html');
    const paths = new Set<string>();
    const basePath = context.documentPath ?? '';
    const sheetContext = { basePath, resources: context.resources, paths };

    dropLeavingElements(page);
    dropFrames(page, page);

    // The page's own styles are read in first; linked sheets come in read against their own folder.
    await Promise.all([...page.querySelectorAll('style')].map(async (style) => {
        style.textContent = await inlineStyleSheetAsync(style.textContent ?? '', sheetContext);
    }));
    await Promise.all([...page.querySelectorAll('link')].map(async (link) => {
        link.replaceWith(await styleForLinkAsync(page, link, sheetContext));
    }));
    await Promise.all([...page.querySelectorAll('[style]')].map(async (element) => {
        element.setAttribute('style', await rewriteUrlsAsync(element.getAttribute('style') ?? '', basePath, sheetContext));
    }));
    await Promise.all([...page.querySelectorAll('script[src]')].map(async (script) => {
        await inlineScriptAsync(page, script, sheetContext);
    }));

    prepareImages(page);
    prepareSvgLinks(page);
    titleWorkspaceLinks(page, context.documentPath);
    await Promise.all(resourceRewrites(page, context, paths));

    const imagePaths = await resolveLocalImagesAsync(page, context, { format: 'data', placeholderClass: HTML_PREVIEW_PLACEHOLDER_CLASS });

    for (const path of imagePaths) {
        paths.add(path);
    }

    const placeholderStyle = page.createElement('style');
    placeholderStyle.textContent = PLACEHOLDER_STYLE;
    page.head.prepend(placeholderStyle);

    return { html: `${doctypeOf(page)}${page.documentElement.outerHTML}`, paths };
}

// Elements that would send the page somewhere else: `<base>` changes what its addresses mean,
// and a refresh `<meta>` leaves it.
function dropLeavingElements(page: Document): void {
    for (const element of [...page.querySelectorAll('base, meta[http-equiv]')]) {
        const isRefresh = (element.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'refresh';

        if (element.localName === 'base' || isRefresh) {
            element.remove();
        }
    }
}

// Frames and embedded objects go, from templates too, which may become shadow roots;
// an object's fallback content stays in its place.
function dropFrames(page: Document, root: ParentNode): void {
    for (const element of [...root.querySelectorAll(FRAME_SELECTOR)]) {
        const fallback = element.localName === 'object' ? [...element.childNodes] : [];
        element.replaceWith(page.createComment(' frame left out '), ...fallback);
    }

    for (const template of [...root.querySelectorAll('template')]) {
        dropFrames(page, template.content);
    }
}

// The page's own doctype, so a page without one draws in quirks mode, as a browser draws it.
function doctypeOf(page: Document): string {
    return page.doctype == null ? '' : `${new XMLSerializer().serializeToString(page.doctype)}\n`;
}

// A workspace script comes in as a data: URL of its text, the unsaved text of its tab included,
// so `defer`, `async` and the order of scripts stay as written;
// a script from the web or outside the workspace goes.
async function inlineScriptAsync(page: Document, script: Element, context: StyleSheetContext): Promise<void> {
    const resolved = resolveWorkspaceReference(script.getAttribute('src') ?? '', context.basePath);

    if (resolved.kind === 'inline') {
        return;
    }

    if (resolved.kind !== 'workspace' || context.resources == null) {
        script.replaceWith(page.createComment(' script left out '));

        return;
    }

    context.paths.add(resolved.path);
    const source = await context.resources.textAsync(resolved.path);

    if (source == null) {
        script.replaceWith(page.createComment(' script not found '));

        return;
    }

    // Names the file in the browser's developer tools and in the page's error messages.
    const named = `${source.text}\n//# sourceURL=${encodeURI(source.path)}\n`;
    script.setAttribute('src', `${SCRIPT_DATA_URL_PREFIX}${encodeBase64(named)}`);
}

// A linked workspace style sheet comes in as a `<style>`; any other link, and a style sheet from the web,
// goes.
async function styleForLinkAsync(
    page: Document,
    link: HTMLLinkElement,
    context: StyleSheetContext,
): Promise<Node> {
    const isStyleSheet = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet');
    const resolved = resolveWorkspaceReference(link.getAttribute('href') ?? '', context.basePath);

    if (!isStyleSheet || resolved.kind !== 'workspace' || context.resources == null) {
        return page.createComment(' style sheet left out ');
    }

    context.paths.add(resolved.path);
    const sheet = await context.resources.textAsync(resolved.path);

    if (sheet == null) {
        return page.createComment(' style sheet not found ');
    }

    const style = page.createElement('style');
    const media = link.getAttribute('media') ?? '';
    const css = await inlineStyleSheetAsync(sheet.text, { ...context, basePath: sheet.path });
    style.setAttribute('data-href', sheet.path);
    style.textContent = media === '' ? css : `@media ${media} {\n${css}\n}`;

    return style;
}

// Images and `<picture>` sources wait for the workspace, as in Markdown;
// web images get a placeholder from there too.
// An image's own `srcset` goes, so it shows its `src`.
function prepareImages(page: Document): void {
    for (const image of [...page.querySelectorAll('img')]) {
        const source = image.getAttribute('src') ?? '';
        image.removeAttribute('srcset');

        if (imageSourceKind(source) !== 'inline') {
            image.removeAttribute('src');
            image.setAttribute(LOCAL_SOURCE_ATTRIBUTE, source);
        }
    }

    for (const source of [...page.querySelectorAll('source[srcset]')]) {
        const srcset = source.getAttribute('srcset') ?? '';
        const kinds = parseSrcset(srcset).map((candidate) => imageSourceKind(candidate.url));
        source.removeAttribute('srcset');

        if (source.parentElement?.localName === 'picture' && kinds.length > 0 && !kinds.includes('web')) {
            source.setAttribute(LOCAL_SRCSET_ATTRIBUTE, srcset);
        }
    }
}

// An SVG link written with `xlink:href` takes `href`, so the studio follows it like any other link.
function prepareSvgLinks(page: Document): void {
    for (const link of [...page.querySelectorAll('a')]) {
        const address = link.getAttribute('xlink:href');

        if (address == null) {
            continue;
        }

        link.removeAttribute('xlink:href');

        if (!link.hasAttribute('href')) {
            link.setAttribute('href', address);
        }
    }
}

// Every other file a page element loads, such as a poster, a video or an SVG image, comes from the workspace
// as a data: URL; one from the web or outside the workspace is dropped.
function resourceRewrites(page: Document, context: LocalImageContext, paths: Set<string>): Array<Promise<void>> {
    const rewrites: Array<Promise<void>> = [];

    for (const element of [...page.querySelectorAll('*')]) {
        const tag = element.localName;

        for (const name of RESOURCE_ATTRIBUTES) {
            const value = element.getAttribute(name);

            if (value == null || (name === 'href' && LINK_TAGS.has(tag)) || (name === 'src' && OWN_SOURCE_TAGS.has(tag))) {
                continue;
            }

            rewrites.push(rewriteResourceAsync(element, name, value, context, paths));
        }
    }

    return rewrites;
}

async function rewriteResourceAsync(
    element: Element,
    name: string,
    value: string,
    context: LocalImageContext,
    paths: Set<string>,
): Promise<void> {
    const resolved = resolveWorkspaceReference(value, context.documentPath ?? '');

    if (resolved.kind === 'inline' || resolved.kind === 'fragment') {
        return;
    }

    if (resolved.kind !== 'workspace' || context.documentPath == null || context.resources == null) {
        element.removeAttribute(name);

        return;
    }

    paths.add(resolved.path);
    const url = await dataUrlOrNullAsync(context.resources, resolved.path);

    if (url == null) {
        element.removeAttribute(name);

        return;
    }

    // A fragment names a part of the file,
    // such as a symbol of an SVG sprite in `<use href="icons.svg#home">`.
    element.setAttribute(name, resolved.fragment == null ? url : `${url}#${resolved.fragment}`);
}

// A file too large to hold as a data: URL is left out, like a missing one.
async function dataUrlOrNullAsync(resources: DocumentResources, path: string): Promise<string | null> {
    try {
        return await resources.dataUrlAsync(path);
    }
    catch {
        return null;
    }
}
