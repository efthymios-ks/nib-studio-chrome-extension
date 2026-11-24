import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TreeDiffDocument } from '../../common/diff/diffDocument.js';
import { buildJsonDiffDocument } from '../../common/diff/jsonDiffDocument.js';
import type { DiffSide } from '../app/store.js';
import { attachAlignedNavigation, buildAlignedDiffPanel, visibleTreeRows, type AlignedDiffOptions, type AlignedDiffState } from './alignedDiff.js';
import { createDiffNavigationState, type DiffNavigationState } from './diffNavigationBar.js';
import { diffDocumentSide } from './diffSideHeader.js';

const LEFT_SIDE: DiffSide = { label: 'a.json', path: 'a.json', source: 'file' };
const RIGHT_SIDE: DiffSide = { label: 'b.json', path: 'b.json', source: 'file' };
const LEFT = { same: { x: 1 }, changed: { v: 1 }, gone: 1 };
const RIGHT = { same: { x: 1 }, changed: { v: 2 }, added: 2 };

function documentOf(left: unknown = LEFT, right: unknown = RIGHT): TreeDiffDocument {
    return buildJsonDiffDocument({ original: diffDocumentSide(LEFT_SIDE), modified: diffDocumentSide(RIGHT_SIDE), left, right });
}

function stateOf(overrides: Partial<AlignedDiffState> = {}): AlignedDiffState {
    return { expansion: new Map(), reveal: null, ...overrides };
}

function optionsOf(overrides: Partial<AlignedDiffOptions> = {}): AlignedDiffOptions {
    return {
        original: LEFT_SIDE,
        modified: RIGHT_SIDE,
        document: documentOf(),
        state: stateOf(),
        rerender: vi.fn(),
        ...overrides,
    };
}

function cell(panel: HTMLElement, side: 'original' | 'modified', path: string): HTMLElement | undefined {
    return [...panel.querySelectorAll<HTMLElement>(`.aligned-cell[data-side="${side}"]`)].find((candidate) => candidate.dataset['path'] === path);
}

describe('visibleTreeRows', () => {
    it('opens only the branches that lead to a change', () => {
        const rows = visibleTreeRows(documentOf(), stateOf());
        const expanded = new Map(rows.filter((row) => row.node === 'open').map((row) => [row.id, row.expanded]));

        expect(expanded.get('$')).toBe(true);
        expect(expanded.get('$.changed')).toBe(true);
        expect(expanded.get('$.same')).toBe(false);
        expect(rows.map((row) => row.id)).not.toContain('$.same.x');
        expect(rows.map((row) => row.id)).not.toContain('$.same:close');
    });

    it('opens everything when the sides are equal', () => {
        const rows = visibleTreeRows(documentOf({ o: { x: 1 } }, { o: { x: 1 } }), stateOf());

        expect(rows.filter((row) => row.node === 'open').every((row) => row.expanded)).toBe(true);
    });

    it('lets a remembered toggle override the document', () => {
        const rows = visibleTreeRows(documentOf(), stateOf({ expansion: new Map([['$.same', true], ['$.changed', false]]) }));
        const ids = rows.map((row) => row.id);

        expect(ids).toContain('$.same.x');
        expect(ids).not.toContain('$.changed.v');
    });

    it('opens and remembers the parents of a revealed path even when closed', () => {
        const state = stateOf({ expansion: new Map([['$.same', false]]), reveal: { side: 'left', path: '$.same.x' } });
        const rows = visibleTreeRows(documentOf(), state);

        expect(rows.map((row) => row.id)).toContain('$.same.x');
        expect(state.expansion.get('$.same')).toBe(true);
    });
});

