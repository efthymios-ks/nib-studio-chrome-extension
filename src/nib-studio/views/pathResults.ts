import type { PathExample, PathSyntaxEntry } from '../../common/paths/pathExamples.js';
import {
    countLabel,
    type FormatLimits,
    type FormattedValue,
    type ValueLayout,
    type ValueLine,
    type ValueTokenKind,
} from '../../common/paths/valueFormat.js';
import { clear, h } from '../app/dom.js';
import { shortcutLetter } from '../app/shortcutKey.js';
import { toast } from '../app/toast.js';
import { errorMessage } from '../../common/errorMessage.js';
import { attachTextBoxHistory, createTextBoxHistory, setTextBoxValue, type TextBoxHistory } from './textBoxHistory.js';

// One match of a query, as the results list shows it.
export interface PathResultMatch {
    readonly path: string;
    // What the value is, such as `object · 3 keys` or `attribute`.
    readonly type: string;
    // A styling hook, such as `object`, `string` or `element`.
    readonly kind: string;
    readonly format: (layout: ValueLayout, limits: FormatLimits) => FormattedValue;
    readonly lineCount: (layout: ValueLayout) => number;
    readonly copyText: (layout: ValueLayout) => string;
    // The path Show in tree hands to `onReveal`, or null when the tree has no node for the match.
    readonly reveal: string | null;
}

export interface PathQuerySpan {
    readonly start: number;
    readonly end: number;
}

export type PathQueryOutcome =
    | {
        readonly ok: true;
        readonly matches: ReadonlyArray<PathResultMatch>;
        // Every match in one text, for Copy all.
        readonly copyAll: (layout: ValueLayout) => string;
    }
    | {
        readonly ok: false;
        readonly message: string;
        // The part of the expression at fault, as 0-based offsets, when it is known.
        readonly span: PathQuerySpan | null;
        // The document doesn't parse, so no expression can run.
        readonly isDocumentError?: boolean;
    };

export interface PathQueryLanguage {
    // `JSONPath` or `XPath`, for the title, labels and toasts.
    readonly name: string;
    readonly placeholder: string;
    // The number the first match shows, as the language counts: 0 for JSONPath, 1 for XPath.
    readonly firstIndex: number;
    readonly copyAllTitle: string;
    readonly evaluate: (expression: string) => PathQueryOutcome;
    readonly examples: () => ReadonlyArray<PathExample>;
    readonly syntax: ReadonlyArray<PathSyntaxEntry>;
}

// Kept by the caller across renders, so the layout and the help stay as they were left.
export interface PathResultsState {
    layout: ValueLayout;
    isHelpOpen: boolean;
    // The undo history of each language's expression box, kept across renders.
    readonly histories: Map<string, TextBoxHistory>;
}

export interface PathResultsOptions {
    readonly language: PathQueryLanguage;
    readonly expression: string;
    readonly state: PathResultsState;
    // Called with every expression that runs, so the caller can keep it.
    readonly onRun: (expression: string) => void;
    // Called with a match's `reveal` path for Show in tree.
    readonly onReveal: (path: string) => void;
}

// What a list of result cards does with a card: what Ctrl+C takes and where Show in tree goes.
export interface ResultCardActions {
    // The text Ctrl+C on a focused card copies when no text is selected, or null when the card has none.
    readonly valueText: (card: HTMLElement) => string | null;
    // The path Show in tree hands to `onReveal`, or null when the tree has no node for the card.
    readonly revealPath: (card: HTMLElement) => string | null;
    readonly onReveal: (path: string) => void;
}

export function createPathResultsState(): PathResultsState {
    return { layout: 'formatted', isHelpOpen: false, histories: new Map() };
}

// Cards rendered at once, and by each Show more.
export const RESULTS_PAGE_SIZE = 200;
// A formatted value longer than this shows its first `COLLAPSED_LINES` lines and Show all.
const COLLAPSE_AFTER_LINES = 24;
export const COLLAPSED_LINES = 20;
// Show all draws at most this many lines; Ctrl+C on the card and Copy all take the whole value.
export const SHOW_ALL_MAX_LINES = 10_000;

