import type { XPathSegment } from '../../common/paths/xPath.js';
import { XPathBuilder } from '../../common/paths/xPathBuilder.js';
import { parseXml, type XmlNode } from '../../common/paths/xmlParser.js';
import { clear, h } from '../app/dom.js';
import { emptyState } from './emptyState.js';
import { bindPathSelection, createPathBar, pathNodeDataset, revealPath, type PathBar } from './pathBar.js';

export interface XmlTreeViewOptions {
    // An XPath, as `XPathBuilder.of` writes it, to open, select and flash once the tree is drawn.
    readonly reveal?: string | null;
    // Offers "Use in XPath" in the path bar, handing it the shown XPath.
    readonly onUseInXPath?: (path: string) => void;
}

export function renderXmlTreeView(container: HTMLElement, xmlText: string, options: XmlTreeViewOptions = {}): void {
    clear(container);
    const parsed = parseXml(xmlText);

    if (!parsed.ok) {
        container.append(emptyState({
            title: 'Not valid XML',
            message: `${parsed.message} (line ${parsed.line}, column ${parsed.column}).`,
        }));

        return;
    }

    const pathBar = createPathBar({ language: 'XPath', onUse: options.onUseInXPath });
    const list = h('ul', { class: 'xml-tree' });
    list.append(renderNode(parsed.root, [{ kind: 'element', name: parsed.root.name, position: 1, count: 1 }]));
    bindPathSelection(list, pathBar);
    container.append(buildXmlTreeToolbar(list, pathBar), list);

    if (options.reveal != null) {
        revealXPath(list, options.reveal, pathBar);
    }
}

// Text that the tree doesn't draw, such as whitespace only, reveals its element instead.
function revealXPath(list: HTMLElement, path: string, pathBar: PathBar): void {
    if (revealPath(list, path, pathBar) || !path.endsWith('/text()')) {
        return;
    }

    revealPath(list, path.slice(0, -'/text()'.length), pathBar);
}

function buildXmlTreeToolbar(treeList: HTMLElement, pathBar: PathBar): HTMLElement {
    return h('div', {
        class: 'tree-toolbar',
        children: [
            h('button', {
                class: 'icon-button',
                text: '⊞',
                attrs: { type: 'button', title: 'Expand all nodes', 'aria-label': 'Expand all nodes' },
                on: { click: () => toggleAllXmlTwists(treeList, 'expanded') },
            }),
            h('button', {
                class: 'icon-button',
                text: '⊟',
                attrs: { type: 'button', title: 'Collapse all nodes', 'aria-label': 'Collapse all nodes' },
                on: { click: () => toggleAllXmlTwists(treeList, 'collapsed') },
            }),
            pathBar.element,
        ],
    });
}

function toggleAllXmlTwists(treeList: HTMLElement, state: 'expanded' | 'collapsed'): void {
    for (const twist of treeList.querySelectorAll<HTMLElement>('.xml-twist[data-state]')) {
        if (twist.dataset['state'] !== state) {
            twist.click();
        }
    }
}

function nodePaths(segments: ReadonlyArray<XPathSegment>): Record<string, string> {
    return pathNodeDataset({ exact: XPathBuilder.of(segments), anyPosition: XPathBuilder.anyItemsOf(segments) });
}

// `segments` ends with the node's own element step.
function renderNode(node: XmlNode, segments: ReadonlyArray<XPathSegment>): HTMLElement {
    const hasChildren = node.children.length > 0;
    const trimmedText = node.text.trim();
    const hasText = trimmedText.length > 0;
    const attributeKeys = Object.keys(node.attributes);
    const textPaths = nodePaths([...segments, { kind: 'text' }]);

    const twist = h('span', {
        class: 'xml-twist',
        text: hasChildren ? '▾' : '',
        dataset: hasChildren ? { state: 'expanded' } : {},
    });
    const nameSpan = h('span', { class: 'xml-name', text: node.name });
    const rowChildren: Array<Node | null> = [
        twist,
        h('span', { class: 'xml-punct', text: '<' }),
        nameSpan,
    ];

    for (const attr of attributeKeys) {
        rowChildren.push(h('span', {
            class: 'xml-attr',
            text: ` @${attr}="${node.attributes[attr] ?? ''}"`,
            dataset: nodePaths([...segments, { kind: 'attribute', name: attr }]),
        }));
    }

    rowChildren.push(h('span', { class: 'xml-punct', text: hasChildren || hasText ? '>' : '/>' }));

    if (!hasChildren && hasText) {
        rowChildren.push(h('span', { class: 'xml-text', text: trimmedText, dataset: textPaths }));
        rowChildren.push(h('span', { class: 'xml-punct', text: `</${node.name}>` }));
    }

    const row = h('div', {
        class: 'xml-row',
        dataset: nodePaths(segments),
        attrs: { tabindex: '0' },
        children: rowChildren,
    });
    const li = h('li', { children: [row] });

    if (!hasChildren) {
        return li;
    }

    const childList = h('ul', { class: 'xml-children' });
    const counts = new Map<string, number>();

    for (const child of node.children) {
        counts.set(child.name, (counts.get(child.name) ?? 0) + 1);
    }

    const positions = new Map<string, number>();

    for (const child of node.children) {
        const position = (positions.get(child.name) ?? 0) + 1;
        positions.set(child.name, position);
        const count = counts.get(child.name) ?? 1;
        childList.append(renderNode(child, [...segments, { kind: 'element', name: child.name, position, count }]));
    }

    if (hasText) {
        const textRow = h('div', {
            class: 'xml-row',
            dataset: textPaths,
            attrs: { tabindex: '0' },
            children: [
                h('span', { class: 'xml-twist' }),
                h('span', { class: 'xml-text', text: trimmedText }),
            ],
        });
        childList.append(h('li', { children: [textRow] }));
    }

    const closeRow = h('div', {
        class: 'xml-row',
        children: [
            h('span', { class: 'xml-twist' }),
            h('span', { class: 'xml-punct', text: `</${node.name}>` }),
        ],
    });

    let expanded = true;
    twist.addEventListener('click', (event) => {
        event.stopPropagation();
        expanded = !expanded;
        twist.textContent = expanded ? '▾' : '▸';
        twist.dataset['state'] = expanded ? 'expanded' : 'collapsed';
        childList.hidden = !expanded;
        closeRow.hidden = !expanded;
    });

    li.append(childList, closeRow);

    return li;
}
