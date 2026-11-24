import { firstAlias, parseYamlStream, type YamlIssue } from './yamlParser.js';
import { convertYamlStream } from './yamlToJson.js';

// What the editor marks: the parser's errors and warnings, an alias with no anchor before it,
// and aliases that expand too far to convert.
export function lintYaml(text: string): YamlIssue[] {
    const stream = parseYamlStream(text);
    const issues = [...stream.issues];
    const hasErrors = issues.some((issue) => issue.severity === 'error');
    const hasAliases = stream.documents.some((document) => firstAlias(document) != null);

    if (hasErrors || !hasAliases) {
        return issues;
    }

    const converted = convertYamlStream(stream);

    if (!converted.ok) {
        const lineStart = stream.lineCounter.lineStarts[converted.line - 1] ?? text.length;
        const offset = Math.min(text.length, lineStart + converted.column - 1);
        issues.push({
            severity: 'error',
            message: converted.message,
            from: offset,
            to: Math.min(text.length, offset + 1),
            line: converted.line,
            column: converted.column,
        });
    }

    return issues;
}
