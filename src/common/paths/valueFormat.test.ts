import { describe, expect, it } from 'vitest';
import { parseXml, type XmlNode } from './xmlParser.js';
import {
    countJsonLines,
    countXmlLines,
    countXmlTextLines,
    describeJsonValue,
    formatJsonValue,
    formatXmlAttribute,
    formatXmlNode,
    formatXmlText,
    jsonValueKind,
    jsonValueText,
    valueLinesToText,
    type FormattedValue,
} from './valueFormat.js';

function text(formatted: FormattedValue): string {
    return valueLinesToText(formatted.lines);
}

function kinds(formatted: FormattedValue): string[] {
    return formatted.lines.flatMap((line) => line.tokens.map((token) => `${token.kind}:${token.text}`));
}

function xml(source: string): XmlNode {
    const parsed = parseXml(source);

    if (!parsed.ok) {
        throw new Error(parsed.message);
    }

    return parsed.root;
}

describe('formatJsonValue', () => {
    const order = { id: 7, name: 'Mug', tags: ['gift', 'blue'], paid: true, note: null, lines: [], meta: {} };

    it('pretty-prints objects and arrays with a 2-space indent, exactly like JSON.stringify', () => {
        const formatted = formatJsonValue(order, 'formatted');

        expect(text(formatted)).toBe(JSON.stringify(order, null, 2));
        expect(formatted.isComplete).toBe(true);
        expect(formatted.lines[1]).toEqual({
            depth: 1,
            tokens: [
                { kind: 'key', text: '"id"' },
                { kind: 'punct', text: ': ' },
                { kind: 'number', text: '7' },
                { kind: 'punct', text: ',' },
            ],
        });
        expect(formatted.lines.map((line) => line.depth)).toEqual([0, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 0]);
    });

    it('puts a compact value on one line, exactly like JSON.stringify without spacing', () => {
        const formatted = formatJsonValue(order, 'compact');

        expect(formatted.lines).toHaveLength(1);
        expect(text(formatted)).toBe(JSON.stringify(order));
    });

    it('marks every value with the kind the JSON tree colours it by', () => {
        const formatted = formatJsonValue({ text: 'a', count: 2, flag: false, none: null }, 'compact');

        expect(kinds(formatted)).toEqual([
            'punct:{',
            'key:"text"', 'punct::', 'string:"a"', 'punct:,',
            'key:"count"', 'punct::', 'number:2', 'punct:,',
            'key:"flag"', 'punct::', 'boolean:false', 'punct:,',
            'key:"none"', 'punct::', 'null:null',
            'punct:}',
        ]);
    });

    it('formats a primitive as one token', () => {
        expect(kinds(formatJsonValue('say "hi"', 'formatted'))).toEqual(['string:"say \\"hi\\""']);
        expect(kinds(formatJsonValue(8.5, 'formatted'))).toEqual(['number:8.5']);
        expect(kinds(formatJsonValue(true, 'formatted'))).toEqual(['boolean:true']);
        expect(kinds(formatJsonValue(null, 'formatted'))).toEqual(['null:null']);
    });

    it('stops after the line limit and says the value was cut short', () => {
        const items = Array.from({ length: 50 }, (_, index) => index);
        const formatted = formatJsonValue(items, 'formatted', { maxLines: 20 });

        expect(formatted.lines).toHaveLength(20);
        expect(formatted.isComplete).toBe(false);
        expect(text(formatted)).toBe(JSON.stringify(items, null, 2).split('\n').slice(0, 20).join('\n'));
    });

    it('keeps a value that fits the line limit whole', () => {
        const formatted = formatJsonValue([1, 2, 3], 'formatted', { maxLines: 5 });

        expect(formatted.lines).toHaveLength(5);
        expect(formatted.isComplete).toBe(true);
    });

    it('cuts a long line short with an ellipsis', () => {
        const formatted = formatJsonValue({ long: 'x'.repeat(100) }, 'compact', { maxLineLength: 20 });

        expect(text(formatted)).toBe(`${JSON.stringify({ long: 'x'.repeat(100) }).slice(0, 20)}…`);
        expect(formatted.isComplete).toBe(false);
    });

    it('cuts each long line of a formatted value but keeps the lines after it', () => {
        const formatted = formatJsonValue(['x'.repeat(50), 'y'], 'formatted', { maxLineLength: 12 });

        expect(text(formatted).split('\n')).toEqual(['[', `  "${'x'.repeat(9)}…`, '  "y"', ']']);
    });
});

