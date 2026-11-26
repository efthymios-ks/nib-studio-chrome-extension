import {
    Annotation,
    ChangeSet,
    EditorSelection,
    EditorState,
    Prec,
    Transaction,
    type ChangeSpec,
    type Extension,
    type TransactionSpec,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { escapeHtmlText } from '../../common/html/escapeHtml.js';
import { htmlItems, isProtectedItem, type HtmlItem } from './htmlLiveItems.js';
import {
    adjacentElement,
    decodeHtmlText,
    enclosingElements,
    HEADING_LEVELS,
    LIST_ELEMENTS,
    renameChanges,
    TEXT_BLOCKS,
    type HtmlElement,
} from './htmlStructure.js';
import { clusterAfter, clusterBefore, rangeAround, skipRanges, subtractSpans } from './liveRanges.js';
import { asUndoStep, changesKeepingCaret } from './liveTransactions.js';

// Marks an edit the Interactive view made itself, with its tags placed on purpose,
// so the tag guard lets it through and its caret stays exactly where it was put.
export const structuralEdit = Annotation.define<boolean>();

// User edits whose deletions may not take tags with them; undo,
// redo and text synced from elsewhere pass untouched.
const GUARDED_EVENTS = ['input.type', 'input.paste', 'input.drop', 'input.complete', 'delete', 'move.drop'];
const ESCAPED = /[<>&]/;
const MAX_CARET_STEPS = 8;
// How far to look for the line break and indentation around a `<br>`.
const LOOK_AROUND = 200;

// Edits HTML like a document: tags stay as they are whatever is typed or deleted,
// Enter splits paragraphs and list items,
// Backspace and Delete join them at their edges, and typed or pasted text is escaped,
// so it never turns into markup.
export function htmlLiveEditing(): Extension {
    return [
        guardTags(),
        canonicalCaretFilter(),
        Prec.highest(EditorView.inputHandler.of(escapeTypedMarkup)),
        Prec.high(keymap.of([
            { key: 'Enter', run: insertBlockBreak },
            { key: 'Shift-Enter', run: insertLineBreak },
            { key: 'Backspace', run: (view) => deleteVisible(view, -1) },
            { key: 'Delete', run: (view) => deleteVisible(view, 1) },
        ])),
        Prec.high(EditorView.domEventHandlers({
            paste: (event, view) => {
                const text = event.clipboardData?.getData('text/plain');

                if (text == null || view.state.readOnly) {
                    return false;
                }

                event.preventDefault();
                const pasted = view.state.replaceSelection(escapeHtmlText(text));
                view.dispatch(view.state.update(pasted, { userEvent: 'input.paste', scrollIntoView: true }));

                return true;
            },
            copy: (event, view) => copySelection(event, view, false),
            cut: (event, view) => copySelection(event, view, true),
            // Moving a selection by dragging would carry its hidden tags along.
            dragstart: (event) => {
                event.preventDefault();

                return true;
            },
        })),
    ];
}

// What a user edit would delete of a tag is kept: only the visible text in its way goes,
// and the typed text goes where the first of it was. Dropped text is escaped, as typed and pasted text are.
function guardTags(): Extension {
    return EditorState.transactionFilter.of((transaction) => {
        if (
            !transaction.docChanged
            || transaction.annotation(structuralEdit) === true
            || !GUARDED_EVENTS.some((event) => transaction.isUserEvent(event))
        ) {
            return transaction;
        }

        const kept = htmlItems(transaction.startState).filter(isProtectedItem);
        const isDrop = transaction.isUserEvent('input.drop');
        let touchesTags = false;
        transaction.changes.iterChangedRanges((fromA, toA) => {
            touchesTags ||= kept.some((item) => item.from < toA && fromA < item.to);
        });

        if (!touchesTags && !isDrop) {
            return transaction;
        }

        const specs: ChangeSpec[] = [];
        const carets: Array<{ at: number; length: number }> = [];
        transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            const insert = isDrop ? escapeHtmlText(inserted.toString()) : inserted.toString();
            const pieces = subtractSpans({ from: fromA, to: toA }, kept);
            const at = pieces[0]?.from ?? outsideOf(fromA, kept);

            if (pieces.length === 0) {
                specs.push({ from: at, insert });
            }

            pieces.forEach((piece, index) => {
                specs.push({ from: piece.from, to: piece.to, insert: index === 0 ? insert : '' });
            });
            carets.push({ at, length: insert.length });
        });
        const changes = ChangeSet.of(specs, transaction.startState.doc.length);
        const first = carets[0];
        const end = first == null ? transaction.startState.selection.main.head : changes.mapPos(first.at, -1) + first.length;

        return {
            changes,
            selection: EditorSelection.cursor(end),
            scrollIntoView: true,
            annotations: [Transaction.userEvent.of(transaction.annotation(Transaction.userEvent) ?? 'input'), structuralEdit.of(true)],
        };
    });
}

