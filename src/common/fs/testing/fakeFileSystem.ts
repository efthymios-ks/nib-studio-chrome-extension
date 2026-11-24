// In-memory stand-ins for the File System Access handles, for unit tests only.

export type WriteChunk = string | Blob | ArrayBuffer | Uint8Array;

export class FakeFileHandle {
    readonly kind = 'file';

    move?: (name: string) => Promise<void>;

    lastModified = 1;

    writeCount = 0;

    // A dropped file starts with read access; 'prompt' turns into 'granted' once requested, 'denied' stays.
    permission: PermissionState = 'granted';

    readonly permissionRequests: string[] = [];

    constructor(public name: string, public data: Uint8Array, private readonly parent: FakeDirectoryHandle) {}

    get text(): string {
        return new TextDecoder().decode(this.data);
    }

    async getFile(): Promise<File> {
        return new File([new Uint8Array(this.data)], this.name, { lastModified: this.lastModified });
    }

    async createWritable(): Promise<{ write: (chunk: WriteChunk) => Promise<void>; close: () => Promise<void> }> {
        const chunks: Uint8Array[] = [];

        return {
            write: async (chunk) => {
                chunks.push(await toBytesAsync(chunk));
            },
            close: async () => {
                const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const merged = new Uint8Array(total);
                let offset = 0;

                for (const chunk of chunks) {
                    merged.set(chunk, offset);
                    offset += chunk.length;
                }

                this.data = merged;
                this.lastModified += 1;
                this.writeCount += 1;
            },
        };
    }

    async isSameEntry(other: unknown): Promise<boolean> {
        return other === this;
    }

    async queryPermission(): Promise<PermissionState> {
        return this.permission;
    }

    async requestPermission(descriptor?: { mode?: string }): Promise<PermissionState> {
        this.permissionRequests.push(descriptor?.mode ?? 'read');

        if (this.permission === 'prompt') {
            this.permission = 'granted';
        }

        return this.permission;
    }

    enableNativeMove(): void {
        this.move = async (name) => {
            this.parent.children.delete(this.name);
            this.name = name;
            this.parent.children.set(name, this);
        };
    }
}

export class FakeDirectoryHandle {
    readonly kind = 'directory';

    readonly children = new Map<string, FakeFileHandle | FakeDirectoryHandle>();

    // A folder starts with read and write access; 'prompt' turns into 'granted' once requested, 'denied' stays.
    permission: PermissionState = 'granted';

    readonly permissionRequests: string[] = [];

    constructor(public name: string) {}

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
        const existing = this.children.get(name);

        if (existing instanceof FakeFileHandle) {
            return existing;
        }

        if (existing != null) {
            throw new DOMException('Not a file.', 'TypeMismatchError');
        }

        if (options?.create !== true) {
            throw new DOMException(`${name} not found.`, 'NotFoundError');
        }

        const created = new FakeFileHandle(name, new Uint8Array(), this);
        this.children.set(name, created);

        return created;
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
        const existing = this.children.get(name);

        if (existing instanceof FakeDirectoryHandle) {
            return existing;
        }

        if (existing != null) {
            throw new DOMException('Not a directory.', 'TypeMismatchError');
        }

        if (options?.create !== true) {
            throw new DOMException(`${name} not found.`, 'NotFoundError');
        }

        const created = new FakeDirectoryHandle(name);
        this.children.set(name, created);

        return created;
    }

    async removeEntry(name: string): Promise<void> {
        if (!this.children.delete(name)) {
            throw new DOMException(`${name} not found.`, 'NotFoundError');
        }
    }

    async isSameEntry(other: unknown): Promise<boolean> {
        return other === this;
    }

    // The path from this folder down to the handle, [] for the folder itself, null when the handle is elsewhere.
    async resolve(possibleDescendant: unknown): Promise<string[] | null> {
        if (possibleDescendant === this) {
            return [];
        }

        for (const [name, child] of this.children) {
            if (child === possibleDescendant) {
                return [name];
            }

            if (child instanceof FakeDirectoryHandle) {
                const inner = await child.resolve(possibleDescendant);

                if (inner != null) {
                    return [name, ...inner];
                }
            }
        }

        return null;
    }

    async queryPermission(): Promise<PermissionState> {
        return this.permission;
    }

    async requestPermission(descriptor?: { mode?: string }): Promise<PermissionState> {
        this.permissionRequests.push(descriptor?.mode ?? 'read');

        if (this.permission === 'prompt') {
            this.permission = 'granted';
        }

        return this.permission;
    }

    async *values(): AsyncIterableIterator<FakeFileHandle | FakeDirectoryHandle> {
        for (const child of [...this.children.values()]) {
            yield child;
        }
    }

    addFile(path: string, data: Uint8Array | string): FakeFileHandle {
        const segments = path.split('/');
        const fileName = segments.pop() as string;
        const current = this.ensureDirectory(segments);
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const file = new FakeFileHandle(fileName, bytes, current);
        current.children.set(fileName, file);

        return file;
    }

    addDirectory(path: string): FakeDirectoryHandle {
        return this.ensureDirectory(path.split('/'));
    }

    find(path: string): FakeFileHandle | FakeDirectoryHandle | null {
        let current: FakeFileHandle | FakeDirectoryHandle | undefined = this;

        for (const segment of path.split('/')) {
            if (!(current instanceof FakeDirectoryHandle)) {
                return null;
            }

            current = current.children.get(segment);
        }

        return current ?? null;
    }

    private ensureDirectory(segments: ReadonlyArray<string>): FakeDirectoryHandle {
        let current: FakeDirectoryHandle = this;

        for (const segment of segments) {
            let next = current.children.get(segment);

            if (!(next instanceof FakeDirectoryHandle)) {
                next = new FakeDirectoryHandle(segment);
                current.children.set(segment, next);
            }

            current = next;
        }

        return current;
    }
}

async function toBytesAsync(chunk: WriteChunk): Promise<Uint8Array> {
    if (typeof chunk === 'string') {
        return new TextEncoder().encode(chunk);
    }

    if (chunk instanceof Blob) {
        return new Uint8Array(await chunk.arrayBuffer());
    }

    return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
}

export function asRoot(directory: FakeDirectoryHandle): FileSystemDirectoryHandle {
    return directory as unknown as FileSystemDirectoryHandle;
}

export function bytesOf(root: FakeDirectoryHandle, path: string): number[] {
    const entry = root.find(path);

    if (!(entry instanceof FakeFileHandle)) {
        throw new Error(`${path} is not a file.`);
    }

    return [...entry.data];
}

export function textOf(root: FakeDirectoryHandle, path: string): string {
    return new TextDecoder().decode(new Uint8Array(bytesOf(root, path)));
}
