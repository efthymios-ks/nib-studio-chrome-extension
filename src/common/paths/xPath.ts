import type { XmlNode } from './xmlParser.js';

// An XPath subset evaluated over `XmlNode` rather than `document.evaluate`, so it also runs in a worker:
// `/`, `//`, `*`, `.`, `..`, `text()`, `@attribute`, `[n]`, `[-n]`, `[last()]`, attribute and child tests,
// `contains()`, `starts-with()`, `local-name()`, `and` and `or`, with prefixes ignored on request.
export type XPathSegment =
    | { kind: 'element'; name: string; position: number; count: number }
    | { kind: 'attribute'; name: string }
    | { kind: 'text' };

export interface XPathMatch {
    readonly kind: 'element' | 'attribute' | 'text';
    readonly value: string;
    readonly segments: XPathSegment[];
    // The matched element, or the element that holds the matched attribute or text;
    // `/` matches a `#document` node whose only child is the root element.
    readonly node: XmlNode;
}

export interface XPathOptions {
    readonly ignorePrefixes?: boolean;
}

// `position` is the 0-based index in the expression where parsing stopped.
export type XPathEvaluation =
    | { readonly ok: true; readonly matches: XPathMatch[] }
    | { readonly ok: false; readonly message: string; readonly position: number };

export function select(xml: XmlNode, path: string, options?: XPathOptions): XPathMatch | null {
    const all = selectAll(xml, path, options);

    return all.length > 0 ? all[0] ?? null : null;
}

// Every match, or none when the expression doesn't parse; `evaluate` says why.
export function selectAll(xml: XmlNode, path: string, options?: XPathOptions): XPathMatch[] {
    const evaluation = evaluate(xml, path, options);

    return evaluation.ok ? evaluation.matches : [];
}

export function evaluate(xml: XmlNode, path: string, options?: XPathOptions): XPathEvaluation {
    try {
        return { ok: true, matches: run(xml, parsePath(path), options) };
    }
    catch (error) {
        if (error instanceof PathParseError) {
            return { ok: false, message: error.message, position: error.position };
        }

        throw error;
    }
}

function run(xml: XmlNode, steps: ParsedPath, options: XPathOptions | undefined): XPathMatch[] {
    const parents = new Map<XmlNode, XmlNode | null>();
    parents.set(xml, null);
    recordParents(xml, parents);

    // Absolute paths start from a synthetic document wrapping the root
    // element, so `/a` matches the root when its name is `a`.
    const documentNode: XmlNode = steps.absolute
        ? { name: '#document', attributes: {}, text: '', children: [xml] }
        : xml;

    if (steps.absolute) {
        parents.set(xml, documentNode);
        parents.set(documentNode, null);
    }

    const start: WalkState[] = [{
        node: documentNode,
        segments: steps.absolute ? [] : [buildRootSegment(xml)],
        parent: null,
    }];

    let current: WalkState[] = start;

    for (let stepIndex = 0; stepIndex < steps.steps.length; stepIndex += 1) {
        const step = steps.steps[stepIndex];
        if (step == null) {
            continue;
        }

        const next: WalkState[] = [];

        for (const state of current) {
            const results = evaluateStep(state, step, parents, options ?? {});
            for (const result of results) {
                next.push(result);
            }
        }

        current = dedupe(next);
    }

    return current.map(toMatch);
}

interface WalkState {
    readonly node: XmlNode;
    readonly segments: XPathSegment[];
    readonly parent: XmlNode | null;
    readonly attribute?: string;
    readonly text?: string;
}

interface Step {
    readonly axis: 'child' | 'descendant' | 'self' | 'parent';
    readonly test: StepTest;
    readonly predicates: Predicate[];
}

type StepTest =
    | { kind: 'element'; name: string | '*' }
    | { kind: 'attribute'; name: string | '*' }
    | { kind: 'text' };

type Predicate =
    | { kind: 'position'; index: number }
    | { kind: 'last' }
    | { kind: 'expression'; expression: PredicateExpression };

type PredicateExpression =
    | { kind: 'attr-exists'; name: string }
    | { kind: 'attr-equals'; name: string; value: string }
    | { kind: 'child-equals'; name: string; value: string }
    | { kind: 'contains'; target: Accessor; value: string }
    | { kind: 'starts-with'; target: Accessor; value: string }
    | { kind: 'and'; left: PredicateExpression; right: PredicateExpression }
    | { kind: 'or'; left: PredicateExpression; right: PredicateExpression };

