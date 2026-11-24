import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { h } from '../app/dom.js';
import { liveStructure } from './liveBlocks.js';
import { linkParts } from './liveInline.js';
import { asUndoStep, expandToWord } from './liveTransactions.js';

// What Ctrl+K edits: a link, an angle-bracket link, a bare address, or text to turn into a link.
export type LinkTargetKind = 'link' | 'autolink' | 'url' | 'text';

export interface LinkTarget {
    readonly kind: LinkTargetKind;
    // The whole link, or the text to link.
    readonly from: number;
    readonly to: number;
    // The link's text as written, formatting included.
    readonly text: string;
    readonly url: string;
    // The link's title, as written with its quotes, kept when the address changes.
    readonly title: string;
}

interface OpenLinkPopover {
    readonly view: EditorView;
    readonly element: HTMLElement;
    readonly detach: () => void;
}

// What the popover edits: the address it starts with, where it sits, and the change an address makes.
export interface LinkPopoverRequest {
    readonly url: string;
    // Linking text that is no link yet, as against editing a link's address.
    readonly isNew: boolean;
    // The document position the popover sits under.
    readonly anchor: number;
    // The change that gives the address, or null when nothing changes.
    readonly apply: (state: EditorState, url: string) => TransactionSpec | null;
}

const POPOVER_WIDTH_PIXELS = 320;
const POPOVER_MARGIN_PIXELS = 8;
const POPOVER_GAP_PIXELS = 4;
const LINK_NODES = new Set(['Link', 'Autolink', 'URL']);
const NEEDS_BRACKETS = /[\s()<>]/;

let open: OpenLinkPopover | null = null;

// The link around the selection, or else the selected text or the word at the caret to link.
// With no word at the caret, the target is empty and the link's text becomes its address.
export function linkTargetAt(state: EditorState): LinkTarget {
    const main = state.selection.main;
    const node = enclosingLinkNode(state, main.from, main.to);

    if (node != null) {
        const target = targetFromNode(state, node);

        if (target != null) {
            return target;
        }
    }

    const range = expandToWord(state, main);

    return { kind: 'text', from: range.from, to: range.to, text: state.sliceDoc(range.from, range.to), url: '', title: '' };
}

function enclosingLinkNode(state: EditorState, from: number, to: number): SyntaxNode | null {
    for (const side of [1, -1] as const) {
        for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, side); node != null; node = node.parent) {
            const isLink = LINK_NODES.has(node.name) && (node.name !== 'URL' || node.parent == null || !LINK_NODES.has(node.parent.name));

            if (isLink && node.from <= from && to <= node.to) {
                return node;
            }
        }
    }

    return null;
}

function targetFromNode(state: EditorState, node: SyntaxNode): LinkTarget | null {
    if (node.name === 'Link') {
        const parts = linkParts(state, node, liveStructure(state));

        if (parts == null) {
            return null;
        }

        const title = node.getChild('LinkTitle');

        return {
            kind: 'link',
            from: node.from,
            to: node.to,
            text: state.sliceDoc(parts.textFrom, parts.textTo),
            url: parts.url,
            title: title == null ? '' : state.sliceDoc(title.from, title.to),
        };
    }

    const isAutolink = node.name === 'Autolink';
    const text = isAutolink ? state.sliceDoc(node.from + 1, node.to - 1) : state.sliceDoc(node.from, node.to);

    return { kind: isAutolink ? 'autolink' : 'url', from: node.from, to: node.to, text, url: text, title: '' };
}

function destination(url: string): string {
    return NEEDS_BRACKETS.test(url) ? `<${url}>` : url;
}

// The change that gives the target the address, as one undo step; an empty address removes the link and keeps its text.
// Null when nothing changes.
export function setLinkUrl(state: EditorState, target: LinkTarget, url: string): TransactionSpec | null {
    const address = url.trim();
    const replacement = linkReplacement(target, address);

    if (replacement == null || replacement === state.sliceDoc(target.from, target.to)) {
        return null;
    }

    return asUndoStep({
        changes: { from: target.from, to: target.to, insert: replacement },
        selection: EditorSelection.cursor(target.from + replacement.length),
    }, 'input.link');
}