const MAX_LINE_LENGTH = 2_000;
const COMPACT_MAX_LENGTH = 1_000;

// Static icons, drawn like the editor bar's.
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
const REVEAL_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 8 8"/><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>';

const TOKEN_CLASSES: Readonly<Record<ValueTokenKind, string>> = Object.freeze({
    'key': 'json-key',
    'string': 'json-string',
    'number': 'json-number',
    'boolean': 'json-boolean',
    'null': 'json-null',
    'punct': 'json-punct',
    'tag': 'xml-name',
    'attribute': 'xml-attr',
    'attribute-value': 'xml-attr-value',
    'text': 'xml-text',
});

// Keys that move focus between result cards, by the index of the card they move to.
const CARD_MOVES: Readonly<Record<string, (index: number, count: number) => number>> = Object.freeze({
    ArrowDown: (index: number, count: number) => Math.min(index + 1, count - 1),
    ArrowUp: (index: number) => Math.max(index - 1, 0),
    Home: () => 0,
    End: (_index: number, count: number) => count - 1,
});

type SuccessOutcome = Extract<PathQueryOutcome, { ok: true }>;

// A query view shared by JSONPath and XPath: the expression box that runs on Enter, a status line,
// one card per match with its path and formatted value, a Formatted / Compact toggle, Copy all and a syntax help.
export function renderPathResults(pane: HTMLElement, options: PathResultsOptions): void {
    const { language, state } = options;
    let current: SuccessOutcome | null = null;
    let shown = 0;

    const input = h('input', {
        class: 'input input-mono path-query-input',
        attrs: {
            'type': 'text',
            'spellcheck': 'false',
            'autocomplete': 'off',
            'placeholder': language.placeholder,
            'aria-label': `${language.name} expression`,
        },
    });
    input.value = options.expression;
    const history = state.histories.get(language.name) ?? createTextBoxHistory();
    state.histories.set(language.name, history);
    attachTextBoxHistory(input, history);

    const helpButton = h('button', {
        class: 'icon-button path-help-button',
        text: '?',
        attrs: { 'type': 'button', 'title': `${language.name} syntax and examples`, 'aria-label': `${language.name} syntax and examples` },
    });
    const status = h('span', { class: 'path-query-status', attrs: { 'role': 'status', 'aria-live': 'polite' } });
    const excerpt = h('code', { class: 'path-query-excerpt', attrs: { hidden: true } });
    const layoutButtons = (['formatted', 'compact'] as const).map((layout) => h('button', {
        class: 'view-tab path-layout-option',
        text: layout === 'formatted' ? 'Formatted' : 'Compact',
        dataset: { layout },
        attrs: {
            type: 'button',
            title: layout === 'formatted' ? 'Show each value indented, over several lines' : 'Show each value on one line',
        },
    }));
    const copyAllButton = h('button', {
        class: 'icon-button path-copy-all',
        html: COPY_ICON,
        attrs: { 'type': 'button', 'title': language.copyAllTitle, 'aria-label': language.copyAllTitle },
    });
    const tools = h('div', {
        class: 'path-results-tools',
        attrs: { hidden: true },
        children: [
            h('div', { class: 'view-tabs path-layout-toggle', attrs: { 'role': 'group', 'aria-label': 'Value layout' }, children: layoutButtons }),
            copyAllButton,
        ],
    });
    const help = h('section', { class: 'path-help', attrs: { 'aria-label': `${language.name} help` } });
    const list = h('ol', { class: 'path-results', attrs: { 'aria-label': 'Matches' } });
    const more = h('div', { class: 'path-results-more' });
    const body = h('div', { class: 'path-results-body', children: [help, list, more] });
    let lastRun: string | null = null;

    const matchOf = (card: HTMLElement): PathResultMatch | null => current?.matches[Number(card.dataset['index'])] ?? null;
    bindResultCards(list, {
        valueText: (card) => matchOf(card)?.copyText(state.layout) ?? null,
        revealPath: (card) => matchOf(card)?.reveal ?? null,
        onReveal: options.onReveal,
    });

    const renderLayout = (): void => {
        list.dataset['layout'] = state.layout;

        for (const button of layoutButtons) {
            const isActive = button.dataset['layout'] === state.layout;
            button.setAttribute('aria-pressed', String(isActive));
            button.dataset['active'] = String(isActive);
        }

        for (const card of list.querySelectorAll<HTMLElement>(':scope > .path-card')) {
            const match = matchOf(card);

            if (match != null) {
                fillValue(card, match, state.layout, false);
            }
        }
    };

    const showMore = (): void => {
        const matches = current?.matches ?? [];
        const end = Math.min(shown + RESULTS_PAGE_SIZE, matches.length);

        for (let index = shown; index < end; index += 1) {
            const match = matches[index];

            if (match != null) {
                list.append(renderCard(match, index, language.firstIndex, state.layout));
            }
        }

        shown = end;
        clear(more);

        if (shown >= matches.length) {
            return;
        }

        more.append(
            h('button', {
                class: 'button',
                text: `Show ${Math.min(RESULTS_PAGE_SIZE, matches.length - shown).toLocaleString('en-US')} more`,
                dataset: { action: 'show-more' },
                attrs: { type: 'button' },
                on: { click: showMore },
            }),
            h('span', { class: 'path-results-count', text: `${shown.toLocaleString('en-US')} of ${matches.length.toLocaleString('en-US')} shown` }),
        );
    };

    const run = (): void => {
        const expression = input.value;
        lastRun = expression;
        options.onRun(expression);
        current = null;
        shown = 0;
        clear(list);
        clear(more);
        showExcerpt(excerpt, expression, null);
        tools.hidden = true;
        delete status.dataset['tone'];
        input.removeAttribute('aria-invalid');

        if (expression.trim() === '') {
            status.textContent = 'Type an expression, then press Enter to run it.';

            return;
        }

        const started = performance.now();
        const outcome = language.evaluate(expression);
        const elapsed = performance.now() - started;

        if (!outcome.ok) {
            status.textContent = outcome.message;
            status.dataset['tone'] = 'fail';

            if (outcome.isDocumentError !== true) {
                input.setAttribute('aria-invalid', 'true');
                showExcerpt(excerpt, expression, outcome.span);
            }

            return;
        }

        current = outcome;
        status.textContent = `${describeCount(outcome.matches.length)} · ${describeElapsed(elapsed)}`;
        tools.hidden = outcome.matches.length === 0;
        body.scrollTop = 0;
        showMore();
    };

    const renderHelpState = (): void => {
        help.hidden = !state.isHelpOpen;
        helpButton.setAttribute('aria-expanded', String(state.isHelpOpen));
        clear(help);

        if (state.isHelpOpen) {
            renderHelp(help, language, (expression) => {
                setTextBoxValue(input, history, expression);
                state.isHelpOpen = false;
                renderHelpState();
                run();
                input.focus();
            });
        }
    };

    // An edited expression says how to run it, until it runs.
    input.addEventListener('input', () => {
        if (input.value !== lastRun) {
            delete status.dataset['tone'];
            status.textContent = 'Enter to run';
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            run();

            return;
        }

        if (event.key === 'ArrowDown') {
            const first = list.querySelector<HTMLElement>(':scope > .path-card');

            if (first != null) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    helpButton.addEventListener('click', () => {
        state.isHelpOpen = !state.isHelpOpen;
        renderHelpState();
    });

    for (const button of layoutButtons) {
        button.addEventListener('click', () => {
            state.layout = button.dataset['layout'] === 'compact' ? 'compact' : 'formatted';
            renderLayout();
        });
    }

    copyAllButton.addEventListener('click', () => {
        if (current != null) {
            void copyTextAsync(current.copyAll(state.layout), `${describeCount(current.matches.length)} copied.`);
        }
    });

    pane.append(h('div', {
        class: 'path-query',
        dataset: { language: language.name.toLowerCase() },
        children: [
            h('div', {
                class: 'path-query-bar',
                children: [
                    h('div', { class: 'path-query-row', children: [input, helpButton] }),
                    h('div', { class: 'path-query-status-row', children: [status, tools] }),
                    excerpt,
                ],
            }),
            body,
        ],
    }));
    renderHelpState();
    renderLayout();
    run();
}

// Card behaviour shared by the query results and the schema errors: paths and values are plain selectable text,
// double-click, Enter or the ↗ button shows the card's node in the tree, and the arrow keys, Home and End move between cards.
export function bindResultCards(list: HTMLElement, actions: ResultCardActions): void {
    const reveal = (card: HTMLElement): void => {
        const path = actions.revealPath(card);

        if (path != null) {
            actions.onReveal(path);
        }
    };

    list.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        const card = target.closest<HTMLElement>('.path-card');

        if (card != null && target.closest('.path-card-reveal') != null) {
            reveal(card);
        }
    });

    list.addEventListener('dblclick', (event) => {
        const target = event.target as HTMLElement;
        const card = target.closest<HTMLElement>('.path-card');

        if (card != null && target.closest('button') == null) {
            reveal(card);
        }
    });

    list.addEventListener('keydown', (event) => {
        const card = event.target as HTMLElement;

        if (!card.classList.contains('path-card')) {
            return;
        }

        const move = CARD_MOVES[event.key];

        if (move != null) {
            event.preventDefault();
            const siblings = [...list.querySelectorAll<HTMLElement>(':scope > .path-card')];
            siblings[move(siblings.indexOf(card), siblings.length)]?.focus();

            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            reveal(card);

            return;
        }

        // With text selected, the browser copies the selection as usual.
        if ((event.ctrlKey || event.metaKey) && shortcutLetter(event) === 'c' && !hasSelection()) {
            const text = actions.valueText(card);

            if (text != null) {
                event.preventDefault();
                void copyTextAsync(text, 'Value copied.');
            }
        }
    });
}

// The ↗ button of a card whose node the tree can show; Enter and double-click do the same.
function revealButton(): HTMLElement {
    return h('button', {
        class: 'icon-button path-card-reveal',
        html: REVEAL_ICON,
        attrs: {
            'type': 'button',
            'tabindex': '-1',
            'title': 'Show in tree (double-click or Enter)',
            'aria-label': 'Show in tree',
        },
    });
}

async function copyTextAsync(text: string, confirmation: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        toast(confirmation, 'ok');
    }
    catch (error) {
        toast(errorMessage(error, 'Copy failed.'), 'fail');
    }
}

