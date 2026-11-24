import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting, type StringStream } from '@codemirror/language';
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { LINQ_AGGREGATES, LINQ_FUNCTIONS, LINQ_METHODS, LINQ_PROPERTIES } from '../../common/linq/linqFunctions.js';
import { LINQ_CONTEXTUAL_KEYWORDS, LINQ_KEYWORDS } from '../../common/linq/linqParser.js';
import { quoteName } from '../../common/linq/linqReference.js';

export interface QueryEditorHandlers {
    onRun?: () => void;
    onChange?: (state: EditorState) => void;
}

export interface QueryEditorOptions {
    readonly parent: HTMLElement;
    readonly columns: ReadonlyArray<string>;
    readonly handlers: QueryEditorHandlers;
    // A saved state to continue from; built from initialText otherwise.
    readonly state?: EditorState;
    readonly initialText?: string;
}

export interface QueryEditorHandle {
    readonly view: EditorView;
    getText(): string;
    setText(text: string): void;
    // Underlines a span of the query, or clears the mark for null.
    markError(span: { start: number; end: number } | null): void;
    focus(): void;
    destroy(): void;
}

const KEYWORDS = new Set([...LINQ_KEYWORDS, ...LINQ_CONTEXTUAL_KEYWORDS].filter((word) => !['true', 'false', 'null'].includes(word)));
const ATOMS = new Set(['true', 'false', 'null']);
const CALLABLE = new Set([
    ...LINQ_AGGREGATES.map((entry) => entry.name),
    ...LINQ_FUNCTIONS.filter((entry) => !entry.name.includes('.')).map((entry) => entry.name.toLowerCase()),
]);

const linqLanguage = StreamLanguage.define<{ afterDot: boolean }>({
    name: 'linq',
    startState: () => ({ afterDot: false }),
    token(stream: StringStream, state) {
        if (stream.eatSpace()) {
            return null;
        }

        const afterDot = state.afterDot;
        state.afterDot = false;

        if (stream.match('//')) {
            stream.skipToEnd();

            return 'comment';
        }

        const quote = stream.peek();

        if (quote === '"' || quote === '\'') {
            stream.next();
            let escaped = false;

            for (let char = stream.next(); char != null; char = stream.next()) {
                if (char === quote && !escaped) {
                    break;
                }

                escaped = !escaped && char === '\\';
            }

            return 'string';
        }

        if (quote === '`') {
            stream.next();
            if (stream.skipTo('`') === true) {
                stream.next();
            }
            else {
                stream.skipToEnd();
            }

            return afterDot ? 'property' : 'column';
        }

        if (stream.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/)) {
            return 'number';
        }

        const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;

        if (word != null) {
            const lower = word[0].toLowerCase();

            if (afterDot) {
                return stream.peek() === '(' ? 'function' : 'property';
            }

            if (ATOMS.has(lower)) {
                return 'atom';
            }

            if (KEYWORDS.has(lower) && !(lower === 'order' && !/^\s*by\b/i.test(stream.string.slice(stream.pos)))) {
                return 'keyword';
            }

            if (lower === 'math' || (CALLABLE.has(lower) && /^\s*\(/.test(stream.string.slice(stream.pos)))) {
                return 'function';
            }

            return 'column';
        }

        const char = stream.next();

        if (char === '.') {
            state.afterDot = true;
        }

        return char != null && /[=!<>&|?:+\-*/%]/.test(char) ? 'operator' : 'punctuation';
    },
    tokenTable: {
        keyword: tags.keyword,
        string: tags.string,
        number: tags.number,
        comment: tags.lineComment,
        atom: tags.atom,
        operator: tags.operator,
        punctuation: tags.punctuation,
        function: tags.function(tags.variableName),
        property: tags.propertyName,
        column: tags.variableName,
    },
    languageData: { commentTokens: { line: '//' } },
});

const linqHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '600' },
    { tag: tags.string, color: 'var(--syntax-string)' },
    { tag: tags.number, color: 'var(--syntax-number)' },
    { tag: tags.atom, color: 'var(--syntax-boolean)' },
    { tag: tags.lineComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: tags.operator, color: 'var(--syntax-operator)' },
    { tag: tags.punctuation, color: 'var(--syntax-punct)' },
    { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
    { tag: tags.propertyName, color: 'var(--syntax-property)' },
    { tag: tags.variableName, color: 'var(--text)' },
]);

const setErrorMark = StateEffect.define<{ start: number; end: number } | null>();
const errorMark = Decoration.mark({ class: 'query-error-mark' });

