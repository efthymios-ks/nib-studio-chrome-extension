import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { createWorkspaceResources } from '../../common/fs/workspaceResources.js';
import { destroyLiveEditors, mountLiveEditor } from '../testing/liveEditor.js';
import { ignoreSelectionChange, settleAsync } from '../testing/testHelpers.js';
import { atomicRangesOf, buildImage, InlineRuleWidget, liveImageContext, LiveImageWidget } from './liveDecorations.js';

const DATA_IMAGE = 'data:image/png;base64,AA';

const views: EditorView[] = [];

function mountView(state: EditorState): EditorView {
    const view = new EditorView({ state, parent: document.body });
    views.push(view);

    return view;
}

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    for (const view of views.splice(0)) {
        view.destroy();
    }

    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

describe('buildImage', () => {
    it('labels an image with no address by its alt text', () => {
        const label = buildImage('  ', 'Logo');

        expect(label.textContent).toBe('Image not shown: Logo');
        expect(label.getAttribute('title')).toBe('Logo');
    });

    it('titles a placeholder with its address when the image has no alt text', () => {
        expect(buildImage('https://example.com/a.png', '').getAttribute('title')).toBe('https://example.com/a.png');
    });

    describe('with a workspace', () => {
        const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        function workspaceContext(documentPath: string | null = 'docs/notes.md') {
            const folder = new FakeDirectoryHandle('workspace');
            folder.addFile('media/dot.png', PNG);

            return { documentPath, resources: createWorkspaceResources(asRoot(folder)) };
        }

        beforeEach(() => {
            vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:live/1');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('reads a workspace image into the frame it returns, and shows it at once the next time', async () => {
            const context = workspaceContext();
            const frame = buildImage('../media/dot.png', 'Dot', context);

            expect(frame.className).toBe('cm-live-image-frame');
            await settleAsync();
            expect(frame.querySelector('img.cm-live-image')?.getAttribute('src')).toBe('blob:live/1');

            const again = buildImage('../media/dot.png', 'Dot', context);

            expect(again.tagName).toBe('IMG');
            expect(again.getAttribute('src')).toBe('blob:live/1');
        });

        it('turns into a placeholder for a missing image', async () => {
            const frame = buildImage('missing.png', 'Gone', workspaceContext());
            await settleAsync();

            expect(frame.className).toBe('cm-live-image-blocked');
            expect(frame.textContent).toBe('Image not found: missing.png');
            expect(frame.title).toBe('Gone');
        });

        it('says a file from outside the workspace shows no relative images, and still blocks web ones', () => {
            expect(buildImage('dot.png', '', { documentPath: null, resources: null }).textContent).toBe('Image not shown (file outside the workspace): dot.png');
            expect(buildImage('https://example.com/a.png', '', workspaceContext()).textContent).toBe('Remote image not loaded (offline): https://example.com/a.png');
        });

        it('shows a workspace image in the Interactive view', async () => {
            const view = mountLiveEditor('Look ![Dot](../media/dot.png)', { imageContext: workspaceContext() }).view;
            await settleAsync();

            expect(view.contentDOM.querySelector('img.cm-live-image')?.getAttribute('src')).toBe('blob:live/1');
        });
    });
});

describe('LiveImageWidget', () => {
    it('draws the image through the view\'s workspace', () => {
        const view = mountView(EditorState.create({ extensions: [liveImageContext.of(null)] }));
        const element = new LiveImageWidget(DATA_IMAGE, 'Dot').toDOM(view);

        expect(element.tagName).toBe('IMG');
        expect(element.className).toBe('cm-live-image');
        expect(element.getAttribute('src')).toBe(DATA_IMAGE);
        expect(element.getAttribute('alt')).toBe('Dot');
    });

    it('shows a relative image as a placeholder in a view with no workspace', () => {
        const view = mountView(EditorState.create());

        expect(new LiveImageWidget('dot.png', '').toDOM(view).textContent).toBe('Image not shown (file outside the workspace): dot.png');
    });

    it('is the same widget for the same address and alt text', () => {
        const widget = new LiveImageWidget(DATA_IMAGE, 'Dot');

        expect(widget.eq(new LiveImageWidget(DATA_IMAGE, 'Dot'))).toBe(true);
        expect(widget.eq(new LiveImageWidget(DATA_IMAGE, 'Other'))).toBe(false);
        expect(widget.eq(new LiveImageWidget('other.png', 'Dot'))).toBe(false);
    });
});

describe('InlineRuleWidget', () => {
    it('draws a rule that screen readers skip', () => {
        const rule = new InlineRuleWidget().toDOM();

        expect(rule.tagName).toBe('SPAN');
        expect(rule.className).toBe('cm-live-rule');
        expect(rule.getAttribute('aria-hidden')).toBe('true');
        expect(new InlineRuleWidget().eq()).toBe(true);
    });
});

describe('atomicRangesOf', () => {
    it('gives the view the atomic ranges the field keeps', () => {
        const atomic: DecorationSet = Decoration.set([Decoration.replace({}).range(1, 3)]);
        const field = StateField.define<{ readonly atomic: DecorationSet }>({
            create: () => ({ atomic }),
            update: (value) => value,
        });
        const view = mountView(EditorState.create({ doc: 'abcdef', extensions: [field, atomicRangesOf(field)] }));
        const sets = view.state.facet(EditorView.atomicRanges).map((ranges) => ranges(view));

        expect(sets).toContain(atomic);
    });

    it('gives no ranges to a view without the field', () => {
        const field = StateField.define<{ readonly atomic: DecorationSet }>({
            create: () => ({ atomic: Decoration.none }),
            update: (value) => value,
        });
        const view = mountView(EditorState.create({ extensions: [atomicRangesOf(field)] }));
        const sets = view.state.facet(EditorView.atomicRanges).map((ranges) => ranges(view));

        expect(sets).toEqual([Decoration.none]);
    });
});
