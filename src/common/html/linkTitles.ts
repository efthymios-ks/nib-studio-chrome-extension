import { workspaceReferenceLabel } from '../fs/workspaceReference.js';

export const LINK_SELECTOR = 'a[href], area[href]';

// Gives each workspace link the path it leads to as its tooltip, after any title of its own;
// a file from outside the workspace has no workspace paths to show.
export function titleWorkspaceLinks(root: ParentNode, documentPath: string | null): void {
    if (documentPath == null) {
        return;
    }

    for (const link of [...root.querySelectorAll(LINK_SELECTOR)]) {
        const label = workspaceReferenceLabel(link.getAttribute('href') ?? '', documentPath);

        if (label == null) {
            continue;
        }

        const title = link.getAttribute('title') ?? '';
        link.setAttribute('title', title === '' ? label : `${title}\n${label}`);
    }
}
