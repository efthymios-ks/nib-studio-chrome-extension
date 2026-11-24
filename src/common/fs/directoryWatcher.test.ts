import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchDirectoryAsync, type DirectoryChangeEvent } from './directoryWatcher.js';
import { FakeDirectoryHandle, FakeFileHandle, asRoot } from './testing/fakeFileSystem.js';

const POLL_INTERVAL_MS = 2500;

type ObserverRecord = { type?: string; relativePathComponents?: string[] };

class FakeObserver {
    static instances: FakeObserver[] = [];

    static failObserve = false;

    observed: { handle: unknown; options: unknown } | null = null;

    disconnected = false;

    constructor(readonly callback: (records: ReadonlyArray<ObserverRecord>) => void) {
        FakeObserver.instances.push(this);
    }

    async observe(handle: unknown, options: unknown): Promise<void> {
        if (FakeObserver.failObserve) {
            throw new DOMException('Not supported.', 'NotSupportedError');
        }

        this.observed = { handle, options };
    }

    disconnect(): void {
        this.disconnected = true;
    }
}

// The module reads window.FileSystemObserver and schedules with window.setTimeout;
// delegate to the global timers at call time so fake timers apply.
function stubWindow(withObserver: boolean): void {
    vi.stubGlobal('window', {
        setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
        ...(withObserver ? { FileSystemObserver: FakeObserver } : {}),
    });
}

function touch(file: FakeDirectoryHandle | FakeFileHandle | null): void {
    if (!(file instanceof FakeFileHandle)) {
        throw new Error('Not a file.');
    }

    file.lastModified += 1;
}

async function startPollingAsync(
    root: FakeDirectoryHandle,
    options?: { recursive?: boolean },
): Promise<{ events: DirectoryChangeEvent[]; dispose: () => void }> {
    const events: DirectoryChangeEvent[] = [];
    const watcher = await watchDirectoryAsync(asRoot(root), (event) => events.push(event), options);
    await vi.advanceTimersByTimeAsync(0);

    return { events, dispose: () => watcher.dispose() };
}

