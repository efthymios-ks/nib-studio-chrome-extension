import type { DocParagraphRole } from './docModel.js';
import {
    applyCharacterSprms,
    applyParagraphSprms,
    resolveToggle,
    type CharacterSprmValues,
    type ParagraphSprmValues,
} from './docSprms.js';

// A style from the stylesheet (STSH) of a Word 97–2003 file.
export interface DocStyle {
    // The built-in style identifier; 0x0ffe for a style the user made.
    readonly sti: number;
    readonly name: string;
    readonly baseIndex: number;
    readonly paragraph: ParagraphSprmValues;
    readonly character: CharacterSprmValues;
}

// What a paragraph style means once its base styles are applied.
export interface ResolvedStyle {
    readonly role: DocParagraphRole;
    readonly level: number;
    readonly paragraph: ParagraphSprmValues;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strike: boolean;
}

interface StyleRole {
    readonly role: DocParagraphRole;
    readonly level: number;
}

const NO_BASE = 0x0fff;
const STI_TITLE = 62;
const STI_SUBTITLE = 74;
const MAX_BASE_DEPTH = 16;

const EMPTY_STYLE: ResolvedStyle = Object.freeze({
    role: 'body',
    level: 0,
    paragraph: Object.freeze({}),
    bold: false,
    italic: false,
    underline: false,
    strike: false,
});

// Reads the styles; a style that can't be read is null, and a stylesheet that can't be read is empty.
export function readStyleSheet(
    table: Uint8Array,
    location: { readonly offset: number; readonly length: number },
): Array<DocStyle | null> {
    const { offset, length } = location;
    const end = Math.min(table.length, offset + length);

    if (length < 4 || end <= offset) {
        return [];
    }

    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const headerSize = view.getUint16(offset, true);
    const count = view.getUint16(offset + 2, true);
    const baseSize = view.getUint16(offset + 4, true);
    const styles: Array<DocStyle | null> = [];
    let position = offset + 2 + headerSize;

    for (let index = 0; index < count && position + 2 <= end; index += 1) {
        const size = view.getUint16(position, true);
        const start = position + 2;
        position = start + size;
        styles.push(size === 0 || position > end ? null : readStyle(table, view, start, size, baseSize));
    }

    return styles;
}

function readStyle(table: Uint8Array, view: DataView, start: number, size: number, baseSize: number): DocStyle | null {
    if (size < 10) {
        return null;
    }

    const sti = view.getUint16(start, true) & 0x0fff;
    const kindAndBase = view.getUint16(start + 2, true);
    const kind = kindAndBase & 0x000f;
    const upxCount = view.getUint16(start + 4, true) & 0x000f;
    const nameAt = start + Math.max(10, baseSize);
    const end = start + size;

    if (nameAt + 2 > end) {
        return null;
    }

    const nameLength = view.getUint16(nameAt, true);
    const nameEnd = nameAt + 2 + nameLength * 2;
    const name = nameEnd <= end ? new TextDecoder('utf-16le').decode(table.subarray(nameAt + 2, nameEnd)) : '';
    const upxs = readUpxs(table, view, { styleStart: start, from: nameEnd + 2, end, count: upxCount });
    const paragraph: ParagraphSprmValues = {};
    const character: CharacterSprmValues = {};

    // Paragraph styles hold paragraph then character properties, character styles character properties only,
    // and table styles table, paragraph and character properties.
    if (kind === 1) {
        applyParagraphSprms(paragraph, upxs[0]?.subarray(2) ?? new Uint8Array());
        applyCharacterSprms(character, upxs[1] ?? new Uint8Array());
    }

    if (kind === 2) {
        applyCharacterSprms(character, upxs[0] ?? new Uint8Array());
    }

    return {
        sti,
        name: name.split(',')[0]?.trim() ?? '',
        baseIndex: kindAndBase >>> 4,
        paragraph,
        character,
    };
}

function readUpxs(
    table: Uint8Array,
    view: DataView,
    layout: { readonly styleStart: number; readonly from: number; readonly end: number; readonly count: number },
): Uint8Array[] {
    const upxs: Uint8Array[] = [];
    let position = layout.from;

    for (let index = 0; index < layout.count; index += 1) {
        // Each property block starts on an even offset from the start of the style.
        if ((position - layout.styleStart) % 2 === 1) {
            position += 1;
        }

        if (position + 2 > layout.end) {
            break;
        }

        const size = view.getUint16(position, true);
        const start = position + 2;

        if (start + size > layout.end) {
            break;
        }

        upxs.push(table.subarray(start, start + size));
        position = start + size;
    }

    return upxs;
}

// The style and its base styles, nearest first; a loop of bases ends the chain.
function styleChain(styles: ReadonlyArray<DocStyle | null>, index: number): DocStyle[] {
    const chain: DocStyle[] = [];
    let current = index;

    while (current !== NO_BASE && chain.length < MAX_BASE_DEPTH) {
        const style = styles[current];

        if (style == null || chain.includes(style)) {
            break;
        }

        chain.push(style);
        current = style.baseIndex;
    }

    return chain;
}

// Resolves a paragraph style with its base styles; character formatting and paragraph values from the nearest style win.
export function resolveStyle(styles: ReadonlyArray<DocStyle | null>, index: number): ResolvedStyle {
    const chain = styleChain(styles, index);

    if (chain.length === 0) {
        return EMPTY_STYLE;
    }

    const paragraph: ParagraphSprmValues = Object.assign({}, ...[...chain].reverse().map((style) => style.paragraph));
    const character: CharacterSprmValues = Object.assign({}, ...[...chain].reverse().map((style) => style.character));
    const { role, level } = styleRole(chain, paragraph);

    return {
        role,
        level,
        paragraph,
        bold: resolveToggle(character.bold, false),
        italic: resolveToggle(character.italic, false),
        underline: (character.underline ?? 0) !== 0,
        strike: resolveToggle(character.strike, false),
    };
}

// The style's own built-in identity decides first, then its name, then the outline level it carries.
function styleRole(chain: ReadonlyArray<DocStyle>, paragraph: ParagraphSprmValues): StyleRole {
    for (const style of chain) {
        const heading = /^heading\s+([1-9])$/i.exec(style.name);

        if ((style.sti >= 1 && style.sti <= 9) || heading != null) {
            return { role: 'heading', level: Math.min(6, heading == null ? style.sti : Number(heading[1])) };
        }

        if (style.sti === STI_TITLE || /^title$/i.test(style.name)) {
            return { role: 'title', level: 0 };
        }

        if (style.sti === STI_SUBTITLE || /^subtitle$/i.test(style.name)) {
            return { role: 'subtitle', level: 0 };
        }
    }

    const outline = paragraph.outlineLevel;

    if (outline != null && outline >= 0 && outline <= 8) {
        return { role: 'heading', level: Math.min(6, outline + 1) };
    }

    return { role: 'body', level: 0 };
}

// The character formatting a character style adds, with its base styles.
export function resolveCharacterStyle(styles: ReadonlyArray<DocStyle | null>, index: number): CharacterSprmValues {
    const chain = styleChain(styles, index);

    return Object.assign({}, ...[...chain].reverse().map((style) => style.character));
}
