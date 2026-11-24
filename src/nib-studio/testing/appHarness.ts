// Mounts the whole App over the in-memory file system so tests can drive it end to end.
import { asRoot, FakeDirectoryHandle } from '../../common/fs/testing/fakeFileSystem.js';
import { App } from '../app/app.js';
import type { AppState, Store } from '../app/store.js';

export interface AppHarness {
    readonly app: App;
    readonly root: HTMLElement;
    readonly folder: FakeDirectoryHandle;
    readonly store: Store;
    readonly state: () => AppState;
    // Calls a private App method by name, awaiting its result.
    readonly callAsync: <T>(name: string, ...args: unknown[]) => Promise<T>;
}

export function createAppHarness(files: Readonly<Record<string, string | Uint8Array>>): AppHarness {
    const root = document.createElement('div');
    document.body.append(root);
    const app = new App(root);
    const folder = new FakeDirectoryHandle('workspace');

    for (const [path, data] of Object.entries(files)) {
        folder.addFile(path, data);
    }

    const store = (app as unknown as { store: Store }).store;
    const callAsync = async <T>(name: string, ...args: unknown[]): Promise<T> => {
        const method = (app as unknown as Record<string, (...values: unknown[]) => unknown>)[name]!;

        return await method.apply(app, args) as T;
    };

    return { app, root, folder, store, state: () => store.getState(), callAsync };
}

// Points the App at the harness folder without reading its configuration or starting a watcher.
export async function openHarnessWorkspaceAsync(harness: AppHarness): Promise<void> {
    harness.store.update({ workspace: { id: 'w1', handle: asRoot(harness.folder), name: harness.folder.name } });
    await harness.callAsync('refreshTreeAsync');
}

export function markChange(harness: AppHarness, path: string, text: string): void {
    (harness.app as unknown as { markChange: (path: string, text: string) => void }).markChange(path, text);
}

export function openPaths(harness: AppHarness): string[] {
    return harness.state().openFiles.map((file) => file.path);
}

export function treeRow(path: string): HTMLElement {
    const row = document.querySelector<HTMLElement>(`.tree-row[data-path="${path}"]`);

    if (row == null) {
        throw new Error(`No tree row for ${path}`);
    }

    return row;
}

export function tabElement(path: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.tab[data-path="${path}"]`);
}
