import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askForPasswordAsync, waitForPaintAsync } from './passwordUnlock.js';
import type { AnimationClock } from './previewZoomController.js';

let host: HTMLElement;

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
});

afterEach(() => {
    host.remove();
});

// A clock whose frames and timers run at once, so each password is tried straight away.
const IMMEDIATE_CLOCK: AnimationClock = {
    now: () => 0,
    requestFrame: (callback) => {
        callback();

        return 1;
    },
    cancelFrame: () => {},
    setTimer: (callback) => {
        callback();

        return 1;
    },
    clearTimer: () => {},
};

function show(panel: HTMLElement): void {
    host.replaceChildren(panel);
}

function panel(): HTMLElement | null {
    return host.querySelector('.password-panel');
}

async function enterAsync(password: string): Promise<void> {
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    (host.querySelector('.password-panel-input') as HTMLInputElement).value = password;
    panel()?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('askForPasswordAsync', () => {
    it('asks until the password opens the file, saying when one was wrong, and shows that it is unlocking', async () => {
        const tried: string[] = [];
        const showUnlocking = vi.fn(() => host.replaceChildren('Unlocking…'));
        const result = askForPasswordAsync({
            title: 'This workbook is protected with a password',
            fileName: 'book.xlsx',
            show,
            showUnlocking,
            tryPasswordAsync: async (password) => {
                tried.push(password);

                return password === 'right' ? 'opened' : null;
            },
            isCurrent: () => true,
            clock: IMMEDIATE_CLOCK,
        });

        await enterAsync('wrong');
        await vi.waitFor(() => expect(panel()?.dataset['reason']).toBe('incorrect'));
        await enterAsync('right');

        expect(await result).toBe('opened');
        expect(tried).toEqual(['wrong', 'right']);
        expect(showUnlocking).toHaveBeenCalledTimes(2);
    });

    it('gives null on Cancel without trying anything', async () => {
        const tryPasswordAsync = vi.fn(async () => 'opened');
        const result = askForPasswordAsync({
            title: 'Locked',
            fileName: 'a.docx',
            show,
            showUnlocking: () => {},
            tryPasswordAsync,
            isCurrent: () => true,
            clock: IMMEDIATE_CLOCK,
        });

        await vi.waitFor(() => expect(panel()).not.toBeNull());
        (host.querySelector('[data-action="password-cancel"]') as HTMLButtonElement).click();

        expect(await result).toBeNull();
        expect(tryPasswordAsync).not.toHaveBeenCalled();
    });

    it('stops once the view moved on, even with a password in hand', async () => {
        let isCurrent = true;
        const tryPasswordAsync = vi.fn(async () => 'opened');
        const result = askForPasswordAsync({
            title: 'Locked',
            fileName: 'a.docx',
            show,
            showUnlocking: () => {},
            tryPasswordAsync,
            isCurrent: () => isCurrent,
            clock: IMMEDIATE_CLOCK,
        });

        await vi.waitFor(() => expect(panel()).not.toBeNull());
        isCurrent = false;
        await enterAsync('right');

        expect(await result).toBeNull();
        expect(tryPasswordAsync).not.toHaveBeenCalled();
    });
});

describe('waitForPaintAsync', () => {
    it('waits for a frame, then a timer', async () => {
        const steps: string[] = [];
        const clock: AnimationClock = {
            ...IMMEDIATE_CLOCK,
            requestFrame: (callback) => {
                steps.push('frame');
                callback();

                return 1;
            },
            setTimer: (callback) => {
                steps.push('timer');
                callback();

                return 1;
            },
        };

        await waitForPaintAsync(clock);

        expect(steps).toEqual(['frame', 'timer']);
    });
});
