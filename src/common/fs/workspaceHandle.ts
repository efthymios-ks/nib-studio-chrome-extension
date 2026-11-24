export type WorkspacePermission = 'granted' | 'denied' | 'prompt';

export type PickedDirectory =
    | { readonly outcome: 'picked'; readonly handle: FileSystemDirectoryHandle }
    | { readonly outcome: 'cancelled' }
    | { readonly outcome: 'refused' };

// Chrome rejects with AbortError both when the picker is cancelled and when the access prompt inside it is refused,
// so only a blocked picker, NotAllowedError, can be told apart as a refusal.
export async function pickDirectoryAsync(): Promise<PickedDirectory> {
    try {
        return { outcome: 'picked', handle: await window.showDirectoryPicker({ mode: 'readwrite' }) };
    }
    catch (error) {
        if (isDomException(error, 'AbortError')) {
            return { outcome: 'cancelled' };
        }

        if (isDomException(error, 'NotAllowedError')) {
            return { outcome: 'refused' };
        }

        throw error;
    }
}

export async function queryPermissionAsync(
    handle: FileSystemDirectoryHandle,
    mode: FileSystemPermissionMode,
): Promise<WorkspacePermission> {
    const existing = await handle.queryPermission({ mode });

    return normalize(existing);
}

export async function ensurePermissionAsync(
    handle: FileSystemHandle,
    mode: FileSystemPermissionMode,
): Promise<WorkspacePermission> {
    const existing = await handle.queryPermission({ mode });

    if (existing === 'granted') {
        return 'granted';
    }

    try {
        const requested = await handle.requestPermission({ mode });

        return normalize(requested);
    }
    catch {
        return 'prompt';
    }
}

function normalize(state: PermissionState): WorkspacePermission {
    if (state === 'granted') {
        return 'granted';
    }

    if (state === 'denied') {
        return 'denied';
    }

    return 'prompt';
}

function isDomException(error: unknown, name: string): boolean {
    return error instanceof DOMException && error.name === name;
}