type Accessor =
    | { kind: 'attribute'; name: string }
    | { kind: 'child'; name: string }
    | { kind: 'local-name' };

interface ParsedPath {
    readonly absolute: boolean;
    readonly steps: Step[];
}

class PathParseError extends Error {
    constructor(message: string, public readonly position: number) {
        super(message);
    }
}

function parsePath(path: string): ParsedPath {
    const parser = new PathParser(path);

    return parser.parse();
}

class PathParser {
    private index = 0;

    constructor(private readonly source: string) {}

    parse(): ParsedPath {
        this.skipWhitespace();
        if (this.atEnd()) {
            throw new PathParseError('Enter an expression', 0);
        }

        const absolute = this.source[this.index] === '/';
        const steps: Step[] = [];
        let descendant = false;

        if (absolute) {
            this.index += 1;
            descendant = this.consumeSlash();
            this.skipWhitespace();

            // A lone `/` selects the document.
            if (!descendant && this.atEnd()) {
                return { absolute, steps };
            }
        }

        while (true) {
            const step = this.parseStep();
            steps.push(descendant ? { ...step, axis: 'descendant' } : step);
            this.skipWhitespace();

            if (this.atEnd()) {
                return { absolute, steps };
            }

            if (this.source[this.index] !== '/') {
                throw new PathParseError(`Unexpected '${this.source[this.index]}'`, this.index);
            }

            this.index += 1;
            descendant = this.consumeSlash();
        }
    }

    private consumeSlash(): boolean {
        if (this.source[this.index] !== '/') {
            return false;
        }

        this.index += 1;

        return true;
    }

    private atEnd(): boolean {
        return this.index >= this.source.length;
    }

    private parseStep(): Step {
        this.skipWhitespace();
        const char = this.source[this.index];

        if (char === '@') {
            this.index += 1;
            const name = this.readNameOrStar();

            return {
                axis: 'self',
                test: { kind: 'attribute', name },
                predicates: this.parsePredicates(),
            };
        }

        if (char === '.') {
            if (this.source.startsWith('..', this.index)) {
                this.index += 2;

                return {
                    axis: 'parent',
                    test: { kind: 'element', name: '*' },
                    predicates: this.parsePredicates(),
                };
            }

            this.index += 1;

            return {
                axis: 'self',
                test: { kind: 'element', name: '*' },
                predicates: this.parsePredicates(),
            };
        }

        if (this.source.startsWith('text()', this.index)) {
            this.index += 'text()'.length;

            return {
                axis: 'child',
                test: { kind: 'text' },
                predicates: this.parsePredicates(),
            };
        }

        if (char === '*') {
            this.index += 1;

            return {
                axis: 'child',
                test: { kind: 'element', name: '*' },
                predicates: this.parsePredicates(),
            };
        }

        const name = this.readNameOrStar();

        return {
            axis: 'child',
            test: { kind: 'element', name },
            predicates: this.parsePredicates(),
        };
    }

    private parsePredicates(): Predicate[] {
        const predicates: Predicate[] = [];
        while (this.index < this.source.length && this.source[this.index] === '[') {
            this.index += 1;
            predicates.push(this.parsePredicate());
            this.skipWhitespace();
            if (this.source[this.index] !== ']') {
                throw new PathParseError("Expected ']'", this.index);
            }

            this.index += 1;
        }

        return predicates;
    }

    private parsePredicate(): Predicate {
        this.skipWhitespace();

        if (this.source.startsWith('last()', this.index)) {
            this.index += 'last()'.length;

            return { kind: 'last' };
        }

        const digitMatch = /^-?\d+/.exec(this.source.slice(this.index));
        if (digitMatch != null) {
            // Must be the entire predicate; if there's more it's an expression.
            const probe = this.index + digitMatch[0].length;
            const next = this.whitespaceEndFrom(probe);
            if (this.source[next] === ']' || next >= this.source.length) {
                this.index = probe;

                return { kind: 'position', index: Number.parseInt(digitMatch[0], 10) };
            }
        }

        const expression = this.parsePredicateExpression();

        return { kind: 'expression', expression };
    }

    private whitespaceEndFrom(start: number): number {
        let cursor = start;
        while (cursor < this.source.length && isWhitespace(this.source[cursor])) {
            cursor += 1;
        }

        return cursor;
    }

    private parsePredicateExpression(): PredicateExpression {
        const left = this.parsePredicateAnd();
        this.skipWhitespace();
        if (this.source.startsWith('or', this.index) && !isNameChar(this.source[this.index + 2])) {
            this.index += 2;
            const right = this.parsePredicateExpression();

            return { kind: 'or', left, right };
        }

        return left;
    }

