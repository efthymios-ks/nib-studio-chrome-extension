import type { ContextMenuGroup, ContextMenuItem } from '../explorer/contextMenu.js';

export type CommandSurface = 'tree' | 'tab';
export type CommandAppearance = 'tree' | 'tab' | 'both';
export type CommandTone = 'default' | 'fail';

// What every command predicate and action sees; `surface` is where the menu opened.
export interface CommandContext {
    readonly surface: CommandSurface;
    readonly selectedPaths: ReadonlyArray<string>;
    // The tree row the menu opened over; null over the empty area below the rows, and left out on tabs.
    readonly rowPath?: string | null;
    // The tab the menu opened over; null on the tree.
    readonly activeTabPath: string | null;
    readonly openPaths: ReadonlyArray<string>;
    // Every tab in display order, file paths and diff tab ids; openPaths when left out.
    readonly tabIds?: ReadonlyArray<string>;
    readonly dirtyPaths: ReadonlyArray<string>;
    readonly workspaceOpen: boolean;
    readonly clipboardAvailable: boolean;
    readonly isFile: (path: string) => boolean;
    readonly isDirectory: (path: string) => boolean;
    readonly isText: (path: string) => boolean;
    readonly isJson: (path: string) => boolean;
    readonly isXml: (path: string) => boolean;
    readonly fileTypeId: (path: string) => string;
    // In-memory text of a tab that is open, or null when the path has no tab.
    // Lets "Compare with open tab" skip a disk read.
    readonly getOpenFileText: (path: string) => string | null;
}

export interface Command {
    readonly id: string;
    readonly label: string;
    readonly shortcut?: string;
    readonly appearsIn: CommandAppearance;
    readonly tone?: CommandTone;
    // Group number: commands with the same number sit together, separated from
    // other groups by a divider. Lower numbers render first.
    readonly group: number;
    readonly enabledWhen: (context: CommandContext) => boolean;
    // Hides the command whatever enabledWhen says; enabledWhen hides it too, as menus never grey items out.
    readonly visibleWhen?: (context: CommandContext) => boolean;
    // Commands that act on every selected item; only these show when the tree
    // menu opens over more than one selected item.
    readonly multiSelect?: boolean;
    readonly run: (context: CommandContext) => void;
    // Optional sub-items for "Compare with…" style submenus, rendered as a flat
    // section under a header that can't be picked.
    readonly children?: (context: CommandContext) => ReadonlyArray<SubCommand>;
}

export interface SubCommand {
    readonly id: string;
    readonly label: string;
    readonly enabledWhen?: (context: CommandContext) => boolean;
    readonly run: (context: CommandContext) => void;
}

// A command with children shows as a header with its entries under it, as "Compare with…" does.
export function buildContextMenu(
    commands: ReadonlyArray<Command>,
    context: CommandContext,
    surface: CommandSurface,
): ReadonlyArray<ContextMenuGroup> {
    const buckets = new Map<number, ContextMenuItem[]>();

    for (const command of commands) {
        if (!matchesSurface(command.appearsIn, surface)) {
            continue;
        }

        if (surface === 'tree' && context.selectedPaths.length > 1 && command.multiSelect !== true) {
            continue;
        }

        if (command.visibleWhen != null && !command.visibleWhen(context)) {
            continue;
        }

        // A command that doesn't apply is left out, not greyed out.
        if (!command.enabledWhen(context)) {
            continue;
        }

        const items = ensureBucket(buckets, command.group);

        if (command.children == null) {
            items.push({
                label: command.label,
                shortcut: command.shortcut,
                tone: command.tone,
                onSelect: () => command.run(context),
            });

            continue;
        }

        const children = command.children(context).filter((child) => child.enabledWhen?.(context) ?? true);

        if (children.length === 0) {
            continue;
        }

        items.push({ label: command.label, header: true, onSelect: () => {} });

        for (const child of children) {
            items.push({
                label: `  ${child.label}`,
                onSelect: () => child.run(context),
            });
        }
    }

    const sortedGroups = [...buckets.entries()].sort((left, right) => left[0] - right[0]);

    return sortedGroups
        .map(([, items]) => ({ items }))
        .filter((group) => group.items.length > 0);
}

function matchesSurface(appears: CommandAppearance, surface: CommandSurface): boolean {
    if (appears === 'both') {
        return true;
    }

    return appears === surface;
}

function ensureBucket(buckets: Map<number, ContextMenuItem[]>, group: number): ContextMenuItem[] {
    const existing = buckets.get(group);

    if (existing != null) {
        return existing;
    }

    const next: ContextMenuItem[] = [];
    buckets.set(group, next);

    return next;
}

export type CompareView = 'diff' | 'row-diff';

// How two files of a type are compared, or null when the type has no compare view.
// Excel workbooks need the raw file rather than text, so a two-file compare leaves them out.
function compareViewFor(fileTypeId: string, isText: boolean): CompareView | null {
    if (fileTypeId === 'csv') {
        return 'row-diff';
    }

    return isText ? 'diff' : null;
}

// The view that compares exactly two selected files, when both are files of the same comparable type.
export function compareViewForPair(context: CommandContext): CompareView | null {
    if (context.selectedPaths.length !== 2) {
        return null;
    }

    const [first, second] = context.selectedPaths as [string, string];

    if (!context.isFile(first) || !context.isFile(second)) {
        return null;
    }

    const typeId = context.fileTypeId(first);

    if (typeId !== context.fileTypeId(second)) {
        return null;
    }

    return compareViewFor(typeId, context.isText(first));
}
