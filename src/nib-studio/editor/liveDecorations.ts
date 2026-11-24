import { Facet, type Extension, type StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { loadLocalImageAsync, peekLocalImage, type LocalImageContext } from '../../common/markdown/localImages.js';
import { h } from '../app/dom.js';

// The workspace the Interactive view reads its images from; without one, a relative image shows a placeholder.
export const liveImageContext = Facet.define<LocalImageContext | null, LocalImageContext | null>({
    combine: (values) => values[0] ?? null,
});

// A view with no workspace reads no images, as a file from outside the workspace doesn't.
const NO_WORKSPACE: LocalImageContext = { documentPath: null, resources: null };

// Inline `data:` images load, and so do workspace images when the view has a workspace to read them from;
// a web image, or one that can't be read, shows the previews' placeholder and is never fetched.
export function buildImage(source: string, alt: string, context: LocalImageContext | null = null): HTMLElement {
    const trimmed = source.trim();
    const title = alt === '' ? trimmed : alt;
    const imageContext = context ?? NO_WORKSPACE;
    const ready = peekLocalImage(trimmed, alt, imageContext);

    if (ready != null) {
        return ready.kind === 'image'
            ? h('img', { class: 'cm-live-image', attrs: { alt, src: ready.url } })
            : h('span', { class: 'cm-live-image-blocked', text: ready.label, attrs: { title } });
    }

    // Not read yet: the frame holds the image, or its placeholder once the file turns out missing.
    const image = h('img', { class: 'cm-live-image', attrs: { alt } });
    const frame = h('span', { class: 'cm-live-image-frame', children: [image] });
    void (async () => {
        const loaded = await loadLocalImageAsync(trimmed, alt, imageContext, 'blob');

        if (loaded.kind === 'image') {
            image.setAttribute('src', loaded.url);

            return;
        }

        frame.className = 'cm-live-image-blocked';
        frame.title = title;
        frame.textContent = loaded.label;
    })();

    return frame;
}

// An image drawn in place of its source, read through the view's workspace.
export class LiveImageWidget extends WidgetType {
    constructor(readonly source: string, readonly alt: string) {
        super();
    }

    override eq(other: LiveImageWidget): boolean {
        return other.source === this.source && other.alt === this.alt;
    }

    toDOM(view: EditorView): HTMLElement {
        return buildImage(this.source, this.alt, view.state.facet(liveImageContext));
    }
}

// A horizontal rule drawn within a line.
export class InlineRuleWidget extends WidgetType {
    override eq(): boolean {
        return true;
    }

    toDOM(): HTMLElement {
        return h('span', { class: 'cm-live-rule', attrs: { 'aria-hidden': 'true' } });
    }
}

// The hidden and replaced ranges a state field keeps, which the caret, arrow keys and deletion treat as one unit.
export function atomicRangesOf<T extends { readonly atomic: DecorationSet }>(field: StateField<T>): Extension {
    return EditorView.atomicRanges.of((view) => view.state.field(field, false)?.atomic ?? Decoration.none);
}
