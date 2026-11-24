import type { DataDiffDocument } from '../../common/diff/diffDocument.js';
import {
    buildJsonDiffDocument,
    buildYamlDiffDocument,
    type JsonDiffDocumentInput,
} from '../../common/diff/jsonDiffDocument.js';
import type { JsonArrayRule } from '../../common/json/jsonComparer.js';
import { JSON_DATA_FORMAT, type DataFormat } from '../../common/json/jsonTree.js';
import { YAML_DATA_FORMAT } from '../../common/yaml/yamlToJson.js';
import type { JsonPathSegment } from '../../common/paths/jsonPathBuilder.js';
import { clear, h } from '../app/dom.js';
import type { DiffSide } from '../app/store.js';
import { toast } from '../app/toast.js';
import { attachAlignedNavigation, buildAlignedDiffPanel } from './alignedDiff.js';
import { compareSize, scheduleDiffRender } from './diffNavigationBar.js';
import { showRuleDialogAsync, sortFieldNames } from './diffRulePicker.js';
import { buildRulesMenu } from './diffRulesMenu.js';
import { rememberScroll } from './diffScroll.js';
import { diffDocumentSide, diffDocumentSidesKey, type DiffSideName } from './diffSideHeader.js';
import { buildDiffToolbarSides } from './diffToolbar.js';
import type { DiffViewInput, JsonDiffViewState } from './diffViewState.js';

// How a data diff reads its sides and which kind of diff document it builds: JSON, or YAML read as JSON data.
export interface DataDiffFormat {
    readonly data: DataFormat;
    readonly build: (input: JsonDiffDocumentInput) => DataDiffDocument;
}

const JSON_DIFF_FORMAT: DataDiffFormat = Object.freeze({
    data: JSON_DATA_FORMAT,
    build: buildJsonDiffDocument,
});

export const YAML_DIFF_FORMAT: DataDiffFormat = Object.freeze({
    data: YAML_DATA_FORMAT,
    build: buildYamlDiffDocument,
});

function formatOf(input: { readonly format?: DataDiffFormat }): DataDiffFormat {
    return input.format ?? JSON_DIFF_FORMAT;
}

export type JsonDiffViewInput = DiffViewInput<JsonDiffViewState> & {
    // JSON unless set.
    readonly format?: DataDiffFormat;
};

export type JsonDiffDocumentSource = Pick<JsonDiffViewInput, 'original' | 'modified' | 'state' | 'format'>;

// Expects every chosen side to be valid for its format; the diff tab shows the parse error itself for one that is not.
export function renderJsonDiffView(container: HTMLElement, input: JsonDiffViewInput): void {
    clear(container);

    const { state } = input;
    const document = currentJsonDiffDocument(input);
    const rerender = (): void => renderJsonDiffView(container, input);
    const body = h('div', { class: 'json-diff-body' });
    const trees = buildTreesPanel(container, input, document ?? pendingJsonDiffDocument(input));

    container.append(buildToolbar(container, input), body);
    body.append(trees.element);

    if (document != null) {
        attachAlignedNavigation({
            panel: trees.panel,
            document,
            keyScope: body,
            state,
            rerender,
            onRecompute: () => {
                state.cache = null;
                rerender();
            },
        });
    }

    rememberScroll(container, state.scroll);
}

// The diff document of both sides, built once and kept until a side, the rules or the key order change.
// Null until both sides are chosen and are valid for the format.
export function currentJsonDiffDocument(input: JsonDiffDocumentSource): DataDiffDocument | null {
    const { original, modified, state } = input;
    const format = formatOf(input);

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
        && cache.sortKeys === state.sortKeys
        && cache.sides === sides
    ) {
        return cache.document;
    }

    const left = format.data.parse(originalText);
    const right = format.data.parse(modifiedText);

    if (!left.ok || !right.ok) {
        return null;
    }

    const document = format.build({
        original: diffDocumentSide(original),
        modified: diffDocumentSide(modified),
        left: left.value,
        right: right.value,
        arrayRules: state.rules,
        sortKeys: state.sortKeys,
    });
    state.cache = { original: originalText, modified: modifiedText, rules: state.rules, sortKeys: state.sortKeys, sides, document };

    return document;
}

