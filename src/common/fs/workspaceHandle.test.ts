import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensurePermissionAsync, pickDirectoryAsync, queryPermissionAsync } from './workspaceHandle.js';

interface PermissionFake {
    readonly handle: FileSystemDirectoryHandle;
    readonly queryPermission: ReturnType<typeof vi.fn>;
    readonly requestPermission: ReturnType<typeof vi.fn>;
}

function fakePermissions(
    queried: PermissionState,
    request: () => Promise<PermissionState> = async () => 'granted',
): PermissionFake {
    const queryPermission = vi.fn(async () => queried);
    const requestPermission = vi.fn(request);
    const handle = { name: 'project', queryPermission, requestPermission } as unknown as FileSystemDirectoryHandle;

    return { handle, queryPermission, requestPermission };
}

function stubPicker(picker: () => Promise<unknown>): ReturnType<typeof vi.fn> {
    const showDirectoryPicker = vi.fn(picker);
    vi.stubGlobal('window', { showDirectoryPicker });

    return showDirectoryPicker;
}

describe('workspaceHandle', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('pickDirectoryAsync', () => {
        it('returns the picked folder, asking for read and write access', async () => {
            const picked = { name: 'project' };
            const showDirectoryPicker = stubPicker(async () => picked);

            await expect(pickDirectoryAsync()).resolves.toEqual({ outcome: 'picked', handle: picked });
            expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
        });

        it('reports a cancel when the user cancels the picker, or refuses the prompt inside it, which Chrome reports alike', async () => {
            stubPicker(async () => {
                throw new DOMException('The user aborted a request.', 'AbortError');
            });

            await expect(pickDirectoryAsync()).resolves.toEqual({ outcome: 'cancelled' });
        });

        it('reports a refusal when Chrome blocks folder access', async () => {
            stubPicker(async () => {
                throw new DOMException('Access to the folder was blocked.', 'NotAllowedError');
            });

            await expect(pickDirectoryAsync()).resolves.toEqual({ outcome: 'refused' });
        });

        it('rethrows other picker failures', async () => {
            const failure = new DOMException('Blocked.', 'SecurityError');
            stubPicker(async () => {
                throw failure;
            });

            await expect(pickDirectoryAsync()).rejects.toBe(failure);
        });

        it('rethrows a plain error even when named AbortError', async () => {
            const failure = new Error('Not a DOMException.');
            failure.name = 'AbortError';
            stubPicker(async () => {
                throw failure;
            });

            await expect(pickDirectoryAsync()).rejects.toBe(failure);
        });
    });

    describe('queryPermissionAsync', () => {
        it.each<[PermissionState, string]>([
            ['granted', 'granted'],
            ['denied', 'denied'],
            ['prompt', 'prompt'],
        ])('maps %s to %s', async (state, expected) => {
            const fake = fakePermissions(state);

            await expect(queryPermissionAsync(fake.handle, 'read')).resolves.toBe(expected);
            expect(fake.queryPermission).toHaveBeenCalledWith({ mode: 'read' });
        });

        it('treats an unknown state as prompt', async () => {
            const fake = fakePermissions('unexpected' as PermissionState);

            await expect(queryPermissionAsync(fake.handle, 'readwrite')).resolves.toBe('prompt');
        });

        it('never requests permission', async () => {
            const fake = fakePermissions('prompt');

            await queryPermissionAsync(fake.handle, 'readwrite');

            expect(fake.requestPermission).not.toHaveBeenCalled();
        });
    });

    describe('ensurePermissionAsync', () => {
        it('returns granted without asking when already granted', async () => {
            const fake = fakePermissions('granted');

            await expect(ensurePermissionAsync(fake.handle, 'readwrite')).resolves.toBe('granted');
            expect(fake.requestPermission).not.toHaveBeenCalled();
        });

        it('requests permission when not yet granted', async () => {
            const fake = fakePermissions('prompt', async () => 'granted');

            await expect(ensurePermissionAsync(fake.handle, 'readwrite')).resolves.toBe('granted');
            expect(fake.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
        });

        it('returns denied when the user refuses', async () => {
            const fake = fakePermissions('prompt', async () => 'denied');

            await expect(ensurePermissionAsync(fake.handle, 'read')).resolves.toBe('denied');
        });

        it('returns prompt when the request throws, as without a user gesture', async () => {
            const fake = fakePermissions('prompt', async () => {
                throw new DOMException('User activation is required.', 'SecurityError');
            });

            await expect(ensurePermissionAsync(fake.handle, 'readwrite')).resolves.toBe('prompt');
        });
    });
});
