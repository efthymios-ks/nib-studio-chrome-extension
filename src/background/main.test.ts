import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ClickListener = () => void;

interface ChromeStub {
    readonly listeners: ClickListener[];
    readonly getURL: ReturnType<typeof vi.fn>;
    readonly createTab: ReturnType<typeof vi.fn>;
}

function stubChrome(createTab: (properties: { url: string }) => Promise<unknown>): ChromeStub {
    const listeners: ClickListener[] = [];
    const getURL = vi.fn((path: string) => `chrome-extension://nib/${path}`);
    const createTabMock = vi.fn(createTab);

    vi.stubGlobal('chrome', {
        runtime: { getURL },
        tabs: { create: createTabMock },
        action: {
            onClicked: {
                addListener: (listener: ClickListener) => {
                    listeners.push(listener);
                },
            },
        },
    });

    return { listeners, getURL, createTab: createTabMock };
}

async function loadBackgroundAsync(): Promise<void> {
    // main.ts is a classic script with no exports, so the path is not a literal TypeScript would check.
    await import('./main.js' as string);
}

async function flushAsync(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('background main', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers one toolbar click listener on load', async () => {
        const stub = stubChrome(async () => ({}));

        await loadBackgroundAsync();

        expect(stub.listeners).toHaveLength(1);
        expect(stub.createTab).not.toHaveBeenCalled();
    });

    it('opens the studio page in a new tab when the toolbar button is clicked', async () => {
        const stub = stubChrome(async () => ({}));
        await loadBackgroundAsync();

        stub.listeners[0]?.();
        await flushAsync();

        expect(stub.getURL).toHaveBeenCalledWith('nib-studio/index.html');
        expect(stub.createTab).toHaveBeenCalledWith({ url: 'chrome-extension://nib/nib-studio/index.html' });
    });

    it('logs instead of throwing when the tab cannot be opened', async () => {
        const failure = new Error('No window.');
        const stub = stubChrome(async () => {
            throw failure;
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await loadBackgroundAsync();

        expect(() => stub.listeners[0]?.()).not.toThrow();
        await flushAsync();

        expect(consoleError).toHaveBeenCalledWith('Open Nib Studio failed.', failure);
    });
});
