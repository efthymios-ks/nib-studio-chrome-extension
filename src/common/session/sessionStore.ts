const SESSION_KEY = 'nib-studio/session';

export interface GlobalSession {
    readonly theme: 'light' | 'dark';
}

export const DEFAULT_SESSION: GlobalSession = {
    theme: 'light',
};

export async function loadSessionAsync(): Promise<GlobalSession> {
    const stored = await readStorageAsync();

    if (stored == null) {
        return DEFAULT_SESSION;
    }

    return {
        theme: stored.theme ?? DEFAULT_SESSION.theme,
    };
}

export async function saveSessionAsync(session: GlobalSession): Promise<void> {
    await writeStorageAsync(session);
}

async function readStorageAsync(): Promise<Partial<GlobalSession> | null> {
    if (typeof chrome === 'undefined' || chrome.storage == null) {
        return null;
    }

    return await new Promise<Partial<GlobalSession> | null>((resolve) => {
        chrome.storage.local.get([SESSION_KEY], (result) => {
            const value = result[SESSION_KEY] as Partial<GlobalSession> | undefined;
            resolve(value ?? null);
        });
    });
}

async function writeStorageAsync(session: GlobalSession): Promise<void> {
    if (typeof chrome === 'undefined' || chrome.storage == null) {
        return;
    }

    await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [SESSION_KEY]: session }, () => resolve());
    });
}
