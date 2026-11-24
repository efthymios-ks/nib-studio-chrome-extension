import { parentPath } from './fileEntry.js';

// Where a link or image address written in a workspace document leads.
export type WorkspaceReference =
    | { readonly kind: 'empty' }
    // `#heading`: a place in the same document.
    | { readonly kind: 'fragment'; readonly fragment: string }
    // An address with a scheme, such as `https:`, `mailto:` or `tel:`, or a protocol-relative `//host` one.
    | { readonly kind: 'web'; readonly url: string }
    // `data:` and `blob:` addresses, which carry or point at their own content.
    | { readonly kind: 'inline'; readonly url: string }
    // A path that climbs above the workspace folder, or a disk path such as `C:\` or `\\server`; never read.
    | { readonly kind: 'outside' }
    // A file or folder in the workspace, by its path from the workspace folder.
    | { readonly kind: 'workspace'; readonly path: string; readonly fragment: string | null };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const DRIVE = /^[a-z]:([\\/]|$)/i;
const INLINE_SCHEMES = new Set(['data', 'blob']);
const DISK_SCHEMES = new Set(['file']);

// Resolves an address as a browser would against the document's folder, with the workspace folder as `/`:
// `?query` is dropped, `%20` and the like are decoded, backslashes count as slashes,
// and nothing ever resolves above the workspace folder.
export function resolveWorkspaceReference(reference: string, documentPath: string): WorkspaceReference {
    const trimmed = reference.trim();

    if (trimmed === '') {
        return { kind: 'empty' };
    }

    if (trimmed.startsWith('#')) {
        return { kind: 'fragment', fragment: decodePart(trimmed.slice(1)) };
    }

    const hashAt = trimmed.indexOf('#');
    const beforeHash = hashAt < 0 ? trimmed : trimmed.slice(0, hashAt);
    const fragment = hashAt < 0 ? null : decodePart(trimmed.slice(hashAt + 1));
    const queryAt = beforeHash.indexOf('?');
    const decoded = decodePart(queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt));

    if (decoded.startsWith('\\\\') || DRIVE.test(decoded)) {
        return { kind: 'outside' };
    }

    const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();

    if (scheme != null) {
        if (INLINE_SCHEMES.has(scheme)) {
            return { kind: 'inline', url: trimmed };
        }

        return DISK_SCHEMES.has(scheme) ? { kind: 'outside' } : { kind: 'web', url: trimmed };
    }

    const path = decoded.replace(/\\/g, '/');

    if (path.startsWith('//')) {
        return { kind: 'web', url: trimmed };
    }

    if (path === '') {
        return { kind: 'workspace', path: documentPath, fragment: emptyToNull(fragment) };
    }

    const base = path.startsWith('/') ? '' : parentPath(documentPath);
    const segments: string[] = [];

    for (const segment of `${base}/${path}`.split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }

        if (segment === '..') {
            if (segments.length === 0) {
                return { kind: 'outside' };
            }

            segments.pop();
            continue;
        }

        segments.push(segment);
    }

    return { kind: 'workspace', path: segments.join('/'), fragment: emptyToNull(fragment) };
}

// The workspace path a link leads to, with its `#fragment`, for its tooltip;
// null for links that don't lead into it.
export function workspaceReferenceLabel(reference: string, documentPath: string): string | null {
    const resolved = resolveWorkspaceReference(reference, documentPath);

    if (resolved.kind !== 'workspace') {
        return null;
    }

    const path = resolved.path === '' ? '/' : resolved.path;

    return resolved.fragment == null ? path : `${path}#${resolved.fragment}`;
}

// Decodes `%xx` escapes, keeping the text as written when they don't form valid UTF-8.
function decodePart(value: string): string {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}

function emptyToNull(value: string | null): string | null {
    return value === '' ? null : value;
}
