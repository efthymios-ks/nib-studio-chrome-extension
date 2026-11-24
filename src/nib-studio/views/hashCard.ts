import { encodeUtf8 } from '../../common/encoding/utf8.js';
import { formatDigest } from '../../common/hash/digestFormat.js';
import { digestBlobAsync } from '../../common/hash/fileDigests.js';
import { HASH_ALGORITHMS, digestAllAsync } from '../../common/hash/hash.js';
import { formatByteSize } from '../../common/text/byteSize.js';
import { h } from '../app/dom.js';
import { errorMessage } from '../../common/errorMessage.js';
import { verifyMatches } from './verifyCard.js';
import {
    buildDigestList,
    buildFormatSelect,
    buildHint,
    buildLabel,
    buildMessage,
    buildToolCard,
    runOnEnter,
    showMessage,
    toolId,
    type ToolCard,
    type ToolCardContext,
} from './toolCard.js';

export function buildHashCard(context: ToolCardContext): ToolCard {
    const { state } = context;
    const hash = state.hash;
    const textId = toolId('hash', 'text');
    const hintId = toolId('hash', 'hint');

    const textarea = h('textarea', {
        class: 'textarea textarea-mono tool-textarea',
        attrs: {
            'id': textId,
            'rows': '3',
            'spellcheck': 'false',
            'placeholder': 'Type or paste text, then press Enter',
            'aria-describedby': hintId,
        },
    });
    textarea.value = hash.text;

    const fileInput = h('input', { attrs: { 'type': 'file', 'hidden': true, 'tabindex': '-1', 'aria-hidden': 'true' } });
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';

        if (file != null) {
            void hashFileAsync(context, file);
        }
    });

    const chooseFile = h('button', {
        class: 'link-button',
        text: 'Choose file…',
        attrs: { type: 'button' },
        on: { click: () => fileInput.click() },
    });

    const sourceLine = buildMessage();
    const progress = h('progress', { class: 'hash-progress', attrs: { 'max': '1', 'value': '0', 'aria-label': 'Hashing progress', 'hidden': true } });
    const digestList = buildDigestList(HASH_ALGORITHMS.map((algorithm) => ({ key: algorithm, label: algorithm })));
    const formatSelect = buildFormatSelect(toolId('hash', 'format'), hash.format, (format) => {
        hash.format = format;
        context.refresh();
    });

    const isStale = (): boolean => hash.source?.kind === 'text' && hash.source.text !== hash.text;

    const updateSource = (): void => {
        if (hash.pending != null) {
            const percent = Math.floor(hash.pending.progress * 100);
            showMessage(sourceLine, { text: `Hashing ${hash.pending.name} · ${formatByteSize(hash.pending.size)}… ${percent}%`, tone: 'muted' });

            return;
        }

        if (hash.error != null) {
            showMessage(sourceLine, { text: hash.error, tone: 'fail' });

            return;
        }

        if (hash.source == null) {
            showMessage(sourceLine, null);

            return;
        }

        if (hash.source.kind === 'file') {
            showMessage(sourceLine, { text: `Digests of ${hash.source.name} · ${formatByteSize(hash.source.size)}`, tone: 'muted' });

            return;
        }

        const edited = isStale() ? ' · edited, press Enter to hash again' : '';
        showMessage(sourceLine, { text: `Digests of the text · ${formatByteSize(hash.source.byteLength)} as UTF-8${edited}`, tone: 'muted' });
    };

    textarea.addEventListener('input', () => {
        hash.text = textarea.value;
        updateSource();
        digestList.element.dataset['stale'] = String(isStale());
    });

    runOnEnter(textarea, () => {
        hash.text = textarea.value;
        void hashTextAsync(context);
    });

    const update = (): void => {
        progress.hidden = hash.pending == null;
        progress.value = hash.pending?.progress ?? 0;
        updateSource();

        const values = hash.digests == null
            ? null
            : new Map([...hash.digests].map(([algorithm, bytes]) => [algorithm, formatDigest(bytes, hash.format)]));
        digestList.update(values, verifyMatches(state), isStale());
    };

    const element = buildToolCard({
        id: 'hash',
        title: 'Hash',
        children: [
            h('div', {
                class: 'tool-field',
                children: [
                    h('div', { class: 'tool-row', children: [buildLabel(textId, 'Text'), h('span', { class: 'toolbar-spacer' }), chooseFile] }),
                    textarea,
                    fileInput,
                ],
            }),
            buildHint(hintId, 'Enter to hash · Shift+Enter for a new line · or drop a file on this card'),
            progress,
            sourceLine,
            h('div', {
                class: 'tool-row',
                children: [h('span', { class: 'tool-label', text: 'Digests' }), h('span', { class: 'toolbar-spacer' }), formatSelect],
            }),
            digestList.element,
        ],
    });

    registerFileDrop(element, {
        onFile: (file) => void hashFileAsync(context, file),
        onFolder: (name) => showUnreadable(context, name, 'it is a folder, not a file.'),
    });

    return { element, update };
}

