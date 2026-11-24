import { entryExistsAsync, readFileAsync, writeFileAsync } from './fileIo.js';

export const WORKSPACE_CONFIG_PATH = '.nib-studio-configuration.json';

export type SurfaceId = 'files' | 'hash';

// A diff tab between two workspace files; both are read again when the workspace reopens.
export interface PersistedDiffTab {
    readonly original: string;
    readonly modified: string;
    // Place among all open tabs.
    readonly position: number;
}

export interface WorkspaceConfig {
    readonly openFiles: ReadonlyArray<string>;
    readonly diffTabs: ReadonlyArray<PersistedDiffTab>;
    readonly activePath: string | null;
    // Index into diffTabs when a diff tab was active.
    readonly activeDiffTab: number | null;
    readonly expandedPaths: ReadonlyArray<string>;
    readonly activeSurface: SurfaceId;
}

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
    openFiles: [],
    diffTabs: [],
    activePath: null,
    activeDiffTab: null,
    expandedPaths: [],
    activeSurface: 'files',
};

export async function readWorkspaceConfigAsync(root: FileSystemDirectoryHandle): Promise<WorkspaceConfig> {
    try {
        const file = await readFileAsync(root, WORKSPACE_CONFIG_PATH);
        const parsed = JSON.parse(file.text) as Partial<WorkspaceConfig>;

        return mergeWorkspaceConfig(DEFAULT_WORKSPACE_CONFIG, parsed);
    }
    catch {
        return DEFAULT_WORKSPACE_CONFIG;
    }
}

// Returns whether the write made the file, which the workspace didn't have before.
export async function writeWorkspaceConfigAsync(
    root: FileSystemDirectoryHandle,
    config: WorkspaceConfig,
): Promise<boolean> {
    try {
        const existed = await entryExistsAsync(root, WORKSPACE_CONFIG_PATH);
        const text = `${JSON.stringify(config, null, 2)}\n`;
        await writeFileAsync(root, WORKSPACE_CONFIG_PATH, text);

        return !existed;
    }
    catch {
        // Read-only workspace or revoked permission; skip persisting the config.
        return false;
    }
}

export function mergeWorkspaceConfig(base: WorkspaceConfig, stored: Partial<WorkspaceConfig>): WorkspaceConfig {
    return {
        openFiles: Array.isArray(stored.openFiles) ? stored.openFiles : base.openFiles,
        diffTabs: Array.isArray(stored.diffTabs) ? stored.diffTabs.filter(isPersistedDiffTab) : base.diffTabs,
        activePath: stored.activePath ?? base.activePath,
        activeDiffTab: typeof stored.activeDiffTab === 'number' ? stored.activeDiffTab : base.activeDiffTab,
        expandedPaths: Array.isArray(stored.expandedPaths) ? stored.expandedPaths : base.expandedPaths,
        activeSurface: isValidSurface(stored.activeSurface) ? stored.activeSurface : base.activeSurface,
    };
}

function isPersistedDiffTab(value: unknown): value is PersistedDiffTab {
    const candidate = value as Partial<PersistedDiffTab> | null;

    return candidate != null
        && typeof candidate.original === 'string'
        && typeof candidate.modified === 'string'
        && typeof candidate.position === 'number';
}

function isValidSurface(value: unknown): value is SurfaceId {
    return value === 'files' || value === 'hash';
}
