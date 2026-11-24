// Reads each File snapshot once while it lives, so switching tabs, or a store update that leaves the file alone,
// never reads it again. A read that fails is forgotten, so opening the tab again tries again.
// The arguments after the File only matter for the first read of a snapshot.
export function cachePerFile<T, TArgs extends ReadonlyArray<unknown>>(
    read: (file: File, ...args: TArgs) => Promise<T>,
): (file: File, ...args: TArgs) => Promise<T> {
    const reads = new WeakMap<File, Promise<T>>();

    return (file, ...args) => {
        const cached = reads.get(file);

        if (cached != null) {
            return cached;
        }

        const pending = read(file, ...args);
        reads.set(file, pending);
        pending.catch(() => reads.delete(file));

        return pending;
    };
}