// The side that is chosen, laid out alone while the other is still missing.
function pendingJsonDiffDocument(input: JsonDiffViewInput): DataDiffDocument {
    const format = formatOf(input);

    return format.build({
        original: diffDocumentSide(input.original),
        modified: diffDocumentSide(input.modified),
        left: parsedValue(input.original, format),
        right: parsedValue(input.modified, format),
        arrayRules: input.state.rules,
        sortKeys: input.state.sortKeys,
    });
}

function parsedValue(side: DiffSide | null, format: DataDiffFormat): unknown {
    if (side == null) {
        return undefined;
    }

    const parsed = format.data.parse(side.text ?? '');

    return parsed.ok ? parsed.value : undefined;
}

// Draws the diff again once a rule changed, comparing large inputs after a pause.
function recompute(host: HTMLElement, input: JsonDiffViewInput): void {
    scheduleDiffRender(host, compareSize(input.original, input.modified), () => renderJsonDiffView(host, input));
}

function buildToolbar(host: HTMLElement, input: JsonDiffViewInput): HTMLElement {
    const { state } = input;

    return h('div', {
        class: 'editor-toolbar json-diff-toolbar',
        children: [
            ...buildDiffToolbarSides(input),
            buildSortKeysToggle(state, () => renderJsonDiffView(host, input)),
            h('span', { class: 'toolbar-spacer' }),
            buildRulesMenu({
                target: 'array',
                rules: state.rules,
                onEdit: (rule) => {
                    void editRuleAsync({ path: rule.path, host, input });
                },
                onRemove: (rule) => {
                    state.rules = state.rules.filter((existing) => existing.path !== rule.path);
                    toast(`Rule removed for ${rule.path}.`, 'ok');
                    recompute(host, input);
                },
            }),
        ],
    });
}

// The "Sort keys" toggle shared by the JSON, XML and row diffs.
export function buildSortKeysToggle(state: { sortKeys: boolean }, rerender: () => void, label = 'Sort keys'): HTMLElement {
    const checkbox = h('input', { attrs: { type: 'checkbox' } });
    checkbox.checked = state.sortKeys;
    checkbox.addEventListener('change', () => {
        state.sortKeys = checkbox.checked;
        rerender();
    });

    return h('label', {
        class: 'diff-sort-toggle',
        dataset: { action: 'sort-keys' },
        attrs: { title: 'Order keys by name instead of as they appear in the file' },
        children: [checkbox, h('span', { text: label })],
    });
}

interface TreesPanel {
    readonly element: HTMLElement;
    readonly panel: HTMLElement;
}

// Both documents as one aligned grid, with the drop zone for a side that has nothing to show.
function buildTreesPanel(host: HTMLElement, input: JsonDiffViewInput, document: DataDiffDocument): TreesPanel {
    const { state, callbacks } = input;
    const empty: DiffSideName | null = input.original == null ? 'original' : input.modified == null ? 'modified' : null;
    const formatName = formatOf(input).data.name;
    const panel = buildAlignedDiffPanel({
        original: input.original,
        modified: input.modified,
        document,
        state,
        onArrayClick: (rulePath) => {
            void editRuleAsync({ path: rulePath, host, input });
        },
        rerender: () => renderJsonDiffView(host, input),
    });

    if (empty != null) {
        const zone = callbacks.targetDropZone?.((target) => callbacks.onSetSide(empty, target))
            ?? h('div', {
                class: 'editor-placeholder',
                children: [h('p', { text: `Pick the ${empty} ${formatName} file.` })],
            });
        panel.append(h('div', { class: 'aligned-drop', dataset: { side: empty }, children: [zone] }));
    }

    return { element: h('div', { class: 'json-diff-trees', children: [panel] }), panel };
}

