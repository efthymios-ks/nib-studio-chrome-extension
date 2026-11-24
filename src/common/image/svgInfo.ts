// SVG files are only read this far for their size, since the root element comes first.
export const SVG_INFO_MAX_BYTES = 64 * 1024;

export interface SvgInfo {
    readonly width: string | null;
    readonly height: string | null;
    readonly viewBox: string | null;
}

const ROOT_TAG = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// The width, height and viewBox written on the root <svg> element, or null when there is no root element.
export function readSvgInfo(text: string): SvgInfo | null {
    const root = ROOT_TAG.exec(text);

    if (root == null) {
        return null;
    }

    const attributes = new Map<string, string>();

    for (const match of (root[1] ?? '').matchAll(ATTRIBUTE)) {
        attributes.set(match[1] ?? '', (match[2] ?? match[3] ?? '').trim());
    }

    const value = (name: string): string | null => {
        const found = attributes.get(name);

        return found == null || found === '' ? null : found;
    };

    return { width: value('width'), height: value('height'), viewBox: value('viewBox') };
}
