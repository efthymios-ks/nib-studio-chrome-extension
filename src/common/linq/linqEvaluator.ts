import { createAbortError, formatMegabytes, throwIfAborted } from '../csv/csvLimits.js';
import type { LinqClause, LinqExpression, LinqQuery, LinqSelectItem } from './linqAst.js';
import { LinqError, isLinqError, withSuggestion, type LinqSpan } from './linqErrors.js';
import {
    LINQ_METHODS,
    LINQ_PROPERTIES,
    LinqTypeError,
    findAggregate,
    findFunction,
    findMethod,
    findProperty,
    likeHint,
    receiverMatches,
    requireNumber,
    type LinqAggregateKind,
} from './linqFunctions.js';
import { parseQuery } from './linqParser.js';
import type { LinqTableSource } from './linqSources.js';
import {
    LinqDate,
    LinqRecord,
    compareValues,
    convertCell,
    estimateValueBytes,
    formatValue,
    inferColumnTypes,
    matchesLike,
    parseDateText,
    typeName,
    valueKey,
    valuesEqual,
    type LinqColumnType,
    type LinqValue,
} from './linqValues.js';

const LINQ_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

const TYPE_SAMPLE_ROWS = 1000;
const OUTPUT_BATCH_FRAMES = 10_000;
const FRAME_OVERHEAD_BYTES = 64;

export interface LinqProgress {
    readonly phase: 'scanning' | 'sorting';
    readonly done: number;
    readonly total: number;
}

export interface LinqRunOptions {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: LinqProgress) => void;
    // Rough cap on what sorting, grouping, distinct and the result may hold in memory.
    readonly memoryLimitBytes?: number;
}

export type LinqResult =
    | {
        readonly kind: 'table';
        readonly columns: ReadonlyArray<string>;
        readonly rows: ReadonlyArray<ReadonlyArray<LinqValue>>;
        readonly scannedRows: number;
        readonly columnTypes: ReadonlyArray<LinqColumnType>;
    }
    | {
        readonly kind: 'scalar';
        readonly column: string;
        readonly value: LinqValue;
        readonly scannedRows: number;
        readonly columnTypes: ReadonlyArray<LinqColumnType>;
    };

// Parses and runs a query against a table, streaming its rows batch by batch.
export async function runQueryAsync(text: string, source: LinqTableSource, options: LinqRunOptions = {}): Promise<LinqResult> {
    try {
        const plan = compileQuery(text, source.columns);

        return await plan.runAsync(source, options);
    }
    catch (error: unknown) {
        if (isLinqError(error)) {
            error.locate(text);
        }

        throw error;
    }
}

// Checks a query against the column names without reading any rows.
export function compileQuery(text: string, columns: ReadonlyArray<string>): LinqPlan {
    try {
        return new LinqCompiler(text, columns).compile(parseQuery(text));
    }
    catch (error: unknown) {
        if (isLinqError(error)) {
            error.locate(text);
        }

        throw error;
    }
}

type Evaluate = (frame: Frame) => LinqValue;

// One element flowing through the pipeline: a table row, a group, or a selected record.
interface Frame {
    readonly cells: ReadonlyArray<unknown> | null;
    readonly key: LinqValue;
    readonly accumulators: Accumulator[] | null;
    readonly values: LinqValue[] | null;
    readonly lets: LinqValue[];
}

interface RowStage {
    readonly kind: 'row';
    readonly rangeVariable: string | null;
    // Inside an aggregate, the group's name stands for each of its rows.
    readonly elementAlias: string | null;
    readonly lets: Map<string, number>;
}

interface GroupStage {
    readonly kind: 'group';
    readonly groupName: string | null;
    readonly rangeVariable: string | null;
    readonly key: LinqExpression | null;
    readonly keyMembers: ReadonlyArray<{ readonly name: string; readonly expression: LinqExpression }>;
    readonly element: RowStage;
    readonly aggregates: AggregateSpec[];
    readonly implicit: boolean;
    readonly lets: Map<string, number>;
}

interface ProjectedStage {
    readonly kind: 'projected';
    readonly columns: ReadonlyArray<string>;
    // Range and group names from before select, accepted as a prefix: row.Revenue.
    readonly formerNames: ReadonlyArray<string>;
}

interface ConstantStage {
    readonly kind: 'constant';
    readonly clause: string;
}

type Stage = RowStage | GroupStage | ProjectedStage | ConstantStage;

interface AggregateSpec {
    readonly kind: LinqAggregateKind;
    readonly name: string;
    readonly argument: Evaluate | null;
    readonly span: LinqSpan;
}

class Accumulator {
    count = 0;

    sum = 0;

    best: LinqValue = null;

    feed(spec: AggregateSpec, frame: Frame): void {
        const value = spec.argument == null ? true : spec.argument(frame);

        if (value == null) {
            return;
        }

        if (spec.kind === 'count') {
            this.count += 1;

            return;
        }

        if (spec.kind === 'sum' || spec.kind === 'average') {
            const number = guard(() => requireNumber(value, spec.name), spec.span);

            if (number != null) {
                this.sum += number;
                this.count += 1;
            }

            return;
        }

        if (this.best == null) {
            this.best = value;

            return;
        }

        const comparison = compareValues(value, this.best);

        if ((spec.kind === 'min' && comparison < 0) || (spec.kind === 'max' && comparison > 0)) {
            this.best = value;
        }
    }

    result(kind: LinqAggregateKind): LinqValue {
        switch (kind) {
            case 'count':
                return this.count;
            case 'sum':
                return this.sum;
            case 'average':
                return this.count === 0 ? null : this.sum / this.count;
            default:
                return this.best;
        }
    }
}

class MemoryBudget {
    private used = 0;

    constructor(private readonly limit: number) {}

    add(bytes: number, span: LinqSpan, what: string): void {
        this.used += bytes;

        if (this.used > this.limit) {
            throw new LinqError(
                `The query needs more than ${formatMegabytes(this.limit)} of memory to ${what}. Narrow it with where, or select fewer columns first.`,
                span,
            );
        }
    }
}

