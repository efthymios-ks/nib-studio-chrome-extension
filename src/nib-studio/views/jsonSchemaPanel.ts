import { notValidMessage } from '../../common/errorMessage.js';
import { jsonPointerSegments } from '../../common/json/jsonPath.js';
import { checkSchema, type SchemaErrorEntry } from '../../common/json/jsonSchema.js';
import { JSON_DATA_FORMAT, type DataFormat, type JsonParseResult } from '../../common/json/jsonTree.js';
import { sampleFromSchema, type SampleNote } from '../../common/json/sampleFromSchema.js';
import { generateSchema } from '../../common/json/schemaGenerator.js';
import { JsonPathBuilder } from '../../common/paths/jsonPathBuilder.js';
import { formatJsonValue, type ValueLine } from '../../common/paths/valueFormat.js';
import { clear, h } from '../app/dom.js';
import { appendLines, bindResultCards, cardHeader, RESULTS_PAGE_SIZE, SHOW_ALL_MAX_LINES } from './pathResults.js';
import { attachTextBoxHistory, createTextBoxHistory, type TextBoxHistory } from './textBoxHistory.js';

export type JsonSchemaMode = 'validate' | 'generate' | 'sample';

// Kept by the caller for each file while the studio is open, so the mode, the pasted schema with its undo history,
// and Required only stay as they were left.
export interface JsonSchemaPanelState {
    mode: JsonSchemaMode;
    schema: string;
    isRequiredOnly: boolean;
    history: TextBoxHistory;
}

export interface JsonSchemaPanelOptions {
    readonly text: string;
    // How the text is read as data; JSON unless set, such as YAML.
    readonly format?: DataFormat;
    readonly state: JsonSchemaPanelState;
    // Called with the JSONPath the JSON tree gives the node an error is about, such as `$.orders[0].total`.
    readonly onReveal: (path: string) => void;
    // Called with the schema box's text each time it changes, by typing, undo or Use to validate.
    readonly onSchemaChange?: (schema: string) => void;
}

// Typing checks once the keys rest this long; a paste or Ctrl+Enter checks at once.
export const SCHEMA_CHECK_DELAY_MS = 300;

const MAX_LINE_LENGTH = 2_000;

// The document read as data, with the name of its format for the message when it can't be read.
type SchemaDocument = JsonParseResult & { readonly formatName: string };

const VALIDATE_PROMPT = 'Paste a JSON Schema to check this document against it.';
const SAMPLE_PROMPT = 'Paste a JSON Schema to build a sample document that passes it.';

const MODES: ReadonlyArray<{ readonly mode: JsonSchemaMode; readonly label: string; readonly title: string }> = [
    { mode: 'validate', label: 'Validate', title: 'Check this document against a pasted JSON Schema' },
    { mode: 'generate', label: 'Generate', title: 'Infer a JSON Schema from this document' },
    { mode: 'sample', label: 'Sample', title: 'Build a sample document that a pasted JSON Schema accepts' },
];

type Tone = 'ok' | 'warn' | 'fail' | null;

export function createJsonSchemaPanelState(): JsonSchemaPanelState {
    return { mode: 'validate', schema: '', isRequiredOnly: false, history: createTextBoxHistory() };
}

// Gives a schema box that has never held a schema, empty with nothing to undo, a schema to start with.
// The schema is where its own undo history starts, so undo doesn't empty the box again.
export function startJsonSchemaPanelWith(state: JsonSchemaPanelState, schema: string): void {
    const history = state.history;
    const isUntouched = state.schema === '' && history.done.length === 0 && history.undone.length === 0;

    if (!isUntouched || schema === '') {
        return;
    }

    state.schema = schema;
    state.history = createTextBoxHistory();
}

