import MarkdownIt from 'markdown-it';
import { encodeBase64 } from '../encoding/base64.js';
import { escapeHtml } from '../html/escapeHtml.js';
import { headingSlug } from './headingSlug.js';
import { HEADING_ID_ATTRIBUTE, sanitizeMarkdownHtml } from './sanitizeMarkdownHtml.js';

const MERMAID_FENCE = 'mermaid';

export interface MarkdownPreview {
    readonly html: string;
    readonly diagrams: ReadonlyArray<MermaidBlock>;
}

export interface MermaidBlock {
    readonly id: string;
    readonly source: string;
}

export interface MarkdownRenderOptions {
    // 'block' (default) swaps images that would load from outside the extension for a placeholder.
    readonly remoteImages?: 'block' | 'keep';
    // True gives each code block a Copy button, for the preview, which handles its clicks;
    // pages and copies that leave the studio have none, since it does nothing there.
    readonly hasCopyButtons?: boolean;
}

export function renderMarkdown(source: string, options: MarkdownRenderOptions = {}): MarkdownPreview {
    const diagrams: MermaidBlock[] = [];
    // Raw HTML passes through to the sanitiser,
    // which keeps what a README needs and drops anything that could run.
    const parser = new MarkdownIt({
        html: true,
        linkify: true,
        breaks: false,
        typographer: false,
    });

    // Give every heading a stable id so in-document links can target it.
    parser.core.ruler.push('nib-heading-ids', (state) => {
        const usedSlugs = new Map<string, number>();

        for (let index = 0; index < state.tokens.length; index += 1) {
            const token = state.tokens[index];

            if (token == null || !token.type.startsWith('heading_open')) {
                continue;
            }

            const inline = state.tokens[index + 1];
            const content = inline?.content ?? '';
            const baseSlug = headingSlug(content);

            if (baseSlug === '') {
                continue;
            }

            const seen = usedSlugs.get(baseSlug) ?? 0;
            const slug = seen === 0 ? baseSlug : `${baseSlug}-${seen}`;
            usedSlugs.set(baseSlug, seen + 1);
            token.attrSet(HEADING_ID_ATTRIBUTE, slug);
        }
    });

    // A table column's alignment as the `align` attribute the sanitiser keeps, where markdown-it writes a style.
    parser.core.ruler.push('nib-table-align', (state) => {
        for (const token of state.tokens) {
            const alignment = /text-align:\s*(left|center|right)/.exec(String(token.attrGet('style') ?? ''))?.[1];

            if ((token.type !== 'th_open' && token.type !== 'td_open') || alignment == null) {
                continue;
            }

            token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
            token.attrSet('align', alignment);
        }
    });

    parser.renderer.rules.fence = (tokens, index) => {
        const token = tokens[index];

        if (token == null) {
            return '';
        }

        const info = (token.info ?? '').trim().toLowerCase();

        if (info === MERMAID_FENCE) {
            const id = `mermaid-${diagrams.length}`;
            diagrams.push({ id, source: token.content });

            return `<div class="md-mermaid" data-mermaid-id="${id}"></div>`;
        }

        const language = info === '' ? '' : ` language-${escapeHtml(info)}`;
        const pre = `<pre class="md-code${language}"><code>${escapeHtml(token.content)}</code></pre>`;

        if (options.hasCopyButtons !== true) {
            return pre;
        }

        // The fence's content ends with the line break before the closing fence, which isn't part of the code.
        const encodedSource = encodeBase64(token.content.replace(/\r?\n$/, ''));
        const button = `<button class="md-code-copy" type="button" data-code="${encodedSource}" aria-label="Copy code" title="Copy code"><span aria-hidden="true">⎘</span></button>`;

        return `<div class="md-code-wrap">${pre}${button}</div>`;
    };

    const html = sanitizeMarkdownHtml(parser.render(source), { remoteImages: options.remoteImages ?? 'block' });

    return {
        html,
        diagrams,
    };
}