function renderCard(match: PathResultMatch, index: number, firstIndex: number, layout: ValueLayout): HTMLElement {
    const card = h('li', {
        class: 'path-card',
        dataset: { index: String(index), kind: match.kind },
        attrs: { 'tabindex': '0', 'aria-label': `Match ${index + firstIndex}: ${match.path}` },
        children: [
            cardHeader({
                index: `[${index + firstIndex}]`,
                path: match.path,
                badge: match.type,
                canReveal: match.reveal != null,
            }),
            h('pre', { class: 'path-card-value' }),
        ],
    });
    fillValue(card, match, layout, false);

    return card;
}

// Draws the value; a long formatted value shows its first lines, with Show all and Show less.
function fillValue(card: HTMLElement, match: PathResultMatch, layout: ValueLayout, isExpanded: boolean): void {
    const value = card.querySelector<HTMLElement>('.path-card-value');

    if (value == null) {
        return;
    }

    clear(value);
    card.querySelector('.path-card-more')?.remove();
    delete value.dataset['collapsed'];

    if (layout === 'compact') {
        appendLines(value, match.format('compact', { maxLineLength: COMPACT_MAX_LENGTH }).lines);

        return;
    }

    const total = match.lineCount('formatted');
    const isCollapsible = total > COLLAPSE_AFTER_LINES;
    const maxLines = isCollapsible ? (isExpanded ? SHOW_ALL_MAX_LINES : COLLAPSED_LINES) : undefined;
    appendLines(value, match.format('formatted', { maxLines, maxLineLength: MAX_LINE_LENGTH }).lines);

    if (!isCollapsible) {
        return;
    }

    value.dataset['collapsed'] = String(!isExpanded);
    const totalText = total.toLocaleString('en-US');
    card.append(h('div', {
        class: 'path-card-more',
        children: [
            h('button', {
                class: 'button',
                text: isExpanded ? 'Show less' : `Show all ${totalText} lines`,
                dataset: { action: isExpanded ? 'show-less' : 'show-all' },
                attrs: { type: 'button' },
                on: { click: () => fillValue(card, match, layout, !isExpanded) },
            }),
            isExpanded && total > SHOW_ALL_MAX_LINES
                ? h('span', {
                    class: 'path-results-count',
                    text: `First ${SHOW_ALL_MAX_LINES.toLocaleString('en-US')} lines shown; Ctrl+C on the card copies all ${totalText}.`,
                })
                : null,
        ],
    }));
}