    private parsePredicateAnd(): PredicateExpression {
        const left = this.parsePredicateTerm();
        this.skipWhitespace();
        if (this.source.startsWith('and', this.index) && !isNameChar(this.source[this.index + 3])) {
            this.index += 3;
            const right = this.parsePredicateAnd();

            return { kind: 'and', left, right };
        }

        return left;
    }

    private parsePredicateTerm(): PredicateExpression {
        this.skipWhitespace();

        if (this.source.startsWith('contains(', this.index)) {
            this.index += 'contains('.length;
            const target = this.parseAccessor();
            this.skipWhitespace();
            this.expectChar(',');
            const value = this.readQuotedString();
            this.skipWhitespace();
            this.expectChar(')');

            return { kind: 'contains', target, value };
        }

        if (this.source.startsWith('starts-with(', this.index)) {
            this.index += 'starts-with('.length;
            const target = this.parseAccessor();
            this.skipWhitespace();
            this.expectChar(',');
            const value = this.readQuotedString();
            this.skipWhitespace();
            this.expectChar(')');

            return { kind: 'starts-with', target, value };
        }

        if (this.source[this.index] === '@') {
            this.index += 1;
            const name = this.readName();
            this.skipWhitespace();
            if (this.source[this.index] === '=') {
                this.index += 1;
                const value = this.readQuotedString();

                return { kind: 'attr-equals', name, value };
            }

            return { kind: 'attr-exists', name };
        }

        // Child equality: child='v'.
        const name = this.readName();
        this.skipWhitespace();
        this.expectChar('=');
        const value = this.readQuotedString();

        return { kind: 'child-equals', name, value };
    }

    private parseAccessor(): Accessor {
        this.skipWhitespace();
        if (this.source.startsWith('local-name()', this.index)) {
            this.index += 'local-name()'.length;

            return { kind: 'local-name' };
        }

        if (this.source[this.index] === '@') {
            this.index += 1;

            return { kind: 'attribute', name: this.readName() };
        }

        return { kind: 'child', name: this.readName() };
    }

    private readName(): string {
        const start = this.index;
        while (this.index < this.source.length && isNameChar(this.source[this.index])) {
            this.index += 1;
        }

        if (start === this.index) {
            throw new PathParseError('Expected a name', this.index);
        }

        return this.source.slice(start, this.index);
    }

    private readNameOrStar(): string {
        if (this.source[this.index] === '*') {
            this.index += 1;

            return '*';
        }

        return this.readName();
    }

    private readQuotedString(): string {
        this.skipWhitespace();
        const quote = this.source[this.index];
        if (quote !== '"' && quote !== "'") {
            throw new PathParseError('Expected a quoted string', this.index);
        }

        this.index += 1;
        const start = this.index;
        const end = this.source.indexOf(quote, start);
        if (end === -1) {
            throw new PathParseError('Unterminated string', start);
        }

        const value = this.source.slice(start, end);
        this.index = end + 1;

        return value;
    }

    private expectChar(ch: string): void {
        this.skipWhitespace();
        if (this.source[this.index] !== ch) {
            throw new PathParseError(`Expected '${ch}'`, this.index);
        }

        this.index += 1;
    }

    private skipWhitespace(): void {
        this.index = this.whitespaceEndFrom(this.index);
    }
}

function isWhitespace(ch: string | undefined): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isNameChar(ch: string | undefined): boolean {
    if (ch == null) {
        return false;
    }

    return /[A-Za-z0-9_\-.:]/.test(ch);
}

function evaluateStep(
    state: WalkState,
    step: Step,
    parents: ReadonlyMap<XmlNode, XmlNode | null>,
    options: XPathOptions,
): WalkState[] {
    const base = gatherCandidates(state, step, parents);
    const filtered = filterByTest(base, step, options);

    if (step.axis !== 'descendant' || step.predicates.length === 0) {
        return applyPredicates(filtered, step.predicates, options);
    }

    // `//item[1]` means the first item under each parent, so positions count per parent.
    const byParent = new Map<XmlNode | null, WalkState[]>();
    for (const candidate of filtered) {
        const key = candidate.attribute != null || candidate.text != null ? candidate.node : candidate.parent;
        const group = byParent.get(key) ?? [];
        group.push(candidate);
        byParent.set(key, group);
    }

    return [...byParent.values()].flatMap((group) => applyPredicates(group, step.predicates, options));
}

