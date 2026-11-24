import { describe, expect, it } from 'vitest';
import { parseXml } from '../paths/xmlParser.js';
import { collectRepeatedElementPaths, convertXmlToJson } from './xmlToJson.js';

function parse(source: string) {
    const result = parseXml(source);
    if (!result.ok) {
        throw new Error('expected ok');
    }

    return result.root;
}

describe('convertXmlToJson', () => {
    it('converts a simple element with text', () => {
        expect(convertXmlToJson(parse('<a>hi</a>'))).toEqual({ a: 'hi' });
    });

    it('promotes attributes with @ prefix by default', () => {
        expect(convertXmlToJson(parse('<a id="1"/>'))).toEqual({ a: { '@id': '1' } });
    });

    it('uses #text for mixed content', () => {
        const output = convertXmlToJson(parse('<a id="1">hi</a>'));
        expect(output).toEqual({ a: { '@id': '1', '#text': 'hi' } });
    });

    it('supports custom attribute prefix and text key', () => {
        const output = convertXmlToJson(parse('<a id="1">hi</a>'), {
            attributePrefix: '_',
            textKey: 'value',
        });
        expect(output).toEqual({ a: { _id: '1', value: 'hi' } });
    });

    it('groups repeated siblings into arrays', () => {
        const output = convertXmlToJson(parse('<a><b>1</b><b>2</b></a>'));
        expect(output).toEqual({ a: { b: ['1', '2'] } });
    });

    it('does not force arrays for single siblings unless requested', () => {
        const output = convertXmlToJson(parse('<a><b>1</b></a>'));
        expect(output).toEqual({ a: { b: '1' } });
    });

    it('forces an array when the path is in forceArray', () => {
        const output = convertXmlToJson(parse('<a><b>1</b></a>'), { forceArray: ['/a/b'] });
        expect(output).toEqual({ a: { b: ['1'] } });
    });

    it('coerces numbers and booleans when coerceTypes is set', () => {
        const output = convertXmlToJson(parse('<a id="7" ok="true">42</a>'), { coerceTypes: true });
        expect(output).toEqual({ a: { '@id': 7, '@ok': true, '#text': 42 } });
    });

    it('strips namespace prefixes when requested', () => {
        const output = convertXmlToJson(parse('<soap:a><soap:b/></soap:a>'), { stripNamespaces: true });
        expect(output).toEqual({ a: { b: null } });
    });

    it('returns null for empty elements', () => {
        expect(convertXmlToJson(parse('<a/>'))).toEqual({ a: null });
    });

    it('trims text and drops whitespace-only text by default', () => {
        expect(convertXmlToJson(parse('<a>\n  <b> x </b>\n  <c>  </c>\n</a>'))).toEqual({ a: { b: 'x', c: null } });
    });

    it('keeps text as written, whitespace-only text included, with keepWhitespace', () => {
        expect(convertXmlToJson(parse('<a>\n  <b> x </b>\n  <c>  </c>\n</a>'), { keepWhitespace: true }))
            .toEqual({ a: { '#text': '\n  \n  \n', b: ' x ', c: '  ' } });
    });
});

describe('collectRepeatedElementPaths', () => {
    it('reports paths with two or more same-name siblings', () => {
        const paths = collectRepeatedElementPaths(parse('<a><b/><b/><c/></a>'));
        expect(paths).toContain('/a/b');
        expect(paths).not.toContain('/a/c');
    });

    it('recurses into nested repeated elements', () => {
        const paths = collectRepeatedElementPaths(parse('<a><b><c/><c/></b></a>'));
        expect(paths).toContain('/a/b/c');
    });
});
