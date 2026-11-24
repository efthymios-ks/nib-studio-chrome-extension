import { describe, expect, it } from 'vitest';
import { buildContextMenu, compareViewForPair, type Command, type CommandContext } from './commands.js';

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
    return {
        surface: 'tree',
        selectedPaths: [],
        activeTabPath: null,
        openPaths: [],
        dirtyPaths: [],
        workspaceOpen: true,
        clipboardAvailable: true,
        isFile: () => true,
        isDirectory: () => false,
        isText: () => true,
        isJson: () => false,
        isXml: () => false,
        fileTypeId: () => 'text',
        getOpenFileText: () => null,
        ...overrides,
    };
}

describe('buildContextMenu', () => {
    it('filters commands by surface', () => {
        const calls: string[] = [];
        const commands: Command[] = [
            {
                id: 'tree-only',
                label: 'Tree only',
                appearsIn: 'tree',
                group: 1,
                enabledWhen: () => true,
                run: () => calls.push('tree-only'),
            },
            {
                id: 'tab-only',
                label: 'Tab only',
                appearsIn: 'tab',
                group: 1,
                enabledWhen: () => true,
                run: () => calls.push('tab-only'),
            },
            {
                id: 'both',
                label: 'Both',
                appearsIn: 'both',
                group: 1,
                enabledWhen: () => true,
                run: () => calls.push('both'),
            },
        ];

        const treeMenu = buildContextMenu(commands, makeContext({ surface: 'tree' }), 'tree');
        const tabMenu = buildContextMenu(commands, makeContext({ surface: 'tab' }), 'tab');

        expect(treeMenu[0]?.items.map((item) => item.label)).toEqual(['Tree only', 'Both']);
        expect(tabMenu[0]?.items.map((item) => item.label)).toEqual(['Tab only', 'Both']);
    });

    it('groups commands by their group number and sorts groups ascending', () => {
        const commands: Command[] = [
            {
                id: 'c',
                label: 'C',
                appearsIn: 'both',
                group: 3,
                enabledWhen: () => true,
                run: () => {},
            },
            {
                id: 'a',
                label: 'A',
                appearsIn: 'both',
                group: 1,
                enabledWhen: () => true,
                run: () => {},
            },
            {
                id: 'b',
                label: 'B',
                appearsIn: 'both',
                group: 1,
                enabledWhen: () => true,
                run: () => {},
            },
        ];
        const menu = buildContextMenu(commands, makeContext(), 'tree');

        expect(menu).toHaveLength(2);
        expect(menu[0]?.items.map((item) => item.label)).toEqual(['A', 'B']);
        expect(menu[1]?.items.map((item) => item.label)).toEqual(['C']);
    });

    it('leaves out commands that do not apply instead of greying them out', () => {
        const commands: Command[] = [
            {
                id: 'always',
                label: 'Always',
                appearsIn: 'tree',
                group: 1,
                enabledWhen: () => true,
                run: () => {},
            },
            {
                id: 'never',
                label: 'Never',
                appearsIn: 'tree',
                group: 1,
                enabledWhen: () => false,
                run: () => {},
            },
        ];
        const menu = buildContextMenu(commands, makeContext(), 'tree');

        expect(menu[0]?.items.map((item) => item.label)).toEqual(['Always']);
    });

    it('lists only the children that apply under their header, and leaves the header out when none do', () => {
        const children = [
            { id: 'cmp-clipboard', label: 'Clipboard', enabledWhen: () => false, run: () => {} },
            { id: 'cmp-file', label: 'Choose file…', run: () => {} },
        ];
        const compare = (childList: typeof children): Command => ({
            id: 'compare',
            label: 'Compare with…',
            appearsIn: 'tree',
            group: 2,
            enabledWhen: () => true,
            run: () => {},
            children: () => childList,
        });

        const menu = buildContextMenu([compare(children)], makeContext(), 'tree');

        expect(menu[0]?.items.map((item) => item.label)).toEqual(['Compare with…', '  Choose file…']);
        expect(menu[0]?.items[0]?.header).toBe(true);
        expect(buildContextMenu([compare([children[0]!])], makeContext(), 'tree')).toEqual([]);
    });

    it('expands child commands into the surrounding group', () => {
        const compareChildren = [
            { id: 'cmp-a', label: 'Clipboard', run: () => {} },
            { id: 'cmp-b', label: 'Choose file…', run: () => {} },
        ];
        const commands: Command[] = [
            {
                id: 'compare',
                label: 'Compare with…',
                appearsIn: 'tree',
                group: 2,
                enabledWhen: () => true,
                run: () => {},
                children: () => compareChildren,
            },
        ];
        const menu = buildContextMenu(commands, makeContext(), 'tree');

        expect(menu[0]?.items.map((item) => item.label)).toEqual([
            'Compare with…',
            '  Clipboard',
            '  Choose file…',
        ]);
    });

    it('invokes run when an item is picked', () => {
        const calls: string[] = [];
        const commands: Command[] = [
            {
                id: 'open',
                label: 'Open',
                appearsIn: 'tree',
                group: 1,
                enabledWhen: () => true,
                run: () => calls.push('open'),
            },
        ];
        const menu = buildContextMenu(commands, makeContext(), 'tree');
        menu[0]?.items[0]?.onSelect();

        expect(calls).toEqual(['open']);
    });
});

describe('multi-selection menu', () => {
    const pairContext = (paths: string[], typeIds: Record<string, string>): CommandContext => ({
        ...makeContext({ selectedPaths: paths }),
        isFile: () => true,
        isText: () => true,
        fileTypeId: (path) => typeIds[path] ?? 'text',
    });

    it('offers a compare for two files of the same type', () => {
        const context = pairContext(['a.json', 'b.json'], { 'a.json': 'json', 'b.json': 'json' });

        expect(compareViewForPair(context)).toBe('diff');
    });

    it('uses the row diff for two CSV files', () => {
        const context = pairContext(['a.csv', 'b.csv'], { 'a.csv': 'csv', 'b.csv': 'csv' });

        expect(compareViewForPair(context)).toBe('row-diff');
    });

    it('offers nothing for files of different types', () => {
        const context = pairContext(['a.json', 'b.xml'], { 'a.json': 'json', 'b.xml': 'xml' });

        expect(compareViewForPair(context)).toBeNull();
    });

    it('shows only multi-selection commands when several items are selected', () => {
        const commands: Command[] = [
            { id: 'single', label: 'Single', appearsIn: 'tree', group: 1, enabledWhen: () => true, run: () => {} },
            { id: 'many', label: 'Many', appearsIn: 'tree', group: 1, multiSelect: true, enabledWhen: () => true, run: () => {} },
        ];
        const menu = buildContextMenu(commands, makeContext({ selectedPaths: ['a', 'b'] }), 'tree');

        expect(menu.flatMap((group) => group.items.map((item) => item.label))).toEqual(['Many']);
    });
});
