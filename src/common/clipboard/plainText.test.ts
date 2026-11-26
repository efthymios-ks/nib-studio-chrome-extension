// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './plainText.js';

function textOf(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;

    return htmlToPlainText(template.content);
}

describe('htmlToPlainText', () => {
    it('sets headings and paragraphs apart by a blank line and folds white space', () => {
        expect(textOf('<h1>Title</h1>\n<p>One   two\nthree</p><p>Four</p>')).toBe('Title\n\nOne two three\n\nFour');
    });

    it('puts list items on lines of their own with their markers', () => {
        const text = textOf('<ul><li>Apples</li><li>Pears<ul><li>Conference</li></ul></li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>');

        expect(text).toBe('- Apples\n- Pears\n  - Conference\n\n3. Third\n4. Fourth');
    });

    it('writes table rows one per line with tab-separated cells', () => {
        const text = textOf('<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Ada</td><td></td></tr></tbody></table>');

        expect(text).toBe('Name\tAge\nAda\t');
    });

    it('keeps a cell holding paragraphs on its row', () => {
        expect(textOf('<table><tr><td><p>One</p><p>Two</p></td><td>Three</td></tr></table>')).toBe('One Two\tThree');
    });

    it('keeps preformatted text as written', () => {
        expect(textOf('<p>Code:</p><pre><code>if (x) {\n    y();\n}\n</code></pre><p>After</p>')).toBe('Code:\n\nif (x) {\n    y();\n}\n\nAfter');
    });

    it('leaves out scripts, styles, buttons and hidden parts', () => {
        const text = textOf('<p>Shown<script>alert(1)</script></p><style>p{}</style><button>Copy</button><div hidden>Secret</div>');

        expect(text).toBe('Shown');
    });

    it('breaks a line at <br>', () => {
        expect(textOf('<p>One<br>Two</p>')).toBe('One\nTwo');
    });
});
