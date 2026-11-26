import { describe, expect, it } from 'vitest';
import { formatYaml } from '../yaml/yamlFormat.js';
import { formatDataText } from './formattedText.js';

describe('formatDataText', () => {
    it('pretty-prints JSON with a 2-space indent', () => {
        expect(formatDataText('json', '{"a":[1,2],"b":{"c":true}}')).toEqual({
            ok: true,
            text: '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": true\n  }\n}',
        });
    });

    it('lays YAML out as Format does', () => {
        const text = 'a:   1\nlist:\n- x   # note\n- y\n';
        const formatted = formatYaml(text);

        expect(formatDataText('yaml', text)).toEqual({ ok: true, text: formatted.ok ? formatted.text : '' });
    });

    it('indents XML', () => {
        expect(formatDataText('xml', '<a><b>1</b></a>')).toEqual({ ok: true, text: '<a>\n  <b>1</b>\n</a>' });
    });

    it('says why a text that does not parse has no formatted copy', () => {
        const json = formatDataText('json', '{"a": }');
        const yaml = formatDataText('yaml', 'a: [1, 2');
        const xml = formatDataText('xml', '<a><b></a>');

        expect(json.ok ? '' : json.message).toMatch(/^Not valid JSON: .+ \(line 1, column \d+\)\.$/);
        expect(yaml.ok ? '' : yaml.message).toMatch(/^Not valid YAML: /);
        expect(xml.ok ? '' : xml.message).toMatch(/^Not valid XML: /);
    });
});
