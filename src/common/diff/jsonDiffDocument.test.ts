import { describe, expect, it } from 'vitest';
import type { DiffDocumentSide, DiffRow } from './diffDocument.js';
import { convertYamlToJson } from '../yaml/yamlToJson.js';
import { serializeDiffDocument } from './diffDocument.js';
import { buildJsonDiffDocument, buildYamlDiffDocument, type JsonDiffDocumentInput } from './jsonDiffDocument.js';

const ORIGINAL: DiffDocumentSide = { name: 'a.json', source: 'file', path: 'data/a.json' };
const MODIFIED: DiffDocumentSide = { name: 'b.json', source: 'disk', path: 'b.json' };

function build(left: unknown, right: unknown, overrides: Partial<JsonDiffDocumentInput> = {}): ReturnType<typeof buildJsonDiffDocument> {
    return buildJsonDiffDocument({ original: ORIGINAL, modified: MODIFIED, left, right, ...overrides });
}

function shape(rows: ReadonlyArray<DiffRow>): string[] {
    return rows.map((row) => {
        const cell = row.left ?? row.right;
        const sides = `${row.left == null ? '·' : row.left.status}|${row.right == null ? '·' : row.right.status}`;

        return `${'  '.repeat(cell?.depth ?? 0)}${cell?.label ?? cell?.tokens[0]?.text ?? ''} ${sides}${row.change == null ? '' : ` <${row.change}>`}`;
    });
}

describe('buildJsonDiffDocument', () => {
    it('aligns both documents row for row, with placeholders, changes and a summary', () => {
        const document = build({ a: 1, b: { x: 1 }, gone: true }, { a: 2, b: { x: 1 }, added: [1] });

        expect(document).toMatchObject({ format: 'nib-studio-diff', version: 1, kind: 'json', original: ORIGINAL, modified: MODIFIED });
        expect(shape(document.rows)).toEqual([
            '{ unchanged|unchanged',
            '  a changed|changed <a>',
            '  added ·|added <added>',
            '    [0] ·|added',
            '  ] ·|added',
            '  b unchanged|unchanged',
            '    x unchanged|unchanged',
            '  } unchanged|unchanged',
            '  gone removed|· <gone>',
            '} unchanged|unchanged',
        ]);
        expect(document.changes.map((change) => [change.id, change.kind, change.row, change.before, change.after])).toEqual([
            ['a', 'changed', 1, 1, 2],
            ['added', 'added', 2, undefined, [1]],
            ['gone', 'removed', 8, true, undefined],
        ]);
        expect(document.changes[0]?.location).toEqual({ path: 'a', pointer: '$.a' });
        expect(document.summary).toEqual({ total: 3, added: 1, removed: 1, changed: 1, typeChanged: 0 });
        expect(document.rows[5]?.left?.collapsed).toBe(true);
    });

    it('records the options it compared with', () => {
        const document = build({}, {}, { arrayRules: [{ path: '$.items[*]', matchBy: ['id'] }], sortKeys: false });

        expect(document.options).toEqual({ arrayRules: [{ path: '$.items[*]', matchBy: ['id'] }], sortKeys: false, nullAsMissing: true });
    });

    it('pairs array items by their match fields and names them by those fields', () => {
        const left = { items: [{ id: 5, price: 1, name: 'a' }, { id: 6, price: 1 }] };
        const right = { items: [{ id: 6, price: 1 }, { id: 5, price: 2, name: 'b' }, { id: 7 }] };
        const document = build(left, right, { arrayRules: [{ path: '$.items[*]', matchBy: ['id'] }] });

        expect(document.changes.map((change) => `${change.kind} ${change.id}`)).toEqual([
            'changed items[id=5].name',
            'changed items[id=5].price',
            'added items[id=7]',
        ]);
        const labels = document.rows.map((row) => (row.left ?? row.right)?.label).filter((label) => label?.startsWith('[') === true);
        expect(labels).toEqual(['[id=5]', '[id=6]', '[id=7]']);
        const paired = document.rows.find((row) => row.left?.label === '[id=5]');
        expect([paired?.left?.path, paired?.right?.path]).toEqual(['$.items[0]', '$.items[1]']);
    });

    it('sorts array items by their sort fields first, so order alone is no difference', () => {
        const left = { items: [{ id: 2 }, { id: 1 }] };
        const right = { items: [{ id: 1 }, { id: 2 }] };

        expect(build(left, right).changes).toHaveLength(2);
        expect(build(left, right, { arrayRules: [{ path: '$.items[*]', sortBy: ['id'] }] }).changes).toEqual([]);
    });

    it('names positional array items by index and points at the full path', () => {
        const document = build({ tags: [1, 2] }, { tags: [1, 3] });

        expect(document.changes[0]?.id).toBe('tags[1]');
        expect(document.changes[0]?.location.pointer).toBe('$.tags[1]');
    });

    it('treats null as a missing value: a value in its place is added, and null in place of a value is removed', () => {
        const document = build({ a: null, b: 'x', c: 1 }, { a: 5, b: null, c: 1 });

        expect(document.changes.map((change) => `${change.kind} ${change.id}`)).toEqual(['added a', 'removed b']);
        expect(document.rows[1]?.left?.tokens).toEqual([{ text: 'null', type: 'null' }]);
        expect([document.rows[1]?.left?.status, document.rows[1]?.right?.status]).toEqual(['unchanged', 'added']);
    });

    it('calls a value of another type a type change', () => {
        const document = build({ a: { b: 1 } }, { a: [1] });

        expect(document.changes.map((change) => `${change.kind} ${change.id}`)).toEqual(['typeChanged a']);
        expect(document.rows[1]?.left?.tokens.map((token) => token?.text)).toEqual(['{', '1 key']);
        expect(document.rows[1]?.left?.node).toBe('leaf');
    });

    it('lays out one side alone while the other is not chosen', () => {
        const document = build({ a: 1 }, undefined, { modified: { name: 'Not chosen', source: 'none' } });

        expect(document.rows.every((row) => row.right == null)).toBe(true);
        expect(document.changes).toEqual([]);
    });

    it('builds the same JSON for the same inputs, and survives a JSON round trip', () => {
        const left = { b: [1, { c: 2 }], a: 'x', n: null };
        const right = { b: [1, { c: 3 }, 4], a: 'y', n: 1 };
        const document = build(left, right);

        expect(JSON.stringify(build(left, right))).toBe(JSON.stringify(document));
        expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    });
});