// The Schema view: Validate checks the document against a pasted schema as it is typed,
// Generate infers a Draft 2020-12 schema from the document, and Sample builds a document the pasted schema accepts.
export function renderJsonSchemaPanel(pane: HTMLElement, options: JsonSchemaPanelOptions): void {
    const { state } = options;
    const format = options.format ?? JSON_DATA_FORMAT;
    const parsed: SchemaDocument = { ...format.parse(options.text), formatName: format.name };
    const root = h('div', { class: 'path-query schema-panel' });
    pane.append(root);

    const draw = (): void => {
        clear(root);
        root.dataset['mode'] = state.mode;
        const modeTabs = h('div', {
            class: 'view-tabs schema-mode',
            attrs: { 'role': 'group', 'aria-label': 'Schema mode' },
            children: MODES.map((entry) => h('button', {
                class: 'view-tab',
                text: entry.label,
                dataset: { mode: entry.mode, active: String(entry.mode === state.mode) },
                attrs: { 'type': 'button', 'title': entry.title, 'aria-pressed': String(entry.mode === state.mode) },
                on: {
                    click: () => {
                        state.mode = entry.mode;
                        draw();
                    },
                },
            })),
        });
        const bar = h('div', { class: 'path-query-bar', children: [h('div', { class: 'path-query-row', children: [modeTabs] })] });
        const body = h('div', { class: 'path-results-body' });
        root.append(bar, body);

        if (state.mode === 'validate') {
            renderValidate(bar, body, parsed, options);

            return;
        }

        if (state.mode === 'sample') {
            renderSample(bar, body, options);

            return;
        }

        renderGenerate(bar, body, parsed, (schema) => {
            setSchema(options, schema);
            state.mode = 'validate';
            draw();
            root.querySelector<HTMLTextAreaElement>('.schema-input')?.focus();
        });
    };

    draw();
}

// The schema box Validate and Sample share: the text is kept as it is typed, and `run` follows
// once the keys rest, at once on paste, and at once on Ctrl+Enter.
function schemaBox(options: JsonSchemaPanelOptions, placeholder: string, run: () => void): HTMLTextAreaElement {
    const { state } = options;
    const input = h('textarea', {
        class: 'textarea textarea-mono schema-input',
        attrs: {
            'rows': '8',
            'spellcheck': 'false',
            'placeholder': placeholder,
            'aria-label': 'JSON Schema',
        },
    });
    input.value = state.schema;
    attachTextBoxHistory(input, state.history);
    let timer: number | null = null;

    const runNow = (): void => {
        if (timer != null) {
            window.clearTimeout(timer);
            timer = null;
        }

        run();
    };

    input.addEventListener('input', (event) => {
        setSchema(options, input.value);

        if ((event as InputEvent).inputType === 'insertFromPaste') {
            runNow();

            return;
        }

        if (timer != null) {
            window.clearTimeout(timer);
        }

        timer = window.setTimeout(runNow, SCHEMA_CHECK_DELAY_MS);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            runNow();
        }
    });

    return input;
}

function renderValidate(bar: HTMLElement, body: HTMLElement, parsed: SchemaDocument, options: JsonSchemaPanelOptions): void {
    const { state } = options;
    const status = h('span', { class: 'path-query-status', attrs: { 'role': 'status', 'aria-live': 'polite' } });
    const list = h('ol', { class: 'path-results', attrs: { 'aria-label': 'Schema errors' } });
    const more = h('div', { class: 'path-results-more' });
    let errors: ReadonlyArray<SchemaErrorEntry> = [];
    let shown = 0;

    const errorOf = (card: HTMLElement): SchemaErrorEntry | null => errors[Number(card.dataset['index'])] ?? null;
    bindResultCards(list, {
        valueText: (card) => {
            const error = errorOf(card);

            return error == null ? null : `${error.path}: ${error.message}`;
        },
        revealPath: (card) => {
            const error = errorOf(card);

            return error == null || !parsed.ok ? null : revealPathOf(parsed.value, error.path);
        },
        onReveal: options.onReveal,
    });

    const showMore = (): void => {
        const end = Math.min(shown + RESULTS_PAGE_SIZE, errors.length);

        for (let index = shown; index < end; index += 1) {
            const error = errors[index];

            if (error != null) {
                const canReveal = parsed.ok && revealPathOf(parsed.value, error.path) != null;
                list.append(errorCard(error, index, canReveal));
            }
        }

        shown = end;
        clear(more);

        if (shown < errors.length) {
            more.append(
                h('button', {
                    class: 'button',
                    text: `Show ${Math.min(RESULTS_PAGE_SIZE, errors.length - shown).toLocaleString('en-US')} more`,
                    dataset: { action: 'show-more' },
                    attrs: { type: 'button' },
                    on: { click: showMore },
                }),
                h('span', { class: 'path-results-count', text: `${shown.toLocaleString('en-US')} of ${errors.length.toLocaleString('en-US')} shown` }),
            );
        }
    };

    const check = (): void => {
        errors = [];
        shown = 0;
        clear(list);
        clear(more);
        const outcome = describeCheck(parsed, state.schema);
        status.textContent = outcome.message;
        setTone(status, outcome.tone);
        errors = outcome.errors;
        showMore();
    };

    bar.append(schemaBox(options, VALIDATE_PROMPT, check), h('div', {
        class: 'path-query-status-row',
        children: [status, h('span', { class: 'path-query-hint', text: 'Checks as you type · Draft 2020-12' })],
    }));
    body.append(list, more);
    check();
}