// A position outside every kept item: the end of the one it falls inside, or the position itself.
function outsideOf(position: number, kept: ReadonlyArray<HtmlItem>): number {
    return rangeAround(kept, position)?.to ?? position;
}

// A caret moved by a click or an arrow key goes to the side of the hidden tags where typing does what it shows:
// after plain text before bold, it stays outside the bold; at the end of bold text, inside it;
// and at the start of a line, past its indentation and the tags that open its block.
// An arrow key always moves the caret by what the view shows, never only across hidden tags.
function canonicalCaretFilter(): Extension {
    return EditorState.transactionFilter.of((transaction) => {
        const selection = transaction.selection;

        if (selection == null || transaction.docChanged || transaction.annotation(structuralEdit) === true || !selection.main.empty) {
            return transaction;
        }

        const state = transaction.startState;
        const items = htmlItems(state);
        const before = state.selection.main.head;
        let head = selection.main.head;
        let caret = canonicalCaret(state, head, items);
        const isKey = transaction.isUserEvent('select') && !transaction.isUserEvent('select.pointer');
        const start = canonicalCaret(state, before, items);

        for (let step = 0; isKey && head !== before && caret === start && step < MAX_CARET_STEPS; step += 1) {
            head = nextShownPosition(state, head, head > before ? 1 : -1, items);
            caret = canonicalCaret(state, head, items);
        }

        if (caret === selection.main.head) {
            return transaction;
        }

        return [transaction, { selection: EditorSelection.cursor(caret), sequential: true }];
    });
}

// One character on in the direction, past any hidden or replaced range it would land in.
function nextShownPosition(state: EditorState, position: number, direction: -1 | 1, items: ReadonlyArray<HtmlItem>): number {
    let next = Math.min(state.doc.length, Math.max(0, position + direction));

    for (;;) {
        const inside = rangeAround(items, next);

        if (inside == null) {
            return next;
        }

        next = direction > 0 ? inside.to : inside.from;
    }
}

export function canonicalCaret(state: EditorState, position: number, items = htmlItems(state)): number {
    const lineStart = state.doc.lineAt(position).from;
    const blockStart = pastLineOpening(lineStart, items);

    if (position >= lineStart && position <= blockStart) {
        return blockStart;
    }

    return skipRanges(items, position, false, (item) => item.kind === 'tag' && !item.isBlock);
}

// Past a line's indentation and the tags that open its block, such as `<p>` or a list item's bullet.
function pastLineOpening(lineStart: number, items: ReadonlyArray<HtmlItem>): number {
    return skipRanges(items, lineStart, true, (item) => item.kind === 'indent'
        || ((item.kind === 'tag' || item.kind === 'marker') && item.isBlock && item.isOpening));
}

// Escapes `<`, `>` and `&` as they are typed, so text never becomes a tag or an entity.
function escapeTypedMarkup(view: EditorView, from: number, to: number, text: string): boolean {
    if (!ESCAPED.test(text) || view.state.readOnly) {
        return false;
    }

    const escaped = escapeHtmlText(text);
    view.dispatch({
        changes: { from, to, insert: escaped },
        selection: EditorSelection.cursor(from + escaped.length),
        userEvent: 'input.type',
        scrollIntoView: true,
    });

    return true;
}

function structural(spec: TransactionSpec): TransactionSpec {
    return asUndoStep(spec, 'input.html', structuralEdit.of(true));
}

