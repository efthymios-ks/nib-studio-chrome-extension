import { describe, expect, it } from 'vitest';
import { parseXml, type XmlNode } from '../paths/xmlParser.js';
import type { DiffDocumentSide } from './diffDocument.js';
import { buildXmlDiffDocument, elementPathOf, xmlLabel, type XmlDiffDocumentInput } from './xmlDiffDocument.js';

const ORIGINAL: DiffDocumentSide = { name: 'a.xml', source: 'file', path: 'a.xml' };
const MODIFIED: DiffDocumentSide = { name: 'b.xml', source: 'file', path: 'b.xml' };

function root(text: string): XmlNode {
    const parsed = parseXml(text);

    if (!parsed.ok) {
        throw new Error(parsed.message);
    }

    return parsed.root;
}

function build(left: string, right: string, overrides: Partial<XmlDiffDocumentInput> = {}): ReturnType<typeof buildXmlDiffDocument> {
    return buildXmlDiffDocument({ original: ORIGINAL, modified: MODIFIED, left: root(left), right: root(right), ...overrides });
}

function changes(document: ReturnType<typeof buildXmlDiffDocument>): string[] {
    return document.changes.map((change) => `${change.kind} ${change.id}`);
}

describe('buildXmlDiffDocument', () => {
    it('names a changed attribute by its element path and labels the rows as XML', () => {
        const document = build('<root id="1"><a>x</a></root>', '<root id="2"><a>x</a></root>');

        expect(changes(document)).toEqual(['changed root/@id']);
        expect(document.rows.map((row) => row.left?.label ?? '')).toEqual(['', '<root>', '@id', '<a>', '', '']);
        expect(document.kind).toBe('xml');
        expect(document.summary.changed).toBe(1);
    });

    it('labels the rows with the JSON names when asked', () => {
        const document = build('<root id="1"/>', '<root id="2"/>', { names: 'json' });

        expect(document.rows.map((row) => row.left?.label ?? '')).toEqual(['', 'root', '@id', '', '']);
        expect(document.options.names).toBe('json');
    });

    it('records the options with their defaults filled in', () => {
        const document = build('<r/>', '<r/>', { elementRules: [{ path: '/r/i', matchBy: ['@id'] }] });

        expect(document.options).toEqual({
            ignoreWhitespaceOnly: false,
            trimText: false,
            ignoreNamespacePrefixes: false,
            caseSensitiveNames: true,
            elementRules: [{ path: '/r/i', matchBy: ['@id'] }],
            sortNames: false,
            names: 'xml',
        });
    });

    it('compares as the options say', () => {
        const left = '<root id=" 1">\n  <a>x</a>\n</root>';
        const right = '<root id="1">\n    <a>x</a>\n</root>';

        expect(changes(build(left, right))).toEqual(['changed root/@id', 'changed root/text()']);
        expect(changes(build(left, right, { options: { trimText: true, ignoreWhitespaceOnly: true } }))).toEqual([]);
        expect(changes(build('<Root/>', '<root/>', { options: { caseSensitiveNames: false } }))).toEqual([]);
        expect(changes(build('<s:r xmlns:s="urn:a"><s:a>1</s:a></s:r>', '<r><a>1</a></r>', { options: { ignoreNamespacePrefixes: true } }))).toEqual([]);
    });

    it('pairs repeated elements by their element rule, names them by its match key, and offers the rule path on the array', () => {
        const document = build(
            '<root><item id="5" v="1"/><item id="6" v="1"/></root>',
            '<root><item id="6" v="1"/><item id="5" v="2"/></root>',
            { elementRules: [{ path: '/root/item', matchBy: ['@id'] }] },
        );

        expect(changes(document)).toEqual(['changed root/item[@id=5]/@v']);
        expect(document.rows.find((row) => row.left?.rulePath != null)?.left?.rulePath).toBe('/root/item');
    });

    it('names unmatched repeated elements by index, and an added element by its path', () => {
        const document = build('<order><item price="1"/><item price="2"/></order>', '<order><item price="1"/><item price="3"/><item price="4"/></order>');

        expect(changes(document)).toEqual(['changed order/item[1]/@price', 'added order/item[2]']);
    });

    it('orders elements by name when sorting is on', () => {
        const labels = (sortNames: boolean): string[] => build('<r><b/><a/></r>', '<r><b/><a/></r>', { sortNames }).rows
            .map((row) => row.left?.label ?? '')
            .filter((label) => label !== '' && label !== '<r>');

        expect(labels(false)).toEqual(['<b>', '<a>']);
        expect(labels(true)).toEqual(['<a>', '<b>']);
    });

    it('builds the same JSON for the same inputs', () => {
        const left = '<r a="1"><x>1</x><x>2</x></r>';
        const right = '<r a="2"><x>1</x></r>';

        expect(JSON.stringify(build(left, right))).toBe(JSON.stringify(build(left, right)));
    });
});

describe('xmlLabel', () => {
    it('shows elements, attributes, text and items as XML names', () => {
        expect(['book', '@id', '#text', '[2]'].map(xmlLabel)).toEqual(['<book>', '@id', 'text()', '[2]']);
    });
});

describe('elementPathOf', () => {
    it('keeps the element names of a path', () => {
        expect(elementPathOf(['library', 'book', 3, '@id'])).toBe('/library/book');
    });
});