describe('buildYamlDiffDocument', () => {
    function yamlValue(text: string): unknown {
        const converted = convertYamlToJson(text);

        if (!converted.ok) {
            throw new Error(converted.message);
        }

        return converted.value;
    }

    it('compares YAML as the data it holds, with the rows and changes of JSON under the YAML kind', () => {
        const left = yamlValue('server:\n  host: localhost\n  port: 80 # http\nitems:\n  - {id: 1, qty: 2}\n');
        const right = yamlValue('# moved\nserver: {port: 8080, host: localhost}\nitems:\n  - id: 1\n    qty: 3\n');
        const arrayRules = [{ path: '$.items[*]', matchBy: ['id'] }];
        const input: JsonDiffDocumentInput = { original: ORIGINAL, modified: MODIFIED, left, right, arrayRules };
        const document = buildYamlDiffDocument(input);
        const json = buildJsonDiffDocument(input);

        expect(document.kind).toBe('yaml');
        expect(document.changes.map((change) => `${change.kind} ${change.id}`)).toEqual([
            'changed items[id=1].qty',
            'changed server.port',
        ]);
        expect({ ...document, kind: 'json' }).toEqual(json);
        expect(Object.keys(document)).toEqual(Object.keys(json));
    });

    it('survives the JSON round trip of an export', () => {
        const document = buildYamlDiffDocument({
            original: { name: 'a.yaml', source: 'pasted' },
            modified: { name: 'b.yaml', source: 'clipboard' },
            left: yamlValue('a: 1\n---\nb: [1, 2]\n'),
            right: yamlValue('a: 2\n---\nb: [1]\n'),
        });

        expect(JSON.parse(serializeDiffDocument(document))).toEqual(document);
        expect(document.rows[1]?.left?.label).toBe('[0]');
    });
});
