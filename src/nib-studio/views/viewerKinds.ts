import { resolveFileType } from '../../common/fs/fileTypes.js';

export type ViewerKind =
    | 'editor'
    | 'table'
    | 'document'
    | 'image'
    | 'audio'
    | 'video'
    | 'font'
    | 'pdf'
    | 'archive'
    | 'office'
    | 'binary';

// The viewer kinds that open as a view-only preview in the shared preview frame.
// `office` is a presentation or an OpenDocument text or drawing, which has no preview of its own,
// and `binary` a file of an unknown type whose bytes aren't text; it is picked by the bytes, never by the name.
export type PreviewKind = 'image' | 'audio' | 'video' | 'font' | 'pdf' | 'document' | 'archive' | 'office' | 'binary';

const PREVIEW_KINDS = new Set<ViewerKind>(['image', 'audio', 'video', 'font', 'pdf', 'document', 'archive', 'office', 'binary']);

export function pickViewer(name: string): ViewerKind {
    const type = resolveFileType(name);

    if (type.id === 'csv' || type.id === 'excel') {
        return 'table';
    }

    if (type.id === 'word') {
        return 'document';
    }

    if (type.id === 'presentation' || type.id === 'opendocument') {
        return 'office';
    }

    if (
        type.id === 'image'
        || type.id === 'audio'
        || type.id === 'video'
        || type.id === 'font'
        || type.id === 'pdf'
        || type.id === 'archive'
    ) {
        return type.id;
    }

    return 'editor';
}

export function isPreviewKind(kind: ViewerKind): kind is PreviewKind {
    return PREVIEW_KINDS.has(kind);
}

// Word documents, PDFs, images, audio, video, fonts, archives, presentations and OpenDocument text and drawings
// are shown from their File and never read as text, so they have no text to edit, save or compare.
export function holdsNoText(name: string): boolean {
    return isPreviewKind(pickViewer(name));
}
