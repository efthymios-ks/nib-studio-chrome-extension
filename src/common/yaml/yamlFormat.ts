import {
    parseAllDocuments,
    type Scalar,
    type ScalarTag,
    type Tags,
    type ToStringOptions,
} from 'yaml';
import { BASE_PARSE_OPTIONS, firstYamlError, parseYamlStream, type YamlFailure } from './yamlParser.js';
import { convertYamlStream } from './yamlToJson.js';

// Format: the same documents with a 2-space indent, keeping comments, document markers, directives,
// anchors, aliases, tags, quoting styles and the way numbers and folded text were written.

export type YamlFormatResult = { readonly ok: true; readonly text: string } | YamlFailure;

type StringifyContext = Parameters<NonNullable<ScalarTag['stringify']>>[1];

const NUMBER_TAGS = new Set(['tag:yaml.org,2002:int', 'tag:yaml.org,2002:float']);

const STRING_TAG = 'tag:yaml.org,2002:str';

// A folded block header this keeps as written: `>` or `>-`, without an indentation indicator or a comment.
const PLAIN_FOLDED_HEADER = /^>-?$/;

const TO_STRING_OPTIONS: ToStringOptions = Object.freeze({
    indent: 2,
    indentSeq: true,
    // Long lines stay as they are, rather than folding at 80 characters.
    lineWidth: 0,
});

// The text with `\n` line breaks, as the editor holds it; a text of other line breaks comes back with `\n`.
export function formatYaml(text: string): YamlFormatResult {
    const source = text.replace(/\r\n?/g, '\n');
    const stream = parseYamlStream(source);
    const error = firstYamlError(stream);

    if (error != null) {
        return error;
    }

    // Comments alone make no document, so there is nothing to lay out.
    if (stream.documents.length === 0) {
        return { ok: true, text: source };
    }

    const kept = layOut(source, true);

    return { ok: true, text: sameData(source, kept) ? kept : layOut(source, false) };
}

// Lays out again a text the stream check found no error in; `keepWritten` keeps numbers and folded blocks
// as they were written.
function layOut(text: string, keepWritten: boolean): string {
    const documents = parseAllDocuments(text, {
        ...BASE_PARSE_OPTIONS,
        // Repeated keys are warnings, and a document with errors can't be written.
        uniqueKeys: false,
        customTags: keepWritten ? (tags) => keepWrittenTags(tags, text) : null,
    });

    return documents.map((document) => document.toString(TO_STRING_OPTIONS)).join('');
}

// The layout must hold the same data; otherwise the plain layout of the `yaml` package is used.
function sameData(original: string, formatted: string): boolean {
    const before = convertYamlStream(parseYamlStream(original));
    const after = convertYamlStream(parseYamlStream(formatted));

    if (!before.ok || !after.ok) {
        return before.ok === after.ok;
    }

    return before.documentCount === after.documentCount
        && JSON.stringify(before.value) === JSON.stringify(after.value);
}

function keepWrittenTags(tags: Tags, text: string): Tags {
    return tags.map((tag) => {
        if (typeof tag === 'string' || tag.collection != null) {
            return tag;
        }

        if (NUMBER_TAGS.has(tag.tag)) {
            return {
                ...tag,
                stringify: (item, ctx, onComment, onChompKeep) => writtenNumber(tag, item)
                    ?? defaultStringify(tag, { item, ctx, onComment, onChompKeep }),
            };
        }

        if (tag.tag === STRING_TAG) {
            return {
                ...tag,
                stringify: (item, ctx, onComment, onChompKeep) => writtenFoldedBlock(item, ctx, text)
                    ?? defaultStringify(tag, { item, ctx, onComment, onChompKeep }),
            };
        }

        return tag;
    });
}

interface StringifyCall {
    readonly item: Scalar;
    readonly ctx: StringifyContext;
    readonly onComment?: () => void;
    readonly onChompKeep?: () => void;
}

function defaultStringify(tag: ScalarTag, call: StringifyCall): string {
    if (tag.stringify == null) {
        return String(call.item.value);
    }

    return tag.stringify(call.item, call.ctx, call.onComment, call.onChompKeep);
}

// A plain number as written, such as `0x1F`, `1e3` or `.Inf`, when that text still reads as the same tag.
function writtenNumber(tag: ScalarTag, item: Scalar): string | null {
    const source = (item as Scalar.Parsed).source;

    if (
        typeof source !== 'string'
        || item.type !== 'PLAIN'
        || tag.test == null
        || !tag.test.test(source)
    ) {
        return null;
    }

    return source;
}

// A folded block `>` or `>-` with its lines broken where they were, indented for its new place.
function writtenFoldedBlock(item: Scalar, ctx: StringifyContext, text: string): string | null {
    const range = item.range;

    // A root block, a key and a flow collection are left to the default layout.
    if (
        item.type !== 'BLOCK_FOLDED'
        || range == null
        || ctx.implicitKey === true
        || ctx.inFlow === true
        || ctx.indent === ''
    ) {
        return null;
    }

    const [header = '', ...body] = text.slice(range[0], range[1]).split('\n');

    if (!PLAIN_FOLDED_HEADER.test(header.trimEnd()) || item.comment != null) {
        return null;
    }

    while (body.length > 0 && (body[body.length - 1] ?? '').trim() === '') {
        body.pop();
    }

    const firstLine = body.find((line) => line.trim() !== '');

    if (firstLine == null) {
        return null;
    }

    const writtenIndent = leadingSpaces(firstLine);

    if (body.some((line) => line.trim() !== '' && leadingSpaces(line) < writtenIndent)) {
        return null;
    }

    const lines = body.map((line) => (line.trim() === '' ? '' : `${ctx.indent}${line.slice(writtenIndent)}`));

    return `${header.trimEnd()}\n${lines.join('\n')}`;
}

function leadingSpaces(line: string): number {
    return line.length - line.replace(/^ +/, '').length;
}
