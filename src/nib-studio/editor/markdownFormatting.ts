import { syntaxTree } from '@codemirror/language';
import {
    ChangeSet,
    EditorSelection,
    type ChangeSpec,
    type EditorState,
    type Line,
    type SelectionRange,
    type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { asUndoStep, expandToWord } from './liveTransactions.js';

export type MarkdownFormatId =
    | 'bold'
    | 'italic'
    | 'strikethrough'
    | 'inlineCode'
    | 'codeBlock'
    | 'link'
    | 'heading'
    | 'quote'
    | 'bulletedList'
    | 'numberedList'
    | 'taskList';

// Inline formats wrap the selected text; block formats work on whole lines.
export type MarkdownFormatGroup = 'inline' | 'block';

export interface MarkdownFormat {
    readonly id: MarkdownFormatId;
    readonly group: MarkdownFormatGroup;
    readonly label: string;
    // Inline SVG markup drawn with currentColor.
    readonly glyph: string;
    // Shortcut as shown to the user, such as `Ctrl+B`.
    readonly shortcut?: string;
    // The same shortcut in CodeMirror key notation, such as `Mod-b`.
    readonly key?: string;
    readonly apply: (state: EditorState) => TransactionSpec;
    readonly isActive?: (state: EditorState) => boolean;
    // When present, the button opens a dropdown of these choices instead of running `apply`.
    readonly menu?: (state: EditorState) => ReadonlyArray<MarkdownFormatChoice>;
}

export interface MarkdownFormatChoice {
    readonly id: string;
    readonly label: string;
    readonly isCurrent: boolean;
    readonly apply: (state: EditorState) => TransactionSpec;
}

interface InlineMarker {
    readonly character: string;
    readonly size: number;
    // Whether a run of marker characters on both sides of the text carries this format.
    readonly isPresentIn: (run: number) => boolean;
    // The syntax node the format makes, found around a caret that is not right beside the markers.
    readonly nodeName: string;
}

interface LinePrefix {
    // Matches the prefix at the start of the line, after indentation when `afterIndentation` is set.
    readonly pattern: RegExp;
    // Matches any prefix this one replaces when added, such as another list marker.
    readonly replaces: RegExp;
    readonly afterIndentation: boolean;
    readonly create: (index: number) => string;
}

type InlineWrapPlacement = 'inside' | 'outside';

interface CodeFence {
    readonly opening: Line;
    readonly closing: Line;
}

const BOLD_MARKER: InlineMarker = { character: '*', size: 2, isPresentIn: (run) => run >= 2, nodeName: 'StrongEmphasis' };
// A run of three asterisks is bold and italic together.
const ITALIC_MARKER: InlineMarker = { character: '*', size: 1, isPresentIn: (run) => run % 2 === 1, nodeName: 'Emphasis' };
const STRIKETHROUGH_MARKER: InlineMarker = {
    character: '~',
    size: 2,
    isPresentIn: (run) => run >= 2,
    nodeName: 'Strikethrough',
};
const INLINE_CODE_MARKER: InlineMarker = { character: '`', size: 1, isPresentIn: (run) => run >= 1, nodeName: 'InlineCode' };

const MAX_MARKER_RUN = 3;

const LIST_MARKER_PATTERN = /^(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;

const QUOTE_PREFIX: LinePrefix = {
    pattern: /^>\s?/,
    replaces: /^>\s?/,
    afterIndentation: false,
    create: () => '> ',
};

const BULLETED_LIST_PREFIX: LinePrefix = {
    pattern: /^[-*+]\s+(?!\[[ xX]\]\s)/,
    replaces: LIST_MARKER_PATTERN,
    afterIndentation: true,
    create: () => '- ',
};

const NUMBERED_LIST_PREFIX: LinePrefix = {
    pattern: /^\d+[.)]\s+/,
    replaces: LIST_MARKER_PATTERN,
    afterIndentation: true,
    create: (index) => `${index + 1}. `,
};

const TASK_LIST_PREFIX: LinePrefix = {
    pattern: /^[-*+]\s+\[[ xX]\]\s+/,
    replaces: LIST_MARKER_PATTERN,
    afterIndentation: true,
    create: () => '- [ ] ',
};

const HEADING_PATTERN = /^(#{1,6})\s+/;
const MAX_CYCLED_HEADING_LEVEL = 3;
const MAX_HEADING_LEVEL = 6;

// Languages offered for a fenced code block, listed alphabetically by name.
export const CODE_BLOCK_LANGUAGES: ReadonlyArray<string> = [
    'bash',
    'c',
    'cpp',
    'csharp',
    'css',
    'diff',
    'dockerfile',
    'go',
    'graphql',
    'html',
    'ini',
    'java',
    'javascript',
    'json',
    'kotlin',
    'markdown',
    'mermaid',
    'php',
    'powershell',
    'python',
    'ruby',
    'rust',
    'scss',
    'shell',
    'sql',
    'swift',
    'text',
    'toml',
    'typescript',
    'xml',
    'yaml',
].sort((left, right) => left.localeCompare(right));

const CODE_FENCE = '```';
const OPENING_FENCE_PATTERN = /^\s*```/;
const CLOSING_FENCE_PATTERN = /^\s*```\s*$/;

const URL_PATTERN = /^(?:[a-z][a-z\d+.-]*:\/\/|mailto:|www\.)\S+$/i;
const LINK_PATTERN = /^\[([^\]]*)\]\(([^)\s]*)\)$/;
const LINK_DESTINATION_PATTERN = /^\]\([^)\s]*\)/;
const LINK_URL_PLACEHOLDER = 'url';

