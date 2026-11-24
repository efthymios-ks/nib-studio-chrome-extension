import { describe, expect, it } from 'vitest';
import { parseXml } from './xmlParser.js';

describe('parseXml', () => {
    it('parses a simple element', () => {
        const result = parseXml('<a/>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.name).toBe('a');
        expect(result.root.children).toEqual([]);
    });

    it('parses attributes and text', () => {
        const result = parseXml('<a id="1">hi</a>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.attributes).toEqual({ id: '1' });
        expect(result.root.text).toBe('hi');
    });

    it('parses nested children', () => {
        const result = parseXml('<a><b/><c/></a>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.children.map((child) => child.name)).toEqual(['b', 'c']);
    });

    it('drops the XML declaration', () => {
        const result = parseXml('<?xml version="1.0" encoding="UTF-8"?><a/>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.name).toBe('a');
    });

    it('drops comments', () => {
        const result = parseXml('<a><!-- c --><b/></a>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.children.map((child) => child.name)).toEqual(['b']);
    });

    it('drops DOCTYPE', () => {
        const result = parseXml('<!DOCTYPE a><a/>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.name).toBe('a');
    });

    it('keeps CDATA text', () => {
        const result = parseXml('<a><![CDATA[<raw>&data]]></a>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.text).toBe('<raw>&data');
    });

    it('keeps namespace prefixes in element names', () => {
        const result = parseXml('<soap:Body><soap:Fault/></soap:Body>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.name).toBe('soap:Body');
        expect(result.root.children[0]?.name).toBe('soap:Fault');
    });

    it('joins mixed content text into one string', () => {
        const result = parseXml('<a>hello <b/> world</a>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.text).toBe('hello  world');
        expect(result.root.children.map((child) => child.name)).toEqual(['b']);
    });

    it('decodes entities in text and attributes', () => {
        const result = parseXml('<a title="A &amp; B">&lt;x&gt;</a>');
        if (!result.ok) {
            throw new Error('expected ok');
        }

        expect(result.root.attributes.title).toBe('A & B');
        expect(result.root.text).toBe('<x>');
    });

    it('reports a line/column on a mismatched closing tag', () => {
        const result = parseXml('<a></b>');
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }

        expect(result.line).toBeGreaterThan(0);
        expect(result.column).toBeGreaterThan(0);
    });

    it('reports an error on an unterminated element', () => {
        const result = parseXml('<a>');
        expect(result.ok).toBe(false);
    });

    it('allows a trailing comment after the root', () => {
        const result = parseXml('<a/><!-- end -->');
        expect(result.ok).toBe(true);
    });
});
