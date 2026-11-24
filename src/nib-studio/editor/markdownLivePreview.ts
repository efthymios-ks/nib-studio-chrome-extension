import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { liveCaretFilter } from './liveCaret.js';
import { liveBlocks, measureDiagramOverhang } from './liveBlocks.js';
import { liveEditing } from './liveEditing.js';
import { scanInline } from './liveInline.js';
import { closeLinkPopover, openLinkPopover } from './linkPopover.js';
import { markdownFormatOverrides } from './markdownFormattingToolbar.js';
import { markdownPasteHandling } from './markdownPaste.js';

export { buildImage } from './liveDecorations.js';
export { toggleTaskAt } from './liveInline.js';
export { renderedDiagrams } from './liveBlocks.js';

// Longer Markdown files open in the Interactive view without the formatting shown, to keep typing fast.
export const LIVE_PREVIEW_MAX_LENGTH = 500_000;

interface InlineDecorations {
    readonly decorations: DecorationSet;
    readonly atomic: DecorationSet;
}

// Headings stay bold without the underline the source view gives them.
const LIVE_HIGHLIGHT_STYLE = HighlightStyle.define([
    { tag: tags.heading, fontWeight: '700' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: 'var(--accent)' },
    { tag: tags.monospace, fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: '0.92em' },
    { tag: tags.quote, color: 'var(--muted)' },
    { tag: tags.comment, color: 'var(--faint)' },
]);

// Edits Markdown like a word processor: the syntax is never shown, whatever the caret does.
// Formatting markers, link addresses, heading and quote marks hide; lists show bullets, numbers and checkboxes;
// code blocks and front matter are boxes edited in place, diagrams draw beside their source while it is edited,
// and tables are grids of cells. The text never changes unless the user edits it.
export function markdownLivePreview(): Extension {
    return [
        liveBlocks(),
        inlinePlugin,
        liveCaretFilter(),
        liveEditing(),
        syntaxHighlighting(LIVE_HIGHLIGHT_STYLE),
        EditorView.editorAttributes.of({ 'data-live-preview': 'true' }),
        markdownPasteHandling(),
        markdownFormatOverrides.of({ id: 'link', run: openLinkPopover }),
    ];
}

function buildInline(view: EditorView): InlineDecorations {
    const decorations: Range<Decoration>[] = [];
    const atomic: Range<Decoration>[] = [];

    for (const { from, to } of view.visibleRanges) {
        for (const item of scanInline(view.state, from, to)) {
            decorations.push(item.decoration.range(item.from, item.to));

            if (item.side != null && item.to > item.from) {
                atomic.push(item.decoration.range(item.from, item.to));
            }
        }
    }

    return { decorations: Decoration.set(decorations, true), atomic: Decoration.set(atomic, true) };
}

const inlinePlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(readonly view: EditorView) {
        const built = buildInline(view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
    }

    update(update: ViewUpdate): void {
        if (
            update.docChanged
            || update.viewportChanged
            || update.selectionSet
            || syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
            const built = buildInline(update.view);
            this.decorations = built.decorations;
            this.atomic = built.atomic;
        }

        // A diagram drawn beside its source makes room under the source when its width changes.
        if (update.geometryChanged) {
            for (const element of update.view.contentDOM.querySelectorAll<HTMLElement>('.cm-live-code-end[data-diagram]')) {
                measureDiagramOverhang(update.view, element);
            }
        }
    }

    destroy(): void {
        closeLinkPopover(this.view);
    }
}, {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
});
