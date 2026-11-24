// The Lookup worker: lists the workspace, reads each file's text and answers searches, off the page's thread.
import { createLookupService, type LookupMessage, type LookupRequest } from '../common/lookup/lookupService.js';

interface LookupWorkerScope {
    postMessage(message: LookupMessage): void;
    onmessage: ((event: MessageEvent<LookupRequest>) => void) | null;
}

const scope = self as unknown as LookupWorkerScope;
const handle = createLookupService((message) => scope.postMessage(message));

scope.onmessage = (event) => handle(event.data);
