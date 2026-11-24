import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeHtmlAttribute, escapeHtmlText } from './escapeHtml.js';

describe('escapeHtml', () => {
    it('escapes markup and both quotes', () => {
        expect(escapeHtml('<a href="x">Tom & Jerry\'s</a>')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    });
});

describe('escapeHtmlText', () => {
    it('escapes what would read as markup between tags, and leaves quotes', () => {
        expect(escapeHtmlText('a < b && "c" > d')).toBe('a &lt; b &amp;&amp; "c" &gt; d');
    });
});

describe('escapeHtmlAttribute', () => {
    it('escapes what would end or break a double-quoted value', () => {
        expect(escapeHtmlAttribute('say "hi" & <go> \'now\'')).toBe('say &quot;hi&quot; &amp; &lt;go> \'now\'');
    });
});