export function toggleBold(state: EditorState): TransactionSpec {
    return toggleInlineMarker(state, BOLD_MARKER);
}

export function toggleItalic(state: EditorState): TransactionSpec {
    return toggleInlineMarker(state, ITALIC_MARKER);
}

export function toggleStrikethrough(state: EditorState): TransactionSpec {
    return toggleInlineMarker(state, STRIKETHROUGH_MARKER);
}

export function toggleInlineCode(state: EditorState): TransactionSpec {
    return toggleInlineMarker(state, INLINE_CODE_MARKER);
}

export function isBold(state: EditorState): boolean {
    return hasInlineFormat(state, BOLD_MARKER);
}

export function isItalic(state: EditorState): boolean {
    return hasInlineFormat(state, ITALIC_MARKER);
}

function isStrikethrough(state: EditorState): boolean {
    return hasInlineFormat(state, STRIKETHROUGH_MARKER);
}

function isInlineCode(state: EditorState): boolean {
    return hasInlineFormat(state, INLINE_CODE_MARKER);
}

function hasInlineFormat(state: EditorState, marker: InlineMarker): boolean {
    const range = state.selection.main;

    return findInlineWrap(state, range, marker) != null || findEnclosingNode(state, range, marker.nodeName) != null;
}

// Wraps the selected lines in ``` fences with the caret on the language slot, or removes the fences around them.
export function toggleCodeBlock(state: EditorState): TransactionSpec {
    const { firstLine, lastLine } = selectedLineSpan(state, state.selection.main);
    const fence = findCodeFence(state, firstLine, lastLine);

    if (fence == null) {
        return asFormattingTransaction({
            changes: [
                { from: firstLine.from, insert: `${CODE_FENCE}\n` },
                { from: lastLine.to, insert: `\n${CODE_FENCE}` },
            ],
            selection: EditorSelection.cursor(firstLine.from + CODE_FENCE.length),
        });
    }

    const { opening, closing } = fence;

    if (closing.number === opening.number + 1) {
        return asFormattingTransaction({
            changes: { from: opening.from, to: closing.to },
            selection: EditorSelection.cursor(opening.from),
        });
    }

    const contentLength = closing.from - 1 - (opening.to + 1);

    return asFormattingTransaction({
        changes: [
            { from: opening.from, to: opening.to + 1 },
            { from: closing.from - 1, to: closing.to },
        ],
        selection: EditorSelection.range(opening.from, opening.from + contentLength),
    });
}

function isCodeBlock(state: EditorState): boolean {
    const { firstLine, lastLine } = selectedLineSpan(state, state.selection.main);

    return findCodeFence(state, firstLine, lastLine) != null;
}

