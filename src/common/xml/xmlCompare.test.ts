import { describe, expect, it } from 'vitest';
import { parseXml } from '../paths/xmlParser.js';
import { collectElementFields, compareXml } from './xmlCompare.js';

function parse(source: string) {
    const result = parseXml(source);
    if (!result.ok) {
        throw new Error('expected ok');
    }

    return result.root;
}

describe('compareXml', () => {
    it('reports no differences for identical XML', () => {
        expect(compareXml(parse('<a id="1"/>'), parse('<a id="1"/>'))).toEqual([]);
    });

    it('reports a changed attribute', () => {
        const diffs = compareXml(parse('<a id="1"/>'), parse('<a id="2"/>'));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.segments).toContain('@id');
    });

    it('reports a changed text', () => {
        const diffs = compareXml(parse('<a>hi</a>'), parse('<a>bye</a>'));
        expect(diffs).toHaveLength(1);
    });

    it('reports text in a once empty element as added, and text emptied out as removed', () => {
        const added = compareXml(parse('<r><note/></r>'), parse('<r><note>hello</note></r>'));
        const removed = compareXml(parse('<r><note>hello</note></r>'), parse('<r><note></note></r>'));

        expect(added).toEqual([{ kind: 'added', path: '$.r.note', segments: ['r', 'note'], leftValue: undefined, rightValue: 'hello' }]);
        expect(removed).toEqual([{ kind: 'removed', path: '$.r.note', segments: ['r', 'note'], leftValue: 'hello', rightValue: undefined }]);
    });

    it('shares shape across a side that has a single child and another that has two', () => {
        const left = parse('<root><item><sku>a</sku></item></root>');
        const right = parse('<root><item><sku>a</sku></item><item><sku>b</sku></item></root>');
        const diffs = compareXml(left, right);
        expect(diffs.some((difference) => difference.segments.includes('item'))).toBe(true);
    });

    it('applies matchBy via arrayRules', () => {
        const left = parse(`
<root>
  <line id="1"><qty>1</qty></line>
  <line id="2"><qty>2</qty></line>
</root>
        `.trim());
        const right = parse(`
<root>
  <line id="2"><qty>2</qty></line>
  <line id="1"><qty>9</qty></line>
</root>
        `.trim());
        const diffs = compareXml(left, right, {
            arrayRules: [{ path: '/root/line', matchBy: ['@id'] }],
        });
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.kind).toBe('changed');
    });

    it('ignores whitespace-only text when requested', () => {
        const left = parse('<a>   </a>');
        const right = parse('<a></a>');
        expect(compareXml(left, right)).toHaveLength(1);
        expect(compareXml(left, right, { ignoreWhitespaceOnly: true })).toEqual([]);
    });

    it('counts indentation between elements unless whitespace-only text is ignored, even with trimming on', () => {
        const left = parse('<root>\n  <a>x</a>\n</root>');
        const right = parse('<root><a>x</a></root>');

        expect(compareXml(left, right, { trimText: true })).toEqual([
            expect.objectContaining({ kind: 'removed', leftValue: '\n  \n' }),
        ]);
        expect(compareXml(left, right, { ignoreWhitespaceOnly: true, trimText: true })).toEqual([]);
    });

    it('compares leading and trailing whitespace in text unless trimming, even with whitespace-only text ignored', () => {
        const left = parse('<root><a> x </a></root>');
        const right = parse('<root><a>x</a></root>');

        expect(compareXml(left, right, { ignoreWhitespaceOnly: true })).toEqual([
            expect.objectContaining({ kind: 'changed', leftValue: ' x ', rightValue: 'x' }),
        ]);
        expect(compareXml(left, right, { ignoreWhitespaceOnly: true, trimText: true })).toEqual([]);
    });

    it('trims attribute values only when trimming', () => {
        const left = parse('<a id=" 7 " name="x"/>');
        const right = parse('<a id="7" name="x"/>');

        expect(compareXml(left, right, { ignoreWhitespaceOnly: true })).toHaveLength(1);
        expect(compareXml(left, right, { trimText: true })).toEqual([]);
    });

    it('keeps inner whitespace when trimming', () => {
        expect(compareXml(parse('<a>x  y</a>'), parse('<a>x y</a>'), { ignoreWhitespaceOnly: true, trimText: true })).toHaveLength(1);
    });

    it('ignores namespace prefixes when requested', () => {
        const left = parse('<soap:a xmlns:soap="x"/>');
        const right = parse('<x:a xmlns:x="y"/>');
        expect(compareXml(left, right).length).toBeGreaterThan(0);
        expect(compareXml(left, right, { ignoreNamespacePrefixes: true })).toEqual([]);
    });

    it('case-insensitive matching when caseSensitiveNames is false', () => {
        const left = parse('<A ID="1"/>');
        const right = parse('<a id="1"/>');
        expect(compareXml(left, right, { caseSensitiveNames: true }).length).toBeGreaterThan(0);
        expect(compareXml(left, right, { caseSensitiveNames: false })).toEqual([]);
    });
});

describe('collectElementFields', () => {
    it('lists attributes and child element names across the siblings on both sides', () => {
        const left = parse('<root><line id="1"><qty>1</qty></line><line id="2" kind="a"/></root>');
        const right = parse('<root><line id="1"><sku>x</sku></line></root>');

        expect(collectElementFields([left, right], '/root/line')).toEqual(['@id', '@kind', 'qty', 'sku']);
    });

    it('returns nothing for a path that does not exist', () => {
        expect(collectElementFields([parse('<root><a/></root>')], '/other/a')).toEqual([]);
    });
});

describe('compareXml element rules', () => {
    it('matches repeated elements nested under another repeated element', () => {
        const left = parse('<root><order><line id="1"><qty>1</qty></line><line id="2"><qty>2</qty></line></order><order/></root>');
        const right = parse('<root><order><line id="2"><qty>2</qty></line><line id="1"><qty>1</qty></line></order><order/></root>');

        expect(compareXml(left, right, { arrayRules: [{ path: '/root/order/line', matchBy: ['@id'] }] })).toEqual([]);
    });

    it('sorts repeated elements by a child element before comparing', () => {
        const left = parse('<root><item><name>b</name></item><item><name>a</name></item></root>');
        const right = parse('<root><item><name>a</name></item><item><name>b</name></item></root>');

        expect(compareXml(left, right, { arrayRules: [{ path: '/root/item', sortBy: ['name'] }] })).toEqual([]);
    });
});
