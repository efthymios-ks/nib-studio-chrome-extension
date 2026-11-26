import { describe, expect, it } from 'vitest';
import { formatXml } from './xmlFormat.js';

describe('formatXml', () => {
    it('indents elements that hold only elements by two spaces', () => {
        const result = formatXml('<?xml version="1.0"?><catalog><book id="1"><title>Dune</title><tags/></book></catalog>');

        expect(result).toEqual({
            ok: true,
            text: [
                '<?xml version="1.0"?>',
                '<catalog>',
                '  <book id="1">',
                '    <title>Dune</title>',
                '    <tags/>',
                '  </book>',
                '</catalog>',
            ].join('\n'),
        });
    });

    it('lays out a document indented some other way afresh', () => {
        const result = formatXml('<a>\n<b>\n\t\t<c>1</c>\n</b>\n    </a>\n');

        expect(result).toEqual({ ok: true, text: '<a>\n  <b>\n    <c>1</c>\n  </b>\n</a>' });
    });

    it('keeps comments, CDATA and the DOCTYPE as written', () => {
        const result = formatXml('<!DOCTYPE note [<!ENTITY x "y">]><note><!-- first --><body><![CDATA[a < b]]></body></note>');

        expect(result.ok && result.text).toBe([
            '<!DOCTYPE note [<!ENTITY x "y">]>',
            '<note>',
            '  <!-- first -->',
            '  <body><![CDATA[a < b]]></body>',
            '</note>',
        ].join('\n'));
    });

    it('keeps mixed content and preserved spaces as written', () => {
        const result = formatXml('<doc><p>Hello <b>big</b>  world</p><pre xml:space="preserve">\n  <x/>\n</pre></doc>');

        expect(result.ok && result.text).toBe([
            '<doc>',
            '  <p>Hello <b>big</b>  world</p>',
            '  <pre xml:space="preserve">\n  <x/>\n</pre>',
            '</doc>',
        ].join('\n'));
    });

    it('keeps a quoted > in an attribute inside its tag', () => {
        const result = formatXml('<a><b title="x > y"><c/></b></a>');

        expect(result.ok && result.text).toBe('<a>\n  <b title="x > y">\n    <c/>\n  </b>\n</a>');
    });

    it('says where a document that does not parse goes wrong', () => {
        const result = formatXml('<a><b></a>');

        expect(result.ok).toBe(false);
        expect(result.ok ? null : result.line).toBe(1);
    });
});
