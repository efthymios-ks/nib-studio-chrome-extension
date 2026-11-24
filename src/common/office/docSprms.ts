// Single property modifiers (sprms), the unit Word 97–2003 stores paragraph, character, table and section formatting in.

interface Sprm {
    readonly code: number;
    // The operand, without the length prefix of variable-length sprms.
    readonly operand: Uint8Array;
}

const SPRM_TABLE_DEFINITION = 0xd608;
const SPRM_CHANGE_TABS = 0xc615;

// Operand sizes by the sprm's spra bits; 6 is variable and 7 three bytes.
const FIXED_OPERAND_SIZES: ReadonlyArray<number> = [1, 1, 2, 4, 2, 2, -1, 3];

// The sprms of a grpprl, in order; reading stops at one that would run past the end.
export function readSprms(grpprl: Uint8Array): Sprm[] {
    const sprms: Sprm[] = [];
    let position = 0;

    while (position + 2 <= grpprl.length) {
        const code = (grpprl[position] ?? 0) | ((grpprl[position + 1] ?? 0) << 8);
        const operand = operandAt(grpprl, code, position + 2);

        if (operand == null) {
            break;
        }

        sprms.push({ code, operand: grpprl.subarray(operand.start, operand.end) });
        position = operand.end;
    }

    return sprms;
}

function operandAt(grpprl: Uint8Array, code: number, start: number): { readonly start: number; readonly end: number } | null {
    const fixed = FIXED_OPERAND_SIZES[code >>> 13] ?? -1;

    if (fixed > 0) {
        return start + fixed <= grpprl.length ? { start, end: start + fixed } : null;
    }

    if (code === SPRM_TABLE_DEFINITION) {
        // A two-byte size that counts itself less one.
        const size = (grpprl[start] ?? 0) | ((grpprl[start + 1] ?? 0) << 8);
        const end = start + size + 1;

        return size > 0 && end <= grpprl.length ? { start: start + 2, end } : null;
    }

    const size = grpprl[start];

    if (size == null || (code === SPRM_CHANGE_TABS && size === 255)) {
        return null;
    }

    const end = start + 1 + size;

    return end <= grpprl.length ? { start: start + 1, end } : null;
}

function operandNumber(operand: Uint8Array): number {
    if (operand.length >= 4) {
        return new DataView(operand.buffer, operand.byteOffset, 4).getInt32(0, true);
    }

    if (operand.length >= 2) {
        return new DataView(operand.buffer, operand.byteOffset, 2).getInt16(0, true);
    }

    return operand[0] ?? 0;
}

function operandUnsigned(operand: Uint8Array): number {
    if (operand.length >= 2) {
        return new DataView(operand.buffer, operand.byteOffset, 2).getUint16(0, true);
    }

    return operand[0] ?? 0;
}

// Paragraph formatting the preview uses; a missing field was not set.
export interface ParagraphSprmValues {
    inTable?: boolean;
    rowEnd?: boolean;
    depth?: number;
    innerRowEnd?: boolean;
    outlineLevel?: number;
    justification?: number;
    listIndex?: number;
    listLevel?: number;
    headerRow?: boolean;
}

type ParagraphApply = (values: ParagraphSprmValues, operand: Uint8Array) => void;

const PARAGRAPH_SPRMS: ReadonlyMap<number, ParagraphApply> = new Map<number, ParagraphApply>([
    [0x2416, (values, operand) => { values.inTable = operand[0] === 1; }],
    [0x2417, (values, operand) => { values.rowEnd = operand[0] === 1; }],
    [0x6649, (values, operand) => { values.depth = operandNumber(operand); }],
    [0x244c, (values, operand) => { values.innerRowEnd = operand[0] === 1; }],
    [0x2640, (values, operand) => { values.outlineLevel = operand[0] ?? 9; }],
    [0x2403, (values, operand) => { values.justification = operand[0] ?? 0; }],
    [0x2461, (values, operand) => { values.justification = operand[0] ?? 0; }],
    [0x460b, (values, operand) => { values.listIndex = operandNumber(operand); }],
    [0x260a, (values, operand) => { values.listLevel = operand[0] ?? 0; }],
    [0x3404, (values, operand) => { values.headerRow = operand[0] === 1; }],
]);

export function applyParagraphSprms(values: ParagraphSprmValues, grpprl: Uint8Array): ParagraphSprmValues {
    for (const sprm of readSprms(grpprl)) {
        PARAGRAPH_SPRMS.get(sprm.code)?.(values, sprm.operand);
    }

    return values;
}

// Character formatting the preview uses. Toggles keep Word's raw operand: 0 off, 1 on,
// 0x80 as the style has it and 0x81 the opposite of the style.
export interface CharacterSprmValues {
    bold?: number;
    italic?: number;
    strike?: number;
    underline?: number;
    hidden?: number;
    deleted?: number;
    special?: number;
    position?: number;
    characterStyle?: number;
    // Where a picture character's PICF record sits in the Data stream.
    pictureLocation?: number;
}

type CharacterApply = (values: CharacterSprmValues, operand: Uint8Array) => void;

