import { fail, succeed, type CodecResult } from './codecResult.js';

// Looks up a named character reference this module doesn't list, such as the browser's full HTML table.
export type EntityResolver = (name: string) => string | null;

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
});

// The common named references; anything else goes to the resolver.
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ensp: ' ',
    emsp: ' ',
    thinsp: ' ',
    shy: '­',
    copy: '©',
    reg: '®',
    trade: '™',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    lsquo: '‘',
    rsquo: '’',
    sbquo: '‚',
    ldquo: '“',
    rdquo: '”',
    bdquo: '„',
    laquo: '«',
    raquo: '»',
    lsaquo: '‹',
    rsaquo: '›',
    bull: '•',
    middot: '·',
    para: '¶',
    sect: '§',
    deg: '°',
    plusmn: '±',
    times: '×',
    divide: '÷',
    micro: 'µ',
    frac12: '½',
    frac14: '¼',
    frac34: '¾',
    sup1: '¹',
    sup2: '²',
    sup3: '³',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
    curren: '¤',
    iexcl: '¡',
    iquest: '¿',
    dagger: '†',
    Dagger: '‡',
    permil: '‰',
    prime: '′',
    Prime: '″',
    larr: '←',
    rarr: '→',
    uarr: '↑',
    darr: '↓',
    harr: '↔',
    rArr: '⇒',
    lArr: '⇐',
    hArr: '⇔',
    ne: '≠',
    le: '≤',
    ge: '≥',
    asymp: '≈',
    equiv: '≡',
    infin: '∞',
    minus: '−',
    radic: '√',
    sum: '∑',
    prod: '∏',
    part: '∂',
    nabla: '∇',
    isin: '∈',
    notin: '∉',
    cap: '∩',
    cup: '∪',
    and: '∧',
    or: '∨',
    forall: '∀',
    exist: '∃',
    empty: '∅',
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    epsilon: 'ε',
    lambda: 'λ',
    mu: 'μ',
    pi: 'π',
    sigma: 'σ',
    tau: 'τ',
    phi: 'φ',
    omega: 'ω',
    Delta: 'Δ',
    Sigma: 'Σ',
    Omega: 'Ω',
    hearts: '♥',
    check: '✓',
});

export function encodeHtmlEntities(text: string): string {
    return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

// Decodes named, decimal and hex references that end in `;`. A bare `&`, as in "AT&T", stays as it is;
// an unknown name, a reference without its `;`, or a number that isn't a character is reported where it starts.
export function decodeHtmlEntities(text: string, resolve?: EntityResolver): CodecResult<string> {
    const parts: string[] = [];
    let index = 0;

    while (index < text.length) {
        const ampersand = text.indexOf('&', index);

        if (ampersand < 0) {
            parts.push(text.slice(index));
            break;
        }

        parts.push(text.slice(index, ampersand));
        const reference = readReference(text, ampersand, resolve);

        if (!reference.ok) {
            return reference;
        }

        parts.push(reference.value.text);
        index = reference.value.end;
    }

    return succeed(parts.join(''));
}

interface DecodedReference {
    readonly text: string;
    readonly end: number;
}

function readReference(text: string, start: number, resolve?: EntityResolver): CodecResult<DecodedReference> {
    const numeric = /^&#(?:([0-9]+)|[xX]([0-9a-fA-F]+))(;?)/.exec(text.slice(start, start + 16));

    if (numeric != null) {
        const [whole, decimal, hex, semicolon] = numeric;
        const codePoint = decimal != null ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);

        if (semicolon !== ';') {
            return fail(`Character reference '${whole}' needs a closing ';'`, start, whole.length);
        }

        if (!isCharacter(codePoint)) {
            return fail(`'${whole}' is not a valid character`, start, whole.length);
        }

        return succeed({ text: String.fromCodePoint(codePoint), end: start + whole.length });
    }

    const named = /^&([A-Za-z][A-Za-z0-9]{0,31});/.exec(text.slice(start, start + 34));

    if (named == null) {
        if (text.startsWith('&#', start)) {
            return fail("'&#' must be followed by a decimal or x and hex digits", start, 2);
        }

        return succeed({ text: '&', end: start + 1 });
    }

    const [whole, name] = named;
    const character = Object.hasOwn(NAMED_ENTITIES, name ?? '')
        ? NAMED_ENTITIES[name ?? '']
        : resolve?.(name ?? '') ?? null;

    if (character == null) {
        return fail(`Unknown entity '${whole}'`, start, whole.length);
    }

    return succeed({ text: character, end: start + whole.length });
}

function isCharacter(codePoint: number): boolean {
    return codePoint > 0
        && codePoint <= 0x10ffff
        && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
}
