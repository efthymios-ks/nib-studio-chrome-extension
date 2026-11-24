import { describe, expect, it } from 'vitest';
import { parseXml } from './xmlParser.js';
import { XPath } from './xPath.js';
import { XPathBuilder } from './xPathBuilder.js';

function root(source: string) {
    const result = parseXml(source);
    if (!result.ok) {
        throw new Error('expected ok');
    }

    return result.root;
}

describe('XPath.select / selectAll', () => {
    const books = root(`
<catalog>
  <book id="1" category="fiction">
    <title>Alpha</title>
    <price>10</price>
  </book>
  <book id="2" category="technical">
    <title>Bravo</title>
    <price>20</price>
  </book>
  <book id="3" category="fiction">
    <title>Charlie</title>
    <price>30</price>
  </book>
</catalog>
    `.trim());

    it('selects the root element by absolute path', () => {
        const match = XPath.select(books, '/catalog');
        expect(match?.kind).toBe('element');
    });

    it('selects a specific descendant by position', () => {
        const match = XPath.select(books, '/catalog/book[2]');
        expect(match?.kind).toBe('element');
    });

    it('selectAll returns every matching element', () => {
        const all = XPath.selectAll(books, '/catalog/book');
        expect(all).toHaveLength(3);
    });

    it('carries the matched element, or the element that holds the matched attribute or text', () => {
        const second = books.children[1];

        expect(XPath.select(books, '/catalog/book[2]')?.node).toBe(second);
        expect(XPath.select(books, '/catalog/book[2]/@id')?.node).toBe(second);
        expect(XPath.select(books, '/catalog/book[2]/title/text()')?.node).toBe(second?.children[0]);

        const documentMatch = XPath.select(books, '/');
        expect(documentMatch?.node.name).toBe('#document');
        expect(documentMatch?.node.children).toEqual([books]);
    });

    it('supports wildcard element name', () => {
        const all = XPath.selectAll(books, '/catalog/*');
        expect(all).toHaveLength(3);
    });

    it('supports // descendant search', () => {
        const all = XPath.selectAll(books, '//title');
        expect(all).toHaveLength(3);
    });

    it('selects an attribute via @attr', () => {
        const match = XPath.select(books, '/catalog/book[1]/@id');
        expect(match?.kind).toBe('attribute');
        expect(match?.value).toBe('1');
    });

    it('selects text via text()', () => {
        const match = XPath.select(books, '/catalog/book[1]/title/text()');
        expect(match?.kind).toBe('text');
        expect(match?.value).toBe('Alpha');
    });

    it('filters by attribute value', () => {
        const all = XPath.selectAll(books, "/catalog/book[@category='fiction']");
        expect(all).toHaveLength(2);
    });

    it('filters by attribute existence', () => {
        const all = XPath.selectAll(books, '/catalog/book[@id]');
        expect(all).toHaveLength(3);
    });

    it('filters by child text', () => {
        const all = XPath.selectAll(books, "/catalog/book[title='Bravo']");
        expect(all).toHaveLength(1);
    });

    it('supports last() predicate', () => {
        const all = XPath.selectAll(books, '/catalog/book[last()]');
        expect(all).toHaveLength(1);
        expect(all[0]?.segments.at(-1)).toMatchObject({ position: 3 });
    });

    it('supports negative indexing', () => {
        const all = XPath.selectAll(books, '/catalog/book[-1]');
        expect(all).toHaveLength(1);
    });

    it('supports contains()', () => {
        const all = XPath.selectAll(books, "/catalog/book[contains(@category,'tech')]");
        expect(all).toHaveLength(1);
    });

    it('supports starts-with()', () => {
        const all = XPath.selectAll(books, "/catalog/book[starts-with(@category,'fic')]");
        expect(all).toHaveLength(2);
    });

    it('supports and in predicates', () => {
        const all = XPath.selectAll(books, "/catalog/book[@category='fiction' and @id='1']");
        expect(all).toHaveLength(1);
    });

    it('supports or in predicates', () => {
        const all = XPath.selectAll(books, "/catalog/book[@id='1' or @id='2']");
        expect(all).toHaveLength(2);
    });

    it('supports local-name() with namespace-agnostic match', () => {
        const soap = root('<soap:Envelope xmlns:soap="x"><soap:Body/></soap:Envelope>');
        const match = XPath.select(soap, '/Envelope/Body', { ignorePrefixes: true });
        expect(match?.kind).toBe('element');
    });

    it('keeps namespace prefixes when ignorePrefixes is not set', () => {
        const soap = root('<soap:Envelope><soap:Body/></soap:Envelope>');
        const strict = XPath.select(soap, '/Envelope/Body');
        expect(strict).toBeNull();
        const loose = XPath.select(soap, '/soap:Envelope/soap:Body');
        expect(loose?.kind).toBe('element');
    });

    it('returns null when no match', () => {
        expect(XPath.select(books, '/catalog/nope')).toBeNull();
    });

    it('returns empty array for selectAll with no match', () => {
        expect(XPath.selectAll(books, '/catalog/nope')).toEqual([]);
    });

    it('records segments with the clicked position and count', () => {
        const match = XPath.select(books, '/catalog/book[2]');
        const last = match?.segments.at(-1);
        expect(last).toMatchObject({ kind: 'element', name: 'book', position: 2, count: 3 });
    });
});

describe('XPath descendant steps', () => {
    const shop = root('<shop><book id="1"><title>A</title></book><book id="2"><title>B</title></book><misc><title>C</title></misc></shop>');

    function paths(expression: string): string[] {
        return XPath.selectAll(shop, expression).map((match) => XPathBuilder.of(match.segments));
    }

    it('follows a leading // with more steps', () => {
        expect(paths('//book/title')).toEqual(['/shop/book[1]/title', '/shop/book[2]/title']);
    });

    it('finds attributes and text anywhere with //@name and //text()', () => {
        expect(paths('//@id')).toEqual(['/shop/book[1]/@id', '/shop/book[2]/@id']);
        expect(paths('//title/text()')).toEqual(['/shop/book[1]/title/text()', '/shop/book[2]/title/text()', '/shop/misc/title/text()']);
    });

    it('counts a position predicate per parent', () => {
        expect(paths('//title[1]')).toEqual(['/shop/book[1]/title', '/shop/book[2]/title', '/shop/misc/title']);
        expect(paths("//book[@id='2']/title")).toEqual(['/shop/book[2]/title']);
    });
});

describe('XPath.evaluate', () => {
    const doc = root('<a><b/></a>');

    it('returns the matches of a valid expression', () => {
        const result = XPath.evaluate(doc, '/a/b');

        expect(result.ok && result.matches).toHaveLength(1);
    });

    it.each([
        ['', 'Enter an expression', 0],
        ['/a/', 'Expected a name', 3],
        ['/a[1', "Expected ']'", 4],
        ['/a b', "Unexpected 'b'", 3],
        ["/a[@id='1]", 'Unterminated string', 8],
        ['count(/a)', "Unexpected '('", 5],
    ])('reports why %j does not parse', (expression, message, position) => {
        expect(XPath.evaluate(doc, expression)).toEqual({ ok: false, message, position });
    });

    it('selects nothing for an expression that does not parse', () => {
        expect(XPath.selectAll(doc, '/a/')).toEqual([]);
    });
});
