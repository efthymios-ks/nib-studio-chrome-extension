// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { purifyHtml } from './purifyHtml.js';

describe('purifyHtml', () => {
    it('removes scripts, handlers and embedded objects even when they sit next to each other', () => {
        const html = purifyHtml('<p>a</p><script>1</script><p onclick="x">b</p><object data="x.swf"></object><embed src="x"><div onmouseover="y">c</div>', {});

        expect(html).toBe('<p>a</p><p>b</p><div>c</div>');
    });

    it('keeps to an allow list', () => {
        const html = purifyHtml('<p class="x" title="t">a</p><b>b</b><i>c</i>', { ALLOWED_TAGS: ['p'], ALLOWED_ATTR: ['title'] });

        expect(html).toBe('<p title="t">a</p>bc');
    });

    it('returns clean HTML as it is', () => {
        expect(purifyHtml('<p>plain</p>', {})).toBe('<p>plain</p>');
    });
});
