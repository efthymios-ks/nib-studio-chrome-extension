import { fileTypeLabel, matchFileSuffix } from '../../common/fs/fileTypes.js';
import { fileMetadataGroup } from '../../common/preview/metadataGroups.js';
import { createPreviewFrame } from './previewFrame.js';
import type { PreviewHandle } from './previewHandle.js';

// What a file with no preview of its own shows in place of one.
export interface PreviewMessage {
    // The toolbar badge, such as Archive or Presentation.
    readonly badge: string;
    // The Type row of the File group in Info.
    readonly typeLabel: string;
    readonly title: string;
    readonly message: string;
}

export interface MessagePreviewOptions {
    readonly file: File;
    readonly fileName: string;
    readonly memoryKey: string;
    readonly message: PreviewMessage;
}

const PRESENTATION_MESSAGE = Object.freeze({
    badge: 'Presentation',
    title: 'This presentation has no preview',
    message: 'Its slides aren\'t shown here. Open it with a presentation app, such as PowerPoint or LibreOffice Impress.',
});

// OpenDocument text and drawings, by suffix; every other file this covers is a presentation.
const OPENDOCUMENT_MESSAGES: ReadonlyMap<string, Omit<PreviewMessage, 'typeLabel'>> = new Map([
    ['odt', {
        badge: 'Document',
        title: 'This document has no preview',
        message: 'Its pages aren\'t shown here. Open it with a word processor, such as LibreOffice Writer or Word.',
    }],
    ['odg', {
        badge: 'Drawing',
        title: 'This drawing has no preview',
        message: 'It isn\'t drawn here. Open it with a drawing app, such as LibreOffice Draw.',
    }],
]);

// A file of an unknown type whose first bytes aren't text.
export const BINARY_PREVIEW_MESSAGE: PreviewMessage = Object.freeze({
    badge: 'Binary',
    typeLabel: 'Binary file',
    title: 'This file isn\'t text',
    message: 'It holds binary data, which can\'t be shown or edited here.',
});

// The message of a PowerPoint file, an OpenDocument presentation, or OpenDocument text or a drawing.
export function officePreviewMessage(fileName: string): PreviewMessage {
    const message = OPENDOCUMENT_MESSAGES.get(matchFileSuffix(fileName) ?? '') ?? PRESENTATION_MESSAGE;

    return { ...message, typeLabel: fileTypeLabel(fileName) ?? message.badge };
}

// A file with no preview shows a message in the frame and its File group in Info. Its bytes are never read:
// the name, size and date come from the File itself. There is no zoom; the toolbar holds only Info.
export function mountMessagePreview(host: HTMLElement, options: MessagePreviewOptions): PreviewHandle {
    const { badge, typeLabel, title, message } = options.message;
    const frame = createPreviewFrame({
        memoryKey: options.memoryKey,
        typeLabel: badge,
        zoom: false,
        label: `${badge} preview of ${options.fileName}`,
    });
    host.append(frame.element);
    let current = options.file;
    frame.showMessage(title, message);
    frame.setMetadata([fileMetadataGroup(current, typeLabel)]);

    return {
        element: frame.element,
        update: (file) => {
            if (file == null || file === current) {
                return;
            }

            current = file;
            frame.setMetadata([fileMetadataGroup(file, typeLabel)]);
        },
        destroy: () => {
            frame.destroy();
            frame.element.remove();
        },
    };
}