// Enter: a new paragraph, or a new item in a list. In the middle of a paragraph,
// heading or item it splits it in two,
// closing the inline elements the caret is in and opening them again on the new line;
// at its end it adds an empty one after it, and at its start an empty one before it.
// An empty list item ends the list with a paragraph after it. In `<pre>` a line break is just a new line,
// and outside any paragraph Enter adds `<br>`.
function insertBlockBreak(view: EditorView): boolean {
    const { state } = view;

    if (state.readOnly) {
        return false;
    }

    if (!state.selection.main.empty) {
        deleteSelection(view, 'delete.selection');
    }

    const spec = blockBreakAt(view.state, view.state.selection.main.head);
    view.dispatch(spec);

    return true;
}

function blockBreakAt(state: EditorState, position: number): TransactionSpec {
    const elements = enclosingElements(state, position);

    if (elements.some((element) => element.name === 'pre')) {
        return structural({ changes: { from: position, insert: '\n' }, selection: EditorSelection.cursor(position + 1) });
    }

    const blockIndex = elements.findIndex((element) => TEXT_BLOCKS.has(element.name));
    const block = elements[blockIndex];

    if (block == null) {
        return lineBreakAt(state, position);
    }

    const items = htmlItems(state);
    const indent = indentationOf(state, block.openFrom);
    const isAtStart = visibleText(state, block.contentFrom, position, items).trim() === '';
    const isAtEnd = visibleText(state, position, block.contentTo, items).trim() === '';
    const newTag = block.name === 'li' || block.name === 'dt' || block.name === 'dd' ? block.name : 'p';

    if (isAtStart && isAtEnd && block.name === 'li') {
        const list = elements.slice(blockIndex + 1).find((element) => LIST_ELEMENTS.has(element.name));

        if (list != null) {
            const paragraph = `\n${indentationOf(state, list.openFrom)}<p>`;

            return structural({
                changes: [{ from: lineStartBefore(state, block.from), to: block.to }, { from: list.to, insert: `${paragraph}</p>` }],
                selection: EditorSelection.cursor(list.to - (block.to - lineStartBefore(state, block.from)) + paragraph.length),
            });
        }
    }

    if (isAtEnd) {
        const opening = `\n${indent}<${newTag}>`;

        return structural({
            changes: { from: block.to, insert: `${opening}</${newTag}>` },
            selection: EditorSelection.cursor(block.to + opening.length),
        });
    }

    if (isAtStart) {
        const before = `<${newTag}></${newTag}>\n${indent}`;

        return structural({
            changes: { from: block.from, insert: before },
            selection: EditorSelection.cursor(position + before.length),
        });
    }

    const inlines = elements.slice(0, blockIndex);
    const closing = `${inlines.map((element) => `</${element.name}>`).join('')}</${block.name}>`;
    const reopened = [...inlines].reverse().map((element) => openingTagWithoutId(state, element)).join('');
    const opening = `${openingTagWithoutId(state, block)}${reopened}`;
    const insert = `${closing}\n${indent}${opening}`;

    return structural({
        changes: { from: position, insert },
        selection: EditorSelection.cursor(position + insert.length),
    });
}

// Deletes the selected text; the tag guard keeps the tags in it.
function deleteSelection(view: EditorView, userEvent: string): void {
    view.dispatch(view.state.update(view.state.replaceSelection(''), { userEvent }));
}

// Shift+Enter: a `<br>`, with the text after it on a line of its own.
function insertLineBreak(view: EditorView): boolean {
    if (view.state.readOnly) {
        return false;
    }

    if (!view.state.selection.main.empty) {
        deleteSelection(view, 'delete.selection');
    }

    view.dispatch(lineBreakAt(view.state, view.state.selection.main.head));

    return true;
}

function lineBreakAt(state: EditorState, position: number): TransactionSpec {
    const insert = `<br>\n${indentationOf(state, position)}`;

    return structural({ changes: { from: position, insert }, selection: EditorSelection.cursor(position + insert.length) });
}

// Backspace and Delete remove the visible character beside the caret, never a tag;
// the hidden tags in between stay.
// At the edge of a paragraph, heading or list item they join it with the one beside it,
// and Backspace at the start of a heading makes it a paragraph first. A `<br>` goes as one character.
// When the last character of an inline element, such as `<strong>`, goes, the element goes with it.
// A selection deletes its visible text and keeps every tag in it.
function deleteVisible(view: EditorView, direction: -1 | 1): boolean {
    const { state } = view;

    if (state.readOnly) {
        return false;
    }

    if (!state.selection.main.empty) {
        deleteSelection(view, 'delete.selection');

        return true;
    }

    const spec = deletionAt(state, state.selection.main.head, direction);

    if (spec != null) {
        view.dispatch(spec);
    }

    return true;
}