const CHARACTER_SPRMS: ReadonlyMap<number, CharacterApply> = new Map<number, CharacterApply>([
    [0x0835, (values, operand) => { values.bold = operand[0] ?? 0; }],
    [0x0836, (values, operand) => { values.italic = operand[0] ?? 0; }],
    [0x0837, (values, operand) => { values.strike = operand[0] ?? 0; }],
    [0x2a53, (values, operand) => { values.strike = operand[0] ?? 0; }],
    [0x2a3e, (values, operand) => { values.underline = operand[0] ?? 0; }],
    [0x083c, (values, operand) => { values.hidden = operand[0] ?? 0; }],
    [0x0800, (values, operand) => { values.deleted = operand[0] ?? 0; }],
    [0x0855, (values, operand) => { values.special = operand[0] ?? 0; }],
    [0x2a48, (values, operand) => { values.position = operand[0] ?? 0; }],
    [0x4a30, (values, operand) => { values.characterStyle = operandUnsigned(operand); }],
    [0x6a03, (values, operand) => { values.pictureLocation = operandNumber(operand) >>> 0; }],
    [0x6a09, (values, operand) => { values.pictureLocation ??= operandNumber(operand) >>> 0; }],
]);

export function applyCharacterSprms(values: CharacterSprmValues, grpprl: Uint8Array): CharacterSprmValues {
    for (const sprm of readSprms(grpprl)) {
        CHARACTER_SPRMS.get(sprm.code)?.(values, sprm.operand);
    }

    return values;
}

interface Word6Sprm {
    // The operand's size; -1 for a variable operand after a length byte.
    readonly size: number;
    readonly apply?: CharacterApply;
}

// Sets a value that takes the operand's one byte as it is.
const byteOperand = (key: 'bold' | 'italic' | 'strike' | 'hidden' | 'deleted' | 'special' | 'underline' | 'position'): CharacterApply => (
    (values, operand) => { values[key] = operand[0] ?? 0; }
);

// Word 6 and Word 95 character sprms: a one-byte code, then an operand of a size each code fixes.
const WORD6_CHARACTER_SPRMS: ReadonlyMap<number, Word6Sprm> = new Map<number, Word6Sprm>([
    [65, { size: 1, apply: byteOperand('deleted') }],
    [66, { size: 1 }],
    [67, { size: 1 }],
    [68, { size: -1 }],
    [69, { size: 2 }],
    [70, { size: 4 }],
    [71, { size: 1 }],
    [72, { size: 2 }],
    [73, { size: 3 }],
    [74, { size: -1 }],
    [75, { size: 1 }],
    [77, { size: -1 }],
    [79, { size: -1 }],
    [80, { size: 2 }],
    [81, { size: -1 }],
    [82, { size: -1 }],
    [83, { size: 0 }],
    [85, { size: 1, apply: byteOperand('bold') }],
    [86, { size: 1, apply: byteOperand('italic') }],
    [87, { size: 1, apply: byteOperand('strike') }],
    [88, { size: 1 }],
    [89, { size: 1 }],
    [90, { size: 1 }],
    [91, { size: 1 }],
    [92, { size: 1, apply: byteOperand('hidden') }],
    [93, { size: 2 }],
    [94, { size: 1, apply: byteOperand('underline') }],
    [95, { size: 3 }],
    [96, { size: 2 }],
    [97, { size: 2 }],
    [98, { size: 1 }],
    [99, { size: 2 }],
    [100, { size: 1 }],
    [101, { size: 2 }],
    [102, { size: 1 }],
    [103, { size: -1 }],
    [104, { size: 1, apply: byteOperand('position') }],
    [105, { size: -1 }],
    [106, { size: -1 }],
    [107, { size: 2 }],
    [108, { size: -1 }],
    [109, { size: 2 }],
    [110, { size: 2 }],
    [111, { size: 2 }],
    [112, { size: 2 }],
    [113, { size: -1 }],
    [115, { size: -1 }],
    [116, { size: -1 }],
    [117, { size: 1, apply: byteOperand('special') }],
    [118, { size: 1 }],
]);

// Reading stops at a code the table doesn't know, as its operand's size, and so the next code, is unknown.
export function applyWord6CharacterSprms(values: CharacterSprmValues, grpprl: Uint8Array): CharacterSprmValues {
    let position = 0;

    while (position < grpprl.length) {
        const sprm = WORD6_CHARACTER_SPRMS.get(grpprl[position] ?? 0);

        if (sprm == null) {
            break;
        }

        const start = position + 1 + (sprm.size < 0 ? 1 : 0);
        const end = start + (sprm.size < 0 ? grpprl[position + 1] ?? 0 : sprm.size);

        if (end > grpprl.length) {
            break;
        }

        sprm.apply?.(values, grpprl.subarray(start, end));
        position = end;
    }

    return values;
}

// Resolves a toggle against what the style says.
export function resolveToggle(operand: number | undefined, styleValue: boolean): boolean {
    if (operand == null || operand === 0x80) {
        return styleValue;
    }

    if (operand === 0x81) {
        return !styleValue;
    }

    return operand === 1;
}

// Section page setup, in twips.
interface SectionSprmValues {
    pageWidth?: number;
    pageHeight?: number;
    marginLeft?: number;
    marginRight?: number;
    marginTop?: number;
    marginBottom?: number;
}

const SECTION_SPRMS: ReadonlyMap<number, keyof SectionSprmValues> = new Map<number, keyof SectionSprmValues>([
    [0xb01f, 'pageWidth'],
    [0xb020, 'pageHeight'],
    [0xb021, 'marginLeft'],
    [0xb022, 'marginRight'],
    [0x9023, 'marginTop'],
    [0x9024, 'marginBottom'],
]);

export function applySectionSprms(values: SectionSprmValues, grpprl: Uint8Array): SectionSprmValues {
    for (const sprm of readSprms(grpprl)) {
        const key = SECTION_SPRMS.get(sprm.code);

        if (key != null) {
            values[key] = Math.abs(operandNumber(sprm.operand));
        }
    }

    return values;
}
