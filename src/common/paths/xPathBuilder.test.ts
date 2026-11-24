import { describe, expect, it } from 'vitest';
import { parseXml } from './xmlParser.js';
import { XPath, type XPathSegment } from './xPath.js';
import { XPathBuilder } from './xPathBuilder.js';

function parse(source: string) {
    const result = parseXml(source);
    if (!result.ok) {
        throw new Error('expected ok');
    }

    return result.root;
}

describe('XPathBuilder', () => {
    it('emits a plain path for unique elements', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'a', position: 1, count: 1 },
            { kind: 'element', name: 'b', position: 1, count: 1 },
        ];
        expect(XPathBuilder.of(segments)).toBe('/a/b');
    });

    it('emits a position index for repeated siblings', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'root', position: 1, count: 1 },
            { kind: 'element', name: 'item', position: 2, count: 3 },
        ];
        expect(XPathBuilder.of(segments)).toBe('/root/item[2]');
    });

    it('encodes an attribute step', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'a', position: 1, count: 1 },
            { kind: 'attribute', name: 'id' },
        ];
        expect(XPathBuilder.of(segments)).toBe('/a/@id');
    });

    it('encodes text()', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'a', position: 1, count: 1 },
            { kind: 'text' },
        ];
        expect(XPathBuilder.of(segments)).toBe('/a/text()');
    });

    it('steps returns one question per repeated element step', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'root', position: 1, count: 1 },
            { kind: 'element', name: 'item', position: 2, count: 3 },
            { kind: 'element', name: 'field', position: 1, count: 1 },
        ];
        expect(XPathBuilder.steps(segments)).toEqual([
            { segmentIndex: 1, name: 'item', position: 2, count: 3 },
        ]);
    });

    it('anyItemsOf drops every position', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'root', position: 1, count: 1 },
            { kind: 'element', name: 'item', position: 2, count: 3 },
        ];
        expect(XPathBuilder.anyItemsOf(segments)).toBe('/root/item');
    });

    it('builds by-attribute predicate when selected', () => {
        const segments: XPathSegment[] = [
            { kind: 'element', name: 'root', position: 1, count: 1 },
            { kind: 'element', name: 'item', position: 2, count: 3 },
        ];
        const choices = new Map([
            [1, { kind: 'byAttribute' as const, name: 'id', value: '7' }],
        ]);
        expect(XPathBuilder.of(segments, choices)).toBe("/root/item[@id='7']");
    });

    it('fieldOf returns the attribute name with @ prefix', () => {
        const element: XPathSegment[] = [
            { kind: 'element', name: 'root', position: 1, count: 1 },
            { kind: 'element', name: 'item', position: 2, count: 3 },
        ];
        const clicked: XPathSegment[] = [
            ...element,
            { kind: 'attribute', name: 'id' },
        ];
        expect(XPathBuilder.fieldOf(element, clicked)).toBe('@id');
    });

    it('fieldOf returns the child element name', () => {
        const element: XPathSegment[] = [
            { kind: 'element', name: 'root', position: 1, count: 1 },
            { kind: 'element', name: 'item', position: 2, count: 3 },
        ];
        const clicked: XPathSegment[] = [
            ...element,
            { kind: 'element', name: 'sku', position: 1, count: 1 },
        ];
        expect(XPathBuilder.fieldOf(element, clicked)).toBe('sku');
    });

    it('round-trips: XPath.select resolves XPathBuilder.of back to the clicked node', () => {
        const samples = [
            '<a><b/></a>',
            '<a><b id="1"/><b id="2"/></a>',
            '<root><item><sku>s1</sku></item><item><sku>s2</sku></item></root>',
        ];

        for (const sample of samples) {
            const rootNode = parse(sample);
            const allBooks = XPath.selectAll(rootNode, '//*');
            for (const match of allBooks) {
                const path = XPathBuilder.of(match.segments);
                const resolved = XPath.select(rootNode, path);
                expect(resolved, path).not.toBeNull();
                expect(resolved?.kind).toBe('element');
            }
        }
    });
});
