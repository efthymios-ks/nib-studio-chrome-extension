import { describe, expect, it } from 'vitest';
import { convertJsonToYaml } from './jsonToYaml.js';
import { convertYamlToJson } from './yamlToJson.js';

describe('convertJsonToYaml', () => {
    it('writes JSON data as one YAML document with a 2-space indent', () => {
        const value = { name: 'nib', tags: ['a', 'b'], nested: { empty: [], none: null, map: {} } };

        expect(convertJsonToYaml(value)).toBe([
            'name: nib',
            'tags:',
            '  - a',
            '  - b',
            'nested:',
            '  empty: []',
            '  none: null',
            '  map: {}',
            '',
        ].join('\n'));
    });

    it('quotes strings a YAML reader would take for another type, and writes line breaks as a block', () => {
        expect(convertJsonToYaml({ answer: 'yes', count: '1', day: '2024-01-15', note: 'one\ntwo\n' })).toBe([
            'answer: "yes"',
            'count: "1"',
            'day: "2024-01-15"',
            'note: |',
            '  one',
            '  two',
            '',
        ].join('\n'));
    });

    it('reads back as the same data', () => {
        const value = { a: [1, 2.5, true, null, 'x: y', '#hash'], 'key with: colon': { deep: ['  padded  '] } };
        const back = convertYamlToJson(convertJsonToYaml(value));

        expect(back).toEqual({ ok: true, value, documentCount: 1 });
    });
});
