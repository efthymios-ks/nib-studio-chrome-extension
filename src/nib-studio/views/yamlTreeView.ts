import { jsonTreeOf } from '../../common/json/jsonTree.js';
import { convertYamlToJson } from '../../common/yaml/yamlToJson.js';
import { clear } from '../app/dom.js';
import { emptyState } from './emptyState.js';
import { renderJsonDataTree, type JsonTreeViewOptions } from './jsonTreeView.js';

export type YamlTreeViewOptions = Omit<JsonTreeViewOptions, 'rootItemLabel'>;

// YAML's data as the JSON tree, with JSONPath in the path bar.
// A file of several documents shows each as a top-level item, `Document 1`, `Document 2` and so on,
// whose paths are `$[0]`, `$[1]` and so on, as the documents are an array when converted to JSON.
export function renderYamlTreeView(container: HTMLElement, text: string, options: YamlTreeViewOptions = {}): void {
    clear(container);
    const converted = convertYamlToJson(text);

    if (!converted.ok) {
        container.append(emptyState({
            title: 'Not valid YAML',
            message: `${converted.message} (line ${converted.line}, column ${converted.column}).`,
        }));

        return;
    }

    renderJsonDataTree(container, jsonTreeOf(converted.value), {
        ...options,
        rootItemLabel: converted.documentCount > 1 ? (index) => `Document ${index + 1}` : undefined,
    });
}
