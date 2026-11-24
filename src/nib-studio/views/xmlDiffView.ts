import type { XmlDiffDocument } from '../../common/diff/diffDocument.js';
import { buildXmlDiffDocument } from '../../common/diff/xmlDiffDocument.js';
import { parseXml, type XmlNode } from '../../common/paths/xmlParser.js';
import { collectElementFields, type XmlArrayRule, type XmlCompareOptions } from '../../common/xml/xmlCompare.js';
import { clear, h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { toast } from '../app/toast.js';
import { attachAlignedNavigation, buildAlignedDiffPanel } from './alignedDiff.js';
import { compareSize, scheduleDiffRender } from './diffNavigationBar.js';
import { showRuleDialogAsync } from './diffRulePicker.js';
import { buildRulesMenu } from './diffRulesMenu.js';
import { rememberScroll } from './diffScroll.js';
import { buildDiffSideHeader, diffDocumentSide, diffDocumentSidesKey, type DiffSideName } from './diffSideHeader.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewInput, XmlDiffViewState } from './diffViewState.js';
import { buildSortKeysToggle } from './jsonDiffView.js';

export type XmlDiffViewInput = DiffViewInput<XmlDiffViewState>;

export type XmlDiffDocumentSource = Pick<XmlDiffViewInput, 'original' | 'modified' | 'state'>;

type XmlComparison = NonNullable<XmlDiffViewState['cache']>;

export function renderXmlDiffView(container: HTMLElement, input: XmlDiffViewInput): void {
    clear(container);

    const comparison = currentXmlComparison(input);
    const root = h('div', { class: 'xml-diff-view' });
    const body = h('div', { class: 'xml-diff-body' });

    root.append(buildToolbar({ host: container, input, comparison }), buildOptionsPanel(container, input), body);
    container.append(root);
    renderBody({ container: body, host: container, input, comparison });
    rememberScroll(container, input.state.scroll);
}

// The diff document of both sides; null until both sides are chosen and are valid XML.
export function currentXmlDiffDocument(input: XmlDiffDocumentSource): XmlDiffDocument | null {
    return currentXmlComparison(input)?.document ?? null;
}

// Draws the diff again once an option or a rule changed, comparing large inputs after a pause.
function recompute(host: HTMLElement, input: XmlDiffViewInput): void {
    scheduleDiffRender(host, compareSize(input.original, input.modified), () => renderXmlDiffView(host, input));
}

function rootsOf(comparison: XmlComparison | null): XmlNode[] {
    return [comparison?.left ?? null, comparison?.right ?? null].filter((root): root is XmlNode => root != null);
}

// Parses both sides and builds the diff document once, kept until a side, an option, a rule, the order or the names change.
function currentXmlComparison(input: XmlDiffDocumentSource): XmlComparison | null {
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
        && cache.options === state.options
        && cache.rules === state.rules
        && cache.sortKeys === state.sortKeys
        && cache.view === state.view
        && cache.sides === sides
    ) {
        return cache;
    }

    const left = parseXml(originalText);
    const right = parseXml(modifiedText);
    const document = left.ok && right.ok
        ? buildXmlDiffDocument({
            original: diffDocumentSide(original),
            modified: diffDocumentSide(modified),
            left: left.root,
            right: right.root,
            options: state.options,
            elementRules: state.rules,
            sortNames: state.sortKeys,
            names: state.view,
        })
        : null;
    state.cache = {
        original: originalText,
        modified: modifiedText,
        options: state.options,
        rules: state.rules,
        sortKeys: state.sortKeys,
        view: state.view,
        sides,
        left: left.ok ? left.root : null,
        right: right.ok ? right.root : null,
        document,
    };

    return state.cache;
}

interface ToolbarOptions {
    readonly host: HTMLElement;
    readonly input: XmlDiffViewInput;
    readonly comparison: XmlComparison | null;
}

