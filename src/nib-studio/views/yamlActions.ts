import { parseJson } from '../../common/json/jsonTree.js';
import { convertJsonToYaml } from '../../common/yaml/jsonToYaml.js';
import { formatYaml } from '../../common/yaml/yamlFormat.js';
import { convertYamlToJson } from '../../common/yaml/yamlToJson.js';
import type { OpenFile } from '../app/store.js';
import { toast } from '../app/toast.js';
import { notValidMessage, type ParseErrorAt } from '../../common/errorMessage.js';

export interface YamlActionCallbacks {
    readonly onChange: (path: string, text: string) => void;
}

// Format: the same YAML with a 2-space indent, comments and documents kept, dispatched through onChange.
// Shows a toast when the document is not valid YAML.
export function applyYamlFormat(file: OpenFile, callbacks: YamlActionCallbacks): void {
    const formatted = formatYaml(file.text);

    if (!formatted.ok) {
        toastNotValid('YAML', formatted);

        return;
    }

    callbacks.onChange(file.path, formatted.text);
}

// Convert to JSON in the Editor view: the YAML's data as JSON with a 2-space indent, in place of the text.
export function applyYamlToJson(file: OpenFile, callbacks: YamlActionCallbacks): void {
    const text = yamlFileAsJson(file.text);

    if (text != null) {
        callbacks.onChange(file.path, text);
    }
}

// The YAML as JSON text, or null after a toast saying why it can't be read.
export function yamlFileAsJson(text: string): string | null {
    const converted = convertYamlToJson(text);

    if (!converted.ok) {
        toastNotValid('YAML', converted);

        return null;
    }

    return JSON.stringify(converted.value, null, 2);
}

// The JSON as YAML text, or null after a toast saying why it can't be read.
export function jsonFileAsYaml(text: string): string | null {
    const parsed = parseJson(text);

    if (!parsed.ok) {
        toastNotValid('JSON', parsed);

        return null;
    }

    return convertJsonToYaml(parsed.value);
}

function toastNotValid(format: string, error: ParseErrorAt): void {
    toast(notValidMessage(format, error), 'fail');
}
