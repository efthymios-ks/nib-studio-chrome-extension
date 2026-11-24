import { sidesOfChange, type DiffCell, type DiffCellStatus, type DiffRow, type TextDiffDocument } from '../../common/diff/diffDocument.js';
import { buildTextDiffDocument } from '../../common/diff/textDiffDocument.js';
import { clear, h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { navigationChangesOf } from './diffChanges.js';
import { attachDiffNavigation, compareSize, scheduleDiffRender } from './diffNavigationBar.js';
import { rememberScroll } from './diffScroll.js';
import { buildDiffSideHeader, diffDocumentSide, diffDocumentSidesKey, type DiffSideName } from './diffSideHeader.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewInput, TextDiffViewState } from './diffViewState.js';
import { buildTextRulesMenu } from './textRulesMenu.js';

export type TextDiffViewInput = DiffViewInput<TextDiffViewState>;

export type TextDiffDocumentSource = Pick<TextDiffViewInput, 'original' | 'modified' | 'state'>;

// How a line's state shows on its cells; unchanged lines carry no marker.
const MARKERS: Readonly<Partial<Record<DiffCellStatus, string>>> = Object.freeze({
    added: 'add',
    removed: 'del',
    ignored: 'ignored',
});

export function renderTextDiffView(container: HTMLElement, input: TextDiffViewInput): void {
    clear(container);

    const document = currentTextDiffDocument(input);
    const body = h('div', { class: 'text-diff-body' });
    const panel = buildDiffPanel(input, document);

    body.append(panel);
    container.append(buildToolbar(container, input), body);

    if (document != null) {
        attachNavigation({ panel, keyScope: body, host: container, input, document });
    }

    rememberScroll(container, input.state.scroll);
}

// The diff document of both sides, built once and kept until a side or the rules change; null until both sides are chosen.
export function currentTextDiffDocument(input: TextDiffDocumentSource): TextDiffDocument | null {
    const { original, modified, state } = input;

    if (original == null || modified == null) {
        return null;
    }

    const originalText = original.text ?? '';
    const modifiedText = modified.text ?? '';
    const sides = diffDocumentSidesKey(original, modified);
    const cache = state.cache;

    if (
        cache != null
        && cache.original === originalText
        && cache.modified === modifiedText
        && cache.rules === state.rules
        && cache.sides === sides
    ) {
        return cache.document;
    }

    const document = buildTextDiffDocument({
        original: diffDocumentSide(original),
        modified: diffDocumentSide(modified),
        originalText,
        modifiedText,
        rules: state.rules,
    });
    state.cache = { original: originalText, modified: modifiedText, rules: state.rules, sides, document };

    return document;
}

// Draws the diff again once a rule changed, comparing large inputs after a pause.
function recompute(host: HTMLElement, input: TextDiffViewInput): void {
    scheduleDiffRender(host, compareSize(input.original, input.modified), () => renderTextDiffView(host, input));
}

// The side controls and the Compare rules button.
function buildToolbar(host: HTMLElement, input: TextDiffViewInput): HTMLElement {
    return h('div', {
        class: 'editor-toolbar',
        children: [
            ...buildDiffToolbarSides(input),
            h('span', { class: 'toolbar-spacer' }),
            buildTextRulesMenu({ state: input.state, onChange: () => recompute(host, input) }),
        ],
    });
}

function buildEmptySide(side: DiffSideName, input: TextDiffViewInput): HTMLElement {
    if (input.callbacks.targetDropZone != null) {
        return input.callbacks.targetDropZone((target) => input.callbacks.onSetSide(side, target));
    }

    return h('div', {
        class: 'editor-placeholder',
        children: [h('p', { text: side === 'original' ? 'Pick the original file to compare.' : 'Pick the modified file to compare.' })],
    });
}

// Both sides line for line, as the document aligns them; the rows of each change share a hunk the bar steps to.
function buildDiffPanel(input: TextDiffViewInput, document: TextDiffDocument | null): HTMLElement {
    if (document == null) {
        return h('div', {
            class: 'split split-horizontal text-diff-split',
            children: [buildPendingPane('original', input), buildPendingPane('modified', input)],
        });
    }

    const lastNumber = document.rows.reduce((largest, row) => Math.max(largest, row.left?.line ?? 0, row.right?.line ?? 0), 0);
    const grid = h('div', { class: 'text-diff-grid', attrs: { style: `--digits: ${String(lastNumber).length}` } });
    const changes = new Map(document.changes.map((change) => [change.id, change]));

    for (const row of document.rows) {
        const change = row.change == null ? undefined : changes.get(row.change);

        if (change == null) {
            grid.append(renderRow(row));

            continue;
        }

        const last = grid.lastElementChild;
        const hunk = last instanceof HTMLElement && last.classList.contains('text-diff-hunk') && last.dataset['change'] === change.id
            ? last
            : grid.appendChild(h('div', { class: 'text-diff-hunk', dataset: { change: change.id, sides: sidesOfChange(change.kind) } }));

        hunk.append(renderRow(row));
    }

    return h('div', {
        class: 'text-diff-panel',
        children: [
            h('div', {
                class: 'aligned-headers',
                children: [buildDiffSideHeader('original', input.original), buildDiffSideHeader('modified', input.modified)],
            }),
            h('div', {
                class: 'aligned-scroller text-diff-scroller',
                dataset: { scrollKey: 'lines' },
                attrs: { tabindex: '0', role: 'region', 'aria-label': 'Both sides, line for line' },
                children: [grid],
            }),
        ],
    });
}

// A side while the other is still missing: its text as it is, or the drop zone that fills it.
function buildPendingPane(side: DiffSideName, input: TextDiffViewInput): HTMLElement {
    const source: DiffSide | null = side === 'original' ? input.original : input.modified;
    const body = h('div', { class: 'split-pane-body', dataset: { scrollKey: side } });

    body.append(source == null
        ? buildEmptySide(side, input)
        : h('pre', { class: 'diff-side-text', text: source.text ?? '' }));

    return h('div', {
        class: 'split-pane',
        dataset: { pane: side },
        children: [buildDiffSideHeader(side, source), body],
    });
}

function renderRow(row: DiffRow): HTMLElement {
    const dataset: Record<string, string> = {};

    // A row only one side has, which Before or After leaves out.
    if (row.left == null || row.right == null) {
        dataset['only'] = row.left == null ? 'modified' : 'original';
    }

    return h('div', {
        class: 'text-diff-row',
        dataset,
        children: [...renderCells(row.left, 'original'), ...renderCells(row.right, 'modified')],
    });
}

function renderCells(cell: DiffCell | null, side: DiffSideName): HTMLElement[] {
    if (cell == null) {
        return [
            h('span', { class: 'text-diff-number', dataset: { side, placeholder: 'true' } }),
            h('span', { class: 'text-diff-text', dataset: { side, placeholder: 'true' } }),
        ];
    }

    const marker = MARKERS[cell.status];
    const dataset: Record<string, string> = marker == null ? { side } : { side, marker };

    return [
        h('span', { class: 'text-diff-number', dataset, text: String(cell.line ?? '') }),
        h('span', { class: 'text-diff-text', dataset, text: cell.tokens[0]?.text ?? '' }),
    ];
}

interface NavigationOptions {
    readonly panel: HTMLElement;
    readonly keyScope: HTMLElement;
    readonly host: HTMLElement;
    readonly input: TextDiffViewInput;
    readonly document: TextDiffDocument;
}

// The bar steps from change to change, top to bottom.
function attachNavigation(options: NavigationOptions): void {
    const { panel, keyScope, host, input } = options;
    const scroller = panel.querySelector<HTMLElement>('.text-diff-scroller');

    if (scroller == null) {
        return;
    }

    const hunks = new Map(Array.from(scroller.querySelectorAll<HTMLElement>('.text-diff-hunk'), (hunk) => [hunk.dataset['change'] ?? '', hunk]));
    const changes = navigationChangesOf(options.document.changes, {
        labelled: false,
        locate: (change) => {
            const hunk = hunks.get(change.id);

            return hunk == null ? [] : [hunk];
        },
    });

    attachDiffNavigation({
        host: panel,
        scroller,
        keyScope,
        state: input.state.navigation,
        rowSelector: '.text-diff-row',
        changes: () => changes,
        onRecompute: () => {
            input.state.cache = null;
            renderTextDiffView(host, input);
        },
    });
}