// Turns the selection, or the word at the caret, into `[text](url)` with the url placeholder selected;
// a selected URL becomes `[url](url)` with the link text selected; an existing link is unwrapped back to its text.
export function insertLink(state: EditorState): TransactionSpec {
    return asFormattingTransaction(state.changeByRange((original) => {
        const enclosingLink = findEnclosingNode(state, original, 'Link');

        if (enclosingLink != null && findSurroundingLinkDestinationLength(state, original) == null) {
            return unwrapLink(state, original, enclosingLink);
        }

        const range = expandToWord(state, original);
        const text = state.sliceDoc(range.from, range.to);
        const selectedLink = LINK_PATTERN.exec(text);

        if (selectedLink != null) {
            const linkText = selectedLink[1] ?? '';

            return {
                changes: { from: range.from, to: range.to, insert: linkText },
                range: EditorSelection.range(range.from, range.from + linkText.length),
            };
        }

        const destinationLength = findSurroundingLinkDestinationLength(state, range);

        if (destinationLength != null) {
            return {
                changes: [
                    { from: range.from - 1, to: range.from },
                    { from: range.to, to: range.to + destinationLength },
                ],
                range: EditorSelection.range(range.from - 1, range.to - 1),
            };
        }

        if (URL_PATTERN.test(text)) {
            return {
                changes: { from: range.from, to: range.to, insert: `[${text}](${text})` },
                range: EditorSelection.range(range.from + 1, range.from + 1 + text.length),
            };
        }

        const urlStart = range.from + text.length + '[]('.length;

        return {
            changes: { from: range.from, to: range.to, insert: `[${text}](${LINK_URL_PLACEHOLDER})` },
            range: EditorSelection.range(urlStart, urlStart + LINK_URL_PLACEHOLDER.length),
        };
    }));
}

function isLink(state: EditorState): boolean {
    const range = state.selection.main;

    return LINK_PATTERN.test(state.sliceDoc(range.from, range.to))
        || findSurroundingLinkDestinationLength(state, range) != null
        || findEnclosingNode(state, range, 'Link') != null;
}

// Replaces the link with its text and keeps the caret or selection on the same characters.
function unwrapLink(
    state: EditorState,
    range: SelectionRange,
    link: SyntaxNode,
): { changes: ChangeSet; range: SelectionRange } {
    const labelEnd = link.getChildren('LinkMark').find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
    const textFrom = link.from + 1;
    const textTo = labelEnd?.from ?? textFrom;
    const changes = ChangeSet.of([
        { from: link.from, to: textFrom },
        { from: textTo, to: link.to },
    ], state.doc.length);

    return {
        changes,
        range: EditorSelection.range(changes.mapPos(range.anchor, -1), changes.mapPos(range.head, -1)),
    };
}

// Steps the selected lines through `#`, `##`, `###` and back to plain text, starting from the first line's level.
export function cycleHeading(state: EditorState): TransactionSpec {
    const lines = selectedContentLines(state);
    const currentLevel = headingLevel(lines[0]?.text ?? '');
    const nextLevel = currentLevel >= MAX_CYCLED_HEADING_LEVEL ? 0 : currentLevel + 1;
    const nextPrefix = nextLevel === 0 ? '' : `${'#'.repeat(nextLevel)} `;
    const changes: ChangeSpec[] = [];

    for (const line of lines) {
        const existing = HEADING_PATTERN.exec(line.text)?.[0] ?? '';

        if (existing !== nextPrefix) {
            changes.push({ from: line.from, to: line.from + existing.length, insert: nextPrefix });
        }
    }

    return applyLineChanges(state, changes);
}

// Sets every selected line to one heading level; level 0 turns them back into plain text.
export function setHeadingLevel(state: EditorState, level: number): TransactionSpec {
    const prefix = level <= 0 ? '' : `${'#'.repeat(Math.min(level, MAX_HEADING_LEVEL))} `;
    const changes: ChangeSpec[] = [];

    for (const line of selectedContentLines(state)) {
        const existing = HEADING_PATTERN.exec(line.text)?.[0] ?? '';

        if (existing !== prefix) {
            changes.push({ from: line.from, to: line.from + existing.length, insert: prefix });
        }
    }

    return applyLineChanges(state, changes);
}

function currentHeadingLevel(state: EditorState): number {
    return headingLevel(selectedContentLines(state)[0]?.text ?? '');
}