export function deletionAt(state: EditorState, position: number, direction: -1 | 1): TransactionSpec | null {
    const items = htmlItems(state);
    const elements = enclosingElements(state, position);
    const block = elements.find((element) => TEXT_BLOCKS.has(element.name)) ?? null;

    if (block != null) {
        const edgeText = direction < 0
            ? visibleText(state, block.contentFrom, position, items)
            : visibleText(state, position, block.contentTo, items);

        if (edgeText.trim() === '') {
            return joinAtEdge(state, block, direction);
        }
    }

    let edge = position;

    for (;;) {
        const hidden = items.find((item) => (direction < 0 ? item.to === edge && item.from < edge : item.from === edge && item.to > edge)
            && (isProtectedItem(item) || item.kind === 'indent'));

        if (hidden == null) {
            break;
        }

        if (hidden.kind === 'tag' && hidden.name === 'br') {
            const lineBreak = lineBreakBeside(state, items, direction < 0 ? hidden.to : hidden.from, direction)
                ?? { from: hidden.from, to: hidden.to };
            const from = Math.min(position, lineBreak.from);
            const to = Math.max(position, lineBreak.to);

            return structural({ changes: { from, to }, selection: EditorSelection.cursor(from) });
        }

        if (hidden.kind === 'box' || hidden.isBlock) {
            return null;
        }

        edge = direction < 0 ? hidden.from : hidden.to;
    }

    const lineBreak = lineBreakBeside(state, items, edge, direction);

    if (lineBreak != null) {
        const from = Math.min(position, lineBreak.from);

        return structural({ changes: { from, to: Math.max(position, lineBreak.to) }, selection: EditorSelection.cursor(from) });
    }

    const unit = items.find((item) => (item.kind === 'entity' || item.kind === 'image')
        && (direction < 0 ? item.to === edge : item.from === edge));
    const unitFrom = unit != null ? unit.from : direction < 0 ? clusterBefore(state, edge) : edge;
    const unitTo = unit != null ? unit.to : direction < 0 ? edge : clusterAfter(state, edge);

    if (unitFrom === unitTo || unitFrom < 0 || unitTo > state.doc.length) {
        return null;
    }

    const emptied = enclosingElements(state, unitFrom).find((element) => element.contentFrom <= unitFrom && unitTo <= element.contentTo);
    const isLastCharacter = emptied != null && !TEXT_BLOCKS.has(emptied.name) && emptied.closeFrom != null
        && visibleText(state, emptied.contentFrom, emptied.contentTo, items) === visibleText(state, unitFrom, unitTo, items);

    if (isLastCharacter && emptied != null) {
        return structural({ changes: { from: emptied.from, to: emptied.to }, selection: EditorSelection.cursor(emptied.from) });
    }

    return structural({ changes: { from: unitFrom, to: unitTo }, selection: EditorSelection.cursor(unitFrom) });
}

// A `<br>` beside the position, with the line break and indentation that follow it in the source,
// which Backspace and Delete remove as the one line break the view shows.
function lineBreakBeside(
    state: EditorState,
    items: ReadonlyArray<HtmlItem>,
    edge: number,
    direction: -1 | 1,
): { from: number; to: number } | null {
    const isBreak = (item: HtmlItem): boolean => item.kind === 'tag' && item.name === 'br';

    if (direction > 0) {
        const tag = items.find((item) => isBreak(item) && item.from === edge);
        const following = tag == null ? '' : state.sliceDoc(tag.to, Math.min(state.doc.length, tag.to + LOOK_AROUND));
        const after = /^[ \t]*\n[ \t]*/.exec(following)?.[0] ?? '';

        return tag == null ? null : { from: edge, to: tag.to + after.length };
    }

    const before = /\n[ \t]*$/.exec(state.sliceDoc(Math.max(0, edge - LOOK_AROUND), edge))?.[0] ?? '';
    const tagEnd = edge - before.length;
    const tag = before === '' ? null : items.find((item) => isBreak(item) && item.to === tagEnd);

    return tag == null ? null : { from: tag.from, to: edge };
}