describe('watchDirectoryAsync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeObserver.instances = [];
        FakeObserver.failObserve = false;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('with a native FileSystemObserver', () => {
        beforeEach(() => {
            stubWindow(true);
        });

        it('observes recursively by default', async () => {
            const root = new FakeDirectoryHandle('project');

            await watchDirectoryAsync(asRoot(root), () => {});

            expect(FakeObserver.instances[0]?.observed).toEqual({ handle: root, options: { recursive: true } });
        });

        it('passes a non-recursive option through', async () => {
            await watchDirectoryAsync(asRoot(new FakeDirectoryHandle('project')), () => {}, { recursive: false });

            expect(FakeObserver.instances[0]?.observed?.options).toEqual({ recursive: false });
        });

        it('maps observer records to change events', async () => {
            const events: DirectoryChangeEvent[] = [];
            await watchDirectoryAsync(asRoot(new FakeDirectoryHandle('project')), (event) => events.push(event));

            FakeObserver.instances[0]?.callback([
                { type: 'appeared', relativePathComponents: ['docs', 'a.md'] },
                { type: 'added', relativePathComponents: ['b.md'] },
                { type: 'modified', relativePathComponents: ['c.md'] },
                { type: 'disappeared', relativePathComponents: ['d.md'] },
                { type: 'removed', relativePathComponents: ['e.md'] },
                { type: 'moved', relativePathComponents: ['f.md'] },
                { type: 'errored', relativePathComponents: ['g.md'] },
                {},
            ]);

            expect(events).toEqual([
                { kind: 'created', path: 'docs/a.md' },
                { kind: 'created', path: 'b.md' },
                { kind: 'modified', path: 'c.md' },
                { kind: 'deleted', path: 'd.md' },
                { kind: 'deleted', path: 'e.md' },
                { kind: 'moved', path: 'f.md' },
                { kind: 'unknown', path: 'g.md' },
                { kind: 'unknown', path: '' },
            ]);
        });

        it('leaves out records of Chrome\'s temporary .crswap files', async () => {
            const events: DirectoryChangeEvent[] = [];
            await watchDirectoryAsync(asRoot(new FakeDirectoryHandle('project')), (event) => events.push(event));

            FakeObserver.instances[0]?.callback([
                { type: 'appeared', relativePathComponents: ['.nib-studio-configuration.json.crswap'] },
                { type: 'modified', relativePathComponents: ['docs', 'a.md.crswap'] },
                { type: 'disappeared', relativePathComponents: ['docs', 'a.md.crswap'] },
                { type: 'modified', relativePathComponents: ['docs', 'a.md'] },
            ]);

            expect(events).toEqual([{ kind: 'modified', path: 'docs/a.md' }]);
        });

        it('disconnects the observer on dispose', async () => {
            const watcher = await watchDirectoryAsync(asRoot(new FakeDirectoryHandle('project')), () => {});

            watcher.dispose();

            expect(FakeObserver.instances[0]?.disconnected).toBe(true);
        });

        it('falls back to polling when observing fails', async () => {
            FakeObserver.failObserve = true;
            const root = new FakeDirectoryHandle('project');

            const { events } = await startPollingAsync(root);
            root.addFile('new.txt', 'x');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

            expect(FakeObserver.instances[0]?.disconnected).toBe(true);
            expect(events).toEqual([{ kind: 'created', path: 'new.txt' }]);
        });
    });

    describe('when polling', () => {
        beforeEach(() => {
            stubWindow(false);
        });

        it('reports nothing when nothing changes', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile('a.txt', 'a');

            const { events } = await startPollingAsync(root);
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

            expect(events).toEqual([]);
        });

        it('reports created, modified and deleted entries on the next tick', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile('keep.txt', 'a');
            root.addFile('edit.txt', 'a');
            root.addFile('drop.txt', 'a');

            const { events } = await startPollingAsync(root);
            root.addFile('docs/new.md', 'x');
            touch(root.find('edit.txt'));
            await root.removeEntry('drop.txt');

            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
            expect(events).toEqual([]);

            await vi.advanceTimersByTimeAsync(1);
            expect(events).toEqual([
                { kind: 'modified', path: 'edit.txt' },
                { kind: 'created', path: 'docs' },
                { kind: 'created', path: 'docs/new.md' },
                { kind: 'deleted', path: 'drop.txt' },
            ]);
        });

        it('leaves Chrome\'s temporary .crswap files out of its snapshots', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile('notes.md', 'a');

            const { events } = await startPollingAsync(root);
            root.addFile('notes.md.crswap', '');
            root.addFile('docs/a.md.crswap', '');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            await root.removeEntry('notes.md.crswap');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

            expect(events).toEqual([{ kind: 'created', path: 'docs' }]);
        });

        it('reports each change once', async () => {
            const root = new FakeDirectoryHandle('project');

            const { events } = await startPollingAsync(root);
            root.addFile('a.txt', 'a');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

            expect(events).toEqual([{ kind: 'created', path: 'a.txt' }]);
        });

        it('ignores changes inside folders when not recursive', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile('docs/a.md', 'a');

            const { events } = await startPollingAsync(root, { recursive: false });
            touch(root.find('docs/a.md'));
            root.addFile('docs/b.md', 'b');
            root.addFile('top.md', 'c');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

            expect(events).toEqual([{ kind: 'created', path: 'top.md' }]);
        });

        it('stops polling after dispose', async () => {
            const root = new FakeDirectoryHandle('project');

            const { events, dispose } = await startPollingAsync(root);
            dispose();
            root.addFile('a.txt', 'a');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

            expect(events).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('keeps polling after a failed read', async () => {
            const root = new FakeDirectoryHandle('project');
            const { events } = await startPollingAsync(root);
            vi.spyOn(root, 'values').mockImplementationOnce(async function* () {
                throw new DOMException('Permission revoked.', 'NotAllowedError');
            });
            root.addFile('a.txt', 'a');

            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            expect(events).toEqual([]);

            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            expect(events).toEqual([{ kind: 'created', path: 'a.txt' }]);
        });

        it('keeps polling when the first read fails, taking the next read as the baseline', async () => {
            const root = new FakeDirectoryHandle('project');
            root.addFile('existing.txt', 'a');
            vi.spyOn(root, 'values').mockImplementationOnce(async function* () {
                throw new DOMException('Busy.', 'NoModificationAllowedError');
            });

            const { events } = await startPollingAsync(root);
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            expect(events).toEqual([]);

            root.addFile('later.txt', 'b');
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            expect(events).toEqual([{ kind: 'created', path: 'later.txt' }]);
        });
    });
});
