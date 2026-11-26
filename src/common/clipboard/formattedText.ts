import { notValidMessage, type ParseErrorAt } from '../errorMessage.js';
import { formatJson } from '../json/jsonFormat.js';
import { formatXml } from '../xml/xmlFormat.js';
import { formatYaml } from '../yaml/yamlFormat.js';

export type DataTextFormat = 'json' | 'yaml' | 'xml';

export type FormattedTextResult =
    | { readonly ok: true; readonly text: string }
    | { readonly ok: false; readonly message: string };

type FormatOutcome = { readonly ok: true; readonly text: string } | ({ readonly ok: false } & ParseErrorAt);

interface DataTextFormatter {
    // As messages name it, such as `Not valid JSON`.
    readonly name: string;
    readonly format: (text: string) => FormatOutcome;
}

// The same layouts the editor's own buttons give: Format for JSON and YAML, with a 2-space indent.
const FORMATTERS: Readonly<Record<DataTextFormat, DataTextFormatter>> = Object.freeze({
    json: { name: 'JSON', format: (text) => formatJson(text, 'format') },
    yaml: { name: 'YAML', format: formatYaml },
    xml: { name: 'XML', format: formatXml },
});

// The document laid out for reading: JSON with a 2-space indent, YAML as Format lays it out, XML indented.
// A text that doesn't parse gives the reason, such as `Not valid JSON: Unexpected token (line 3, column 7).`.
export function formatDataText(format: DataTextFormat, text: string): FormattedTextResult {
    const formatter = FORMATTERS[format];
    const outcome = formatter.format(text);

    return outcome.ok ? { ok: true, text: outcome.text } : { ok: false, message: notValidMessage(formatter.name, outcome) };
}

// The name of the format, such as `JSON`.
export function dataTextFormatName(format: DataTextFormat): string {
    return FORMATTERS[format].name;
}
