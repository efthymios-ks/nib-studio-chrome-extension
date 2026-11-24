import DOMPurify, { type Config } from 'dompurify';

const MAX_PASSES = 16;

// Sanitizes with DOMPurify until the result stops changing. Chrome is done after one pass and confirms it with a second;
// DOM implementations whose node iterator skips the node after a removed one need a pass per skipped node.
// Without a DOM to sanitize in, or if the result never settles, it returns an empty string and shows nothing.
export function purifyHtml(html: string, config: Config): string {
    if (!DOMPurify.isSupported) {
        return '';
    }

    let current = html;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const next = String(DOMPurify.sanitize(current, { ...config, RETURN_DOM: false, RETURN_DOM_FRAGMENT: false }));

        if (next === current) {
            return next;
        }

        current = next;
    }

    return '';
}
