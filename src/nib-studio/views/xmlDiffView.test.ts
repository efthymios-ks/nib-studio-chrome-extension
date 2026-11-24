import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffSide } from '../app/store.js';
import { createXmlDiffViewState, type DiffViewCallbacks, type XmlDiffViewState } from './diffViewState.js';
import { currentXmlDiffDocument, renderXmlDiffView } from './xmlDiffView.js';

const callbacks: DiffViewCallbacks = {
    onSetSide: () => {},
    onSwap: () => {},
};

function side(path: string, text: string): DiffSide {
    return { label: path, path, source: 'file', text };
}

describe('renderXmlDiffView', () => {
    let container: HTMLElement;
    let state: XmlDiffViewState;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        state = createXmlDiffViewState();
    });

    afterEach(() => {
        container.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function render(original: string | null, modified: string | null): void {
        renderXmlDiffView(container, {
            original: original == null ? null : side('a.xml', original),
            modified: modified == null ? null : side('b.xml', modified),
            state,
            callbacks,
        });
    }

    function column(which: 'original' | 'modified'): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>(`.aligned-cell[data-side="${which}"]`));
    }

    // Each change as the bar names it, such as `changed root/@id`.
    function changes(): string[] {
        return state.cache?.document?.changes.map((change) => `${change.kind} ${change.id}`) ?? [];
    }


    it('labels both sides, and asks for the missing one', () => {
        render('<root/>', null);

        expect(container.querySelector('.diff-side-header[data-side="original"] .diff-side-name')?.textContent).toBe('a.xml');
        expect(container.querySelector('.diff-side-header[data-side="modified"]')?.getAttribute('data-empty')).toBe('true');
        expect(container.querySelector('.editor-placeholder')?.textContent).toContain('Pick two XML documents');
    });

    it('names a changed attribute by its element path, counted in the bar with no totals in the toolbar', () => {
        render('<root id="1"/>', '<root id="2"/>');

        expect(changes()).toEqual(['changed root/@id']);
        expect(container.querySelector('.diff-bar-position')?.textContent).toBe('– / 1');
        expect(container.querySelector('.diff-count-pills, .diff-count-pill')).toBeNull();
        expect(container.querySelector('.xml-diff-layout')?.children).toHaveLength(1);
        expect(container.querySelector('.xml-diff-list, .diff-list, .rules-panel')).toBeNull();
    });

    it('says there are no changes for identical documents', () => {
        render('<root><child/></root>', '<root><child/></root>');

        expect(container.querySelector('.diff-bar-position')?.textContent).toBe('No changes');
    });

    it('surfaces a parse error for an invalid document', () => {
        render('<unclosed>', '<root/>');

        expect(container.querySelector('.editor-placeholder h2')?.textContent).toContain('Original is not valid XML');
    });

    it('aligns elements and attributes with placeholders, in document order unless sorting is on', () => {
        render('<root><b/><a x="1"/></root>', '<root><b/><c/></root>');

        expect(column('original')).toHaveLength(column('modified').length);
        expect(column('modified').some((cell) => cell.dataset['placeholder'] === 'true')).toBe(true);
        expect(state.sortKeys).toBe(false);

        const labels = (): string[] => column('original')
            .map((cell) => cell.querySelector('.aligned-key')?.textContent ?? '')
            .filter((label) => label !== '');
        expect(labels().slice(0, 3)).toEqual(['<root>', '<b>', '<a>']);
    });

    it('names repeated elements by their rule match key', () => {
        state.rules = [{ path: '/root/item', matchBy: ['@id'] }];
        render('<root><item id="5" v="1"/><item id="6" v="1"/></root>', '<root><item id="6" v="1"/><item id="5" v="2"/></root>');

        expect(changes()).toEqual(['changed root/item[@id=5]/@v']);
        expect(state.cache?.document?.changes).toHaveLength(1);
    });

    it('names unmatched repeated elements by index, and an added element by its path', () => {
        render('<order><item price="1"/><item price="2"/></order>', '<order><item price="1"/><item price="3"/><item price="4"/></order>');

        expect(changes()).toEqual(['changed order/item[1]/@price', 'added order/item[2]']);
    });

    it('lists the element rules under Rules (n) once there are any', () => {
        render('<root><item id="5"/><item id="6"/></root>', '<root><item id="6"/><item id="5"/></root>');
        expect(container.querySelector('[data-action="rules"]')).toBeNull();

        state.rules = [{ path: '/root/item', matchBy: ['@id'] }];
        render('<root><item id="5"/><item id="6"/></root>', '<root><item id="6"/><item id="5"/></root>');

        expect(container.querySelector('[data-action="rules"]')?.textContent).toBe('Rules (1)');
        expect(changes()).toEqual([]);
    });

    it('confirms a rule removed from Rules (n) with a toast, as the JSON diff does', () => {
        state.rules = [{ path: '/root/item', matchBy: ['@id'] }];
        render('<root><item id="5"/><item id="6"/></root>', '<root><item id="6"/><item id="5"/></root>');

        container.querySelector<HTMLButtonElement>('[data-action="rules"]')!.click();
        document.querySelector<HTMLButtonElement>('.diff-rules-popover [data-action="remove"]')!.click();

        expect(state.rules).toEqual([]);
        expect([...document.querySelectorAll('.toast')].at(-1)?.textContent).toBe('Rule removed for /root/item.');
    });

    function option(key: string): HTMLLabelElement {
        return container.querySelector<HTMLLabelElement>(`.xml-diff-option[data-option="${key}"]`)!;
    }

    function toggle(key: string): void {
        option(key).querySelector<HTMLInputElement>('input')!.click();
    }

    function differenceCount(): number {
        return state.cache?.document?.changes.length ?? -1;
    }

    it('labels every option and explains it in a tooltip', () => {
        render('<root/>', '<root/>');

        const options = [...container.querySelectorAll<HTMLLabelElement>('.xml-diff-option')].map((label) => [
            label.textContent,
            label.querySelector('input')?.checked,
            label.title !== '',
        ]);
        expect(options).toEqual([
            ['Ignore whitespace-only text', true, true],
            ['Trim text and attribute values', true, true],
            ['Ignore namespace prefixes', false, true],
            ['Case-sensitive names', true, true],
        ]);
    });

    it('counts indentation between elements when whitespace-only text is not ignored', () => {
        render('<root>\n  <a>x</a>\n</root>', '<root>\n    <a>x</a>\n</root>');

        expect(differenceCount()).toBe(0);

        toggle('ignoreWhitespaceOnly');

        expect(state.options.ignoreWhitespaceOnly).toBe(false);
        expect(differenceCount()).toBe(1);
        expect(changes()).toEqual(['changed root/text()']);
    });

    it('compares leading and trailing whitespace of text and attribute values once trimming is off', () => {
        render('<root id=" 1"><a> x </a></root>', '<root id="1"><a>x</a></root>');

        expect(differenceCount()).toBe(0);

        toggle('trimText');

        expect(state.options.trimText).toBe(false);
        expect(changes()).toEqual(['changed root/@id', 'changed root/a']);
    });

    it('matches prefixed names once namespace prefixes are ignored', () => {
        render('<s:root xmlns:s="urn:a"><s:a>1</s:a></s:root>', '<root><a>1</a></root>');

        expect(differenceCount()).toBeGreaterThan(0);

        toggle('ignoreNamespacePrefixes');

        expect(differenceCount()).toBe(0);
    });

    it('matches names that differ in case once case-sensitive names is off', () => {
        render('<Root ID="1"/>', '<root id="1"/>');

        expect(differenceCount()).toBeGreaterThan(0);

        toggle('caseSensitiveNames');

        expect(differenceCount()).toBe(0);
    });

    function position(): string {
        return container.querySelector('.diff-bar-position')?.textContent ?? '';
    }

    it('calls text in a once empty element added and emptied text removed, not a type change, listed as the rows show them', () => {
        render('<r><note/><memo>old</memo></r>', '<r><note>hello</note><memo/></r>');

        expect(changes()).toEqual(['added r/note', 'removed r/memo']);
        expect(position()).toBe('– / 2');
    });

    it('floats the bar over the aligned documents and steps from top to bottom', () => {
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        render('<r a="1" b="1"/>', '<r a="2" b="2"/>');

        expect(container.querySelector('.aligned-diff.diff-bar-host > .diff-bar')).not.toBeNull();
        container.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();
        container.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();

        expect(position()).toBe('2 / 2');
        expect(state.navigation.current).toBe('r/@b');
        expect(container.querySelector('.diff-bar-position')?.getAttribute('title')).toBe('r/@b');
    });

    it('labels the rows as JSON names once asked, building the document again with them', () => {
        render('<root id="1"/>', '<root id="2"/>');
        const document = state.cache?.document;

        container.querySelector<HTMLButtonElement>('.view-tab[data-view="json"]')!.click();

        expect(state.cache?.document).not.toBe(document);
        expect(state.cache?.document?.options.names).toBe('json');
        expect(column('original').map((cell) => cell.querySelector('.aligned-key')?.textContent ?? '').filter((label) => label !== '')).toEqual(['root', '@id']);
    });

    it('has no diff document until both sides are valid XML', () => {
        expect(currentXmlDiffDocument({ original: side('a.xml', '<a>'), modified: side('b.xml', '<b/>'), state })).toBeNull();
        expect(currentXmlDiffDocument({ original: side('a.xml', '<a/>'), modified: null, state })).toBeNull();
    });

    it('compares again after an option changes, keeping the bar view', () => {
        render('<root id=" 1"/>', '<root id="1"/>');
        container.querySelector<HTMLButtonElement>('.diff-bar [data-view="before"]')!.click();

        toggle('trimText');

        expect(position()).toBe('– / 1');
        expect(container.querySelector('.aligned-diff')?.getAttribute('data-diff-view')).toBe('before');
    });
});
