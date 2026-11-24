import { resolveWorkspaceReference } from '../fs/workspaceReference.js';
import type { DocumentResources } from '../fs/workspaceResources.js';

export interface StyleSheetContext {
    // The workspace path of the file the CSS came from, which its relative addresses resolve against.
    readonly basePath: string;
    // Null when there is no workspace to read from.
    readonly resources: DocumentResources | null;
    // Collects every workspace path read, found or not, so a change to one of them refreshes the page.
    readonly paths: Set<string>;
}

type Replacer = (match: RegExpMatchArray) => Promise<string>;

const MAX_IMPORT_DEPTH = 4;
const IMPORT_RULE = /@import\s+(?:url\(\s*(['"]?)([^'")]*?)\1\s*\)|(['"])(.*?)\3)\s*([^;]*);?/gi;
const URL_FUNCTION = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
// `image-set()` with its arguments, `url()` ones included; a plain string in it is an address too.
const IMAGE_SET = /image-set\(((?:[^()]|\([^()]*\))*)\)/gi;
const BARE_STRING = /(?<!url\(\s*)(["'])(.*?)\1/g;

// Makes a style sheet self-contained for a sandboxed page that must not fetch anything:
// a workspace `@import` is read in, a `url()` of a workspace file becomes a data: URL,
// which fonts load from too,
// and an address on the web or outside the workspace is dropped.
export async function inlineStyleSheetAsync(css: string, context: StyleSheetContext): Promise<string> {
    return await inlineAsync(css, context, [context.basePath]);
}

// `chain` holds the sheets being read, outermost first, so an `@import` loop stops.
async function inlineAsync(css: string, context: StyleSheetContext, chain: ReadonlyArray<string>): Promise<string> {
    const basePath = chain.at(-1) ?? context.basePath;
    const withImports = await replaceAsync(css, IMPORT_RULE, async (match) => {
        const reference = match[2] ?? match[4] ?? '';
        const condition = (match[5] ?? '').trim();
        const resolved = resolveWorkspaceReference(reference, basePath);

        if (resolved.kind !== 'workspace' || context.resources == null || chain.length > MAX_IMPORT_DEPTH) {
            return '';
        }

        context.paths.add(resolved.path);
        const sheet = await context.resources.textAsync(resolved.path);

        if (sheet == null || chain.includes(sheet.path)) {
            return '';
        }

        const inner = await inlineAsync(sheet.text, context, [...chain, sheet.path]);

        return condition === '' ? inner : `@media ${condition} {\n${inner}\n}`;
    });

    return await rewriteUrlsAsync(withImports, basePath, context);
}

// Rewrites every `url()` of a style sheet or a `style` attribute, and every address in an `image-set()`:
// data: and `#id` addresses stay, workspace files become data: URLs, and anything else becomes `none`.
export async function rewriteUrlsAsync(css: string, basePath: string, context: Omit<StyleSheetContext, 'basePath'>): Promise<string> {
    const withUrls = css.replace(IMAGE_SET, (match: string, inner: string) => {
        return match.replace(inner, inner.replace(BARE_STRING, 'url($1$2$1)'));
    });

    return await replaceAsync(withUrls, URL_FUNCTION, async (match) => {
        const reference = (match[2] ?? '').trim();
        const resolved = resolveWorkspaceReference(reference, basePath);

        if (resolved.kind === 'fragment' || resolved.kind === 'inline') {
            return match[0];
        }

        if (resolved.kind !== 'workspace' || context.resources == null) {
            return 'none';
        }

        context.paths.add(resolved.path);
        const dataUrl = await context.resources.dataUrlAsync(resolved.path);
        const fragment = resolved.fragment == null ? '' : `#${resolved.fragment}`;

        return dataUrl == null ? 'none' : `url("${dataUrl}${fragment}")`;
    });
}

async function replaceAsync(text: string, pattern: RegExp, replacer: Replacer): Promise<string> {
    const matches = [...text.matchAll(pattern)];
    const replacements = await Promise.all(matches.map(replacer));
    const parts: string[] = [];
    let last = 0;

    matches.forEach((match, index) => {
        const start = match.index ?? 0;
        parts.push(text.slice(last, start), replacements[index] ?? '');
        last = start + match[0].length;
    });
    parts.push(text.slice(last));

    return parts.join('');
}
