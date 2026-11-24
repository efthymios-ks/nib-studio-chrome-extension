// Builds JSONPath strings from the segments the JSON tree records while rendering,
// so copied paths round-trip through the evaluator without parsing display text.
export type JsonPathSegment = string | number;
export type JsonIndexChoice = number | 'any';

// A single step the UI must resolve when the user picks an array.
// `count` is the total number of items in the clicked array.
// `clickedIndex` is the item the user originally selected.
export interface JsonArrayStep {
    readonly segmentIndex: number;
    readonly clickedIndex: number;
    readonly count: number;
}

function root(): string {
    return '$';
}

function member(path: string, key: string): string {
    if (isSafeIdentifier(key)) {
        return `${path}.${key}`;
    }

    return `${path}${bracketMember(key)}`;
}

function index(path: string, position: number): string {
    return `${path}[${position}]`;
}

function anyItem(path: string): string {
    return `${path}[*]`;
}

// Walk the clicked segments and return one `JsonArrayStep`
// per repeated-array crossing so the UI can ask the user
// "specific index or any item?" per step.
function indexSteps(segments: ReadonlyArray<JsonPathSegment>): JsonArrayStep[] {
    const steps: JsonArrayStep[] = [];

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];

        if (typeof segment === 'number') {
            steps.push({
                segmentIndex,
                clickedIndex: segment,
                count: segment + 1,
            });
        }
    }

    return steps;
}

// Build the final JSONPath. Supply `choices` to override each
// numeric segment ("any" → `[*]`); missing choices default to the
// clicked index.
function of(
    segments: ReadonlyArray<JsonPathSegment>,
    choices?: ReadonlyMap<number, JsonIndexChoice>,
): string {
    let path = root();

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];

        if (segment == null) {
            continue;
        }

        if (typeof segment === 'string') {
            path = member(path, segment);
            continue;
        }

        const choice = choices?.get(segmentIndex);

        if (choice === 'any') {
            path = anyItem(path);
            continue;
        }

        const position = typeof choice === 'number' ? choice : segment;
        path = index(path, position);
    }

    return path;
}

// Build a JSONPath where every numeric segment is replaced with `[*]`.
// Used by compare rules that target "all items at this depth".
function anyItemsOf(segments: ReadonlyArray<JsonPathSegment>): string {
    let path = root();

    for (const segment of segments) {
        if (typeof segment === 'string') {
            path = member(path, segment);
        }
        else {
            path = anyItem(path);
        }
    }

    return path;
}

// The dot-path from an array item down to the clicked field, as a `matchBy` or `sortBy` field;
// a key that contains a dot doesn't round-trip.
function fieldOf(
    elementSegments: ReadonlyArray<JsonPathSegment>,
    clickedSegments: ReadonlyArray<JsonPathSegment>,
): string {
    if (clickedSegments.length <= elementSegments.length) {
        return '';
    }

    for (let index = 0; index < elementSegments.length; index += 1) {
        if (clickedSegments[index] !== elementSegments[index]) {
            return '';
        }
    }

    const tail = clickedSegments.slice(elementSegments.length);
    const parts: string[] = [];

    for (const segment of tail) {
        if (typeof segment === 'string') {
            parts.push(segment);
        }
    }

    return parts.join('.');
}

function isSafeIdentifier(key: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function bracketMember(key: string): string {
    // When the key contains a double quote, emit single-quoted form so
    // the evaluator's unescape rules stay consistent on both sides.
    if (key.includes('"') && !key.includes("'")) {
        return `['${key}']`;
    }

    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return `["${escaped}"]`;
}

export const JsonPathBuilder = {
    root,
    member,
    index,
    anyItem,
    indexSteps,
    of,
    anyItemsOf,
    fieldOf,
};
