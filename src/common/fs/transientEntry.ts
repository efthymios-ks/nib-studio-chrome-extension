// Chrome writes a file through a swap file, `<name>.crswap`, until the write closes.
const SWAP_FILE_SUFFIX = '.crswap';

// Whether an entry is Chrome's temporary swap file, which no listing of the workspace shows.
export function isTransientEntry(name: string): boolean {
    return name.endsWith(SWAP_FILE_SUFFIX);
}
