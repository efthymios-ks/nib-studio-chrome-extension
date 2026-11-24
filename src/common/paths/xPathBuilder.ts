import type { XPathSegment } from './xPath.js';

// Builds XPath strings, with steps `name`, `name[n]` for a repeated sibling, `@name` and `text()`,
// from the segments the XML tree records while rendering.
export type XPathIndexChoice =
    | { kind: 'specific'; position: number }
    | { kind: 'any' }
    | { kind: 'byAttribute'; name: string; value: string };

// One question per repeated element step: specific index / any / by-attribute.
export interface XPathElementStep {
    readonly segmentIndex: number;
    readonly name: string;
    readonly position: number;
    readonly count: number;
}

function steps(segments: ReadonlyArray<XPathSegment>): XPathElementStep[] {
    const result: XPathElementStep[] = [];
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment?.kind === 'element' && segment.count > 1) {
            result.push({
                segmentIndex: index,
                name: segment.name,
                position: segment.position,
                count: segment.count,
            });
        }
    }

    return result;
}

function of(
    segments: ReadonlyArray<XPathSegment>,
    choices?: ReadonlyMap<number, XPathIndexChoice>,
): string {
    let path = '';

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment == null) {
            continue;
        }

        if (segment.kind === 'attribute') {
            path += `/@${segment.name}`;
            continue;
        }

        if (segment.kind === 'text') {
            path += '/text()';
            continue;
        }

        const choice = choices?.get(index);

        if (segment.count === 1 && choice == null) {
            path += `/${segment.name}`;
            continue;
        }

        if (choice?.kind === 'any') {
            path += `/${segment.name}`;
            continue;
        }

        if (choice?.kind === 'byAttribute') {
            path += `/${segment.name}[@${choice.name}='${escapeAttributeValue(choice.value)}']`;
            continue;
        }

        const position = choice?.kind === 'specific' ? choice.position : segment.position;
        path += `/${segment.name}[${position}]`;
    }

    return path;
}

function anyItemsOf(segments: ReadonlyArray<XPathSegment>): string {
    let path = '';

    for (const segment of segments) {
        if (segment.kind === 'attribute') {
            path += `/@${segment.name}`;
            continue;
        }

        if (segment.kind === 'text') {
            path += '/text()';
            continue;
        }

        path += `/${segment.name}`;
    }

    return path;
}

// The matchBy or sortBy field a click names under a repeated element: `@attribute`, `child`,
// or '' when `clickedSegments` is not `elementSegments` plus one step.
function fieldOf(
    elementSegments: ReadonlyArray<XPathSegment>,
    clickedSegments: ReadonlyArray<XPathSegment>,
): string {
    if (clickedSegments.length !== elementSegments.length + 1) {
        return '';
    }

    for (let index = 0; index < elementSegments.length; index += 1) {
        const elementSegment = elementSegments[index];
        const clickedSegment = clickedSegments[index];
        if (elementSegment == null || clickedSegment == null || elementSegment.kind !== clickedSegment.kind) {
            return '';
        }

        if (elementSegment.kind === 'element' && clickedSegment.kind === 'element' && elementSegment.name !== clickedSegment.name) {
            return '';
        }
    }

    const tail = clickedSegments[clickedSegments.length - 1];
    if (tail == null) {
        return '';
    }

    if (tail.kind === 'attribute') {
        return `@${tail.name}`;
    }

    if (tail.kind === 'element') {
        return tail.name;
    }

    return '';
}

function escapeAttributeValue(value: string): string {
    if (value.includes("'") && !value.includes('"')) {
        // The grammar accepts either quote style; swap to avoid escaping.
        return value;
    }

    return value.replace(/'/g, '&apos;');
}

export const XPathBuilder = {
    steps,
    of,
    anyItemsOf,
    fieldOf,
};
