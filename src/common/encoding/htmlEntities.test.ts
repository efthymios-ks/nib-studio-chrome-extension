import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, encodeHtmlEntities } from './htmlEntities.js';

describe('encodeHtmlEntities', () => {
    it('escapes the five characters that matter in HTML', () => {
        expect(encodeHtmlEntities(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    });

    it('leaves other text, Unicode included, as it is', () => {
        expect(encodeHtmlEntities('π · 😀')).toBe('π · 😀');
    });
});

describe('decodeHtmlEntities', () => {
    it('round-trips text through encoding', () => {
        const text = `<p class="x">'Ελληνικά' & 😀</p>`;
        const result = decodeHtmlEntities(encodeHtmlEntities(text));

        expect(result.ok && result.value).toBe(text);
    });

    it('decodes named, decimal and hex references', () => {
        const result = decodeHtmlEntities('&copy; &#169; &#xA9; &#X1F600; &hellip;');

        expect(result.ok && result.value).toBe('© © © 😀 …');
    });

    it('decodes one level only', () => {
        const result = decodeHtmlEntities('&amp;lt;');

        expect(result.ok && result.value).toBe('&lt;');
    });

    it('keeps a bare ampersand', () => {
        const result = decodeHtmlEntities('AT&T & co; a &&');

        expect(result.ok && result.value).toBe('AT&T & co; a &&');
    });

    it('reports an unknown name where it starts', () => {
        const result = decodeHtmlEntities('one &bogus; two');

        expect(!result.ok && result.error).toEqual({ message: "Unknown entity '&bogus;'", position: 4, length: 7 });
    });

    it('asks the resolver for names it does not list', () => {
        const result = decodeHtmlEntities('&Aacute;&bogus;', (name) => (name === 'Aacute' ? 'Á' : null));

        expect(!result.ok && result.error.position).toBe(8);
        expect(decodeHtmlEntities('&Aacute;', () => 'Á')).toEqual({ ok: true, value: 'Á', warning: null });
    });

    it('does not treat inherited object keys as entities', () => {
        expect(decodeHtmlEntities('&toString;').ok).toBe(false);
    });

    it('reports a numeric reference without its semicolon', () => {
        const result = decodeHtmlEntities('x &#65 y');

        expect(!result.ok && result.error).toEqual({ message: "Character reference '&#65' needs a closing ';'", position: 2, length: 4 });
    });

    it('reports numbers that are not characters', () => {
        for (const reference of ['&#0;', '&#xD800;', '&#x110000;']) {
            const result = decodeHtmlEntities(`a${reference}`);

            expect(!result.ok && result.error.position).toBe(1);
        }
    });

    it('reports &# with no digits', () => {
        const result = decodeHtmlEntities('a &#; b');

        expect(!result.ok && result.error.position).toBe(2);
    });
});