export function headingChoices(state: EditorState): ReadonlyArray<MarkdownFormatChoice> {
    const current = currentHeadingLevel(state);
    const levels = Array.from({ length: MAX_HEADING_LEVEL + 1 }, (_, level) => level);

    return levels.map((level) => ({
        id: `heading-${level}`,
        label: level === 0 ? 'Normal text' : `Heading ${level}`,
        isCurrent: level === current,
        apply: (target: EditorState) => setHeadingLevel(target, level),
    }));
}

// The language written after the opening fence of the code block around the selection,
// '' for a fence without one, or null outside a code block.
export function currentCodeBlockLanguage(state: EditorState): string | null {
    const { firstLine, lastLine } = selectedLineSpan(state, state.selection.main);
    const fence = findCodeFence(state, firstLine, lastLine);

    if (fence == null) {
        return null;
    }

    return fence.opening.text.trim().slice(CODE_FENCE.length).trim();
}

// Wraps the selected lines in a fence for the language, or relabels the code block already around them.
export function setCodeBlockLanguage(state: EditorState, language: string): TransactionSpec {
    const { firstLine, lastLine } = selectedLineSpan(state, state.selection.main);
    const fence = findCodeFence(state, firstLine, lastLine);
    const openingText = `${CODE_FENCE}${language}`;

    if (fence == null) {
        return asFormattingTransaction({
            changes: [
                { from: firstLine.from, insert: `${openingText}\n` },
                { from: lastLine.to, insert: `\n${CODE_FENCE}` },
            ],
            selection: EditorSelection.range(
                firstLine.from + openingText.length + 1,
                lastLine.to + openingText.length + 1,
            ),
        });
    }

    const indentation = /^\s*/.exec(fence.opening.text)?.[0] ?? '';

    return asFormattingTransaction({
        changes: { from: fence.opening.from, to: fence.opening.to, insert: `${indentation}${openingText}` },
    });
}

export function codeBlockChoices(state: EditorState): ReadonlyArray<MarkdownFormatChoice> {
    const current = currentCodeBlockLanguage(state);
    const choices: MarkdownFormatChoice[] = [
        {
            id: 'code-none',
            label: 'No language',
            isCurrent: current === '',
            apply: (target: EditorState) => setCodeBlockLanguage(target, ''),
        },
        ...CODE_BLOCK_LANGUAGES.map((language) => ({
            id: `code-${language}`,
            label: language,
            isCurrent: current === language,
            apply: (target: EditorState) => setCodeBlockLanguage(target, language),
        })),
    ];

    if (current != null) {
        choices.push({
            id: 'code-remove',
            label: 'Remove code block',
            isCurrent: false,
            apply: toggleCodeBlock,
        });
    }

    return choices;
}

function isHeading(state: EditorState): boolean {
    const firstLine = selectedContentLines(state)[0];

    return firstLine != null && headingLevel(firstLine.text) > 0;
}

export function toggleQuote(state: EditorState): TransactionSpec {
    return toggleLinePrefix(state, QUOTE_PREFIX);
}

export function toggleBulletedList(state: EditorState): TransactionSpec {
    return toggleLinePrefix(state, BULLETED_LIST_PREFIX);
}

export function toggleNumberedList(state: EditorState): TransactionSpec {
    return toggleLinePrefix(state, NUMBERED_LIST_PREFIX);
}

export function toggleTaskList(state: EditorState): TransactionSpec {
    return toggleLinePrefix(state, TASK_LIST_PREFIX);
}

function isQuote(state: EditorState): boolean {
    return everyLineHasPrefix(selectedContentLines(state), QUOTE_PREFIX);
}

function isBulletedList(state: EditorState): boolean {
    return everyLineHasPrefix(selectedContentLines(state), BULLETED_LIST_PREFIX);
}

function isNumberedList(state: EditorState): boolean {
    return everyLineHasPrefix(selectedContentLines(state), NUMBERED_LIST_PREFIX);
}

function isTaskList(state: EditorState): boolean {
    return everyLineHasPrefix(selectedContentLines(state), TASK_LIST_PREFIX);
}

