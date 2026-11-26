import type { LinqSpan } from './linqErrors.js';

export type LinqBinaryOperator =
    | '||' | '&&' | '??'
    | '==' | '!='
    | '<' | '<=' | '>' | '>='
    | '+' | '-' | '*' | '/' | '%';

export type LinqUnaryOperator = '!' | '-';

export type LinqLiteralValue = number | string | boolean | null;

export type LinqExpression =
    | { readonly kind: 'literal'; readonly value: LinqLiteralValue; readonly span: LinqSpan }
    | { readonly kind: 'identifier'; readonly name: string; readonly span: LinqSpan }
    | { readonly kind: 'star'; readonly span: LinqSpan }
    | { readonly kind: 'member'; readonly object: LinqExpression; readonly name: string; readonly span: LinqSpan }
    | { readonly kind: 'index'; readonly object: LinqExpression; readonly index: LinqExpression; readonly span: LinqSpan }
    | { readonly kind: 'call'; readonly callee: LinqExpression; readonly args: ReadonlyArray<LinqExpression>; readonly span: LinqSpan }
    | { readonly kind: 'unary'; readonly operator: LinqUnaryOperator; readonly operand: LinqExpression; readonly span: LinqSpan }
    | {
        readonly kind: 'binary';
        readonly operator: LinqBinaryOperator;
        readonly left: LinqExpression;
        readonly right: LinqExpression;
        readonly span: LinqSpan;
    }
    | {
        readonly kind: 'conditional';
        readonly test: LinqExpression;
        readonly whenTrue: LinqExpression;
        readonly whenFalse: LinqExpression;
        readonly span: LinqSpan;
    }
    | { readonly kind: 'object'; readonly members: ReadonlyArray<LinqSelectItem>; readonly span: LinqSpan }
    // `value [not] like pattern`, with SQL wildcards.
    | {
        readonly kind: 'like';
        readonly value: LinqExpression;
        readonly pattern: LinqExpression;
        readonly negated: boolean;
        readonly span: LinqSpan;
    }
    // `value [not] in (a, b, …)`.
    | {
        readonly kind: 'in';
        readonly value: LinqExpression;
        readonly items: ReadonlyArray<LinqExpression>;
        readonly negated: boolean;
        readonly span: LinqSpan;
    }
    // `value [not] between low and high`, inclusive.
    | {
        readonly kind: 'between';
        readonly value: LinqExpression;
        readonly low: LinqExpression;
        readonly high: LinqExpression;
        readonly negated: boolean;
        readonly span: LinqSpan;
    }
    // `value is [not] null`.
    | { readonly kind: 'isNull'; readonly value: LinqExpression; readonly negated: boolean; readonly span: LinqSpan };

export interface LinqSelectItem {
    // The alias written as `Name = expr` or `expr as Name`; null to infer one.
    readonly alias: string | null;
    readonly expression: LinqExpression;
    readonly span: LinqSpan;
}

export interface LinqOrderKey {
    readonly expression: LinqExpression;
    readonly descending: boolean;
}

export type LinqClause =
    | { readonly kind: 'where'; readonly condition: LinqExpression; readonly span: LinqSpan }
    | { readonly kind: 'let'; readonly name: string; readonly value: LinqExpression; readonly span: LinqSpan }
    | { readonly kind: 'orderby'; readonly keys: ReadonlyArray<LinqOrderKey>; readonly span: LinqSpan }
    | {
        readonly kind: 'group';
        // The name written in `group row by …`, or null for `group by …`.
        readonly element: string | null;
        readonly key: LinqExpression;
        readonly into: string | null;
        readonly span: LinqSpan;
    }
    | {
        readonly kind: 'select';
        readonly items: ReadonlyArray<LinqSelectItem>;
        // True for `select new { … }`, false for a plain list.
        readonly object: boolean;
        readonly span: LinqSpan;
    }
    | { readonly kind: 'distinct'; readonly span: LinqSpan }
    | { readonly kind: 'skip'; readonly count: LinqExpression; readonly span: LinqSpan }
    | { readonly kind: 'take'; readonly count: LinqExpression; readonly span: LinqSpan };

// The table a query reads: the open table, written `*` or `table`, or a sheet of a workbook named as in `from Q2`.
export interface LinqSourceRef {
    // The sheet's name as written, without its quotes or brackets; null for the open table.
    readonly sheet: string | null;
    readonly span: LinqSpan;
}

export interface LinqQuery {
    // The range variable of `from x in table`, or null for `from *`.
    readonly rangeVariable: string | null;
    readonly source: LinqSourceRef;
    readonly clauses: ReadonlyArray<LinqClause>;
    readonly span: LinqSpan;
}