// Backspace at the start of a block, or Delete at its end: a heading becomes a paragraph,
// or the block joins the one before or after it,
// taking the first one's tag. Nothing happens at a list's first item
// or beside anything that isn't a paragraph, heading or item.
function joinAtEdge(state: EditorState, block: HtmlElement, direction: -1 | 1): TransactionSpec | null {
    if (direction < 0 && HEADING_LEVELS.has(block.name)) {
        return structural(changesKeepingCaret(state, renameChanges(block, 'p'), block.contentFrom));
    }

    const neighbour = adjacentElement(state, block, direction);

    if (neighbour == null || !TEXT_BLOCKS.has(neighbour.name) || neighbour.isVoid) {
        return null;
    }

    const [first, second] = direction < 0 ? [neighbour, block] : [block, neighbour];
    const changes: ChangeSpec[] = [{ from: first.contentTo, to: second.contentFrom }];

    if (second.closeNameFrom != null && second.closeNameTo != null && first.name !== second.name) {
        changes.push({ from: second.closeNameFrom, to: second.closeNameTo, insert: first.name });
    }

    return structural({ changes, selection: EditorSelection.cursor(first.contentTo) });
}

// The text the view shows between two positions: the source without the hidden tags and indentation,
// with each entity and image as one character.
function visibleText(state: EditorState, from: number, to: number, items = htmlItems(state)): string {
    const asOneCharacter = (item: HtmlItem): string => (item.kind === 'entity' || item.kind === 'image' ? '●' : '');

    return textBetween(state, from, to, items, asOneCharacter);
}

// The text of a selection as the view shows it, entities as their characters and without tags or images,
// for pasting anywhere as plain text; the source goes along as HTML.
function shownText(state: EditorState, from: number, to: number, items = htmlItems(state)): string {
    const asCharacters = (item: HtmlItem): string => (item.kind === 'entity' ? decodeHtmlText(state.sliceDoc(item.from, item.to)) : '');

    return textBetween(state, from, to, items, asCharacters);
}

// The source between two positions with each item in it put as `itemText` gives it.
function textBetween(
    state: EditorState,
    from: number,
    to: number,
    items: ReadonlyArray<HtmlItem>,
    itemText: (item: HtmlItem) => string,
): string {
    let text = '';
    let position = from;

    for (const item of items) {
        if (item.to <= position || item.from >= to) {
            continue;
        }

        text += state.sliceDoc(position, Math.max(position, item.from));
        text += itemText(item);
        position = Math.max(position, item.to);
    }

    return text + state.sliceDoc(position, Math.max(position, to));
}

// Copy and cut give the shown text as plain text and the selected source as HTML; cut then deletes the text,
// keeping the tags.
function copySelection(event: ClipboardEvent, view: EditorView, isCut: boolean): boolean {
    const { from, to, empty } = view.state.selection.main;

    if (empty || event.clipboardData == null) {
        return false;
    }

    event.preventDefault();
    event.clipboardData.setData('text/plain', shownText(view.state, from, to));
    event.clipboardData.setData('text/html', view.state.sliceDoc(from, to));

    if (isCut && !view.state.readOnly) {
        deleteSelection(view, 'delete.cut');
    }

    return true;
}

// The white space a line starts with, when the position is the first thing on it; otherwise none.
function indentationOf(state: EditorState, position: number): string {
    const line = state.doc.lineAt(position);
    const before = state.sliceDoc(line.from, position);

    return /^[ \t]*$/.test(before) ? before : '';
}

// The start of the position's line when only white space comes before it,
// so a removed element takes its indentation along.
function lineStartBefore(state: EditorState, position: number): number {
    const line = state.doc.lineAt(position);

    return /^[ \t]*$/.test(state.sliceDoc(line.from, position)) && line.from > 0 ? line.from - 1 : position;
}

// The element's opening tag as written, without an `id`, so a split doesn't give two elements the same id.
function openingTagWithoutId(state: EditorState, element: HtmlElement): string {
    return state.sliceDoc(element.openFrom, element.openTo).replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
}