export const MARKDOWN_FORMATS: ReadonlyArray<MarkdownFormat> = [
    {
        id: 'bold',
        group: 'inline',
        label: 'Bold',
        glyph: svgGlyph('<path d="M4.5 2.5h4.25a2.75 2.75 0 0 1 0 5.5H4.5zM4.5 8h5a2.75 2.75 0 0 1 0 5.5h-5z" stroke-width="2"/>'),
        shortcut: 'Ctrl+B',
        key: 'Mod-b',
        apply: toggleBold,
        isActive: isBold,
    },
    {
        id: 'italic',
        group: 'inline',
        label: 'Italic',
        glyph: svgGlyph('<path d="M7 2.5h5.5M3.5 13.5H9M10 2.5l-4 11"/>'),
        shortcut: 'Ctrl+I',
        key: 'Mod-i',
        apply: toggleItalic,
        isActive: isItalic,
    },
    {
        id: 'strikethrough',
        group: 'inline',
        label: 'Strikethrough',
        glyph: svgGlyph('<path d="M2.5 8h11M11.5 4.25C11 3.2 9.8 2.5 8.2 2.5 6.2 2.5 4.8 3.6 4.8 5.1c0 .8.3 1.4.9 1.9M5 11.3c.5 1.3 1.8 2.2 3.5 2.2 2 0 3.5-1.1 3.5-2.7 0-.5-.1-.9-.4-1.3"/>'),
        shortcut: 'Ctrl+Shift+X',
        key: 'Mod-Shift-x',
        apply: toggleStrikethrough,
        isActive: isStrikethrough,
    },
    {
        id: 'inlineCode',
        group: 'inline',
        label: 'Inline code',
        glyph: svgGlyph('<path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4"/>'),
        shortcut: 'Ctrl+E',
        key: 'Mod-e',
        apply: toggleInlineCode,
        isActive: isInlineCode,
    },
    {
        id: 'link',
        group: 'inline',
        label: 'Link',
        glyph: svgGlyph('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.1 9.2a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>'),
        shortcut: 'Ctrl+K',
        key: 'Mod-k',
        apply: insertLink,
        isActive: isLink,
    },
    {
        id: 'heading',
        group: 'block',
        label: 'Heading level',
        glyph: svgGlyph('<path d="M3 2.5v11M11 2.5v11M3 8h8"/>'),
        apply: cycleHeading,
        isActive: isHeading,
        menu: headingChoices,
    },
    {
        id: 'quote',
        group: 'block',
        label: 'Quote',
        glyph: svgGlyph('<path d="M2.5 2.5v11M6 4.5h7.5M6 8h7.5M6 11.5h5"/>'),
        apply: toggleQuote,
        isActive: isQuote,
    },
    {
        id: 'codeBlock',
        group: 'block',
        label: 'Code block',
        glyph: svgGlyph('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6.5 6 4.5 8l2 2M9.5 6l2 2-2 2"/>'),
        apply: toggleCodeBlock,
        isActive: isCodeBlock,
        menu: codeBlockChoices,
    },
    {
        id: 'bulletedList',
        group: 'block',
        label: 'Bulleted list',
        glyph: svgGlyph('<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none"/>'),
        apply: toggleBulletedList,
        isActive: isBulletedList,
    },
    {
        id: 'numberedList',
        group: 'block',
        label: 'Numbered list',
        glyph: svgGlyph('<path d="M7 4h7M7 8h7M7 12h7M2 2.75l1.25-.75v4M2 6h2.5M1.75 10h2.25l-2.25 3.5h2.5"/>'),
        apply: toggleNumberedList,
        isActive: isNumberedList,
    },
    {
        id: 'taskList',
        group: 'block',
        label: 'Task list',
        glyph: svgGlyph('<rect x="1.5" y="2" width="5" height="5" rx="1"/><path d="m2.75 4.5 1 1 1.5-2M9 4.5h5.5M9 11.5h5.5"/><rect x="1.5" y="9" width="5" height="5" rx="1"/>'),
        apply: toggleTaskList,
        isActive: isTaskList,
    },
];

function svgGlyph(content: string): string {
    return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
}

// Every formatting action is one undo step of its own, never merged with typing around it.
function asFormattingTransaction(spec: TransactionSpec): TransactionSpec {
    return asUndoStep(spec, 'input.format');
}

