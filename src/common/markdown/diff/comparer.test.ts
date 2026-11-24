import { describe, expect, it } from 'vitest';

import { compareMarkdown } from './comparer.js';
import type { ChangeRecord } from './types.js';

const changesOf = (markdown: [string, string]): ChangeRecord[] => {
    const [original, modified] = markdown;
    const diff = compareMarkdown(original, modified, { includeUnchanged: true });

    return diff.changes;
};

const onlyChanged = (markdown: [string, string]): ChangeRecord[] => {
    const [original, modified] = markdown;
    const diff = compareMarkdown(original, modified);

    return diff.changes;
};

describe('compareMarkdown — segmentation and alignment', () => {
    it('reports every segment Unchanged when inputs are identical', () => {
        const source = '# Title\n\nA paragraph of prose.\n\n- a list item\n- another item\n';
        const diff = compareMarkdown(source, source, { includeUnchanged: true });

        expect(diff.changes.length).toBeGreaterThan(0);
        for (const change of diff.changes) {
            expect(change.status).toBe('Unchanged');
        }

        expect(diff.summary.added).toBe(0);
        expect(diff.summary.removed).toBe(0);
        expect(diff.summary.modified).toBe(0);
    });

    it('produces a single Modified change with inline runs for a tweaked paragraph', () => {
        const original = 'The quick brown fox jumps over the lazy dog.';
        const modified = 'The quick brown fox leaps over the lazy dog.';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        expect(changes[0]!.status).toBe('Modified');
        expect(changes[0]!.inline).not.toBeNull();
        const text = (changes[0]!.inline ?? []).map((run) => `${run.op}:${run.text}`).join('|');
        expect(text).toContain('Removed');
        expect(text).toContain('Added');
    });

    it('reports a pure paragraph addition', () => {
        const original = '# Title\n\nFirst paragraph.\n';
        const modified = '# Title\n\nFirst paragraph.\n\nSecond paragraph added.\n';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        expect(changes[0]!.status).toBe('Added');
        expect(changes[0]!.modified?.text).toContain('Second paragraph added');
    });

    it('reports a pure paragraph removal', () => {
        const original = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
        const modified = '# Title\n\nFirst paragraph.\n';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        expect(changes[0]!.status).toBe('Removed');
        expect(changes[0]!.original?.text).toContain('Second paragraph');
    });

    it('turns a heavily rewritten sentence into a single removed + added pair', () => {
        const original = 'This sentence is written in a very particular older style of English prose.';
        const modified = 'Totally reworked clause, every single word swapped for something new, nothing kept.';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        expect(changes[0]!.status).toBe('Modified');
        const runs = changes[0]!.inline ?? [];
        const removed = runs.filter((run) => run.op === 'Removed');
        const added = runs.filter((run) => run.op === 'Added');
        expect(removed.length).toBeLessThanOrEqual(2);
        expect(added.length).toBeLessThanOrEqual(2);
        // The old text should have gone wholesale into the removed run.
        expect(removed.map((run) => run.text).join(' ')).toContain('older style');
        expect(added.map((run) => run.text).join(' ')).toContain('Totally reworked');
    });

    it('produces a cell-level TableDiff on a changed table', () => {
        const original = [
            '| Name | Role |',
            '|------|------|',
            '| Alice | lead |',
            '| Bob | junior |',
            '',
        ].join('\n');
        const modified = [
            '| Name | Role |',
            '|------|------|',
            '| Alice | lead |',
            '| Bob | senior |',
            '',
        ].join('\n');
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        const change = changes[0]!;
        expect(change.status).toBe('Modified');
        expect(change.type).toBe('Table');
        expect(change.tableDiff).not.toBeNull();

        const rows = change.tableDiff!.rows;
        const bobRow = rows.find((row) => row.cells.some((cell) => /Bob/.test(cell.modified)));
        expect(bobRow).toBeDefined();
        const changedCell = bobRow!.cells.find((cell) => cell.status === 'Modified');
        expect(changedCell).toBeDefined();
        expect(changedCell!.inline).not.toBeNull();
    });

    it('diffs a fenced code change line by line', () => {
        const original = '```ts\nconst x = 1;\nconst y = 2;\nconst z = 3;\n```\n';
        const modified = '```ts\nconst x = 1;\nconst y = 42;\nconst z = 3;\n```\n';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        const change = changes[0]!;
        expect(change.status).toBe('Modified');
        expect(change.type).toBe('Code');
        expect(change.inlineKind).toBe('Line');

        const lineOps = change.inline ?? [];
        expect(lineOps.some((op) => op.op === 'Added' && /42/.test(op.text))).toBe(true);
        expect(lineOps.some((op) => op.op === 'Removed' && /y = 2/.test(op.text))).toBe(true);
    });

    it('detects a changed mermaid diagram as Modified', () => {
        const original = '```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '```mermaid\ngraph TD\nA --> C\n```\n';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        const change = changes[0]!;
        expect(change.status).toBe('Modified');
        expect(change.type).toBe('Mermaid');
        expect(change.atomic).toBe(true);
    });

    it('detects an added mermaid diagram', () => {
        const original = '# Title\n\nSome prose.\n';
        const modified = '# Title\n\nSome prose.\n\n```mermaid\ngraph TD\nA --> B\n```\n';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        expect(changes[0]!.status).toBe('Added');
        expect(changes[0]!.type).toBe('Mermaid');
    });

    it('detects a removed mermaid diagram', () => {
        const original = '# Title\n\nSome prose.\n\n```mermaid\ngraph TD\nA --> B\n```\n';
        const modified = '# Title\n\nSome prose.\n';
        const changes = onlyChanged([original, modified]);

        expect(changes.length).toBe(1);
        expect(changes[0]!.status).toBe('Removed');
        expect(changes[0]!.type).toBe('Mermaid');
    });

    it('detects a changed front matter block', () => {
        const original = '---\ntitle: old\n---\n\n# Body\n';
        const modified = '---\ntitle: new\n---\n\n# Body\n';
        const changes = onlyChanged([original, modified]);

        const frontMatterChange = changes.find((change) => change.type === 'FrontMatter');
        expect(frontMatterChange).toBeDefined();
        expect(frontMatterChange!.status).toBe('Modified');
    });

    it('uses the heading path to prefer pairing atomic blocks under the same heading', () => {
        const original = [
            '# A',
            '',
            '```mermaid',
            'graph TD',
            'X --> Y',
            '```',
            '',
            '# B',
            '',
            '```mermaid',
            'graph TD',
            'P --> Q',
            '```',
            '',
        ].join('\n');

        // Under heading B, change the diagram; under A keep it the same.
        // The sole-under-heading rule should pair B-old with B-new as Modified.
        const modified = [
            '# A',
            '',
            '```mermaid',
            'graph TD',
            'X --> Y',
            '```',
            '',
            '# B',
            '',
            '```mermaid',
            'graph TD',
            'P --> Z',
            '```',
            '',
        ].join('\n');

        const changes = onlyChanged([original, modified]);
        const diagramChanges = changes.filter((change) => change.type === 'Mermaid');

        // Only one of the two diagrams should show up — modified — and the one under heading B.
        expect(diagramChanges.length).toBe(1);
        expect(diagramChanges[0]!.status).toBe('Modified');
        expect(diagramChanges[0]!.path).toBe('B');
    });

    it('populates the summary counts', () => {
        const original = '# A\n\nParagraph.\n';
        const modified = '# A\n\nTweaked paragraph.\n\nNew one.\n';
        const diff = compareMarkdown(original, modified);

        expect(diff.summary.added).toBe(1);
        expect(diff.summary.modified).toBe(1);
        expect(diff.summary.removed).toBe(0);
    });

    it('preserves the status when includeUnchanged is on', () => {
        const original = '# A\n\nSame.\n';
        const modified = '# A\n\nSame.\n';
        const diff = compareMarkdown(original, modified, { includeUnchanged: true });

        expect(diff.changes.every((change) => change.status === 'Unchanged')).toBe(true);
        expect(changesOf([original, modified]).length).toBeGreaterThan(0);
    });
});
