import { createPasswordForm, type PasswordReason } from './passwordPanel.js';
import { BROWSER_CLOCK, type AnimationClock } from './previewZoomController.js';

export interface PasswordUnlockOptions<T> {
    // The password panel's title, such as "This document is protected with a password".
    readonly title: string;
    readonly fileName: string;
    // Puts the password panel where the content goes.
    readonly show: (panel: HTMLElement) => void;
    // Says the password is being tried, which takes a moment for strong encryption.
    readonly showUnlocking: () => void;
    // What the password opens, or null when it is wrong.
    readonly tryPasswordAsync: (password: string) => Promise<T | null>;
    // Whether the view still wants the answer; another file or a closed tab stops the asking.
    readonly isCurrent: () => boolean;
    readonly clock?: AnimationClock;
}

// Asks for the password until it opens the file: what it opened, or null after Cancel,
// or when the view has moved on by the time a password is tried.
// A wrong password asks again and says so. Each password goes to `tryPasswordAsync` and is kept nowhere.
export async function askForPasswordAsync<T>(options: PasswordUnlockOptions<T>): Promise<T | null> {
    let reason: PasswordReason = 'needed';

    while (options.isCurrent()) {
        const password = await promptAsync(options, reason);

        if (password == null || !options.isCurrent()) {
            return null;
        }

        options.showUnlocking();
        // Unlocking hashes the password on this thread, so "Unlocking…" is painted first.
        await waitForPaintAsync(options.clock ?? BROWSER_CLOCK);
        const result = await options.tryPasswordAsync(password);

        if (result != null) {
            return result;
        }

        reason = 'incorrect';
    }

    return null;
}

async function promptAsync<T>(options: PasswordUnlockOptions<T>, reason: PasswordReason): Promise<string | null> {
    return await new Promise((resolve) => {
        const form = createPasswordForm({
            title: options.title,
            fileName: options.fileName,
            reason,
            onSubmit: (password) => resolve(password),
            onCancel: () => resolve(null),
        });
        options.show(form.element);
        form.focus();
    });
}

// Resolves after the next frame has been painted.
export async function waitForPaintAsync(clock: AnimationClock): Promise<void> {
    await new Promise<void>((resolve) => {
        clock.requestFrame(() => {
            clock.setTimer(resolve, 0);
        });
    });
}