function gatherCandidates(
    state: WalkState,
    step: Step,
    parents: ReadonlyMap<XmlNode, XmlNode | null>,
): WalkState[] {
    if (step.axis === 'self') {
        if (step.test.kind === 'attribute') {
            return attributeStates(state);
        }

        return [state];
    }

    if (step.axis === 'parent') {
        const parent = parents.get(state.node) ?? null;
        if (parent == null) {
            return [];
        }

        return [{
            node: parent,
            parent: parents.get(parent) ?? null,
            segments: state.segments.slice(0, -1),
        }];
    }

    if (step.axis === 'child') {
        if (step.test.kind === 'attribute') {
            return attributeStates(state);
        }

        if (step.test.kind === 'text') {
            return textStates(state);
        }

        return elementChildStates(state);
    }

    const states: WalkState[] = [];
    collectDescendants(state.node, state.segments, states);

    if (step.test.kind === 'element') {
        return states;
    }

    // `//@id` and `//text()` look at the context node and every element below it.
    const owners = [state, ...states];

    return step.test.kind === 'attribute'
        ? owners.flatMap(attributeStates)
        : owners.flatMap(textStates);
}

function attributeStates(state: WalkState): WalkState[] {
    const results: WalkState[] = [];
    for (const name of Object.keys(state.node.attributes)) {
        results.push({
            node: state.node,
            parent: state.parent,
            segments: [...state.segments, { kind: 'attribute', name }],
            attribute: name,
        });
    }

    return results;
}

function textStates(state: WalkState): WalkState[] {
    if (state.node.text === '') {
        return [];
    }

    return [{
        node: state.node,
        parent: state.parent,
        segments: [...state.segments, { kind: 'text' }],
        text: state.node.text,
    }];
}

function elementChildStates(state: WalkState): WalkState[] {
    const results: WalkState[] = [];
    const counts = countByName(state.node.children);
    const indices = new Map<string, number>();

    for (const child of state.node.children) {
        const position = (indices.get(child.name) ?? 0) + 1;
        indices.set(child.name, position);
        results.push({
            node: child,
            parent: state.node,
            segments: [
                ...state.segments,
                {
                    kind: 'element',
                    name: child.name,
                    position,
                    count: counts.get(child.name) ?? 1,
                },
            ],
        });
    }

    return results;
}

function collectDescendants(node: XmlNode, segments: XPathSegment[], out: WalkState[]): void {
    const counts = countByName(node.children);
    const indices = new Map<string, number>();

    for (const child of node.children) {
        const position = (indices.get(child.name) ?? 0) + 1;
        indices.set(child.name, position);
        const childSegments = [
            ...segments,
            {
                kind: 'element' as const,
                name: child.name,
                position,
                count: counts.get(child.name) ?? 1,
            },
        ];
        out.push({ node: child, parent: node, segments: childSegments });
        collectDescendants(child, childSegments, out);
    }
}

function countByName(children: ReadonlyArray<XmlNode>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const child of children) {
        counts.set(child.name, (counts.get(child.name) ?? 0) + 1);
    }

    return counts;
}

function filterByTest(
    states: ReadonlyArray<WalkState>,
    step: Step,
    options: XPathOptions,
): WalkState[] {
    const results: WalkState[] = [];

    for (const state of states) {
        if (step.test.kind === 'attribute') {
            if (state.attribute == null) {
                continue;
            }

            if (step.test.name === '*' || matchName(state.attribute, step.test.name, options)) {
                results.push(state);
            }

            continue;
        }

        if (step.test.kind === 'text') {
            if (state.text != null) {
                results.push(state);
            }

            continue;
        }

        if (state.attribute != null || state.text != null) {
            continue;
        }

        if (step.test.name === '*' || matchName(state.node.name, step.test.name, options)) {
            results.push(state);
        }
    }

    return results;
}

function matchName(actual: string, expected: string, options: XPathOptions): boolean {
    if (actual === expected) {
        return true;
    }

    if (options.ignorePrefixes === true) {
        return localName(actual) === localName(expected);
    }

    return false;
}

function localName(name: string): string {
    const colon = name.indexOf(':');

    return colon === -1 ? name : name.slice(colon + 1);
}

function applyPredicates(
    states: ReadonlyArray<WalkState>,
    predicates: ReadonlyArray<Predicate>,
    options: XPathOptions,
): WalkState[] {
    let current = states;

    for (const predicate of predicates) {
        current = applyPredicate(current, predicate, options);
    }

    return [...current];
}

