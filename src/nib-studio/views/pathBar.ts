import { h } from '../app/dom.js';
import { toast } from '../app/toast.js';
import { errorMessage } from '../../common/errorMessage.js';

// The path of a node picked in a tree, in two forms.
export interface PathBarSelection {
    // With the position of every repeated element or array item, such as `/orders/order[2]/@id`.
    readonly exact: string;
    // Without positions, such as `/orders/order/@id`, so it matches the same node under every repeated parent.
    readonly anyPosition: string;
}

export interface PathBarOptions {
    // The query language, such as `XPath` or `JSONPath`, used for the label, tooltips and the copy toast.
    readonly language: string;
    // Offers a "Use in <language>" button that hands the shown path to the query view.
    readonly onUse?: (path: string) => void;
}

export interface PathBar {
    readonly element: HTMLElement;
    readonly show: (selection: PathBarSelection) => void;
}

// A strip above a tree that shows the path of the selected node, with Copy and an "Any position" toggle.
export function createPathBar(options: PathBarOptions): PathBar {
    const { language, onUse } = options;
    let selection: PathBarSelection | null = null;

    const path = h('code', {
        class: 'path-bar-path',
        text: `Click a node to see its ${language}.`,
    });
    const anyPosition = h('input', { attrs: { type: 'checkbox', disabled: true } });
    const copyButton = h('button', {
        class: 'button',
        text: 'Copy',
        dataset: { action: 'copy-path' },
        attrs: { type: 'button', title: `Copy the ${language} to the clipboard`, disabled: true },
    });
    const useButton = onUse == null
        ? null
        : h('button', {
            class: 'button',
            text: `Use in ${language}`,
            dataset: { action: 'use-path' },
            attrs: { type: 'button', title: `Open the ${language} view with this path as the expression`, disabled: true },
        });
    const element = h('div', {
        class: 'path-bar',
        dataset: { empty: 'true' },
        attrs: { role: 'group', 'aria-label': `${language} of the selected node` },
        children: [
            h('span', { class: 'path-bar-label', text: language }),
            path,
            h('label', {
                class: 'path-bar-option',
                attrs: { title: 'Leave out the positions, so the path matches this node under every repeated parent' },
                children: [anyPosition, h('span', { text: 'Any position' })],
            }),
            copyButton,
            useButton,
        ],
    });

    const shownPath = (): string => {
        if (selection == null) {
            return '';
        }

        return anyPosition.checked ? selection.anyPosition : selection.exact;
    };

    const refresh = (): void => {
        const text = shownPath();
        path.textContent = text;
        path.title = text;
    };

    anyPosition.addEventListener('change', refresh);
    copyButton.addEventListener('click', () => {
        void copyPathAsync(shownPath(), language);
    });
    useButton?.addEventListener('click', () => onUse?.(shownPath()));

    return {
        element,
        show: (next) => {
            selection = next;
            delete element.dataset['empty'];
            copyButton.disabled = false;
            anyPosition.disabled = next.anyPosition === next.exact;

            if (useButton != null) {
                useButton.disabled = false;
            }

            refresh();
        },
    };
}

const FLASH_MILLISECONDS = 1500;

// The data attributes a tree puts on every node that can be selected.
export function pathNodeDataset(selection: PathBarSelection): Record<string, string> {
    return { nodePath: selection.exact, nodePathAny: selection.anyPosition };
}

// A click on a node marked with `pathNodeDataset`, or Enter on a focused row, selects it and shows its path.
export function bindPathSelection(tree: HTMLElement, pathBar: PathBar): void {
    tree.addEventListener('click', (event) => {
        const node = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-node-path]');

        if (node != null && tree.contains(node)) {
            selectPathNode(tree, node, pathBar);
        }
    });
    tree.addEventListener('keydown', (event) => {
        const row = event.target as HTMLElement;

        if (event.key !== 'Enter' || row.dataset['nodePath'] == null) {
            return;
        }

        event.preventDefault();
        selectPathNode(tree, row, pathBar);
    });
}

// Opens the folded parents of the node with this exact path, then selects, scrolls to and flashes it.
// Returns false when no node in the tree has the path.
export function revealPath(tree: HTMLElement, path: string, pathBar: PathBar): boolean {
    const node = [...tree.querySelectorAll<HTMLElement>('[data-node-path]')]
        .find((candidate) => candidate.dataset['nodePath'] === path);

    if (node == null) {
        return false;
    }

    for (let element = node.parentElement; element != null && element !== tree; element = element.parentElement) {
        if (element.hidden) {
            element.parentElement?.querySelector<HTMLElement>(':scope > :first-child [data-state="collapsed"]')?.click();
        }
    }

    selectPathNode(tree, node, pathBar);
    node.dataset['flash'] = 'true';
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    node.closest<HTMLElement>('[tabindex]')?.focus({ preventScroll: true });
    window.setTimeout(() => {
        delete node.dataset['flash'];
    }, FLASH_MILLISECONDS);

    return true;
}

function selectPathNode(tree: HTMLElement, node: HTMLElement, pathBar: PathBar): void {
    for (const selected of tree.querySelectorAll<HTMLElement>('[data-selected]')) {
        delete selected.dataset['selected'];
    }

    node.dataset['selected'] = 'true';
    pathBar.show({
        exact: node.dataset['nodePath'] ?? '',
        anyPosition: node.dataset['nodePathAny'] ?? node.dataset['nodePath'] ?? '',
    });
}

async function copyPathAsync(path: string, language: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(path);
        toast(`${language} copied.`, 'ok');
    }
    catch (error) {
        toast(errorMessage(error, 'Copy failed.'), 'fail');
    }
}