interface RunContext {
    readonly signal: AbortSignal | undefined;
    readonly budget: MemoryBudget;
    readonly report: (progress: LinqProgress) => void;
    readonly runtime: Runtime;
}

interface Runtime {
    converters: Array<(cell: unknown) => LinqValue>;
    types: LinqColumnType[];
    scannedRows: number;
}

type FrameStream = AsyncIterable<Frame[]>;

type Operator = (input: FrameStream, context: RunContext) => FrameStream;

export class LinqPlan {
    constructor(
        private readonly operators: ReadonlyArray<Operator>,
        private readonly runtime: Runtime,
        readonly columns: ReadonlyArray<string>,
        private readonly toRow: (frame: Frame) => LinqValue[],
        // Set when the query summarises the whole table into one value.
        readonly scalar: boolean,
        private readonly span: LinqSpan,
    ) {}

    async runAsync(source: LinqTableSource, options: LinqRunOptions = {}): Promise<LinqResult> {
        const runtime = this.runtime;
        runtime.types = source.columns.map(() => 'string');
        runtime.converters = source.columns.map(() => (cell: unknown) => convertCell(cell, 'string'));
        runtime.scannedRows = 0;
        const context: RunContext = {
            signal: options.signal,
            budget: new MemoryBudget(options.memoryLimitBytes ?? LINQ_MEMORY_LIMIT_BYTES),
            report: options.onProgress ?? (() => undefined),
            runtime,
        };
        let stream: FrameStream = scanSource(source, context);

        for (const operator of this.operators) {
            stream = operator(stream, context);
        }

        const rows: LinqValue[][] = [];

        for await (const batch of stream) {
            for (const frame of batch) {
                const row = this.toRow(frame);
                context.budget.add(FRAME_OVERHEAD_BYTES + row.reduce<number>((sum, value) => sum + estimateValueBytes(value), 0), this.span, 'hold the result');
                rows.push(row);
            }
        }

        throwIfAborted(options.signal);

        if (this.scalar) {
            return {
                kind: 'scalar',
                column: this.columns[0] ?? '',
                value: rows[0]?.[0] ?? null,
                scannedRows: runtime.scannedRows,
                columnTypes: runtime.types,
            };
        }

        return { kind: 'table', columns: this.columns, rows, scannedRows: runtime.scannedRows, columnTypes: runtime.types };
    }
}

async function* scanSource(source: LinqTableSource, context: RunContext): FrameStream {
    let typed = false;

    for await (const batch of source.batches(context.signal)) {
        throwIfAborted(context.signal);

        if (!typed) {
            typed = true;
            const types = inferColumnTypes(source.columns.length, batch.rows.slice(0, TYPE_SAMPLE_ROWS));
            context.runtime.types = types;
            context.runtime.converters = types.map((type) => (cell: unknown) => convertCell(cell, type));
        }

        const frames = new Array<Frame>(batch.rows.length);

        for (let index = 0; index < batch.rows.length; index += 1) {
            frames[index] = { cells: batch.rows[index] ?? [], key: null, accumulators: null, values: null, lets: [] };
        }

        context.runtime.scannedRows = batch.done;
        context.report({ phase: 'scanning', done: batch.done, total: batch.total });
        yield frames;
    }
}

function guard<T>(compute: () => T, span: LinqSpan): T {
    try {
        return compute();
    }
    catch (error: unknown) {
        if (error instanceof LinqTypeError) {
            throw new LinqError(error.message, span);
        }

        throw error;
    }
}

function lookupName(map: ReadonlyMap<string, number>, name: string): number | undefined {
    const exact = map.get(name);

    if (exact != null) {
        return exact;
    }

    const lower = name.toLowerCase();

    for (const [candidate, slot] of map) {
        if (candidate.toLowerCase() === lower) {
            return slot;
        }
    }

    return undefined;
}

function sameName(left: string | null, right: string): boolean {
    return left != null && left.toLowerCase() === right.toLowerCase();
}

function isTrue(value: LinqValue, what: string, span: LinqSpan): boolean {
    if (value == null) {
        return false;
    }

    if (typeof value !== 'boolean') {
        throw new LinqError(`${what} needs a true or false value, got ${typeName(value)} '${formatValue(value)}'.`, span);
    }

    return value;
}

function containsAggregate(expression: LinqExpression): boolean {
    switch (expression.kind) {
        case 'call':
            return (expression.callee.kind === 'identifier' && findAggregate(expression.callee.name) != null)
                || containsAggregate(expression.callee)
                || expression.args.some(containsAggregate);
        case 'member':
            return containsAggregate(expression.object);
        case 'index':
            return containsAggregate(expression.object) || containsAggregate(expression.index);
        case 'unary':
            return containsAggregate(expression.operand);
        case 'binary':
            return containsAggregate(expression.left) || containsAggregate(expression.right);
        case 'conditional':
            return containsAggregate(expression.test) || containsAggregate(expression.whenTrue) || containsAggregate(expression.whenFalse);
        case 'object':
            return expression.members.some((member) => containsAggregate(member.expression));
        case 'like':
            return containsAggregate(expression.value) || containsAggregate(expression.pattern);
        case 'in':
            return containsAggregate(expression.value) || expression.items.some(containsAggregate);
        case 'between':
            return containsAggregate(expression.value) || containsAggregate(expression.low) || containsAggregate(expression.high);
        case 'isNull':
            return containsAggregate(expression.value);
        default:
            return false;
    }
}

// Strips the range variable so row.city, row["city"] and city compare equal.
function normalize(expression: LinqExpression, rangeVariable: string | null): LinqExpression {
    if (expression.kind === 'member' && expression.object.kind === 'identifier' && sameName(rangeVariable, expression.object.name)) {
        return { kind: 'identifier', name: expression.name, span: expression.span };
    }

    if (expression.kind === 'index'
        && expression.object.kind === 'identifier'
        && sameName(rangeVariable, expression.object.name)
        && expression.index.kind === 'literal'
        && typeof expression.index.value === 'string') {
        return { kind: 'identifier', name: expression.index.value, span: expression.span };
    }

    return expression;
}