function buildToolbar(options: ToolbarOptions): HTMLElement {
    const { host, input } = options;
    const { state } = input;

    return h('div', {
        class: 'editor-toolbar',
        children: [
            ...buildDiffToolbarSides(input),
            buildSortKeysToggle(state, () => renderXmlDiffView(host, input), 'Sort by name'),
            h('span', { class: 'toolbar-spacer' }),
            buildRulesMenu({
                target: 'element',
                rules: state.rules,
                onEdit: (rule) => {
                    void editRuleAsync({ xpath: rule.path, host, input, roots: rootsOf(options.comparison) });
                },
                onRemove: (rule) => {
                    state.rules = state.rules.filter((existing) => existing.path !== rule.path);
                    toast(`Rule removed for ${rule.path}.`, 'ok');
                    recompute(host, input);
                },
            }),
            h('div', {
                class: 'toolbar-group',
                children: [
                    h('button', {
                        class: 'view-tab',
                        text: 'XML',
                        attrs: {
                            'type': 'button',
                            'title': 'Label the rows with element names, such as <line> and @id',
                            'aria-pressed': String(state.view === 'xml'),
                        },
                        dataset: state.view === 'xml' ? { active: 'true', view: 'xml' } : { view: 'xml' },
                        on: {
                            click: () => {
                                state.view = 'xml';
                                renderXmlDiffView(host, input);
                            },
                        },
                    }),
                    h('button', {
                        class: 'view-tab',
                        text: 'JSON names',
                        attrs: {
                            'type': 'button',
                            'title': 'Label the rows with the keys the XML converts to as JSON',
                            'aria-pressed': String(state.view === 'json'),
                        },
                        dataset: state.view === 'json' ? { active: 'true', view: 'json' } : { view: 'json' },
                        on: {
                            click: () => {
                                state.view = 'json';
                                renderXmlDiffView(host, input);
                            },
                        },
                    }),
                ],
            }),
        ],
    });
}

function buildOptionsPanel(host: HTMLElement, input: XmlDiffViewInput): HTMLElement {
    const { state } = input;
    const optionCheckbox = (label: string, key: keyof XmlCompareOptions, tooltip: string): HTMLElement => {
        const checkbox = h('input', { attrs: { type: 'checkbox' } });
        checkbox.checked = Boolean(state.options[key] ?? false);
        checkbox.addEventListener('change', () => {
            state.options = { ...state.options, [key]: checkbox.checked };
            recompute(host, input);
        });

        return h('label', {
            class: 'xml-diff-option',
            dataset: { option: key },
            attrs: { title: tooltip },
            children: [checkbox, h('span', { text: label })],
        });
    };

    return h('div', {
        class: 'xml-diff-options',
        children: [
            optionCheckbox(
                'Ignore whitespace-only text',
                'ignoreWhitespaceOnly',
                'Skip text made only of spaces, tabs and line breaks, such as the indentation between elements. Untick to count indentation changes.',
            ),
            optionCheckbox(
                'Trim text and attribute values',
                'trimText',
                'Ignore spaces, tabs and line breaks at the start and end of text and of attribute values. Untick to compare them exactly.',
            ),
            optionCheckbox(
                'Ignore namespace prefixes',
                'ignoreNamespacePrefixes',
                'Treat soap:Body and Body as the same element, and leave xmlns declarations out of the compare.',
            ),
            optionCheckbox(
                'Case-sensitive names',
                'caseSensitiveNames',
                'Treat Order and order as different element and attribute names. Untick to ignore case in names; values keep their case.',
            ),
        ],
    });
}

interface BodyOptions {
    readonly container: HTMLElement;
    readonly host: HTMLElement;
    readonly input: XmlDiffViewInput;
    readonly comparison: XmlComparison | null;
}

