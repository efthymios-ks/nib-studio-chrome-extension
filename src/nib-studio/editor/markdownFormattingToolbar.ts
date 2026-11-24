import { Facet, Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import type { EditorBarButton } from './editorBar.js';
import { MARKDOWN_FORMATS, type MarkdownFormat, type MarkdownFormatGroup, type MarkdownFormatId } from './markdownFormatting.js';

export interface MarkdownFormatOverride {
    readonly id: MarkdownFormatId;
    // Returns whether it handled the format; when not, the format applies as usual.
    readonly run: (view: EditorView) => boolean;
}

// Lets a view run a format its own way, such as the Interactive view editing a link's address in a popover.
export const markdownFormatOverrides = Facet.define<MarkdownFormatOverride>();

const BUTTON_GROUP_ORDER: ReadonlyArray<MarkdownFormatGroup> = ['inline', 'block'];

// The Markdown formatting shortcuts, such as `Ctrl+B`, for the Editor, Interactive and Split views.
export function markdownFormattingKeymap(): Extension {
    const bindings: KeyBinding[] = [];

    for (const format of MARKDOWN_FORMATS) {
        if (format.key == null) {
            continue;
        }

        bindings.push({
            key: format.key,
            run: (view) => runMarkdownFormat(view, format),
        });
    }

    return Prec.high(keymap.of(bindings));
}

export function runMarkdownFormat(view: EditorView, format: MarkdownFormat): boolean {
    if (view.state.readOnly) {
        return false;
    }

    const override = view.state.facet(markdownFormatOverrides).find((candidate) => candidate.id === format.id);

    if (override != null && override.run(view)) {
        return true;
    }

    view.dispatch(format.apply(view.state));

    return true;
}

// The formatting buttons of the docked editor bar: inline formats, then block formats.
export function markdownFormattingButtonGroups(): ReadonlyArray<ReadonlyArray<EditorBarButton>> {
    return BUTTON_GROUP_ORDER.map((group) => MARKDOWN_FORMATS
        .filter((format) => format.group === group)
        .map((format) => toBarButton(format)));
}

function toBarButton(format: MarkdownFormat): EditorBarButton {
    const menu = format.menu;

    return {
        id: format.id,
        label: format.label,
        glyph: format.glyph,
        shortcut: format.shortcut,
        run: (view) => {
            runMarkdownFormat(view, format);
        },
        isPressed: format.isActive,
        menu: menu == null
            ? undefined
            : (state) => menu(state).map((choice) => ({
                id: choice.id,
                label: choice.label,
                isCurrent: choice.isCurrent,
                run: (view: EditorView) => {
                    view.dispatch(choice.apply(view.state));
                },
            })),
    };
}