interface CheckOutcome {
    readonly message: string;
    readonly tone: Tone;
    readonly errors: ReadonlyArray<SchemaErrorEntry>;
}

function describeCheck(parsed: SchemaDocument, schema: string): CheckOutcome {
    if (!parsed.ok) {
        return { message: notValidJson(parsed), tone: 'fail', errors: [] };
    }

    if (schema.trim() === '') {
        return { message: VALIDATE_PROMPT, tone: null, errors: [] };
    }

    const result = checkSchema(parsed.value, schema);

    if (result.ok) {
        const keywords = result.keywordsChecked === 1 ? '1 keyword' : `${result.keywordsChecked.toLocaleString('en-US')} keywords`;

        return { message: `OK — ${keywords} checked.`, tone: 'ok', errors: [] };
    }

    if ('message' in result) {
        return { message: result.message, tone: 'fail', errors: [] };
    }

    const count = result.errors.length;

    return { message: count === 1 ? '1 error' : `${count.toLocaleString('en-US')} errors`, tone: 'fail', errors: result.errors };
}

function errorCard(error: SchemaErrorEntry, index: number, canReveal: boolean): HTMLElement {
    return h('li', {
        class: 'path-card schema-error',
        dataset: { index: String(index) },
        attrs: { 'tabindex': '0', 'aria-label': `${error.path}: ${error.message}` },
        children: [
            cardHeader({ index: `[${index + 1}]`, path: error.path, badge: error.keyword, canReveal }),
            h('p', { class: 'path-card-message', text: error.message }),
        ],
    });
}

// An error path is `$` and a JSON Pointer, such as `$/orders/0/total`; the tree names the node `$.orders[0].total`.
function revealPathOf(document: unknown, path: string): string | null {
    const segments = jsonPointerSegments(document, path.startsWith('$') ? path.slice(1) : path);

    return segments == null ? null : JsonPathBuilder.of(segments);
}

function renderGenerate(
    bar: HTMLElement,
    body: HTMLElement,
    parsed: SchemaDocument,
    useToValidate: (schema: string) => void,
): void {
    const status = h('span', { class: 'path-query-status', attrs: { 'role': 'status', 'aria-live': 'polite' } });
    bar.append(h('div', { class: 'path-query-status-row', children: [status] }));

    if (!parsed.ok) {
        status.textContent = notValidJson(parsed);
        setTone(status, 'fail');

        return;
    }

    const schema = generateSchema(parsed.value);
    const text = JSON.stringify(schema, null, 2);
    const formatted = formatJsonValue(schema, 'formatted', { maxLines: SHOW_ALL_MAX_LINES, maxLineLength: MAX_LINE_LENGTH });
    const output = h('pre', { class: 'path-card-value schema-output' });
    appendLines(output, formatted.lines);

    status.textContent = formatted.isComplete
        ? 'Inferred from this document · Draft 2020-12'
        : `First ${SHOW_ALL_MAX_LINES.toLocaleString('en-US')} lines shown · Use to validate takes the whole schema`;
    status.after(h('button', {
        class: 'link-button schema-use',
        text: 'Use to validate',
        attrs: { type: 'button', title: 'Put this schema in the Validate box and check the document against it' },
        on: { click: () => useToValidate(text) },
    }));
    body.append(output);
}