function sameExpression(leftInput: LinqExpression, rightInput: LinqExpression, rangeVariable: string | null): boolean {
    const left = normalize(leftInput, rangeVariable);
    const right = normalize(rightInput, rangeVariable);

    if (left.kind !== right.kind) {
        return false;
    }

    const same = (a: LinqExpression, b: LinqExpression): boolean => sameExpression(a, b, rangeVariable);

    switch (left.kind) {
        case 'literal':
            return right.kind === 'literal' && left.value === right.value;
        case 'identifier':
            return right.kind === 'identifier' && sameName(left.name, right.name);
        case 'star':
            return true;
        case 'member':
            return right.kind === 'member' && sameName(left.name, right.name) && same(left.object, right.object);
        case 'index':
            return right.kind === 'index' && same(left.object, right.object) && same(left.index, right.index);
        case 'call':
            return right.kind === 'call'
                && same(left.callee, right.callee)
                && left.args.length === right.args.length
                && left.args.every((arg, index) => same(arg, right.args[index] as LinqExpression));
        case 'unary':
            return right.kind === 'unary' && left.operator === right.operator && same(left.operand, right.operand);
        case 'binary':
            return right.kind === 'binary' && left.operator === right.operator && same(left.left, right.left) && same(left.right, right.right);
        case 'conditional':
            return right.kind === 'conditional'
                && same(left.test, right.test)
                && same(left.whenTrue, right.whenTrue)
                && same(left.whenFalse, right.whenFalse);
        case 'object':
            return right.kind === 'object'
                && left.members.length === right.members.length
                && left.members.every((member, index) => {
                    const other = right.members[index] as LinqSelectItem;

                    return member.alias === other.alias && same(member.expression, other.expression);
                });
        case 'like':
            return right.kind === 'like' && left.negated === right.negated && same(left.value, right.value) && same(left.pattern, right.pattern);
        case 'in':
            return right.kind === 'in'
                && left.negated === right.negated
                && same(left.value, right.value)
                && left.items.length === right.items.length
                && left.items.every((item, index) => same(item, right.items[index] as LinqExpression));
        case 'between':
            return right.kind === 'between'
                && left.negated === right.negated
                && same(left.value, right.value)
                && same(left.low, right.low)
                && same(left.high, right.high);
        case 'isNull':
            return right.kind === 'isNull' && left.negated === right.negated && same(left.value, right.value);
        default:
            return false;
    }
}

type BinaryOperation = (left: LinqValue, right: LinqValue) => LinqValue;

function arithmetic(symbol: string, compute: (left: number, right: number) => number | null): BinaryOperation {
    return (left, right) => {
        const leftNumber = requireNumber(left, `'${symbol}'`);
        const rightNumber = requireNumber(right, `'${symbol}'`);

        return leftNumber == null || rightNumber == null ? null : compute(leftNumber, rightNumber);
    };
}

function relational(test: (comparison: number) => boolean): BinaryOperation {
    return (left, right) => (left == null || right == null ? false : test(compareValues(left, right)));
}

// Operators that evaluate both sides; &&, || and ?? short-circuit and are handled apart.
const BINARY_OPERATIONS: Readonly<Record<string, BinaryOperation>> = {
    '==': (left, right) => valuesEqual(left, right),
    '!=': (left, right) => !valuesEqual(left, right),
    '<': relational((comparison) => comparison < 0),
    '<=': relational((comparison) => comparison <= 0),
    '>': relational((comparison) => comparison > 0),
    '>=': relational((comparison) => comparison >= 0),
    '+': (left, right) => {
        if (typeof left === 'string' || typeof right === 'string') {
            return formatValue(left) + formatValue(right);
        }

        return arithmetic('+', (first, second) => first + second)(left, right);
    },
    '-': arithmetic('-', (first, second) => first - second),
    '*': arithmetic('*', (first, second) => first * second),
    '/': arithmetic('/', (first, second) => (second === 0 ? null : first / second)),
    '%': arithmetic('%', (first, second) => (second === 0 ? null : first % second)),
};

class LinqCompiler {
    private readonly runtime: Runtime = { converters: [], types: [], scannedRows: 0 };

    private readonly operators: Operator[] = [];

    constructor(private readonly text: string, private readonly columns: ReadonlyArray<string>) {}

    compile(query: LinqQuery): LinqPlan {
        let stage: Stage = { kind: 'row', rangeVariable: query.rangeVariable, elementAlias: null, lets: new Map() };
        let scalar = false;

        for (const clause of query.clauses) {
            if (clause.kind === 'select') {
                const selected = this.compileSelect(clause, stage);
                stage = selected.stage;
                scalar = selected.scalar;
                continue;
            }

            stage = this.compileClause(clause, stage);
        }

        const output = this.compileOutput(stage);

        return new LinqPlan(this.operators, this.runtime, output.columns, output.toRow, scalar, query.span);
    }

    private compileClause(clause: Exclude<LinqClause, { kind: 'select' }>, stage: Stage): Stage {
        switch (clause.kind) {
            case 'where': {
                const condition = this.compileExpression(clause.condition, stage);
                const span = clause.condition.span;
                this.operators.push(mapBatches((frames) => frames.filter((frame) => isTrue(condition(frame), 'where', span))));

                return stage;
            }
            case 'let':
                return this.compileLet(clause, stage);
            case 'orderby':
                this.compileOrderBy(clause, stage);

                return stage;
            case 'group':
                return this.compileGroup(clause, stage);
            case 'distinct':
                this.operators.push(distinctOperator(clause.span));

                return stage;
            case 'skip':
            case 'take':
                this.operators.push(this.compileSkipTake(clause));

                return stage;
            default:
                return stage;
        }
    }

    private compileLet(clause: Extract<LinqClause, { kind: 'let' }>, stage: Stage): Stage {
        if (stage.kind !== 'row' && stage.kind !== 'group') {
            throw new LinqError('let cannot follow select.', clause.span);
        }

        if (sameName(stage.kind === 'row' ? stage.rangeVariable : stage.groupName, clause.name)) {
            throw new LinqError(`'${clause.name}' is already the name of the ${stage.kind === 'row' ? 'rows' : 'group'}.`, clause.span);
        }

        const value = this.compileExpression(clause.value, stage);
        const slot = stage.lets.size;
        const lets = new Map(stage.lets);
        lets.set(clause.name, slot);
        this.operators.push(mapBatches((frames) => {
            for (const frame of frames) {
                frame.lets[slot] = value(frame);
            }

            return frames;
        }));

        return { ...stage, lets };
    }

