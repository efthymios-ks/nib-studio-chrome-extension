import { del, entries, get, set } from 'idb-keyval';

const WORKSPACE_PREFIX = 'nib-studio/workspace/';
const ACTIVE_WORKSPACE_KEY = 'nib-studio/workspace-active';

export interface WorkspaceRecord {
    readonly id: string;
    readonly name: string;
    readonly handle: FileSystemDirectoryHandle;
}

interface StoredWorkspace {
    readonly handle: FileSystemDirectoryHandle;
    readonly displayName: string;
    readonly addedAt: number;
}

export async function listWorkspacesAsync(): Promise<WorkspaceRecord[]> {
    const all = await entries();
    const records: WorkspaceRecord[] = [];

    for (const [key, value] of all) {
        if (typeof key !== 'string' || !key.startsWith(WORKSPACE_PREFIX)) {
            continue;
        }

        const stored = normalizeStored(value);

        if (stored == null) {
            continue;
        }

        records.push({
            id: key.slice(WORKSPACE_PREFIX.length),
            name: stored.displayName,
            handle: stored.handle,
        });
    }

    records.sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }));

    return records;
}

export async function addWorkspaceAsync(handle: FileSystemDirectoryHandle): Promise<WorkspaceRecord> {
    const existing = await findWorkspaceAsync(handle);

    if (existing != null) {
        await setActiveWorkspaceAsync(existing.id);

        return existing;
    }

    const id = buildId(handle.name);
    const record: StoredWorkspace = {
        handle,
        displayName: handle.name,
        addedAt: Date.now(),
    };
    await set(WORKSPACE_PREFIX + id, record);
    await set(ACTIVE_WORKSPACE_KEY, id);

    return { id, name: handle.name, handle };
}

export async function removeWorkspaceAsync(id: string): Promise<void> {
    await del(WORKSPACE_PREFIX + id);
    const active = await get<string>(ACTIVE_WORKSPACE_KEY);

    if (active === id) {
        await del(ACTIVE_WORKSPACE_KEY);
    }
}

export async function setActiveWorkspaceAsync(id: string): Promise<void> {
    await set(ACTIVE_WORKSPACE_KEY, id);
}

export async function getActiveWorkspaceAsync(): Promise<WorkspaceRecord | null> {
    const id = await get<string>(ACTIVE_WORKSPACE_KEY);

    if (id == null) {
        return null;
    }

    const stored = normalizeStored(await get(WORKSPACE_PREFIX + id));

    if (stored == null) {
        return null;
    }

    return { id, name: stored.displayName, handle: stored.handle };
}

export async function findWorkspaceAsync(handle: FileSystemDirectoryHandle): Promise<WorkspaceRecord | null> {
    const workspaces = await listWorkspacesAsync();

    for (const workspace of workspaces) {
        if (await workspace.handle.isSameEntry(handle)) {
            return workspace;
        }
    }

    return null;
}

function buildId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    const suffix = Date.now().toString(36);

    return slug === '' ? suffix : `${slug}-${suffix}`;
}

function normalizeStored(value: unknown): StoredWorkspace | null {
    if (value == null || typeof value !== 'object') {
        return null;
    }

    const record = value as Partial<StoredWorkspace>;

    if (record.handle == null) {
        return null;
    }

    return {
        handle: record.handle,
        displayName: record.displayName ?? record.handle.name,
        addedAt: record.addedAt ?? 0,
    };
}
