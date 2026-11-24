import type { DirectoryChangeEvent } from '../fs/directoryWatcher.js';
import {
    createLookupIndex,
    type LookupHost,
    type LookupIndex,
    type LookupProgress,
    type PdfReadOutcome,
} from './lookupIndex.js';
import type { LookupResults } from './lookupResults.js';

// The Lookup index behind messages, so it runs in a worker off the page's thread; the page answers what only it can,
// a PDF's text through pdf.js and the plain bytes of a file a tab unlocked.

export type LookupRequest =
    | { readonly type: 'start'; readonly root: FileSystemDirectoryHandle; readonly codePage: number }
    // Lists the workspace again, reading only the files that changed.
    | { readonly type: 'refresh' }
    | { readonly type: 'search'; readonly id: number; readonly query: string }
    | { readonly type: 'changes'; readonly events: ReadonlyArray<DirectoryChangeEvent> }
    | { readonly type: 'open-texts'; readonly texts: ReadonlyArray<readonly [string, string]> }
    | { readonly type: 'unlocked'; readonly paths: ReadonlyArray<string> }
    // The page's answer to a question the index asked.
    | { readonly type: 'answer'; readonly id: number; readonly value: PdfReadOutcome | Uint8Array | null };

export type LookupMessage =
    | { readonly type: 'progress'; readonly progress: LookupProgress }
    | { readonly type: 'results'; readonly id: number; readonly results: LookupResults }
    | { readonly type: 'pdf-text'; readonly id: number; readonly path: string; readonly file: File }
    | { readonly type: 'unlocked-bytes'; readonly id: number; readonly path: string; readonly file: File };

type PostLookupMessage = (message: LookupMessage) => void;

const noResults = (query: string): LookupResults => ({ query, results: [], total: 0 });

type RequestHandler<Type extends LookupRequest['type']> = (request: Extract<LookupRequest, { type: Type }>) => void;

// Returns the function that takes each request.
export function createLookupService(post: PostLookupMessage): (request: LookupRequest) => void {
    let index: LookupIndex | null = null;
    let nextQuestion = 1;
    const answers = new Map<number, (value: unknown) => void>();

    const askAsync = async <T>(question: (id: number) => LookupMessage): Promise<T> => await new Promise<T>((resolve) => {
        const id = nextQuestion;
        nextQuestion += 1;
        answers.set(id, (value) => resolve(value as T));
        post(question(id));
    });

    const host: LookupHost = {
        readPdfTextAsync: async (path, file) => await askAsync<PdfReadOutcome>((id) => (
            { type: 'pdf-text', id, path, file }
        )),
        readUnlockedBytesAsync: async (path, file) => await askAsync<Uint8Array | null>((id) => (
            { type: 'unlocked-bytes', id, path, file }
        )),
        onChange: (progress) => post({ type: 'progress', progress }),
    };

    const handlers: { readonly [Type in LookupRequest['type']]: RequestHandler<Type> } = {
        start: (request) => {
            index?.dispose();
            index = createLookupIndex({ root: request.root, codePage: request.codePage, host });
        },
        refresh: () => index?.refresh(),
        search: (request) => post({
            type: 'results',
            id: request.id,
            results: index?.search(request.query) ?? noResults(request.query),
        }),
        changes: (request) => index?.applyChanges(request.events),
        'open-texts': (request) => index?.setOpenTexts(new Map(request.texts)),
        unlocked: (request) => index?.setUnlocked(new Set(request.paths)),
        answer: (request) => {
            const answer = answers.get(request.id);
            answers.delete(request.id);
            answer?.(request.value);
        },
    };

    return (request) => {
        (handlers[request.type] as (value: LookupRequest) => void)(request);
    };
}