    private compileOrderBy(clause: Extract<LinqClause, { kind: 'orderby' }>, stage: Stage): void {
        const keys = clause.keys.map((key) => ({ evaluate: this.compileExpression(key.expression, stage), descending: key.descending }));
        this.operators.push(async function* (input, context) {
            const decorated: Array<{ frame: Frame; values: LinqValue[] }> = [];

            for await (const batch of input) {
                for (const frame of batch) {
                    const values = keys.map((key) => key.evaluate(frame));
                    context.budget.add(estimateFrameBytes(frame) + values.reduce<number>((sum, value) => sum + estimateValueBytes(value), 0), clause.span, 'sort');
                    decorated.push({ frame, values });
                }
            }

            context.report({ phase: 'sorting', done: 0, total: decorated.length });
            decorated.sort((left, right) => {
                for (let index = 0; index < keys.length; index += 1) {
                    const leftValue = left.values[index] ?? null;
                    const rightValue = right.values[index] ?? null;

                    // Empty values go last whichever the direction.
                    if (leftValue == null || rightValue == null) {
                        if (leftValue == null && rightValue == null) {
                            continue;
                        }

                        return leftValue == null ? 1 : -1;
                    }

                    const comparison = compareValues(leftValue, rightValue);

                    if (comparison !== 0) {
                        return keys[index]?.descending === true ? -comparison : comparison;
                    }
                }

                return 0;
            });
            context.report({ phase: 'sorting', done: decorated.length, total: decorated.length });
            yield* inBatches(decorated.map((entry) => entry.frame));
        });
    }

    private compileGroup(clause: Extract<LinqClause, { kind: 'group' }>, stage: Stage): Stage {
        if (stage.kind !== 'row') {
            throw new LinqError('group by must come before select.', clause.span);
        }

        if (clause.element != null && !sameName(stage.rangeVariable, clause.element)) {
            throw new LinqError(
                stage.rangeVariable == null
                    ? `With 'from *', write 'group by …' without '${clause.element}'.`
                    : `Write 'group ${stage.rangeVariable} by …': a group collects whole rows.`,
                clause.span,
            );
        }

        if (clause.into != null && (sameName(stage.rangeVariable, clause.into) || lookupName(stage.lets, clause.into) != null)) {
            throw new LinqError(`'${clause.into}' is already taken; pick another name after into.`, clause.span);
        }

        const key = this.compileExpression(clause.key, stage);
        const keyMembers = clause.key.kind === 'object'
            ? this.memberNames(clause.key.members).map((name, index) => ({ name, expression: (clause.key as Extract<LinqExpression, { kind: 'object' }>).members[index]?.expression as LinqExpression }))
            : [];
        const group: GroupStage = {
            kind: 'group',
            groupName: clause.into,
            rangeVariable: stage.rangeVariable,
            key: clause.key,
            keyMembers,
            element: { ...stage, elementAlias: clause.into },
            aggregates: [],
            implicit: false,
            lets: new Map(),
        };
        this.operators.push(groupOperator(group, key, clause.span));

        return group;
    }

    private compileSkipTake(clause: Extract<LinqClause, { kind: 'skip' | 'take' }>): Operator {
        const count = this.compileExpression(clause.count, { kind: 'constant', clause: clause.kind });
        const value = guard(() => count({ cells: null, key: null, accumulators: null, values: null, lets: [] }), clause.count.span);

        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            throw new LinqError(`${clause.kind} needs a whole number of 0 or more.`, clause.count.span);
        }