describe('JSON value helpers', () => {
    it('gives the copy text, the same as JSON.stringify', () => {
        expect(jsonValueText({ a: [1] }, 'formatted')).toBe('{\n  "a": [\n    1\n  ]\n}');
        expect(jsonValueText({ a: [1] }, 'compact')).toBe('{"a":[1]}');
        expect(jsonValueText(undefined, 'compact')).toBe('null');
    });

    it.each([
        [{}, 'object', 'object · 0 keys'],
        [{ a: 1 }, 'object', 'object · 1 key'],
        [[1, 2, 3], 'array', 'array · 3 items'],
        [[1], 'array', 'array · 1 item'],
        ['a', 'string', 'string'],
        [2, 'number', 'number'],
        [false, 'boolean', 'boolean'],
        [null, 'null', 'null'],
    ])('names the kind of %j', (value, kind, description) => {
        expect(jsonValueKind(value)).toBe(kind);
        expect(describeJsonValue(value)).toBe(description);
    });

    it('counts the lines of a value without formatting it', () => {
        const value = { a: [1, 2], b: {}, c: { d: 'x' } };

        expect(countJsonLines(value, 'formatted')).toBe(JSON.stringify(value, null, 2).split('\n').length);
        expect(countJsonLines(value, 'compact')).toBe(1);
        expect(countJsonLines(5, 'formatted')).toBe(1);
    });
});

describe('formatXmlNode', () => {
    const CATALOG = '<catalog><book id="1" lang="en"><title>Alpha &amp; Omega</title><price>9</price></book><shelf/></catalog>';

    it('indents elements with two spaces and keeps a leaf element on one line', () => {
        const formatted = formatXmlNode(xml(CATALOG), 'formatted');

        expect(text(formatted)).toBe([
            '<catalog>',
            '  <book id="1" lang="en">',
            '    <title>Alpha &amp; Omega</title>',
            '    <price>9</price>',
            '  </book>',
            '  <shelf/>',
            '</catalog>',
        ].join('\n'));
        expect(countXmlLines(xml(CATALOG), 'formatted')).toBe(7);
    });

    it('marks tags, attributes, attribute values and text by kind', () => {
        const formatted = formatXmlNode(xml('<a id="1">x</a>'), 'formatted');

        expect(kinds(formatted)).toEqual([
            'punct:<', 'tag:a', 'punct: ', 'attribute:id', 'punct:="', 'attribute-value:1', 'punct:"', 'punct:>',
            'text:x',
            'punct:</', 'tag:a', 'punct:>',
        ]);
    });

    it('puts a compact element on one line', () => {
        const formatted = formatXmlNode(xml(CATALOG), 'compact');

        expect(formatted.lines).toHaveLength(1);
        expect(text(formatted)).toBe(CATALOG);
        expect(countXmlLines(xml(CATALOG), 'compact')).toBe(1);
    });

    it('drops whitespace-only text and puts an element\'s own text before its children', () => {
        const node = xml('<note>\n  Remember\n  <b>this</b>\n</note>');

        expect(text(formatXmlNode(node, 'formatted'))).toBe('<note>\n  Remember\n  <b>this</b>\n</note>');
        expect(text(formatXmlNode(node, 'compact'))).toBe('<note>Remember<b>this</b></note>');
        expect(countXmlLines(node, 'formatted')).toBe(4);
    });

    it('escapes text and attribute values so the output is XML again', () => {
        const node = xml('<a title="&quot;x&quot; &lt; y">1 &lt; 2 &amp;&amp; 3 &gt; 2</a>');

        expect(text(formatXmlNode(node, 'formatted'))).toBe('<a title="&quot;x&quot; &lt; y">1 &lt; 2 &amp;&amp; 3 &gt; 2</a>');
    });

    it('formats the root element for the document node', () => {
        const root = xml('<r><x/></r>');
        const documentNode: XmlNode = { name: '#document', attributes: {}, text: '', children: [root] };

        expect(text(formatXmlNode(documentNode, 'formatted'))).toBe('<r>\n  <x/>\n</r>');
        expect(countXmlLines(documentNode, 'formatted')).toBe(3);
    });

    it('stops after the line limit', () => {
        const items = Array.from({ length: 40 }, (_, index) => `<item>${index}</item>`).join('');
        const formatted = formatXmlNode(xml(`<list>${items}</list>`), 'formatted', { maxLines: 20 });

        expect(formatted.lines).toHaveLength(20);
        expect(formatted.isComplete).toBe(false);
        expect(countXmlLines(xml(`<list>${items}</list>`), 'formatted')).toBe(42);
    });
});

describe('formatXmlAttribute and formatXmlText', () => {
    it('shows an attribute as name="value"', () => {
        const formatted = formatXmlAttribute('id', 'a"b');

        expect(text(formatted)).toBe('id="a&quot;b"');
        expect(kinds(formatted)).toEqual(['attribute:id', 'punct:="', 'attribute-value:a&quot;b', 'punct:"']);
    });

    it('shows text trimmed, one line per line in the formatted layout and joined in the compact one', () => {
        expect(text(formatXmlText('  first\n    second  ', 'formatted'))).toBe('first\nsecond');
        expect(text(formatXmlText('  first\n    second  ', 'compact'))).toBe('first second');
        expect(countXmlTextLines('  first\n    second  ', 'formatted')).toBe(2);
        expect(countXmlTextLines('   ', 'formatted')).toBe(1);
        expect(text(formatXmlText('   ', 'formatted'))).toBe('');
    });

    it('shows text as it reads, without XML escapes', () => {
        expect(text(formatXmlText('1 < 2 & "x"', 'formatted'))).toBe('1 < 2 & "x"');
    });
});
