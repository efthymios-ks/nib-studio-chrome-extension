import { describe, expect, it } from 'vitest';
import { runJsonPath } from '../json/jsonPath.js';
import { buildJsonPathExamples, buildXPathExamples, JSON_PATH_SYNTAX, XPATH_SYNTAX } from './pathExamples.js';
import { XPath } from './xPath.js';
import { parseXml, type XmlNode } from './xmlParser.js';

function xml(source: string): XmlNode {
    const parsed = parseXml(source);

    if (!parsed.ok) {
        throw new Error(parsed.message);
    }

    return parsed.root;
}

function jsonMatchCount(root: unknown, expression: string): number {
    const result = runJsonPath(root, expression);

    return result.ok ? result.matches.length : -1;
}

describe('buildJsonPathExamples', () => {
    const shop = {
        name: 'Corner shop',
        orders: [
            { id: 7, customer: 'Ada', total: 120.5, 'gift note': 'Hi' },
            { id: 8, customer: 'Linus', total: 30 },
        ],
    };

    it('builds the examples from the document\'s own keys and values', () => {
        expect(buildJsonPathExamples(shop)).toEqual([
            { title: 'The whole document', expression: '$' },
            { title: 'The name key', expression: '$.name' },
            { title: 'Every top-level value', expression: '$.*' },
            { title: 'Every item of orders', expression: '$.orders[*]' },
            { title: 'The first item of orders', expression: '$.orders[0]' },
            { title: 'The last item of orders', expression: '$.orders[-1:]' },
            { title: 'The id of every item', expression: '$.orders[*].id' },
            { title: 'Items whose id is at least 7', expression: '$.orders[?(@.id >= 7)]' },
            { title: 'Items whose customer is Ada', expression: '$.orders[?(@.customer == "Ada")]' },
            { title: 'Every id, at any depth', expression: '$..id' },
        ]);
    });

    it('builds examples that each match something', () => {
        for (const example of buildJsonPathExamples(shop)) {
            expect(jsonMatchCount(shop, example.expression), example.expression).toBeGreaterThan(0);
        }
    });

    it('finds a list of objects at the root or deeper', () => {
        const rows = [{ 'first name': 'Ada', age: 36 }];
        const nested = { data: { results: [[{ code: 'a' }]] } };

        expect(buildJsonPathExamples(rows).map((example) => example.expression)).toEqual([
            '$',
            '$[*]',
            '$[0]',
            '$[-1:]',
            '$[*]["first name"]',
            '$[?(@.age >= 36)]',
            '$..age',
        ]);
        expect(buildJsonPathExamples(nested).map((example) => example.expression)).toContain('$.data.results[0][*]');

        for (const [root, examples] of [[rows, buildJsonPathExamples(rows)], [nested, buildJsonPathExamples(nested)]] as const) {
            for (const example of examples) {
                expect(jsonMatchCount(root, example.expression), example.expression).toBeGreaterThan(0);
            }
        }
    });

    it('leaves out text filters for values that would need escapes', () => {
        const expressions = buildJsonPathExamples([{ quote: 'say "hi"' }]).map((example) => example.expression);

        expect(expressions.some((expression) => expression.includes('?('))).toBe(false);
    });

    it('offers only the whole document for a primitive', () => {
        expect(buildJsonPathExamples(42)).toEqual([{ title: 'The whole document', expression: '$' }]);
    });
});

describe('buildXPathExamples', () => {
    const ORDERS = xml('<orders><order id="A-1" status="paid"><customer>Ada</customer></order><order id="B-2"><customer>Linus</customer></order></orders>');

    it('builds the examples from the document\'s own names, attributes and text', () => {
        expect(buildXPathExamples(ORDERS)).toEqual([
            { title: 'The root element', expression: '/*' },
            { title: 'Every child of orders', expression: '/orders/*' },
            { title: 'Every order, at any depth', expression: '//order' },
            { title: 'The second order of each parent', expression: '//order[2]' },
            { title: 'The last order of each parent', expression: '//order[last()]' },
            { title: 'The id of every order', expression: '//order/@id' },
            { title: 'Every element with id', expression: '//*[@id]' },
            { title: 'The order whose id is A-1', expression: "//order[@id='A-1']" },
            { title: 'Every order whose id contains A-1', expression: "//order[contains(@id, 'A-1')]" },
            { title: 'The text of every customer', expression: '//customer/text()' },
            { title: 'The order whose customer is Ada', expression: "//order[customer='Ada']" },
        ]);
    });

    it('builds examples that each match something', () => {
        const documents = [
            ORDERS,
            xml('<w:doc xmlns:w="x"><w:p w:val="it\'s">One</w:p><w:p>Two</w:p></w:doc>'),
            xml('<config><setting name="a">\n  padded\n</setting></config>'),
        ];

        for (const root of documents) {
            for (const example of buildXPathExamples(root)) {
                expect(XPath.selectAll(root, example.expression).length, example.expression).toBeGreaterThan(0);
            }
        }
    });

    it('quotes a value with an apostrophe in double quotes and skips a value with both quote marks', () => {
        const apostrophe = buildXPathExamples(xml('<a><b n="it\'s"/></a>')).map((example) => example.expression);
        const both = buildXPathExamples(xml('<a><b n="it\'s &quot;x&quot;"/></a>')).map((example) => example.expression);

        expect(apostrophe).toContain('//b[@n="it\'s"]');
        expect(both.some((expression) => expression.includes('[@n='))).toBe(false);
    });

    it('offers only the root for a lone element', () => {
        expect(buildXPathExamples(xml('<empty/>'))).toEqual([{ title: 'The root element', expression: '/*' }]);
    });
});

describe('syntax references', () => {
    it('describe every entry', () => {
        for (const entry of [...JSON_PATH_SYNTAX, ...XPATH_SYNTAX]) {
            expect(entry.syntax).not.toBe('');
            expect(entry.description).toMatch(/\.$/);
        }
    });
});