        return clause.kind === 'skip' ? skipOperator(value) : takeOperator(value);
    }

    private compileSelect(clause: Extract<LinqClause, { kind: 'select' }>, input: Stage): { stage: Stage; scalar: boolean } {
        let stage = input;
        let implicit = false;

        if (stage.kind === 'row' && clause.items.some((item) => containsAggregate(item.expression))) {
            implicit = true;
            const group: GroupStage = {
                kind: 'group',
                groupName: null,
                rangeVariable: stage.rangeVariable,
                key: null,
                keyMembers: [],
                element: stage,
                aggregates: [],
                implicit: true,
                lets: new Map(),
            };
            this.operators.push(groupOperator(group, () => null, clause.span));
            stage = group;
        }

        const evaluators: Array<(frame: Frame, into: LinqValue[]) => void> = [];
        const names: string[] = [];

        for (const item of clause.items) {
            const expands = item.expression.kind === 'star'
                || (item.alias == null && item.expression.kind === 'identifier' && stage.kind === 'row'
                    && sameName(stage.rangeVariable, item.expression.name) && lookupName(stage.lets, item.expression.name) == null);

            if (expands) {
                this.expandAll(stage, item.span, names, evaluators);
                continue;
            }

            const evaluate = this.compileExpression(item.expression, stage);
            names.push(item.alias ?? this.inferName(item.expression));
            evaluators.push((frame, into) => {
                into.push(evaluate(frame));
            });
        }

        const columns = uniqueNames(names);
        this.operators.push(mapBatches((frames) => frames.map((frame) => {
            const values: LinqValue[] = [];

            for (const evaluate of evaluators) {
                evaluate(frame, values);
            }

            return { cells: null, key: null, accumulators: null, values, lets: [] };
        })));

        const formerNames = [
            ...(input.kind === 'row' && input.rangeVariable != null ? [input.rangeVariable] : []),
            ...(input.kind === 'group' && input.groupName != null ? [input.groupName] : []),
            ...(input.kind === 'group' && input.rangeVariable != null ? [input.rangeVariable] : []),
        ];
        const scalar = implicit && !clause.object && clause.items.length === 1 && clause.items[0]?.alias == null;

        return { stage: { kind: 'projected', columns, formerNames }, scalar };
    }

    private expandAll(stage: Stage, span: LinqSpan, names: string[], evaluators: Array<(frame: Frame, into: LinqValue[]) => void>): void {
        if (stage.kind === 'row') {
            names.push(...this.columns);
            const converters = this.runtime;
            evaluators.push((frame, into) => {
                const cells = frame.cells ?? [];

                for (let index = 0; index < this.columns.length; index += 1) {
                    into.push((converters.converters[index] as (cell: unknown) => LinqValue)(cells[index]));
                }
            });

            return;
        }

        if (stage.kind === 'projected') {
            names.push(...stage.columns);
            evaluators.push((frame, into) => {
                into.push(...(frame.values ?? []));
            });

            return;
        }

        throw new LinqError('After group by, * has no single row to stand for; select the key and aggregates instead.', span);
    }

    private compileOutput(stage: Stage): { columns: ReadonlyArray<string>; toRow: (frame: Frame) => LinqValue[] } {
        if (stage.kind === 'projected') {
            return { columns: stage.columns, toRow: (frame) => frame.values ?? [] };
        }

        if (stage.kind === 'row') {
            return {
                columns: this.columns,
                toRow: (frame) => this.columns.map((_, index) => (this.runtime.converters[index] as (cell: unknown) => LinqValue)((frame.cells ?? [])[index])),
            };
        }

        if (stage.kind === 'group') {
            // A query that ends with group by lists each key with its row count.
            const countSlot = stage.aggregates.length;
            stage.aggregates.push({ kind: 'count', name: 'count', argument: null, span: { start: 0, end: 0 } });
            const keyNames = stage.keyMembers.length > 0 ? stage.keyMembers.map((member) => member.name) : ['Key'];

            return {
                columns: uniqueNames([...keyNames, 'Count']),
                toRow: (frame) => {
                    const keyValues = stage.keyMembers.length > 0 && frame.key instanceof LinqRecord ? [...frame.key.values] : [frame.key];

                    return [...keyValues, frame.accumulators?.[countSlot]?.result('count') ?? 0];
                },
            };
        }

        return { columns: [], toRow: () => [] };
    }

    private memberNames(members: ReadonlyArray<LinqSelectItem>): string[] {
        return uniqueNames(members.map((member) => member.alias ?? this.inferName(member.expression)));
    }

    private inferName(expression: LinqExpression): string {
        if (expression.kind === 'identifier' || expression.kind === 'member') {
            return expression.name;
        }

        if (expression.kind === 'index' && expression.index.kind === 'literal' && typeof expression.index.value === 'string') {
            return expression.index.value;
        }

        return this.text.slice(expression.span.start, expression.span.end).replace(/\s+/g, ' ').trim();
    }

    private compileExpression(expression: LinqExpression, stage: Stage): Evaluate {
        if (stage.kind === 'group') {
            const matched = this.matchGroupKey(expression, stage);

            if (matched != null) {
                return matched;
            }
        }

        switch (expression.kind) {
            case 'literal': {
                const value = expression.value;

                return () => value;
            }
            case 'identifier':
                return this.compileIdentifier(expression.name, expression.span, stage);
            case 'star':
                throw new LinqError("'*' only works on its own in select, or in count(*).", expression.span);
            case 'member':
                return this.compileMember(expression, stage);
            case 'index':
                return this.compileIndex(expression, stage);
            case 'call':
                return this.compileCall(expression, stage);
            case 'unary':
                return this.compileUnary(expression, stage);
            case 'binary':
                return this.compileBinary(expression, stage);
            case 'conditional': {
                const test = this.compileExpression(expression.test, stage);
                const whenTrue = this.compileExpression(expression.whenTrue, stage);
                const whenFalse = this.compileExpression(expression.whenFalse, stage);
                const span = expression.test.span;

                return (frame) => (isTrue(test(frame), "'?:'", span) ? whenTrue(frame) : whenFalse(frame));
            }
            case 'object': {
                const names = this.memberNames(expression.members);
                const values = expression.members.map((member) => this.compileExpression(member.expression, stage));

                return (frame) => new LinqRecord(names, values.map((evaluate) => evaluate(frame)));
            }
            case 'like':
                return this.compileLike(expression, stage);
            case 'in': {
                const value = this.compileExpression(expression.value, stage);
                const items = expression.items.map((item) => this.compileExpression(item, stage));
                const negated = expression.negated;
                const span = expression.span;

                return (frame) => guard(() => {
                    const current = value(frame);
                    const found = items.some((item) => valuesEqual(current, item(frame)));

                    return negated ? !found : found;
                }, span);
            }
            case 'between': {
                const value = this.compileExpression(expression.value, stage);
                const low = this.compileExpression(expression.low, stage);
                const high = this.compileExpression(expression.high, stage);
                const negated = expression.negated;
                const span = expression.span;

                return (frame) => guard(() => {
                    const current = value(frame);
                    const from = low(frame);
                    const to = high(frame);

                    // Like < and >, an empty value on any side never compares.
                    if (current == null || from == null || to == null) {
                        return false;
                    }

                    const inside = compareValues(current, from) >= 0 && compareValues(current, to) <= 0;

                    return negated ? !inside : inside;
                }, span);
            }
            case 'isNull': {
                const value = this.compileExpression(expression.value, stage);
                const negated = expression.negated;

                return (frame) => (value(frame) == null) !== negated;
            }
            default:
                throw new LinqError('Unsupported expression.', { start: 0, end: 0 });
        }
    }

    // After group by, an expression equal to the key, or to one of its members, reads the key.
    private matchGroupKey(expression: LinqExpression, stage: GroupStage): Evaluate | null {
        if (stage.key == null || expression.kind === 'literal') {
            return null;
        }

        if (expression.kind === 'identifier' && lookupName(stage.lets, expression.name) != null) {
            return null;
        }

        if (sameExpression(expression, stage.key, stage.rangeVariable)) {
            return (frame) => frame.key;
        }

        for (let index = 0; index < stage.keyMembers.length; index += 1) {
            const member = stage.keyMembers[index] as { name: string; expression: LinqExpression };
            const normalized = normalize(expression, stage.rangeVariable);
            const byName = normalized.kind === 'identifier' && sameName(member.name, normalized.name);

            if (byName || sameExpression(expression, member.expression, stage.rangeVariable)) {
                return (frame) => (frame.key instanceof LinqRecord ? frame.key.values[index] ?? null : null);
            }
        }

        return null;
    }

    private compileIdentifier(name: string, span: LinqSpan, stage: Stage): Evaluate {
        if (stage.kind === 'constant') {
            throw new LinqError(`${stage.clause} needs a plain number, like ${stage.clause} 10.`, span);
        }

        if (stage.kind === 'projected') {
            return this.compileProjectedColumn(name, span, stage);
        }

        const letSlot = lookupName(stage.lets, name);

        if (letSlot != null) {
            return (frame) => frame.lets[letSlot] ?? null;
        }

        if (stage.kind === 'group') {
            throw new LinqError(this.groupMisuse(name, stage), span);
        }

        if (sameName(stage.rangeVariable, name) || sameName(stage.elementAlias, name)) {
            return (frame) => this.rowRecord(frame);
        }

        if (/^math$/i.test(name)) {
            throw new LinqError('Math needs a function, like Math.Round(row.total, 2).', span);
        }

        return this.compileColumn(name, span, [...stage.lets.keys()]);
    }

    private groupMisuse(name: string, stage: GroupStage): string {
        if (sameName(stage.groupName, name)) {
            return `The group '${name}' works inside an aggregate, like count(${name}) or sum(${name}.total), or as ${name}.Key.`;
        }

        if (stage.implicit) {
            return `'${name}' needs an aggregate here, because the select also uses aggregates. Wrap it, like min(${name}), or add group by.`;
        }

        if (sameName(stage.rangeVariable, name)) {
            return `After group by, '${name}' works only inside an aggregate, like count(${name}).`;
        }

        return `'${name}' is not part of the group key. Use it inside an aggregate, like sum(${name}), or group by it.`;
    }

    private compileColumn(name: string, span: LinqSpan, extraNames: ReadonlyArray<string>): Evaluate {
        let index = this.columns.indexOf(name);

        if (index < 0) {
            const lower = name.toLowerCase();
            index = this.columns.findIndex((column) => column.toLowerCase() === lower);
        }

        if (index < 0) {
            throw new LinqError(withSuggestion(`Unknown column '${name}'.`, name, [...this.columns, ...extraNames]), span);
        }

        const column = index;
        const runtime = this.runtime;

        return (frame) => (runtime.converters[column] as (cell: unknown) => LinqValue)(frame.cells?.[column]);
    }

    private compileProjectedColumn(name: string, span: LinqSpan, stage: ProjectedStage): Evaluate {
        let index = stage.columns.indexOf(name);

        if (index < 0) {
            const lower = name.toLowerCase();
            index = stage.columns.findIndex((column) => column.toLowerCase() === lower);
        }

        if (index < 0) {
            throw new LinqError(withSuggestion(`Unknown column '${name}'; after select, use the selected names.`, name, stage.columns), span);
        }

        const column = index;

        return (frame) => frame.values?.[column] ?? null;
    }

    private rowRecord(frame: Frame): LinqRecord {
        const cells = frame.cells ?? [];

        return new LinqRecord(this.columns, this.columns.map((_, index) => (this.runtime.converters[index] as (cell: unknown) => LinqValue)(cells[index])));
    }

    private compileMember(expression: Extract<LinqExpression, { kind: 'member' }>, stage: Stage): Evaluate {
        const target = expression.object;

        if (target.kind === 'identifier') {
            if (stage.kind === 'row'
                && (sameName(stage.rangeVariable, target.name) || sameName(stage.elementAlias, target.name))
                && lookupName(stage.lets, target.name) == null) {
                return this.compileColumn(expression.name, expression.span, []);
            }

            if (stage.kind === 'group' && sameName(stage.groupName, target.name)) {
                if (expression.name.toLowerCase() === 'key') {
                    return (frame) => frame.key;
                }

                throw new LinqError(
                    `Use ${target.name}.${expression.name} inside an aggregate, like sum(${target.name}.${expression.name}), or read ${target.name}.Key.`,
                    expression.span,
                );
            }

            if (stage.kind === 'projected' && stage.formerNames.some((name) => sameName(name, target.name))) {
                return this.compileProjectedColumn(expression.name, expression.span, stage);
            }

            if (/^math$/i.test(target.name)) {
                throw new LinqError(`Math.${expression.name} is a function: call it, like Math.${expression.name}(value).`, expression.span);
            }
        }

        const object = this.compileExpression(target, stage);
        const name = expression.name;
        const property = findProperty(name);
        const span = expression.span;

        return (frame) => {
            const value = object(frame);

            if (value == null) {
                return null;
            }

            if (value instanceof LinqRecord) {
                const index = value.indexOf(name);

                if (index < 0) {
                    throw new LinqError(withSuggestion(`The object has no member '${name}'.`, name, value.names), span);
                }

                return value.values[index] ?? null;
            }

            if (property == null) {
                throw new LinqError(withSuggestion(`Unknown property '${name}'.`, name, LINQ_PROPERTIES.map((entry) => entry.name)), span);
            }

            return guard(() => readProperty(property, value), span);
        };
    }

    private compileIndex(expression: Extract<LinqExpression, { kind: 'index' }>, stage: Stage): Evaluate {
        const index = expression.index;
        const literal = index.kind === 'literal' && typeof index.value === 'string' ? index.value : null;

        if (literal != null && expression.object.kind === 'identifier') {
            const name = expression.object.name;

            if (stage.kind === 'row' && (sameName(stage.rangeVariable, name) || sameName(stage.elementAlias, name))) {
                return this.compileColumn(literal, expression.span, []);
            }

            if (stage.kind === 'projected' && stage.formerNames.some((former) => sameName(former, name))) {
                return this.compileProjectedColumn(literal, expression.span, stage);
            }
        }

        const object = this.compileExpression(expression.object, stage);
        const key = this.compileExpression(index, stage);
        const span = expression.span;

        return (frame) => {
            const value = object(frame);
            const member = key(frame);

            if (value == null) {
                return null;
            }

            if (value instanceof LinqRecord && typeof member === 'string') {
                const position = value.indexOf(member);

                if (position < 0) {
                    throw new LinqError(withSuggestion(`The object has no member '${member}'.`, member, value.names), span);
                }

                return value.values[position] ?? null;
            }

            throw new LinqError(`[ ] reads a column by name, like row["unit price"]; it does not work on ${typeName(value)}.`, span);
        };
    }

    private compileCall(expression: Extract<LinqExpression, { kind: 'call' }>, stage: Stage): Evaluate {
        const callee = expression.callee;

        if (callee.kind === 'identifier') {
            const aggregate = findAggregate(callee.name);

            if (aggregate != null) {
                return this.compileAggregate(expression, aggregate.kind, callee.name, stage);
            }

            const entry = findFunction(callee.name);
            const hint = likeHint(callee.name);

            if (hint != null) {
                throw new LinqError(hint, callee.span);
            }

            if (entry == null || entry.name.includes('.')) {
                throw new LinqError(
                    withSuggestion(`Unknown function '${callee.name}'.`, callee.name, ['count', 'sum', 'average', 'avg', 'min', 'max', 'date', 'number']),
                    callee.span,
                );
            }

            return this.compileFunction(entry.name, expression, stage);
        }

        if (callee.kind === 'member' && callee.object.kind === 'identifier' && /^math$/i.test(callee.object.name)) {
            const entry = findFunction(`Math.${callee.name}`);

            if (entry == null) {
                throw new LinqError(
                    withSuggestion(`Unknown function 'Math.${callee.name}'.`, callee.name, ['Round', 'Abs', 'Floor', 'Ceiling', 'Min', 'Max', 'Pow', 'Sqrt']),
                    callee.span,
                );
            }

            return this.compileFunction(entry.name, expression, stage);
        }

        if (callee.kind !== 'member') {
            throw new LinqError('Only functions and methods can be called.', callee.span);
        }

        const method = findMethod(callee.name);
        const hint = likeHint(callee.name);

        if (hint != null) {
            throw new LinqError(hint, callee.span);
        }

        if (method == null) {
            throw new LinqError(withSuggestion(`Unknown method '${callee.name}'.`, callee.name, LINQ_METHODS.map((entry) => entry.name)), callee.span);
        }

        this.checkArity(method.name, method.minArgs, method.maxArgs, expression);
        const receiver = this.compileExpression(callee.object, stage);
        const args = expression.args.map((arg) => this.compileExpression(arg, stage));
        const span = expression.span;

        return (frame) => {
            const value = receiver(frame);

            if (value == null) {
                return null;
            }

            if (!receiverMatches(method.receiver, value)) {
                throw new LinqError(`${method.name} does not work on ${typeName(value)}.`, span);
            }

            const values = args.map((arg) => arg(frame));

            return guard(() => method.apply(value, values), span);
        };
    }

    private compileFunction(name: string, expression: Extract<LinqExpression, { kind: 'call' }>, stage: Stage): Evaluate {
        const entry = findFunction(name);

        if (entry == null) {
            throw new LinqError(`Unknown function '${name}'.`, expression.span);
        }

        this.checkArity(entry.name, entry.minArgs, entry.maxArgs, expression);
        const args = expression.args.map((arg) => this.compileExpression(arg, stage));
        const span = expression.span;

        return (frame) => {
            const values = args.map((arg) => arg(frame));

            return guard(() => entry.apply(values), span);
        };
    }

    private checkArity(name: string, min: number, max: number, expression: Extract<LinqExpression, { kind: 'call' }>): void {
        const count = expression.args.length;

        if (count < min || count > max) {
            const expected = min === max ? `${min}` : `${min} to ${max}`;
            throw new LinqError(`${name} takes ${expected} argument${max === 1 ? '' : 's'}, not ${count}.`, expression.span);
        }
    }

    private compileAggregate(
        expression: Extract<LinqExpression, { kind: 'call' }>,
        kind: LinqAggregateKind,
        name: string,
        stage: Stage,
    ): Evaluate {
        if (stage.kind === 'row') {
            throw new LinqError(`${name}() works in select, or after group by.`, expression.span);
        }

        if (stage.kind !== 'group') {
            throw new LinqError(`${name}() cannot follow select; put it in the select.`, expression.span);
        }

        if (expression.args.length > 1) {
            throw new LinqError(`${name} takes one value, like ${name}(total).`, expression.span);
        }

        const arg = expression.args[0];
        const element = stage.element;
        const wholeRow = arg == null
            || arg.kind === 'star'
            || (arg.kind === 'identifier' && (sameName(element.rangeVariable, arg.name) || sameName(stage.groupName, arg.name)) && lookupName(element.lets, arg.name) == null);

        if (wholeRow && kind !== 'count') {
            throw new LinqError(`${name} needs a value, like ${name}(${stage.groupName == null ? '' : `${stage.groupName}.`}total).`, expression.span);
        }

        let argument: Evaluate | null = null;

        if (!wholeRow && arg != null) {
            if (containsAggregate(arg)) {
                throw new LinqError(`Aggregates cannot be nested inside ${name}().`, arg.span);
            }

            argument = this.compileExpression(arg, { ...element, elementAlias: stage.groupName });
        }

        const slot = stage.aggregates.length;
        stage.aggregates.push({ kind, name, argument, span: expression.span });

        return (frame) => frame.accumulators?.[slot]?.result(kind) ?? null;
    }

    private compileLike(expression: Extract<LinqExpression, { kind: 'like' }>, stage: Stage): Evaluate {
        const value = this.compileExpression(expression.value, stage);
        const pattern = this.compileExpression(expression.pattern, stage);
        const negated = expression.negated;
        const span = expression.span;
        const likeText = (current: LinqValue): string => {
            if (current instanceof LinqRecord) {
                throw new LinqError(`like needs text, got ${typeName(current)}.`, span);
            }

            return formatValue(current);
        };

        return (frame) => {
            const current = value(frame);
            const wanted = pattern(frame);

            // An empty value never matches, with or without not.
            if (current == null || wanted == null) {
                return false;
            }

            const matched = matchesLike(likeText(current), likeText(wanted));

            return negated ? !matched : matched;
        };
    }

    private compileUnary(expression: Extract<LinqExpression, { kind: 'unary' }>, stage: Stage): Evaluate {
        const operand = this.compileExpression(expression.operand, stage);
        const span = expression.span;

        if (expression.operator === '!') {
            return (frame) => {
                const value = operand(frame);

                return value == null ? null : !isTrue(value, "'!'", span);
            };
        }

        return (frame) => {
            const value = guard(() => requireNumber(operand(frame), "'-'"), span);

            return value == null ? null : -value;
        };
    }

    private compileBinary(expression: Extract<LinqExpression, { kind: 'binary' }>, stage: Stage): Evaluate {
        const left = this.compileExpression(expression.left, stage);
        const right = this.compileExpression(expression.right, stage);
        const span = expression.span;
        const leftSpan = expression.left.span;
        const rightSpan = expression.right.span;

        switch (expression.operator) {
            case '&&':
                return (frame) => isTrue(left(frame), "'&&'", leftSpan) && isTrue(right(frame), "'&&'", rightSpan);
            case '||':
                return (frame) => isTrue(left(frame), "'||'", leftSpan) || isTrue(right(frame), "'||'", rightSpan);
            case '??':
                return (frame) => left(frame) ?? right(frame);
            default: {
                const operation = BINARY_OPERATIONS[expression.operator] as BinaryOperation;

                return (frame) => guard(() => operation(left(frame), right(frame)), span);
            }
        }
    }
}