const errorField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(marks, transaction) {
        let next = transaction.docChanged ? Decoration.none : marks.map(transaction.changes);

        for (const effect of transaction.effects) {
            if (effect.is(setErrorMark)) {
                const length = transaction.state.doc.length;
                const span = effect.value;

                if (span == null || length === 0) {
                    next = Decoration.none;
                    continue;
                }

                const start = Math.min(span.start, length - 1);
                const end = Math.min(length, Math.max(span.end, start + 1));
                next = Decoration.set([errorMark.range(start, end)]);
            }
        }

        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});

function completionSource(columns: ReadonlyArray<string>): (context: CompletionContext) => CompletionResult | null {
    const columnOptions: Completion[] = columns.map((column) => ({ label: quoteName(column), type: 'variable', detail: 'column' }));
    const keywordOptions: Completion[] = [...KEYWORDS, 'true', 'false', 'null'].map((word) => ({ label: word, type: 'keyword' }));
    const functionOptions: Completion[] = [
        ...LINQ_AGGREGATES.map((entry) => ({ label: entry.name, type: 'function', detail: 'aggregate', info: entry.description, apply: `${entry.name}(` })),
        ...LINQ_FUNCTIONS.filter((entry) => !entry.name.includes('.')).map((entry) => ({ label: entry.name, type: 'function', info: entry.description, apply: `${entry.name}(` })),
        { label: 'Math', type: 'namespace' },
    ];
    const memberOptions: Completion[] = [
        ...LINQ_METHODS.map((entry) => ({ label: entry.name, type: 'method', info: entry.description, apply: `${entry.name}(` })),
        ...LINQ_PROPERTIES.map((entry) => ({ label: entry.name, type: 'property', info: entry.description })),
        { label: 'Key', type: 'property', info: 'The key of a group.' },
    ];
    const mathOptions: Completion[] = LINQ_FUNCTIONS.filter((entry) => entry.name.startsWith('Math.')).map((entry) => ({
        label: entry.name.slice(5),
        type: 'function',
        info: entry.description,
        apply: `${entry.name.slice(5)}(`,
    }));

    return (context) => {
        const word = context.matchBefore(/`[^`]*|[A-Za-z_]\w*/);
        const from = word?.from ?? context.pos;

        if (word == null && !context.explicit) {
            const dot = context.matchBefore(/\.$/);

            if (dot == null) {
                return null;
            }
        }

        const before = context.state.sliceDoc(Math.max(0, from - 64), from);

        if (/Math\s*\.$/i.test(before)) {
            return { from, options: mathOptions, validFor: /^\w*$/ };
        }

        if (/\.\s*$/.test(before)) {
            return { from, options: [...columnOptions, ...memberOptions], validFor: /^`?[\w ]*$/ };
        }

        return { from, options: [...columnOptions, ...keywordOptions, ...functionOptions], validFor: /^`?[\w ]*$/ };
    };
}

function buildExtensions(columns: ReadonlyArray<string>, handlers: QueryEditorHandlers): Extension[] {
    return [
        history(),
        bracketMatching(),
        linqLanguage,
        syntaxHighlighting(linqHighlight),
        errorField,
        placeholder('from row in table\nwhere row.total > 100\nselect row'),
        autocompletion({ override: [completionSource(columns)], activateOnTyping: true }),
        Prec.highest(keymap.of([
            {
                key: 'Mod-Enter',
                run: () => {
                    handlers.onRun?.();

                    return true;
                },
            },
        ])),
        keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) {
                handlers.onChange?.(update.state);
            }
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'Query' }),
    ];
}

export function createQueryEditorState(text: string, columns: ReadonlyArray<string>, handlers: QueryEditorHandlers): EditorState {
    return EditorState.create({ doc: text, extensions: buildExtensions(columns, handlers) });
}

export function mountQueryEditor(options: QueryEditorOptions): QueryEditorHandle {
    const state = options.state ?? createQueryEditorState(options.initialText ?? '', options.columns, options.handlers);
    const view = new EditorView({ parent: options.parent, state });

    return {
        view,
        getText: () => view.state.doc.toString(),
        setText: (text) => {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text },
                selection: { anchor: text.length },
                effects: setErrorMark.of(null),
            });
        },
        markError: (span) => {
            view.dispatch({ effects: setErrorMark.of(span) });
        },
        focus: () => view.focus(),
        destroy: () => view.destroy(),
    };
}
