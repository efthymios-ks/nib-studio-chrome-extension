// Type shims for browser APIs the stock TypeScript lib does not describe.

interface FileSystemPermissionDescriptor {
    mode?: 'read' | 'readwrite';
}

type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
}

// The handle of a dragged file or folder, where the browser provides it.
interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

interface Window {
    showDirectoryPicker(options?: {
        mode?: FileSystemPermissionMode;
        startIn?: string | FileSystemHandle;
        id?: string;
    }): Promise<FileSystemDirectoryHandle>;

    showOpenFilePicker(options?: {
        multiple?: boolean;
        excludeAcceptAllOption?: boolean;
        types?: ReadonlyArray<{
            description?: string;
            accept: Record<string, ReadonlyArray<string>>;
        }>;
    }): Promise<FileSystemFileHandle[]>;

    showSaveFilePicker(options?: {
        suggestedName?: string;
        types?: ReadonlyArray<{
            description?: string;
            accept: Record<string, ReadonlyArray<string>>;
        }>;
    }): Promise<FileSystemFileHandle>;
}

// FileSystemObserver, where the browser provides it; the watcher falls back to polling.
interface FileSystemObserverRecord {
    type?: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown';
    relativePathComponents?: ReadonlyArray<string>;
    changedHandle?: FileSystemHandle;
}

interface FileSystemObserver {
    observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
    disconnect(): void;
}

interface Window {
    FileSystemObserver?: new (
        callback: (records: ReadonlyArray<FileSystemObserverRecord>) => void,
    ) => FileSystemObserver;
}

// The Brotli decoder of the brotli package, which ships no types: compressed bytes in, the original bytes out.
declare module 'brotli/decompress.js' {
    export default function decompress(data: Uint8Array, outputSize?: number): Uint8Array;
}

// The DEFLATE decoder of the pako package, which ships no types: raw DEFLATE bytes in, the original bytes out.
declare module 'pako' {
    const pako: {
        inflateRaw(data: Uint8Array): Uint8Array;
    };

    export default pako;
}