function readProperty(property: (typeof LINQ_PROPERTIES)[number], value: LinqValue): LinqValue {
    if (property.receiver === 'date' && !(value instanceof LinqDate)) {
        const parsed = typeof value === 'string' ? parseDateText(value) : null;

        if (parsed == null) {
            throw new LinqTypeError(`${property.name} needs a date, got ${typeName(value)} '${formatValue(value)}'.`);
        }

        return property.read(parsed);
    }

    if (!receiverMatches(property.receiver, value)) {
        throw new LinqTypeError(`${property.name} does not work on ${typeName(value)}.`);
    }

    return property.read(value);
}

function uniqueNames(names: ReadonlyArray<string>): string[] {
    const seen = new Map<string, number>();

    return names.map((name) => {
        const base = name === '' ? 'Column' : name;
        const lower = base.toLowerCase();
        const count = (seen.get(lower) ?? 0) + 1;
        seen.set(lower, count);

        return count === 1 ? base : `${base} ${count}`;
    });
}

function estimateFrameBytes(frame: Frame): number {
    let bytes = FRAME_OVERHEAD_BYTES;

    for (const cell of frame.cells ?? []) {
        bytes += estimateValueBytes(cell);
    }

    for (const value of frame.values ?? []) {
        bytes += estimateValueBytes(value);
    }

    for (const value of frame.lets) {
        bytes += estimateValueBytes(value);
    }

    return bytes + estimateValueBytes(frame.key);
}