// Sample builds a document from the schema in the shared box; the open document isn't used, so it may be invalid JSON.
function renderSample(bar: HTMLElement, body: HTMLElement, options: JsonSchemaPanelOptions): void {
    const { state } = options;
    const status = h('span', { class: 'path-query-status', attrs: { 'role': 'status', 'aria-live': 'polite' } });
    const requiredOnly = h('input', { attrs: { id: 'schema-required-only', type: 'checkbox' } });
    requiredOnly.checked = state.isRequiredOnly;
    const output = h('pre', { class: 'path-card-value schema-output' });
    const notes = h('ul', { class: 'schema-notes', attrs: { 'aria-label': 'Keywords the sample doesn\'t satisfy' } });

    const build = (): void => {
        clear(output);
        clear(notes);
        const outcome = describeSample(state);
        status.textContent = outcome.message;
        setTone(status, outcome.tone);
        output.hidden = outcome.lines == null;
        appendLines(output, outcome.lines ?? []);
        notes.append(...outcome.notes.map(noteItem));
    };

    requiredOnly.addEventListener('change', () => {
        state.isRequiredOnly = requiredOnly.checked;
        build();
    });

    bar.append(schemaBox(options, SAMPLE_PROMPT, build), h('div', {
        class: 'path-query-status-row',
        children: [
            status,
            h('label', {
                class: 'tool-check schema-required-only',
                attrs: { for: 'schema-required-only', title: 'Give objects only their required properties' },
                children: [requiredOnly, 'Required only'],
            }),
            h('span', { class: 'path-query-hint', text: 'Updates as you type · Draft 2020-12' }),
        ],
    }));
    body.append(output, notes);
    build();
}

interface SampleOutcome {
    readonly message: string;
    readonly tone: Tone;
    readonly lines: ReadonlyArray<ValueLine> | null;
    readonly notes: ReadonlyArray<SampleNote>;
}

function describeSample(state: JsonSchemaPanelState): SampleOutcome {
    if (state.schema.trim() === '') {
        return { message: SAMPLE_PROMPT, tone: null, lines: null, notes: [] };
    }

    const result = sampleFromSchema(state.schema, { isRequiredOnly: state.isRequiredOnly });

    if (!result.ok) {
        return { message: result.message, tone: 'fail', lines: null, notes: [] };
    }

    const formatted = formatJsonValue(result.value, 'formatted', { maxLines: SHOW_ALL_MAX_LINES, maxLineLength: MAX_LINE_LENGTH });
    const count = result.notes.length;
    const shown = formatted.isComplete ? '' : ` · first ${SHOW_ALL_MAX_LINES.toLocaleString('en-US')} lines shown`;

    if (count === 0) {
        return { message: `Passes the schema${shown}`, tone: 'ok', lines: formatted.lines, notes: [] };
    }

    const keywords = count === 1 ? '1 keyword' : `${count.toLocaleString('en-US')} keywords`;

    return { message: `${keywords} not satisfied${shown}`, tone: 'warn', lines: formatted.lines, notes: result.notes };
}

// A note such as "`pattern` at `$.code` not satisfied; edit the value", with the backticked parts as code.
function noteItem(note: SampleNote): HTMLElement {
    return h('li', {
        children: note.message.split('`').map((part, index) => (index % 2 === 1 ? h('code', { text: part }) : part)),
    });
}

function setSchema(options: JsonSchemaPanelOptions, schema: string): void {
    options.state.schema = schema;
    options.onSchemaChange?.(schema);
}

function notValidJson(parsed: Extract<SchemaDocument, { ok: false }>): string {
    return notValidMessage(parsed.formatName, parsed, 'Document is');
}

function setTone(element: HTMLElement, tone: Tone): void {
    if (tone == null) {
        delete element.dataset['tone'];

        return;
    }

    element.dataset['tone'] = tone;
}
