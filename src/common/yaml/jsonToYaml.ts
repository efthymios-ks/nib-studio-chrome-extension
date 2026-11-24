import { stringify } from 'yaml';

// JSON data written as one YAML document with a 2-space indent; strings with line breaks become `|` blocks.
// Strings that a YAML 1.1 reader would take for another type, such as `"yes"`, `"1"` or `"2024-01-15"`, stay quoted,
// so older tools read the same data.
export function convertJsonToYaml(value: unknown): string {
    return stringify(value, {
        indent: 2,
        indentSeq: true,
        lineWidth: 0,
        aliasDuplicateObjects: false,
        compat: 'yaml-1.1',
    });
}