function frameKey(frame: Frame): string {
    if (frame.values != null) {
        return valueKey(new LinqRecord([], frame.values));
    }

    if (frame.cells != null) {
        return frame.cells.map((cell) => (cell == null ? '' : String(cell)).replace(/[\\\u0001]/g, '\\$&')).join('\u0001');
    }

    return valueKey(frame.key);
}

function* inBatches(frames: ReadonlyArray<Frame>): Generator<Frame[]> {
    for (let start = 0; start < frames.length; start += OUTPUT_BATCH_FRAMES) {
        yield frames.slice(start, start + OUTPUT_BATCH_FRAMES);
    }
}

function mapBatches(transform: (frames: Frame[]) => Frame[]): Operator {
    return async function* (input) {
        for await (const batch of input) {
            const next = transform(batch);

            if (next.length > 0) {
                yield next;
            }
        }
    };
}

function groupOperator(stage: GroupStage, key: Evaluate, span: LinqSpan): Operator {
    return async function* (input, context) {
        const groups = new Map<string, Frame>();
        const create = (value: LinqValue): Frame => ({
            cells: null,
            key: value,
            accumulators: stage.aggregates.map(() => new Accumulator()),
            values: null,
            lets: [],
        });

        if (stage.implicit) {
            groups.set('', create(null));
        }

        for await (const batch of input) {
            for (const frame of batch) {
                const value = stage.implicit ? null : key(frame);
                const id = stage.implicit ? '' : valueKey(value);
                let group = groups.get(id);

                if (group == null) {
                    group = create(value);
                    context.budget.add(FRAME_OVERHEAD_BYTES + id.length * 2 + estimateValueBytes(value) + stage.aggregates.length * 48, span, 'group');
                    groups.set(id, group);
                }

                const accumulators = group.accumulators as Accumulator[];

                for (let index = 0; index < stage.aggregates.length; index += 1) {
                    (accumulators[index] as Accumulator).feed(stage.aggregates[index] as AggregateSpec, frame);
                }
            }
        }

        yield* inBatches([...groups.values()]);
    };
}

