import type { JsonNode } from '../../common/json/jsonTree.js';
import { parseJson } from '../../common/json/jsonTree.js';
import { JsonPathBuilder, type JsonPathSegment } from '../../common/paths/jsonPathBuilder.js';
import { countLabel } from '../../common/paths/valueFormat.js';
import { clear, h } from '../app/dom.js';
import { emptyState } from './emptyState.js';
import { bindPathSelection, createPathBar, pathNodeDataset, revealPath, type PathBar } from './pathBar.js';

export interface JsonTreeViewOptions {
    // A JSONPath, as `JsonPathBuilder.of` writes it, to open, select and flash once the tree is drawn.
    readonly reveal?: string | null;
    // Offers "Use in JSONPath" in the path bar, handing it the shown JSONPath.
    readonly onUseInJsonPath?: (path: string) => void;
    // Names the items of a root array in place of their index, such as `Document 1` for the documents of a YAML file.
    readonly rootItemLabel?: (index: number) => string;
}

export function renderJsonTreeView(container: HTMLElement, text: string, options: JsonTreeViewOptions = {}): void {
    clear(container);
    const result = parseJson(text);

    if (!result.ok) {
        container.append(emptyState({
            title: 'Not valid JSON',
            message: `${result.message} (line ${result.line}, column ${result.column}).`,
        }));

        return;
    }

    renderJsonDataTree(container, result.root, options);
}

// The tree of data that is already parsed, such as YAML read as JSON.
export function renderJsonDataTree(container: HTMLElement, root: JsonNode, options: JsonTreeViewOptions = {}): void {
    clear(container);
    const pathBar = createPathBar({ language: 'JSONPath', onUse: options.onUseInJsonPath });
    const list = h('ul', { class: 'json-tree' });
    const label = options.rootItemLabel;
    list.append(renderNode(root, [], label == null ? null : (node) => labelOfRootItem(root, node, label)));
    bindPathSelection(list, pathBar);
    container.append(buildTreeToolbar(list, pathBar), list);

    if (options.reveal != null) {
        revealPath(list, options.reveal, pathBar);
    }
}

function buildTreeToolbar(treeList: HTMLElement, pathBar: PathBar): HTMLElement {
    return h('div', {
        class: 'tree-toolbar',
        children: [
            h('button', {
                class: 'icon-button',
                text: '⊞',
                attrs: { type: 'button', title: 'Expand all nodes', 'aria-label': 'Expand all nodes' },
                on: { click: () => toggleAllJsonTwists(treeList, 'expanded') },
            }),
            h('button', {
                class: 'icon-button',
                text: '⊟',
                attrs: { type: 'button', title: 'Collapse all nodes', 'aria-label': 'Collapse all nodes' },
                on: { click: () => toggleAllJsonTwists(treeList, 'collapsed') },
            }),
            pathBar.element,
        ],
    });
}

function toggleAllJsonTwists(treeList: HTMLElement, state: 'expanded' | 'collapsed'): void {
    for (const twist of treeList.querySelectorAll<HTMLElement>('.json-twist[data-state]')) {
        if (twist.dataset['state'] !== state) {
            twist.click();
        }
    }
}

// The label a root array's item shows instead of its index, or null for every other node.
type ItemLabeler = (node: JsonNode) => string | null;

function labelOfRootItem(root: JsonNode, node: JsonNode, label: (index: number) => string): string | null {
    return root.kind === 'array' && typeof node.key === 'number' && root.children[node.key] === node ? label(node.key) : null;
}

function renderNode(
    node: JsonNode,
    parentSegments: ReadonlyArray<JsonPathSegment>,
    labeler: ItemLabeler | null = null,
): HTMLElement {
    const segments: JsonPathSegment[] = node.key == null
        ? [...parentSegments]
        : [...parentSegments, node.key];
    const pathString = JsonPathBuilder.of(segments);
    const paths = pathNodeDataset({ exact: pathString, anyPosition: JsonPathBuilder.anyItemsOf(segments) });
    const isContainer = node.kind === 'object' || node.kind === 'array';

    if (!isContainer) {
        return h('li', {
            attrs: { 'data-json-path': pathString },
            children: [renderLeafRow(node, paths, labeler?.(node) ?? null)],
        });
    }

    const open = node.kind === 'object' ? '{' : '[';
    const close = node.kind === 'object' ? '}' : ']';
    const twist = h('span', {
        class: 'json-twist',
        text: '▾',
        dataset: { state: 'expanded' },
    });
    const childrenList = h('ul', { class: 'json-children' });

    for (const child of node.children) {
        childrenList.append(renderNode(child, segments, segments.length === 0 ? labeler : null));
    }

    const rowChildren: Array<Node | null> = [twist];

    if (node.key != null) {
        rowChildren.push(renderKeySpan(node.key, labeler?.(node) ?? null));
        rowChildren.push(h('span', { class: 'json-punct', text: ':' }));
    }

    rowChildren.push(h('span', {
        class: 'json-punct json-container-open',
        text: open,
    }));
    rowChildren.push(h('span', {
        class: 'json-count',
        text: countLabel(node.children.length, node.kind === 'array' ? 'item' : 'key'),
    }));

    const row = h('div', {
        class: 'json-row',
        dataset: paths,
        attrs: { tabindex: '0' },
        children: rowChildren,
    });

    const closeRow = h('div', {
        class: 'json-row',
        children: [
            h('span', { class: 'json-twist' }),
            h('span', { class: 'json-punct', text: close }),
        ],
    });

    let expanded = true;
    twist.addEventListener('click', (event) => {
        event.stopPropagation();
        expanded = !expanded;
        twist.textContent = expanded ? '▾' : '▸';
        twist.dataset['state'] = expanded ? 'expanded' : 'collapsed';
        childrenList.hidden = !expanded;
        closeRow.hidden = !expanded;
    });

    return h('li', {
        attrs: { 'data-json-path': pathString },
        children: [row, childrenList, closeRow],
    });
}

function renderLeafRow(node: JsonNode, paths: Record<string, string>, label: string | null): HTMLElement {
    const children: Array<Node | null> = [h('span', { class: 'json-twist' })];

    if (node.key != null) {
        children.push(renderKeySpan(node.key, label));
        children.push(h('span', { class: 'json-punct', text: ':' }));
    }

    children.push(renderLeafValue(node));

    return h('div', {
        class: 'json-row',
        dataset: paths,
        attrs: { tabindex: '0' },
        children,
    });
}

function renderKeySpan(key: string | number, label: string | null): HTMLElement {
    if (label != null) {
        return h('span', { class: 'json-key', dataset: { label: 'true' }, text: label });
    }

    return h('span', { class: 'json-key', text: JSON.stringify(key) });
}

function renderLeafValue(node: JsonNode): HTMLElement {
    if (node.kind === 'string') {
        return h('span', { class: 'json-string', text: JSON.stringify(node.raw) });
    }

    if (node.kind === 'number') {
        return h('span', { class: 'json-number', text: String(node.raw) });
    }

    if (node.kind === 'boolean') {
        return h('span', { class: 'json-boolean', text: String(node.raw) });
    }

    return h('span', { class: 'json-null', text: 'null' });
}
