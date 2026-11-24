// @vitest-environment node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import { describe, expect, it } from 'vitest';

const STYLES_PATH = join(dirname(fileURLToPath(import.meta.url)), 'styles.scss');

// Mermaid's default theme draws edges and arrowheads in this colour, whatever the studio's theme.
const MERMAID_LINE_COLOR = '#333333';
const MIN_LINE_CONTRAST = 3;

const DIAGRAM_SELECTORS = [
    '.markdown-preview .md-mermaid svg',
    '.cm-live-mermaid .md-mermaid svg',
    '.cm-live-diagram-panel .md-mermaid svg',
];

interface CssRule {
    readonly selectors: ReadonlyArray<string>;
    readonly declarations: ReadonlyMap<string, string>;
}

function compileRules(): CssRule[] {
    const css = sass.compile(STYLES_PATH, { style: 'expanded' }).css;
    const rules: CssRule[] = [];

    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = (match[1] ?? '').split(',').map((selector) => selector.trim().replace(/\s+/g, ' '));
        const declarations = new Map<string, string>();

        for (const declaration of (match[2] ?? '').split(';')) {
            const colon = declaration.indexOf(':');

            if (colon > 0) {
                declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
            }
        }

        rules.push({ selectors, declarations });
    }

    return rules;
}

function luminance(hex: string): number {
    const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
    const [red, green, blue] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

    return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrastRatio(one: string, two: string): number {
    const [high, low] = [luminance(one), luminance(two)].sort((left, right) => right - left);

    return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe('styles.scss diagrams', () => {
    const rules = compileRules();

    it.each(DIAGRAM_SELECTORS)('draws %s on a fixed light surface that Mermaid\'s lines stand out on', (selector) => {
        const backgrounds = rules
            .filter((rule) => rule.selectors.some((candidate) => candidate.endsWith(selector)))
            .map((rule) => rule.declarations.get('background') ?? rule.declarations.get('background-color'))
            .filter((value): value is string => value != null);

        expect(backgrounds).toHaveLength(1);
        expect(backgrounds[0]).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(MERMAID_LINE_COLOR, backgrounds[0] ?? '')).toBeGreaterThanOrEqual(MIN_LINE_CONTRAST);
    });

    it('gives no theme a diagram surface of its own', () => {
        const themed = rules.filter((rule) => rule.selectors.some((selector) => selector.includes('data-theme') && selector.includes('md-mermaid')));

        expect(themed).toEqual([]);
    });
});
