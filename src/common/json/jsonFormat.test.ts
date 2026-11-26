import { describe, expect, it } from 'vitest';
import { formatJson } from './jsonFormat.js';

describe('formatJson', () => {
    it('lays the document out with a 2-space indent, keeping the key order', () => {
        expect(formatJson('{"b":[1,2],"a":{"c":true}}', 'format')).toEqual({
            ok: true,
            text: '{\n  "b": [\n    1,\n    2\n  ],\n  "a": {\n    "c": true\n  }\n}',
        });
    });

    it('puts the document on one line with no spaces', () => {
        expect(formatJson('{\n  "a": [1, 2],\n  "b": "x y"\n}', 'minify')).toEqual({ ok: true, text: '{"a":[1,2],"b":"x y"}' });
    });

    it('says where a text that is not JSON stopped', () => {
        const result = formatJson('{"a": }', 'format');

        expect(result.ok).toBe(false);
        expect(result.ok ? null : [result.line, result.column > 0]).toEqual([1, true]);
    });
});