function linkReplacement(target: LinkTarget, address: string): string | null {
    if (target.kind === 'link') {
        if (address === '') {
            return target.text;
        }

        const title = target.title === '' ? '' : ` ${target.title}`;

        return `[${target.text}](${destination(address)}${title})`;
    }

    if (target.kind === 'autolink' || target.kind === 'url') {
        if (address === '') {
            return target.kind === 'autolink' ? target.text : null;
        }

        return target.kind === 'autolink' ? `<${address}>` : address;
    }

    if (address === '') {
        return null;
    }

    return `[${target.text === '' ? address : target.text}](${destination(address)})`;
}

// Opens the link popover under the link or the text to link: one address field,
// where Enter applies, Esc cancels, and an empty address removes the link.
export function openLinkPopover(view: EditorView): boolean {
    if (view.state.readOnly) {
        return false;
    }

    const target = linkTargetAt(view.state);

    return showLinkPopover(view, {
        url: target.url,
        isNew: target.kind === 'text',
        anchor: target.from,
        apply: (state, url) => setLinkUrl(state, target, url),
    });
}

// The popover itself, for any document kind that has links.
export function showLinkPopover(view: EditorView, request: LinkPopoverRequest): boolean {
    if (view.state.readOnly) {
        return false;
    }

    closeLinkPopover();
    const docAtOpen = view.state.doc;
    const input = h('input', {
        class: 'input link-popover-input',
        attrs: {
            type: 'text',
            spellcheck: 'false',
            placeholder: 'https://',
            'aria-label': 'Link address',
        },
    });
    input.value = request.url;
    const hint = h('div', {
        class: 'link-popover-hint',
        text: request.isNew
            ? 'Enter to link · Esc to cancel'
            : 'Enter to apply · Esc to cancel · Empty removes the link',
    });
    const element = h('div', {
        class: 'link-popover',
        attrs: { role: 'dialog', 'aria-label': request.isNew ? 'Add link' : 'Edit link' },
        children: [input, hint],
    });

    const finish = (shouldApply: boolean): void => {
        const isCurrent = open?.element === element;
        closeLinkPopover();

        if (!isCurrent) {
            return;
        }

        if (shouldApply && view.state.doc === docAtOpen) {
            const spec = request.apply(view.state, input.value);

            if (spec != null) {
                view.dispatch(spec);
            }
        }

        view.focus();
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }
    });

    const onOutside = (event: Event): void => {
        if (!element.contains(event.target as Node | null)) {
            finish(false);
        }
    };
    const onScroll = (): void => finish(false);

    document.addEventListener('pointerdown', onOutside, true);
    view.scrollDOM.addEventListener('scroll', onScroll);
    document.body.append(element);
    place(view, element, request.anchor);
    open = {
        view,
        element,
        detach: () => {
            document.removeEventListener('pointerdown', onOutside, true);
            view.scrollDOM.removeEventListener('scroll', onScroll);
        },
    };
    // A bar button gives focus back to the editor after its command; the field takes it once that is done.
    queueMicrotask(() => {
        if (open?.element === element) {
            input.focus();
            input.select();
        }
    });

    return true;
}

export function closeLinkPopover(view?: EditorView): void {
    if (open == null || (view != null && open.view !== view)) {
        return;
    }

    const current = open;
    open = null;
    current.detach();
    current.element.remove();
}

// Under the target's first character, within the window.
function place(view: EditorView, element: HTMLElement, position: number): void {
    const coords = view.coordsAtPos(position) ?? view.coordsAtPos(view.state.selection.main.head);
    const width = Math.min(POPOVER_WIDTH_PIXELS, window.innerWidth - POPOVER_MARGIN_PIXELS * 2);
    const left = Math.min(coords?.left ?? POPOVER_MARGIN_PIXELS, window.innerWidth - width - POPOVER_MARGIN_PIXELS);
    element.style.width = `${width}px`;
    element.style.left = `${Math.max(POPOVER_MARGIN_PIXELS, left)}px`;
    element.style.top = `${(coords?.bottom ?? POPOVER_MARGIN_PIXELS) + POPOVER_GAP_PIXELS}px`;
}