function applyPredicate(
    states: ReadonlyArray<WalkState>,
    predicate: Predicate,
    options: XPathOptions,
): WalkState[] {
    if (predicate.kind === 'position') {
        if (predicate.index > 0) {
            const picked = states[predicate.index - 1];

            return picked != null ? [picked] : [];
        }

        if (predicate.index < 0) {
            const picked = states[states.length + predicate.index];

            return picked != null ? [picked] : [];
        }

        return [];
    }

    if (predicate.kind === 'last') {
        const picked = states[states.length - 1];

        return picked != null ? [picked] : [];
    }

    return states.filter((state) => evalExpression(state, predicate.expression, options));
}

function evalExpression(
    state: WalkState,
    expression: PredicateExpression,
    options: XPathOptions,
): boolean {
    if (expression.kind === 'and') {
        return evalExpression(state, expression.left, options) && evalExpression(state, expression.right, options);
    }

    if (expression.kind === 'or') {
        return evalExpression(state, expression.left, options) || evalExpression(state, expression.right, options);
    }

    if (expression.kind === 'attr-exists') {
        return findAttribute(state.node, expression.name, options) != null;
    }

    if (expression.kind === 'attr-equals') {
        return findAttribute(state.node, expression.name, options) === expression.value;
    }

    if (expression.kind === 'child-equals') {
        const child = findChildByName(state.node, expression.name, options);

        return child != null && child.text === expression.value;
    }

    if (expression.kind === 'contains') {
        const target = readAccessor(state, expression.target, options);

        return target != null && target.includes(expression.value);
    }

    if (expression.kind === 'starts-with') {
        const target = readAccessor(state, expression.target, options);

        return target != null && target.startsWith(expression.value);
    }

    return false;
}

function findAttribute(node: XmlNode, name: string, options: XPathOptions): string | null {
    if (Object.prototype.hasOwnProperty.call(node.attributes, name)) {
        return node.attributes[name] ?? null;
    }

    if (options.ignorePrefixes !== true) {
        return null;
    }

    const target = localName(name);
    for (const key of Object.keys(node.attributes)) {
        if (localName(key) === target) {
            return node.attributes[key] ?? null;
        }
    }

    return null;
}

function findChildByName(node: XmlNode, name: string, options: XPathOptions): XmlNode | null {
    for (const child of node.children) {
        if (matchName(child.name, name, options)) {
            return child;
        }
    }

    return null;
}

function readAccessor(
    state: WalkState,
    accessor: Accessor,
    options: XPathOptions,
): string | null {
    if (accessor.kind === 'attribute') {
        return findAttribute(state.node, accessor.name, options);
    }

    if (accessor.kind === 'child') {
        const child = findChildByName(state.node, accessor.name, options);

        return child == null ? null : child.text;
    }

    return localName(state.node.name);
}

function toMatch(state: WalkState): XPathMatch {
    if (state.attribute != null) {
        return {
            kind: 'attribute',
            value: state.node.attributes[state.attribute] ?? '',
            segments: state.segments,
            node: state.node,
        };
    }

    if (state.text != null) {
        return {
            kind: 'text',
            value: state.text,
            segments: state.segments,
            node: state.node,
        };
    }

    return {
        kind: 'element',
        value: state.node.text,
        segments: state.segments,
        node: state.node,
    };
}

function buildRootSegment(root: XmlNode): XPathSegment {
    return { kind: 'element', name: root.name, position: 1, count: 1 };
}

function recordParents(node: XmlNode, parents: Map<XmlNode, XmlNode | null>): void {
    for (const child of node.children) {
        parents.set(child, node);
        recordParents(child, parents);
    }
}

function dedupe(states: ReadonlyArray<WalkState>): WalkState[] {
    const seen = new Set<string>();
    const out: WalkState[] = [];
    for (const state of states) {
        const signature = describe(state);
        if (seen.has(signature)) {
            continue;
        }

        seen.add(signature);
        out.push(state);
    }

    return out;
}

function describe(state: WalkState): string {
    const path = state.segments.map((segment) => {
        if (segment.kind === 'element') {
            return `${segment.name}[${segment.position}]`;
        }

        if (segment.kind === 'attribute') {
            return `@${segment.name}`;
        }

        return 'text()';
    }).join('/');
    const attr = state.attribute ?? '';
    const text = state.text != null ? '#text' : '';

    return `${path}|${attr}|${text}`;
}

export const XPath = {
    select,
    selectAll,
    evaluate,
};