describe('buildAlignedDiffPanel', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('renders both side headers above a scrollable tree', () => {
        const panel = buildAlignedDiffPanel(optionsOf());
        const headers = [...panel.querySelectorAll<HTMLElement>('.aligned-headers .diff-side-header')];

        expect(headers.map((header) => header.querySelector('.diff-side-name')?.textContent)).toEqual(['a.json', 'b.json']);
        expect(panel.querySelector<HTMLElement>('.aligned-scroller')?.dataset['scrollKey']).toBe('tree');
        expect(panel.querySelector('.aligned-scroller')?.getAttribute('tabindex')).toBe('0');
    });

    it('marks removed values on the original side and added ones on the modified side', () => {
        const panel = buildAlignedDiffPanel(optionsOf());

        expect(cell(panel, 'original', '$.gone')?.dataset['diff']).toBe('removed');
        expect(cell(panel, 'modified', '$.added')?.dataset['diff']).toBe('added');
        expect(cell(panel, 'original', '$.changed.v')?.dataset['diff']).toBe('changed');
        expect(cell(panel, 'modified', '$.changed.v')?.dataset['diff']).toBe('changed');
        expect(cell(panel, 'original', '$.added')).toBeUndefined();
    });

    it('flips the remembered expansion and redraws when a twist is clicked', () => {
        const options = optionsOf();
        const panel = buildAlignedDiffPanel(options);
        const twist = cell(panel, 'original', '$.same')!.querySelector<HTMLButtonElement>('.aligned-twist')!;

        twist.click();

        expect(twist.getAttribute('aria-expanded')).toBe('false');
        expect(options.state.expansion.get('$.same')).toBe(true);
        expect(options.rerender).toHaveBeenCalledTimes(1);
    });

    it('passes the rule path of a clicked array to the array handler', () => {
        const onArrayClick = vi.fn();
        const panel = buildAlignedDiffPanel(optionsOf({ document: documentOf({ list: [1] }, { list: [2] }), onArrayClick }));

        cell(panel, 'original', '$.list')!.querySelector<HTMLElement>('[data-clickable="true"]')!.click();

        expect(onArrayClick).toHaveBeenCalledWith('$.list[*]');
    });

    it('opens the parents of a revealed path once, then forgets the reveal', () => {
        const state = stateOf({ expansion: new Map([['$.same', false]]), reveal: { side: 'left', path: '$.same.x' } });
        const panel = buildAlignedDiffPanel(optionsOf({ state }));

        expect(cell(panel, 'original', '$.same.x')).toBeDefined();
        expect(state.reveal).toBeNull();
        expect(state.expansion.get('$.same')).toBe(true);
    });

    it('marks rows only one side has, for Before and After to leave out', () => {
        const panel = buildAlignedDiffPanel(optionsOf());
        const only = (path: string, side: 'original' | 'modified'): string | undefined => cell(panel, side, path)?.closest<HTMLElement>('.aligned-row')?.dataset['only'];

        expect(only('$.gone', 'original')).toBe('original');
        expect(only('$.added', 'modified')).toBe('modified');
        expect(only('$.changed', 'original')).toBeUndefined();
    });
});

describe('attachAlignedNavigation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    interface Setup {
        readonly panel: HTMLElement;
        readonly state: AlignedDiffState & { navigation: DiffNavigationState };
        readonly rerender: ReturnType<typeof vi.fn>;
    }

    function setUp(expansion = new Map<string, boolean>()): Setup {
        const state = { ...stateOf({ expansion }), navigation: createDiffNavigationState() };
        const rerender = vi.fn();
        const options = optionsOf({ state });
        const panel = buildAlignedDiffPanel(options);
        document.body.append(panel);
        attachAlignedNavigation({ panel, document: options.document, keyScope: panel, state, rerender, onRecompute: vi.fn() });

        return { panel, state, rerender };
    }

    it('steps through the changes from top to bottom as the grid orders them, and flashes the row of each', () => {
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        const { panel, state } = setUp();
        const next = (): void => panel.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();

        next();
        expect(state.navigation.current).toBe('added');
        expect(cell(panel, 'modified', '$.added')?.closest<HTMLElement>('.aligned-row')?.dataset['flash']).toBe('true');
        next();
        expect(state.navigation.current).toBe('changed.v');
        next();
        expect(state.navigation.current).toBe('gone');
    });

    it('asks for a redraw with the reveal set when the row is inside a closed node', () => {
        const { panel, state, rerender } = setUp(new Map([['$.changed', false]]));
        state.navigation.current = 'added';
        state.navigation.movedAt = Date.now();

        panel.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();

        expect(rerender).toHaveBeenCalledTimes(1);
        expect(state.reveal).toEqual({ side: 'left', path: '$.changed.v' });
        expect(state.navigation).toMatchObject({ current: 'changed.v', reveal: true });
    });

    it('counts every change in the position and names the current one in its tooltip', () => {
        vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
        const { panel } = setUp();
        const position = panel.querySelector('.diff-bar-position');
        expect(position?.textContent).toBe('– / 3');

        panel.querySelector<HTMLButtonElement>('.diff-bar [data-step="1"]')!.click();

        expect(position?.textContent).toBe('1 / 3');
        expect(position?.getAttribute('title')).toBe('added');
    });
});
