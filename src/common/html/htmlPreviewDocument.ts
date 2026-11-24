import { resolveWorkspaceReference } from '../fs/workspaceReference.js';
import {
    imageSourceKind,
    LOCAL_SOURCE_ATTRIBUTE,
    LOCAL_SRCSET_ATTRIBUTE,
    parseSrcset,
    resolveLocalImagesAsync,
    type LocalImageContext,
} from '../markdown/localImages.js';
import { titleWorkspaceLinks } from './linkTitles.js';
import { purifyHtml } from './purifyHtml.js';
import { inlineStyleSheetAsync, rewriteUrlsAsync, type StyleSheetContext } from './styleSheets.js';

export interface HtmlPreviewDocument {
    // The page for a sandboxed frame's `srcdoc`.
    readonly html: string;
    // Every workspace path the page read, found or not, so a change to one of them refreshes it.
    readonly paths: ReadonlySet<string>;
}

const HTML_PREVIEW_PLACEHOLDER_CLASS = 'nib-image-placeholder';

// Attributes that load a file. Links (`a`, `area`) and images (`img`,
// `<picture>` sources) have their own handling.
const RESOURCE_ATTRIBUTES = Object.freeze(['src', 'poster', 'background', 'href', 'xlink:href']);
const LINK_TAGS = new Set(['a', 'area']);

// The page's own `<style>` elements and `style` attributes stay, since the frame keeps them from the studio.
// Scripts never run: they are dropped here, and the frame allows none.
const PREVIEW_CONFIG = Object.freeze({
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['link', 'style'],
    ADD_ATTR: ['rel'],
    FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'base', 'meta', 'portal', 'noscript'],
    FORBID_ATTR: ['target', 'ping', 'formaction', 'action', 'srcdoc'],
    KEEP_CONTENT: true,
});

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

// Sanitizes an HTML file for the sandboxed preview and makes it self-contained: linked workspace style sheets
// are read in, images become blob URLs, and nothing from the web or outside the workspace loads.
export async function buildHtmlPreviewAsync(text: string, context: LocalImageContext): Promise<HtmlPreviewDocument> {
    const page = new DOMParser().parseFromString(`<!doctype html>${purifyHtml(text, PREVIEW_CONFIG)}`, 'text/html');
    const paths = new Set<string>();
    const basePath = context.documentPath ?? '';
    const sheetContext = { basePath, resources: context.resources, paths };

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

    prepareImages(page);
    prepareSvgLinks(page);
    titleWorkspaceLinks(page, context.documentPath);
    await Promise.all(resourceRewrites(page, context, paths));

    const imagePaths = await resolveLocalImagesAsync(page, context, { format: 'blob', placeholderClass: HTML_PREVIEW_PLACEHOLDER_CLASS });

    for (const path of imagePaths) {
        paths.add(path);
    }

    const placeholderStyle = page.createElement('style');
    placeholderStyle.textContent = PLACEHOLDER_STYLE;
    page.head.prepend(placeholderStyle);

    return { html: `<!doctype html>\n${page.documentElement.outerHTML}`, paths };
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
// as a blob URL; one from the web or outside the workspace is dropped.
function resourceRewrites(page: Document, context: LocalImageContext, paths: Set<string>): Array<Promise<void>> {
    const rewrites: Array<Promise<void>> = [];

    for (const element of [...page.querySelectorAll('*')]) {
        const tag = element.localName;

        for (const name of RESOURCE_ATTRIBUTES) {
            const value = element.getAttribute(name);

            if (value == null || (name === 'href' && LINK_TAGS.has(tag)) || (name === 'src' && tag === 'img')) {
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
    const url = await context.resources.imageUrlAsync(resolved.path);

    if (url == null) {
        element.removeAttribute(name);

        return;
    }

    // A fragment names a part of the file,
    // such as a symbol of an SVG sprite in `<use href="icons.svg#home">`.
    element.setAttribute(name, resolved.fragment == null ? url : `${url}#${resolved.fragment}`);
}