// With nothing selected, the format goes to the word at the caret, or adds empty markers when there is none.
function toggleInlineMarker(state: EditorState, marker: InlineMarker): TransactionSpec {
    const markerText = marker.character.repeat(marker.size);

    return asFormattingTransaction(state.changeByRange((range) => {
        const placement = findInlineWrap(state, range, marker);

        if (placement === 'inside') {
            return {
                changes: [
                    { from: range.from, to: range.from + marker.size },
                    { from: range.to - marker.size, to: range.to },
                ],
                range: EditorSelection.range(range.from, range.to - 2 * marker.size),
            };
        }

        if (placement === 'outside') {
            return {
                changes: [
                    { from: range.from - marker.size, to: range.from },
                    { from: range.to, to: range.to + marker.size },
                ],
                range: EditorSelection.range(range.from - marker.size, range.to - marker.size),
            };
        }

        const enclosing = findEnclosingNode(state, range, marker.nodeName);

        if (enclosing != null) {
            return removeNodeMarks(state, range, enclosing);
        }

        const target = expandToWord(state, range);
        const changes = ChangeSet.of([
            { from: target.from, insert: markerText },
            { from: target.to, insert: markerText },
        ], state.doc.length);

        if (range.empty && !target.empty) {
            return { changes, range: EditorSelection.cursor(range.head + marker.size) };
        }

        return {
            changes,
            range: EditorSelection.range(range.from + marker.size, range.to + marker.size),
        };
    }));
}

// The innermost syntax node of the type that holds the selection;
// a caret counts as inside only within the node, not on its outer edge.
function findEnclosingNode(state: EditorState, range: SelectionRange, nodeName: string): SyntaxNode | null {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, 1);

    while (node != null) {
        const holds = range.empty
            ? node.from < range.from && range.to < node.to
            : node.from <= range.from && range.to <= node.to;

        if (node.name === nodeName && holds) {
            return node;
        }

        node = node.parent;
    }

    return null;
}

// Deletes the opening and closing marks of a node, such as the `**` around bold text.
function removeNodeMarks(
    state: EditorState,
    range: SelectionRange,
    node: SyntaxNode,
): { changes: ChangeSet; range: SelectionRange } {
    const marks = [node.firstChild, node.lastChild]
        .filter((mark): mark is SyntaxNode => mark != null && mark.name.endsWith('Mark'));
    const changes = ChangeSet.of(marks.map((mark) => ({ from: mark.from, to: mark.to })), state.doc.length);

    return {
        changes,
        range: EditorSelection.range(changes.mapPos(range.anchor, -1), changes.mapPos(range.head, -1)),
    };
}

// Finds the marker either at the edges of the selected text or just around it.
function findInlineWrap(state: EditorState, range: SelectionRange, marker: InlineMarker): InlineWrapPlacement | null {
    const text = state.sliceDoc(range.from, range.to);
    const leadingRun = countLeading(text, marker.character);
    const trailingRun = countTrailing(text, marker.character);

    if (leadingRun < text.length && marker.isPresentIn(Math.min(leadingRun, trailingRun, MAX_MARKER_RUN))) {
        return 'inside';
    }

    const runBefore = countTrailing(state.sliceDoc(Math.max(0, range.from - MAX_MARKER_RUN), range.from), marker.character);
    const runAfter = countLeading(state.sliceDoc(range.to, range.to + MAX_MARKER_RUN), marker.character);

    if (marker.isPresentIn(Math.min(runBefore, runAfter))) {
        return 'outside';
    }

    return null;
}

function countLeading(text: string, character: string): number {
    let count = 0;

    while (count < text.length && text[count] === character) {
        count++;
    }

    return count;
}

function countTrailing(text: string, character: string): number {
    let count = 0;

    while (count < text.length && text[text.length - 1 - count] === character) {
        count++;
    }

    return count;
}

function findSurroundingLinkDestinationLength(state: EditorState, range: SelectionRange): number | null {
    if (range.from === 0 || state.sliceDoc(range.from - 1, range.from) !== '[') {
        return null;
    }

    const restOfLine = state.sliceDoc(range.to, state.doc.lineAt(range.to).to);
    const destination = LINK_DESTINATION_PATTERN.exec(restOfLine);

    return destination == null ? null : destination[0].length;
}

// A selection ending at the very start of a line doesn't include that line.
function selectedLineSpan(state: EditorState, range: SelectionRange): { firstLine: Line; lastLine: Line } {
    const firstLine = state.doc.lineAt(range.from);
    let lastLine = state.doc.lineAt(range.to);

    if (range.to > range.from && range.to === lastLine.from && lastLine.number > firstLine.number) {
        lastLine = state.doc.line(lastLine.number - 1);
    }

    return { firstLine, lastLine };
}

