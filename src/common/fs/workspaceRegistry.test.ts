import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addWorkspaceAsync,
    getActiveWorkspaceAsync,
    listWorkspacesAsync,
    removeWorkspaceAsync,
    setActiveWorkspaceAsync,
} from './workspaceRegistry.js';
import { FakeDirectoryHandle, asRoot } from './testing/fakeFileSystem.js';

const store = vi.hoisted(() => new Map<IDBValidKey, unknown>());

vi.mock('idb-keyval', () => ({
    get: async (key: IDBValidKey) => store.get(key),
    set: async (key: IDBValidKey, value: unknown) => {
        store.set(key, value);
    },
    del: async (key: IDBValidKey) => {
        store.delete(key);
    },
    entries: async () => [...store.entries()],
}));

const ACTIVE_KEY = 'nib-studio/workspace-active';
const PREFIX = 'nib-studio/workspace/';
const NOW = Date.UTC(2026, 0, 1);

describe('workspaceRegistry', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('addWorkspaceAsync', () => {
        it('stores a new folder under a slug id and makes it active', async () => {
            const handle = asRoot(new FakeDirectoryHandle('My Project!'));

            const record = await addWorkspaceAsync(handle);

            const suffix = NOW.toString(36);
            expect(record).toEqual({ id: `my-project-${suffix}`, name: 'My Project!', handle });
            expect(store.get(`${PREFIX}my-project-${suffix}`)).toEqual({ handle, displayName: 'My Project!', addedAt: NOW });
            expect(store.get(ACTIVE_KEY)).toBe(`my-project-${suffix}`);
        });

        it('uses the time alone as the id when the name has no letters or digits', async () => {
            const record = await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('###')));

            expect(record.id).toBe(NOW.toString(36));
        });

        it('caps the slug at 48 characters', async () => {
            const record = await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('a'.repeat(80))));

            expect(record.id).toBe(`${'a'.repeat(48)}-${NOW.toString(36)}`);
        });

        it('reuses the record for a folder already registered and makes it active', async () => {
            const handle = asRoot(new FakeDirectoryHandle('docs'));
            const first = await addWorkspaceAsync(handle);
            await setActiveWorkspaceAsync('other');
            vi.setSystemTime(NOW + 5000);

            const second = await addWorkspaceAsync(handle);

            expect(second).toEqual(first);
            expect([...store.keys()].filter((key) => String(key).startsWith(PREFIX))).toHaveLength(1);
            expect(store.get(ACTIVE_KEY)).toBe(first.id);
        });

        it('registers a different folder with the same name separately', async () => {
            await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('docs')));
            vi.setSystemTime(NOW + 1);
            await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('docs')));

            await expect(listWorkspacesAsync()).resolves.toHaveLength(2);
        });
    });

    describe('listWorkspacesAsync', () => {
        it('returns nothing for an empty store', async () => {
            await expect(listWorkspacesAsync()).resolves.toEqual([]);
        });

        it('lists workspaces sorted by name ignoring case', async () => {
            await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('zeta')));
            await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('Alpha')));
            await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('beta')));

            const names = (await listWorkspacesAsync()).map((workspace) => workspace.name);

            expect(names).toEqual(['Alpha', 'beta', 'zeta']);
        });

        it('skips unrelated keys and malformed records', async () => {
            const handle = new FakeDirectoryHandle('kept');
            store.set('other-key', { handle });
            store.set(ACTIVE_KEY, 'kept');
            store.set(42, { handle });
            store.set(`${PREFIX}empty`, null);
            store.set(`${PREFIX}text`, 'not a record');
            store.set(`${PREFIX}nohandle`, { displayName: 'Lost' });
            store.set(`${PREFIX}kept`, { handle, displayName: 'Kept', addedAt: 1 });

            await expect(listWorkspacesAsync()).resolves.toEqual([{ id: 'kept', name: 'Kept', handle }]);
        });

        it('falls back to the folder name when a record has no display name', async () => {
            const handle = new FakeDirectoryHandle('unnamed');
            store.set(`${PREFIX}unnamed`, { handle });

            const [workspace] = await listWorkspacesAsync();

            expect(workspace?.name).toBe('unnamed');
        });
    });

    describe('getActiveWorkspaceAsync', () => {
        it('returns null when nothing is active', async () => {
            await expect(getActiveWorkspaceAsync()).resolves.toBeNull();
        });

        it('returns the active workspace', async () => {
            const handle = asRoot(new FakeDirectoryHandle('notes'));
            const record = await addWorkspaceAsync(handle);

            await expect(getActiveWorkspaceAsync()).resolves.toEqual(record);
        });

        it('returns null when the active id points at a missing record', async () => {
            await setActiveWorkspaceAsync('gone');

            await expect(getActiveWorkspaceAsync()).resolves.toBeNull();
        });
    });

    describe('removeWorkspaceAsync', () => {
        it('removes the record and clears it as active', async () => {
            const record = await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('notes')));

            await removeWorkspaceAsync(record.id);

            await expect(listWorkspacesAsync()).resolves.toEqual([]);
            expect(store.has(ACTIVE_KEY)).toBe(false);
        });

        it('keeps a different active workspace', async () => {
            const first = await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('first')));
            const second = await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('second')));

            await removeWorkspaceAsync(first.id);

            expect(store.get(ACTIVE_KEY)).toBe(second.id);
            await expect(getActiveWorkspaceAsync()).resolves.toEqual(second);
        });

        it('does nothing for an unknown id', async () => {
            const record = await addWorkspaceAsync(asRoot(new FakeDirectoryHandle('notes')));

            await removeWorkspaceAsync('unknown');

            await expect(listWorkspacesAsync()).resolves.toEqual([record]);
        });
    });
});