export interface CardHeaderOptions {
    readonly index: string;
    readonly path: string;
    readonly badge: string;
    readonly canReveal: boolean;
}

// A card's top row: a small index, the path (the whole path in its tooltip), a type badge and ↗.
export function cardHeader(options: CardHeaderOptions): HTMLElement {
    return h('div', {
        class: 'path-card-header',
        children: [
            h('span', { class: 'path-card-index', text: options.index }),
            h('code', { class: 'path-card-path', text: options.path, attrs: { title: options.path } }),
            h('span', { class: 'badge path-card-type', text: options.badge }),
            options.canReveal ? revealButton() : null,
        ],
    });
}

// Draws formatted lines as text with one coloured span per token, so selecting and copying keeps the layout.
export function appendLines(target: HTMLElement, lines: ReadonlyArray<ValueLine>): void {
    lines.forEach((line, index) => {
        if (index > 0) {
            target.append('\n');
        }

        if (line.depth > 0) {
            target.append('  '.repeat(line.depth));
        }

        for (const token of line.tokens) {
            target.append(h('span', { class: TOKEN_CLASSES[token.kind], text: token.text }));
        }
    });
}

function renderHelp(host: HTMLElement, language: PathQueryLanguage, runExample: (expression: string) => void): void {
    const examples = language.examples();
    const syntax = h('dl', { class: 'path-help-syntax' });

    for (const entry of language.syntax) {
        syntax.append(h('dt', { children: [h('code', { text: entry.syntax })] }), h('dd', { text: entry.description }));
    }

    host.append(
        h('h3', { text: 'Examples for this document' }),
        h('p', { text: 'Click one to run it.' }),
        h('div', {
            class: 'path-help-examples',
            children: examples.map((example) => h('button', {
                class: 'path-help-example',
                attrs: { type: 'button', title: 'Run this example' },
                on: { click: () => runExample(example.expression) },
                children: [
                    h('span', { class: 'path-help-example-title', text: example.title }),
                    h('code', { class: 'path-help-example-code', text: example.expression }),
                ],
            })),
        }),
        h('h3', { text: `${language.name} syntax` }),
        syntax,
    );
}

// Shows the expression with the part at fault marked; a fault at the end marks an empty place.
function showExcerpt(excerpt: HTMLElement, expression: string, span: PathQuerySpan | null): void {
    clear(excerpt);
    excerpt.hidden = span == null;

    if (span == null) {
        return;
    }

    const start = Math.min(Math.max(span.start, 0), expression.length);
    const end = Math.min(Math.max(span.end, start), expression.length);
    excerpt.append(
        expression.slice(0, start),
        h('mark', { class: 'path-query-mark', text: end > start ? expression.slice(start, end) : ' ' }),
        expression.slice(end),
    );
}

function hasSelection(): boolean {
    const selection = window.getSelection();

    return selection != null && !selection.isCollapsed;
}

function describeCount(count: number): string {
    return count === 0 ? 'No matches' : countLabel(count, 'match', 'matches');
}

function describeElapsed(milliseconds: number): string {
    return milliseconds < 1 ? '< 1 ms' : `${Math.round(milliseconds).toLocaleString('en-US')} ms`;
}
