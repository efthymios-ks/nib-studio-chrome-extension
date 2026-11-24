import { describe, expect, it } from 'vitest';
import {
    applyCharacterSprms,
    applyParagraphSprms,
    applySectionSprms,
    applyWord6CharacterSprms,
    readSprms,
    resolveToggle,
} from './docSprms.js';

function codesAndOperands(grpprl: Uint8Array): Array<[string, number[]]> {
    return readSprms(grpprl).map((sprm) => [sprm.code.toString(16), [...sprm.operand]]);
}

describe('readSprms', () => {
    it('sizes operands by their spra bits, variable ones by their length byte', () => {
        const grpprl = Uint8Array.of(
            0x35, 0x08, 0x01,
            0x30, 0x4a, 0x05, 0x00,
            0x49, 0x66, 0x02, 0x00, 0x00, 0x00,
            0x15, 0xc6, 0x02, 0xaa, 0xbb,
            0x0b, 0x46, 0x03, 0x00,
        );

        expect(codesAndOperands(grpprl)).toEqual([
            ['835', [1]],
            ['4a30', [5, 0]],
            ['6649', [2, 0, 0, 0]],
            ['c615', [0xaa, 0xbb]],
            ['460b', [3, 0]],
        ]);
    });

    it('reads a table definition by its two-byte size and stops at a sprm that runs past the end', () => {
        expect(codesAndOperands(Uint8Array.of(0x08, 0xd6, 0x04, 0x00, 1, 2, 3, 0x35, 0x08, 0x01))).toEqual([['d608', [1, 2, 3]], ['835', [1]]]);
        expect(readSprms(Uint8Array.of(0x35, 0x08, 0x01, 0x49, 0x66, 0x01))).toHaveLength(1);
    });
});

describe('sprm values', () => {
    it('reads the paragraph, character and section values the preview uses, and skips the rest', () => {
        expect(applyParagraphSprms({}, Uint8Array.of(0x16, 0x24, 1, 0x17, 0x24, 1, 0x40, 0x26, 2, 0x03, 0x24, 3))).toEqual({
            inTable: true,
            rowEnd: true,
            outlineLevel: 2,
            justification: 3,
        });
        expect(applyCharacterSprms({}, Uint8Array.of(0x36, 0x08, 0x81, 0x43, 0x4a, 0x18, 0x00, 0x03, 0x6a, 0x10, 0, 0, 0))).toEqual({
            italic: 0x81,
            pictureLocation: 16,
        });
        expect(applySectionSprms({}, Uint8Array.of(0x1f, 0xb0, 0xd0, 0x2f, 0x21, 0xb0, 0xa0, 0x05))).toEqual({ pageWidth: 12240, marginLeft: 1440 });
    });

    it('takes the picture location from either of its sprms, sprmCPicLocation first', () => {
        expect(applyCharacterSprms({}, Uint8Array.of(0x09, 0x6a, 0x20, 0, 0, 0))).toEqual({ pictureLocation: 32 });
        expect(applyCharacterSprms({}, Uint8Array.of(0x03, 0x6a, 0x10, 0, 0, 0, 0x09, 0x6a, 0x20, 0, 0, 0))).toEqual({ pictureLocation: 16 });
    });

    it('reads Word 6 character sprms by their one-byte codes, and stops at a code it doesn\'t know', () => {
        const grpprl = Uint8Array.of(93, 0, 0, 68, 4, 1, 2, 3, 4, 85, 1, 94, 1, 104, 2, 117, 1, 200, 86, 1);

        expect(applyWord6CharacterSprms({}, grpprl)).toEqual({ bold: 1, underline: 1, position: 2, special: 1 });
        expect(applyWord6CharacterSprms({}, Uint8Array.of(86, 1, 92))).toEqual({ italic: 1 });
    });

    it('resolves toggles against the style', () => {
        expect([undefined, 0, 1, 0x80, 0x81].map((operand) => resolveToggle(operand, true))).toEqual([true, false, true, true, false]);
        expect([undefined, 0, 1, 0x80, 0x81].map((operand) => resolveToggle(operand, false))).toEqual([false, false, true, false, true]);
    });
});