function selectedLines(state: EditorState): Line[] {
    const lineByNumber = new Map<number, Line>();

    for (const range of state.selection.ranges) {
        const { firstLine, lastLine } = selectedLineSpan(state, range);

        for (let number = firstLine.number; number <= lastLine.number; number++) {
            lineByNumber.set(number, state.doc.line(number));
        }
    }

    return [...lineByNumber.values()].sort((left, right) => left.number - right.number);
}

// Blank lines are left alone unless nothing else is selected.
function selectedContentLines(state: EditorState): Line[] {
    const lines = selectedLines(state);
    const contentLines = lines.filter((line) => line.text.trim() !== '');

    return contentLines.length > 0 ? contentLines : lines;
}

function findCodeFence(state: EditorState, firstLine: Line, lastLine: Line): CodeFence | null {
    if (lastLine.number > firstLine.number
        && OPENING_FENCE_PATTERN.test(firstLine.text)
        && CLOSING_FENCE_PATTERN.test(lastLine.text)) {
        return { opening: firstLine, closing: lastLine };
    }

    if (firstLine.number > 1 && lastLine.number < state.doc.lines) {
        const lineBefore = state.doc.line(firstLine.number - 1);
        const lineAfter = state.doc.line(lastLine.number + 1);

        if (OPENING_FENCE_PATTERN.test(lineBefore.text) && CLOSING_FENCE_PATTERN.test(lineAfter.text)) {
            return { opening: lineBefore, closing: lineAfter };
        }
    }

    return findEnclosingCodeFence(state, firstLine, lastLine);
}

// The fenced block around lines deeper inside it, from the syntax tree; an unclosed block has no fence to remove.
function findEnclosingCodeFence(state: EditorState, firstLine: Line, lastLine: Line): CodeFence | null {
    const block = findEnclosingNode(state, EditorSelection.range(firstLine.from, lastLine.to), 'FencedCode');

    if (block == null) {
        return null;
    }

    const opening = state.doc.lineAt(block.from);
    const closing = state.doc.lineAt(block.to);

    if (closing.number <= opening.number || !CLOSING_FENCE_PATTERN.test(closing.text)) {
        return null;
    }

    return { opening, closing };
}

function headingLevel(text: string): number {
    return HEADING_PATTERN.exec(text)?.[1]?.length ?? 0;
}

function prefixStart(line: Line, prefix: LinePrefix): number {
    return prefix.afterIndentation ? (/^\s*/.exec(line.text)?.[0].length ?? 0) : 0;
}

function everyLineHasPrefix(lines: ReadonlyArray<Line>, prefix: LinePrefix): boolean {
    return lines.length > 0
        && lines.every((line) => prefix.pattern.test(line.text.slice(prefixStart(line, prefix))));
}

// Removes the prefix when every selected line has it, otherwise adds it to every line,
// replacing a different list marker in place.
function toggleLinePrefix(state: EditorState, prefix: LinePrefix): TransactionSpec {
    const lines = selectedContentLines(state);
    const removing = everyLineHasPrefix(lines, prefix);
    const changes: ChangeSpec[] = [];

    lines.forEach((line, index) => {
        const start = line.from + prefixStart(line, prefix);
        const body = line.text.slice(start - line.from);

        if (removing) {
            const existing = prefix.pattern.exec(body)?.[0] ?? '';
            changes.push({ from: start, to: start + existing.length });

            return;
        }

        const replaced = prefix.replaces.exec(body)?.[0] ?? '';
        const inserted = prefix.create(index);

        if (replaced !== inserted) {
            changes.push({ from: start, to: start + replaced.length, insert: inserted });
        }
    });

    return applyLineChanges(state, changes);
}

// Maps the selection past inserted prefixes so it stays on the line text.
function applyLineChanges(state: EditorState, changes: ReadonlyArray<ChangeSpec>): TransactionSpec {
    const changeSet = state.changes(changes);
    const ranges = state.selection.ranges.map((range) => EditorSelection.range(
        changeSet.mapPos(range.anchor, 1),
        changeSet.mapPos(range.head, 1),
    ));

    return asFormattingTransaction({
        changes: changeSet,
        selection: EditorSelection.create(ranges, state.selection.mainIndex),
    });
}
