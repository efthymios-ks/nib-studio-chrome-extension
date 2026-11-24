// A phrase for a Word or PDF preview to find once it shows, such as the match Lookup opened the file at:
// the preview puts it in its Find box and steps to the first match, now when it shows already, or once it opens.
// One request waits at a time; a newer one takes its place.

interface FindRequest {
    readonly key: string;
    readonly text: string;
}

let waiting: FindRequest | null = null;
const listeners = new Set<(key: string) => void>();

export function requestPreviewFind(key: string, text: string): void {
    waiting = { key, text };

    for (const listener of [...listeners]) {
        listener(key);
    }
}

// The phrase waiting for the preview of `key`, which is then no longer waiting; null when there is none.
export function takePreviewFind(key: string): string | null {
    if (waiting?.key !== key) {
        return null;
    }

    const { text } = waiting;
    waiting = null;

    return text;
}

// Calls `onRequest` whenever a phrase is asked for in the preview of `key`; returns the function that stops it.
export function listenForPreviewFind(key: string, onRequest: () => void): () => void {
    const listener = (requested: string): void => {
        if (requested === key) {
            onRequest();
        }
    };
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
