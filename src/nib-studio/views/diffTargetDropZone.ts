import { readClipboardTextAsync } from '../app/clipboardPaste.js';
import { h } from '../app/dom.js';
import { toast } from '../app/toast.js';
import { INTERNAL_MIME } from '../explorer/dragDrop.js';
import type { DiffSide } from '../app/store.js';

export interface DiffDropTarget {
    readonly kind: 'clipboard' | 'file' | 'disk';
    readonly path: string;
    readonly text: string;
    // Binary sources such as xlsx need the original file, not its text.
    readonly file: File | null;
}

export interface DiffTargetDropZoneOptions {
    readonly onTarget: (target: DiffDropTarget) => void;
    readonly onPickFileAsync: () => Promise<DiffDropTarget | null>;
    readonly readWorkspaceFileAsync?: (path: string) => Promise<DiffDropTarget | null>;
    // Element whose paste events also feed the zone, such as the whole diff view.
    readonly pasteScope?: HTMLElement;
}

// Lets a view build the zone for its empty side without knowing where files come from.
export type DiffTargetDropZoneFactory = (onTarget: (target: DiffSide) => void) => HTMLElement;

const pasteHandlersByScope = new WeakMap<HTMLElement, (event: ClipboardEvent) => void>();

export function renderDiffTargetDropZone(options: DiffTargetDropZoneOptions): HTMLElement {
    const ways = [
        'Drag a file from the Explorer',
        'Drop a file from your computer',
        'Paste text (Ctrl+V)',
        'Click to choose a file',
    ];

    const pasteButton = h('button', {
        class: 'button',
        text: 'Paste from clipboard',
        attrs: { type: 'button' },
        on: {
            click: (event) => {
                event.stopPropagation();
                void pasteFromClipboardAsync(options);
            },
        },
    });

    const zone = h('div', {
        class: 'diff-target-drop-zone',
        attrs: { role: 'button', tabindex: '0', 'aria-label': 'Drop a file here, paste text, or click to choose a file' },
        children: [
            h('h2', {
                class: 'diff-target-drop-zone-title',
                text: 'Choose what to compare with',
            }),
            h('ul', {
                class: 'diff-target-drop-zone-ways',
                children: ways.map((way) => h('li', { text: way })),
            }),
            pasteButton,
        ],
    });

    zone.addEventListener('click', () => {
        void pickFileAsync(options);
    });

    zone.addEventListener('keydown', (event) => {
        if (event.target !== zone) {
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void pickFileAsync(options);
        }
    });

    attachDragHandlers(zone, options);
    attachPasteHandler(zone, options);

    return zone;
}

function attachDragHandlers(zone: HTMLElement, options: DiffTargetDropZoneOptions): void {
    const onDragOver = (event: DragEvent): void => {
        const kind = dragKindOf(event);

        if (kind == null || event.dataTransfer == null) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        // Tree drags only allow `move`, so the drop effect has to match it.
        event.dataTransfer.dropEffect = kind === 'tree' ? 'move' : 'copy';
        zone.dataset['dragOver'] = 'true';
    };

    zone.addEventListener('dragenter', onDragOver);
    zone.addEventListener('dragover', onDragOver);

    zone.addEventListener('dragleave', (event) => {
        const next = event.relatedTarget as Node | null;

        if (next == null || !zone.contains(next)) {
            delete zone.dataset['dragOver'];
        }
    });

    zone.addEventListener('drop', (event) => {
        const kind = dragKindOf(event);

        if (kind == null || event.dataTransfer == null) {
            return;
        }

        // Keeps the window-level "drop opens the file" handler from also firing.
        event.preventDefault();
        event.stopPropagation();
        delete zone.dataset['dragOver'];

        if (kind === 'tree') {
            void deliverTreeDropAsync(event.dataTransfer.getData(INTERNAL_MIME), options);

            return;
        }

        const file = event.dataTransfer.files[0];

        if (file != null) {
            void deliverFileAsync(file, options);
        }
    });
}

function attachPasteHandler(zone: HTMLElement, options: DiffTargetDropZoneOptions): void {
    const scope = options.pasteScope ?? zone;
    const onPaste = (event: ClipboardEvent): void => {
        if (!zone.isConnected || isEditableTarget(event.target, zone)) {
            return;
        }

        const file = event.clipboardData?.files[0];

        if (file != null) {
            event.preventDefault();
            void deliverFileAsync(file, options);

            return;
        }

        const text = event.clipboardData?.getData('text/plain') ?? '';

        if (text === '') {
            return;
        }

        event.preventDefault();
        options.onTarget(clipboardTarget(text));
    };

    // Views re-render into the same scope, so swap the old handler instead of stacking them.
    const previous = pasteHandlersByScope.get(scope);

    if (previous != null) {
        scope.removeEventListener('paste', previous as EventListener);
    }

    pasteHandlersByScope.set(scope, onPaste);
    scope.addEventListener('paste', onPaste as EventListener);
}

function dragKindOf(event: DragEvent): 'tree' | 'desktop' | null {
    const types = event.dataTransfer?.types ?? [];

    if (types.includes(INTERNAL_MIME)) {
        return 'tree';
    }

    if (types.includes('Files')) {
        return 'desktop';
    }

    return null;
}

function isEditableTarget(target: EventTarget | null, zone: HTMLElement): boolean {
    if (!(target instanceof HTMLElement) || target === zone) {
        return false;
    }

    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target.isContentEditable;
}

async function pickFileAsync(options: DiffTargetDropZoneOptions): Promise<void> {
    try {
        const picked = await options.onPickFileAsync();

        if (picked != null) {
            options.onTarget(picked);
        }
    }
    catch {
        toast('Could not read that file.', 'fail');
    }
}

async function pasteFromClipboardAsync(options: DiffTargetDropZoneOptions): Promise<void> {
    const text = await readClipboardTextAsync(navigator.clipboard);

    if (text != null) {
        options.onTarget(clipboardTarget(text));
    }
}

async function deliverTreeDropAsync(raw: string, options: DiffTargetDropZoneOptions): Promise<void> {
    const path = firstPathOf(raw);

    if (path == null || options.readWorkspaceFileAsync == null) {
        return;
    }

    try {
        const target = await options.readWorkspaceFileAsync(path);

        if (target != null) {
            options.onTarget(target);
        }
    }
    catch {
        toast('Could not read that file.', 'fail');
    }
}

async function deliverFileAsync(file: File, options: DiffTargetDropZoneOptions): Promise<void> {
    try {
        const text = await file.text();
        options.onTarget({ kind: 'disk', path: file.name, text, file });
    }
    catch {
        toast('Could not read that file.', 'fail');
    }
}

function firstPathOf(raw: string): string | null {
    try {
        const parsed: unknown = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            return null;
        }

        const first: unknown = parsed[0];

        return typeof first === 'string' ? first : null;
    }
    catch {
        return null;
    }
}

function clipboardTarget(text: string): DiffDropTarget {
    return {
        kind: 'clipboard',
        path: 'Clipboard',
        text,
        file: null,
    };
}