function distinctOperator(span: LinqSpan): Operator {
    return async function* (input, context) {
        const seen = new Set<string>();

        for await (const batch of input) {
            const fresh: Frame[] = [];

            for (const frame of batch) {
                const id = frameKey(frame);

                if (!seen.has(id)) {
                    seen.add(id);
                    context.budget.add(32 + id.length * 2, span, 'find distinct rows');
                    fresh.push(frame);
                }
            }

            if (fresh.length > 0) {
                yield fresh;
            }
        }
    };
}

function skipOperator(count: number): Operator {
    return async function* (input) {
        let remaining = count;

        for await (const batch of input) {
            if (remaining >= batch.length) {
                remaining -= batch.length;
                continue;
            }

            yield remaining === 0 ? batch : batch.slice(remaining);
            remaining = 0;
        }
    };
}

// Stops pulling, and so stops reading the file, once enough rows have passed.
function takeOperator(count: number): Operator {
    return async function* (input, context) {
        let remaining = count;

        if (remaining === 0) {
            return;
        }

        for await (const batch of input) {
            if (context.signal?.aborted === true) {
                throw createAbortError();
            }

            if (batch.length >= remaining) {
                yield batch.slice(0, remaining);

                return;
            }

            remaining -= batch.length;
            yield batch;
        }
    };
}