// Hashes the typed text as UTF-8; empty text clears the card instead.
export async function hashTextAsync(context: ToolCardContext): Promise<void> {
    const hash = context.state.hash;
    const run = startRun(context);
    const text = hash.text;

    if (text === '') {
        hash.digests = null;
        hash.source = null;
        context.refresh();

        return;
    }

    const bytes = encodeUtf8(text);
    const digests = await digestAllAsync(bytes);

    if (run !== hash.run) {
        return;
    }

    hash.digests = digests;
    hash.source = { kind: 'text', text, byteLength: bytes.length };
    context.refresh();
}

export async function hashFileAsync(context: ToolCardContext, file: File): Promise<void> {
    const hash = context.state.hash;
    const run = startRun(context);
    const controller = new AbortController();
    hash.abort = controller;
    hash.pending = { name: file.name, size: file.size, progress: 0 };
    context.refresh();

    try {
        // Chrome hands a dropped folder over as an empty file without a type, which reads in slices
        // but fails when read whole, so such a file is read whole first.
        if (file.size === 0 && file.type === '') {
            await file.arrayBuffer();
        }

        const digests = await digestBlobAsync(file, {
            signal: controller.signal,
            onProgress: (fraction) => {
                if (run === hash.run && hash.pending != null) {
                    hash.pending = { ...hash.pending, progress: fraction };
                    context.refresh();
                }
            },
        });

        if (run !== hash.run) {
            return;
        }

        hash.digests = digests;
        hash.source = { kind: 'file', name: file.name, size: file.size };
    }
    catch (error) {
        if (run !== hash.run) {
            return;
        }

        const reason = errorMessage(error);
        hash.error = `Could not read ${file.name}: ${reason}`;
        hash.digests = null;
        hash.source = null;
    }

    hash.pending = null;
    hash.abort = null;
    context.refresh();
}

function showUnreadable(context: ToolCardContext, name: string, reason: string): void {
    const hash = context.state.hash;
    startRun(context);
    hash.error = `Could not read ${name}: ${reason}`;
    hash.digests = null;
    hash.source = null;
    context.refresh();
}

// Cancels a file still being hashed and starts a new computation.
function startRun(context: ToolCardContext): number {
    const hash = context.state.hash;
    hash.abort?.abort();
    hash.abort = null;
    hash.pending = null;
    hash.error = null;
    hash.run += 1;

    return hash.run;
}

interface FileDropHandlers {
    readonly onFile: (file: File) => void;
    readonly onFolder: (name: string) => void;
}

// A file dragged from the computer onto the card is hashed instead of opened; a folder says it can't be read.
function registerFileDrop(card: HTMLElement, handlers: FileDropHandlers): void {
    const isFileDrag = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragOver = (event: DragEvent): void => {
        if (!isFileDrag(event)) {
            return;
        }

        event.preventDefault();
        card.dataset['dragOver'] = 'true';

        if (event.dataTransfer != null) {
            event.dataTransfer.dropEffect = 'copy';
        }
    };

    card.addEventListener('dragenter', onDragOver);
    card.addEventListener('dragover', onDragOver);

    card.addEventListener('dragleave', (event) => {
        if (!card.contains(event.relatedTarget as Node | null)) {
            delete card.dataset['dragOver'];
        }
    });

    card.addEventListener('drop', (event) => {
        if (!isFileDrag(event)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        delete card.dataset['dragOver'];
        const file = event.dataTransfer?.files[0];
        // The entry is only there while the drop event runs.
        const isFolder = event.dataTransfer?.items[0]?.webkitGetAsEntry?.()?.isDirectory === true;

        if (file == null) {
            return;
        }

        if (isFolder) {
            handlers.onFolder(file.name);

            return;
        }

        handlers.onFile(file);
    });
}