interface EditRuleOptions {
    readonly path: string;
    readonly host: HTMLElement;
    readonly input: JsonDiffViewInput;
}

async function editRuleAsync(options: EditRuleOptions): Promise<void> {
    const { path, host, input } = options;
    const { state } = input;
    const existing = state.rules.find((rule) => rule.path === path) ?? null;
    const segments = segmentsOfRule(path);
    const fields = segments == null ? [] : collectArrayItemFields(parsedSides(input), segments);
    const result = await showRuleDialogAsync({
        target: 'array',
        path,
        fields,
        matchBy: existing?.matchBy ?? [],
        sortBy: existing?.sortBy ?? [],
        existing: existing != null,
    });

    if (result == null) {
        return;
    }

    const others = state.rules.filter((rule) => rule.path !== path);

    if (result.action === 'remove' || (result.matchBy.length === 0 && result.sortBy.length === 0)) {
        state.rules = others;

        if (existing != null) {
            toast(`Rule removed for ${path}.`, 'ok');
        }

        recompute(host, input);

        return;
    }

    const rule: JsonArrayRule = { path, matchBy: result.matchBy, sortBy: result.sortBy };
    const at = state.rules.findIndex((candidate) => candidate.path === path);
    state.rules = at < 0 ? [...others, rule] : state.rules.map((candidate) => candidate.path === path ? rule : candidate);
    toast(existing == null
        ? `Rule added for ${path}.`
        : `Rule updated for ${path}.`, 'ok');
    recompute(host, input);
}

// Rule paths come from anyItemsOf plus a trailing [*]; turns them back into array segments.
function segmentsOfRule(path: string): JsonPathSegment[] | null {
    if (!path.startsWith('$') || !path.endsWith('[*]')) {
        return null;
    }

    const segments: JsonPathSegment[] = [];
    const pattern = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[\*\]|\["((?:[^"\\]|\\.)*)"\]|\['([^']*)'\]/gy;
    const inner = path.slice(1, -3);
    pattern.lastIndex = 0;

    while (pattern.lastIndex < inner.length) {
        const match = pattern.exec(inner);

        if (match == null) {
            return null;
        }

        if (match[1] != null) {
            segments.push(match[1]);
        }
        else if (match[2] != null) {
            segments.push(match[2].replace(/\\(.)/g, '$1'));
        }
        else if (match[3] != null) {
            segments.push(match[3]);
        }
        else {
            segments.push(0);
        }
    }

    return segments;
}

// Every field name found on the objects of the arrays at segments, across all values.
// Numeric segments act as wildcards, matching the [*] steps of a rule path.
export function collectArrayItemFields(
    values: ReadonlyArray<unknown>,
    segments: ReadonlyArray<JsonPathSegment>,
): string[] {
    const fields = new Set<string>();
    const arrays: unknown[][] = [];

    for (const value of values) {
        collectArrays(value, segments, 0, arrays);
    }

    for (const array of arrays) {
        for (const item of array) {
            if (isPlainObject(item)) {
                for (const key of Object.keys(item)) {
                    fields.add(key);
                }
            }
        }
    }

    return sortFieldNames(fields);
}

function collectArrays(
    value: unknown,
    segments: ReadonlyArray<JsonPathSegment>,
    position: number,
    out: unknown[][],
): void {
    if (position === segments.length) {
        if (Array.isArray(value)) {
            out.push(value);
        }

        return;
    }

    const segment = segments[position];

    if (typeof segment === 'number') {
        if (Array.isArray(value)) {
            for (const item of value) {
                collectArrays(item, segments, position + 1, out);
            }
        }

        return;
    }

    if (segment != null && isPlainObject(value) && Object.hasOwn(value, segment)) {
        collectArrays(value[segment], segments, position + 1, out);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parsedSides(input: JsonDiffViewInput): unknown[] {
    const values: unknown[] = [];

    for (const source of [input.original, input.modified]) {
        const value = parsedValue(source, formatOf(input));

        if (value !== undefined) {
            values.push(value);
        }
    }

    return values;
}