// The aligned documents and their bar, or what stands in while a side is missing or not valid XML.
function renderBody(options: BodyOptions): void {
    const { container, host, input, comparison } = options;
    clear(container);

    if (comparison == null) {
        const panes = h('div', { class: 'split split-horizontal xml-diff-panes' });
        panes.append(buildPendingPane('original', input), buildPendingPane('modified', input));
        container.append(panes);

        return;
    }

    if (comparison.left == null || comparison.right == null || comparison.document == null) {
        const which = comparison.left == null ? 'Original' : 'Modified';
        const result = parseXml((comparison.left == null ? input.original : input.modified)?.text ?? '');
        container.append(h('div', {
            class: 'editor-placeholder',
            children: [
                h('h2', { text: `${which} is not valid XML` }),
                result.ok ? null : h('p', { text: `${result.message} (line ${result.line}, column ${result.column}).` }),
            ],
        }));

        return;
    }

    const roots = [comparison.left, comparison.right];
    const document = comparison.document;
    const rerender = (): void => renderXmlDiffView(host, input);
    const panel = buildAlignedDiffPanel({
        original: input.original,
        modified: input.modified,
        document,
        state: input.state,
        onArrayClick: (rulePath) => {
            void editRuleAsync({ xpath: rulePath, host, input, roots });
        },
        rerender,
    });

    const panes = h('div', { class: 'xml-diff-panes', children: [panel] });
    container.append(h('div', { class: 'xml-diff-layout', children: [panes] }));

    attachAlignedNavigation({
        panel,
        document,
        keyScope: container,
        state: input.state,
        rerender,
        onRecompute: () => {
            input.state.cache = null;
            rerender();
        },
    });
}

// A pane while the other side is still missing: the chosen document, or the drop zone that fills the empty side.
function buildPendingPane(side: DiffSideName, input: XmlDiffViewInput): HTMLElement {
    const source: DiffSide | null = side === 'original' ? input.original : input.modified;
    const body = h('div', { class: 'split-pane-body', dataset: { scrollKey: side } });

    if (source != null) {
        body.append(h('pre', { class: 'xml-diff-pre', text: source.text ?? '' }));
    }
    else if (input.callbacks.targetDropZone != null) {
        body.append(input.callbacks.targetDropZone((target) => input.callbacks.onSetSide(side, target)));
    }
    else {
        body.append(h('div', {
            class: 'editor-placeholder',
            children: [h('p', { text: 'Pick two XML documents to compare.' })],
        }));
    }

    return h('div', {
        class: 'split-pane',
        dataset: { pane: side },
        children: [buildDiffSideHeader(side, source), body],
    });
}

interface EditRuleOptions {
    readonly xpath: string;
    readonly host: HTMLElement;
    readonly input: XmlDiffViewInput;
    readonly roots: ReadonlyArray<XmlNode>;
}

async function editRuleAsync(options: EditRuleOptions): Promise<void> {
    const { xpath, host, input, roots } = options;
    const { state } = input;
    const existing = state.rules.find((rule) => rule.path === xpath) ?? null;
    const result = await showRuleDialogAsync({
        target: 'element',
        path: xpath,
        fields: collectElementFields(roots, xpath, state.options),
        matchBy: existing?.matchBy ?? [],
        sortBy: existing?.sortBy ?? [],
        existing: existing != null,
    });

    if (result == null) {
        return;
    }

    const others = state.rules.filter((rule) => rule.path !== xpath);

    if (result.action === 'remove' || (result.matchBy.length === 0 && result.sortBy.length === 0)) {
        state.rules = others;

        if (existing != null) {
            toast(`Rule removed for ${xpath}.`, 'ok');
        }
    }
    else {
        const rule: XmlArrayRule = { path: xpath, matchBy: result.matchBy, sortBy: result.sortBy };
        state.rules = existing == null
            ? [...others, rule]
            : state.rules.map((candidate) => candidate.path === xpath ? rule : candidate);
        toast(existing == null ? `Rule added for ${xpath}.` : `Rule updated for ${xpath}.`, 'ok');
    }

    recompute(host, input);
}
