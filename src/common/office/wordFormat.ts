import { decodeCp1252, decodeUtf16ByMark } from './codePage.js';
import { hasCompoundSignature } from './compoundFile.js';
import { isZip } from './zipPackage.js';

// What a file with a Word name really holds, read from its first bytes. 'early-word' is a Word for Windows 1.0
// or 2.0 file, which Word saved as a plain file rather than a compound file.
export type WordContainer = 'ooxml' | 'compound' | 'early-word' | 'rtf' | 'html' | 'xml' | 'text' | 'empty' | 'binary';

// The identifiers Word for Windows 1.0 (0xA59B) and 2.0 (0xA5DB) files start with, little-endian.
export const EARLY_WORD_IDENTS: ReadonlySet<number> = new Set([0xa59b, 0xa5db]);

const SNIFF_BYTES = 4096;
// Text may hold a few control characters, such as form feeds; more than this share is taken as binary.
const MAX_CONTROL_SHARE = 0.02;

export function sniffWordContainer(bytes: Uint8Array): WordContainer {
    if (bytes.length === 0) {
        return 'empty';
    }

    if (hasCompoundSignature(bytes)) {
        return 'compound';
    }

    if (isZip(bytes)) {
        return 'ooxml';
    }

    const head = decodeHead(bytes.subarray(0, SNIFF_BYTES));

    // An early Word file holds zero bytes from its header on, so text that starts with the same two bytes stays text.
    if (head == null) {
        return EARLY_WORD_IDENTS.has((bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8)) ? 'early-word' : 'binary';
    }

    const start = head.trimStart().slice(0, 512).toLowerCase();

    if (start.startsWith('{\\rtf')) {
        return 'rtf';
    }

    if (start.startsWith('<?xml') && !/<html[\s>]/.test(start)) {
        return 'xml';
    }

    if (start.startsWith('<!doctype html') || /<html[\s>]/.test(start)) {
        return 'html';
    }

    return 'text';
}

// The start of the file as text, or null when it reads as binary.
function decodeHead(head: Uint8Array): string | null {
    const utf16 = decodeUtf16ByMark(head);

    if (utf16 != null) {
        return utf16;
    }

    let controls = 0;

    for (const byte of head) {
        if (byte === 0) {
            return null;
        }

        if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
            controls += 1;
        }
    }

    return controls > head.length * MAX_CONTROL_SHARE ? null : new TextDecoder('utf-8').decode(head);
}

// The whole file as text: UTF-8 or UTF-16 by its byte order mark, or Windows-1252 when it isn't valid UTF-8.
export function decodePlainText(bytes: Uint8Array): string {
    const utf16 = decodeUtf16ByMark(bytes);

    if (utf16 != null) {
        return utf16;
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return decodeCp1252(bytes);
    }
}
