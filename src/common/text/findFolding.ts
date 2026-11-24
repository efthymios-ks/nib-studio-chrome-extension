// How Find compares text in the Word and PDF previews, and how Lookup matches names and contents:
// lower case, without accents or other marks, and a final sigma as σ, so ΟΔΟΣ, οδός and οδος all match.

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /^\s$/u;
const LETTER = /^\p{L}$/u;
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;
const CLASS_SYNTAX = /[\\\]^-]/g;

// The blocks whose accented letters fold to a plain one: Latin-1 and Latin Extended, Greek and Coptic, and Greek Extended.
const FOLD_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x00c0, 0x024f],
    [0x0370, 0x03ff],
    [0x1f00, 0x1fff],
];

// One character as Find compares it.
export function foldCharacter(character: string): string {
    return character
        .toLowerCase()
        .normalize('NFD')
        .replace(COMBINING_MARKS, '')
        .replaceAll('ς', 'σ');
}

// Folds text one character at a time, white space such as a no-break space to a plain space, and keeps any
// character whose fold has another length as it is,
// so offsets in the folded text are offsets in the original.
export function foldKeepingOffsets(text: string): string {
    return Array.from(text, (character) => {
        if (WHITESPACE.test(character)) {
            return ' ';
        }

        const folded = foldCharacter(character);

        return folded.length === character.length ? folded : character;
    }).join('');
}

let foldVariants: ReadonlyMap<string, string> | null = null;

// Every plain lower-case letter and the lower-case letters that fold to it, such as α and άὰᾶ…, built on first use.
function variantsByLetter(): ReadonlyMap<string, string> {
    if (foldVariants != null) {
        return foldVariants;
    }

    const variants = new Map<string, string>();

    for (const [first, last] of FOLD_RANGES) {
        for (let code = first; code <= last; code += 1) {
            const letter = String.fromCodePoint(code).toLowerCase();
            const base = foldCharacter(letter);
            const isVariant = letter.length === 1 && base !== letter && LETTER.test(base);

            if (!isVariant || variants.get(base)?.includes(letter) === true) {
                continue;
            }

            variants.set(base, `${variants.get(base) ?? ''}${letter}`);
        }
    }

    foldVariants = variants;

    return variants;
}

// The source of a regular expression that matches a typed character and every character that folds the same way,
// such as `[αάὰᾶ…]` for α or Ά; null for a mark on its own, which folds to nothing.
// Case is left to the expression's `i` flag.
export function foldPattern(character: string): string | null {
    const folded = foldCharacter(character);

    if (folded === '') {
        return null;
    }

    const base = folded.length === 1 ? folded : character.toLowerCase();
    const variants = variantsByLetter().get(base);

    if (variants == null) {
        return base.replace(REGEX_SYNTAX, '\\$&');
    }

    return `[${`${base}${variants}`.replace(CLASS_SYNTAX, '\\$&')}]`;
}
