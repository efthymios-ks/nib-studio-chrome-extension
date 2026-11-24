import { describe, expect, it } from 'vitest';
import { convertYamlToJson, parseYamlAsJson, YAML_DATA_FORMAT, type YamlToJsonResult } from './yamlToJson.js';

function valueOf(result: YamlToJsonResult): unknown {
    if (!result.ok) {
        throw new Error(`${result.message} (line ${result.line}, column ${result.column})`);
    }

    return result.value;
}

function aliasBomb(levels: number): string {
    const lines = ['a0: &a0 [lol, lol, lol, lol, lol, lol, lol, lol, lol, lol]'];

    for (let level = 1; level < levels; level += 1) {
        lines.push(`a${level}: &a${level} [${Array.from({ length: 10 }, () => `*a${level - 1}`).join(', ')}]`);
    }

    return `${lines.join('\n')}\n`;
}

describe('convertYamlToJson', () => {
    it('gives one document as its value', () => {
        expect(convertYamlToJson('name: demo\ncount: 3\nratio: 0.5\non: true\nnothing: null\n')).toEqual({
            ok: true,
            value: { name: 'demo', count: 3, ratio: 0.5, on: true, nothing: null },
            documentCount: 1,
        });
    });

    it('gives several documents as an array of their values', () => {
        expect(convertYamlToJson('# first\na: 1\n---\nb: 2\n...\n---\n- 3\n')).toEqual({
            ok: true,
            value: [{ a: 1 }, { b: 2 }, [3]],
            documentCount: 3,
        });
    });

    it('gives null for a text with no document, such as comments alone', () => {
        expect(convertYamlToJson('')).toEqual({ ok: true, value: null, documentCount: 0 });
        expect(convertYamlToJson('# only a comment\n')).toEqual({ ok: true, value: null, documentCount: 0 });
    });

    it('resolves anchors and aliases into copies of the anchored value', () => {
        expect(valueOf(convertYamlToJson('base: &base {host: db, port: 5432}\nprimary: *base\nreplicas: [*base, *base]\n'))).toEqual({
            base: { host: 'db', port: 5432 },
            primary: { host: 'db', port: 5432 },
            replicas: [{ host: 'db', port: 5432 }, { host: 'db', port: 5432 }],
        });
    });

    it('merges `<<` merge keys, with the keys written in the map winning', () => {
        const text = 'defaults: &defaults\n  retries: 3\n  timeout: 10\njob:\n  timeout: 30\n  <<: *defaults\n  name: build\n';

        expect(valueOf(convertYamlToJson(text))).toEqual({
            defaults: { retries: 3, timeout: 10 },
            job: { timeout: 30, retries: 3, name: 'build' },
        });
    });

    it('keeps timestamps as the text they were written as', () => {
        const text = 'day: 2024-01-15\nstamp: !!timestamp 2001-12-14t21:59:43.10-05:00\n';

        expect(valueOf(convertYamlToJson(text))).toEqual({ day: '2024-01-15', stamp: '2001-12-14t21:59:43.10-05:00' });
        expect(valueOf(convertYamlToJson('%YAML 1.1\n---\nday: 2001-12-14\n'))).toEqual({ day: '2001-12-14' });
    });

    it('turns keys that are not strings into strings as they were written', () => {
        const text = '1: one\n0x1F: hex\ntrue: yes\n~: tilde\n[a, b]: pair\n"quoted": q\n';

        expect(Object.keys(valueOf(convertYamlToJson(text)) as object)).toEqual(['1', '0x1F', 'true', 'null', '[ a, b ]', 'quoted']);
    });

    it('turns binary into Base64 text', () => {
        expect(valueOf(convertYamlToJson('logo: !!binary |\n  SGVs\n  bG8=\n'))).toEqual({ logo: 'SGVsbG8=' });
    });

    it('names infinities and not-a-number, which JSON has no numbers for', () => {
        expect(valueOf(convertYamlToJson('up: .inf\ndown: -.Inf\nodd: .nan\n'))).toEqual({ up: 'Infinity', down: '-Infinity', odd: 'NaN' });
    });

    it('gives a set as an array and an ordered map as an object', () => {
        expect(valueOf(convertYamlToJson('tags: !!set {x, y}\nsteps: !!omap [first: 1, second: 2]\n'))).toEqual({
            tags: ['x', 'y'],
            steps: { first: 1, second: 2 },
        });
    });

    it('keeps the last value of a repeated key', () => {
        expect(valueOf(convertYamlToJson('a: 1\na: 2\n'))).toEqual({ a: 2 });
    });

    it('keeps a key named __proto__ as an ordinary key', () => {
        const value = valueOf(convertYamlToJson('__proto__: 5\n')) as Record<string, unknown>;

        expect(Object.keys(value)).toEqual(['__proto__']);
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    });

    it('stops an alias bomb at the first alias, with the line and column', () => {
        expect(convertYamlToJson(aliasBomb(9))).toEqual({
            ok: false,
            message: 'Too many aliases: they expand an anchor to more than 1,000 copies',
            line: 2,
            column: 10,
        });
    });

    it('expands an anchor used a few hundred times', () => {
        const items = Array.from({ length: 300 }, () => '  - *item').join('\n');
        const value = valueOf(convertYamlToJson(`item: &item {x: 1}\nlist:\n${items}\n`)) as { list: unknown[] };

        expect(value.list).toHaveLength(300);
    });

    it('refuses an alias inside its own anchor, which JSON can\'t hold', () => {
        expect(convertYamlToJson('loop: &loop [1, *loop]\n')).toEqual({
            ok: false,
            message: 'An alias refers to the node it sits in, which JSON can\'t hold',
            line: 1,
            column: 17,
        });
    });

    it('reports the first error with its line and column', () => {
        expect(convertYamlToJson('ok: 1\nbad: [1, 2\nnext: 3\n')).toEqual({
            ok: false,
            message: 'Flow sequence in block collection must be sufficiently indented and end with a ]',
            line: 3,
            column: 1,
        });
    });
});

describe('parseYamlAsJson', () => {
    it('reads YAML as JSON data with its tree, for the data views', () => {
        const parsed = parseYamlAsJson('a:\n  - 1\n');

        expect(parsed.ok).toBe(true);
        expect(parsed.ok ? parsed.root.children[0]?.kind : null).toBe('array');
        expect(YAML_DATA_FORMAT.name).toBe('YAML');
        expect(YAML_DATA_FORMAT.parse('a: [').ok).toBe(false);
    });
});
