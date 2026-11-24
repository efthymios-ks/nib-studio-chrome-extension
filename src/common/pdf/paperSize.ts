const POINTS_PER_INCH = 72;
const MILLIMETRES_PER_POINT = 25.4 / POINTS_PER_INCH;

interface PaperSize {
    readonly name: string;
    // Portrait: the shorter side first.
    readonly widthMm: number;
    readonly heightMm: number;
}

// The common sheet sizes, in the order they are tried.
const PAPER_SIZES: ReadonlyArray<PaperSize> = [
    { name: 'A4', widthMm: 210, heightMm: 297 },
    { name: 'Letter', widthMm: 215.9, heightMm: 279.4 },
    { name: 'Legal', widthMm: 215.9, heightMm: 355.6 },
    { name: 'A3', widthMm: 297, heightMm: 420 },
    { name: 'A5', widthMm: 148, heightMm: 210 },
    { name: 'A6', widthMm: 105, heightMm: 148 },
    { name: 'A2', widthMm: 420, heightMm: 594 },
    { name: 'A1', widthMm: 594, heightMm: 841 },
    { name: 'A0', widthMm: 841, heightMm: 1189 },
    { name: 'B4', widthMm: 250, heightMm: 353 },
    { name: 'B5', widthMm: 176, heightMm: 250 },
    { name: 'JIS B4', widthMm: 257, heightMm: 364 },
    { name: 'JIS B5', widthMm: 182, heightMm: 257 },
    { name: 'Tabloid', widthMm: 279.4, heightMm: 431.8 },
    { name: 'Executive', widthMm: 184.15, heightMm: 266.7 },
    { name: 'Statement', widthMm: 139.7, heightMm: 215.9 },
];

// PDF writers round page sizes to whole points or millimetres,
// so a sheet matches within this much on each side.
const MATCH_TOLERANCE_MM = 2;

// "A4" or "Letter landscape" for a page of this size in points; null when it is no common sheet.
export function paperSizeName(widthPt: number, heightPt: number): string | null {
    const width = widthPt * MILLIMETRES_PER_POINT;
    const height = heightPt * MILLIMETRES_PER_POINT;
    const shorter = Math.min(width, height);
    const longer = Math.max(width, height);
    const match = PAPER_SIZES.find((paper) => Math.abs(paper.widthMm - shorter) <= MATCH_TOLERANCE_MM
        && Math.abs(paper.heightMm - longer) <= MATCH_TOLERANCE_MM);

    if (match == null) {
        return null;
    }

    return width > height ? `${match.name} landscape` : match.name;
}

// "210 × 297 mm (8.27 × 11.69 in), A4", or without the name for an uncommon size.
export function formatPageSize(widthPt: number, heightPt: number): string {
    const widthMm = trimmed(widthPt * MILLIMETRES_PER_POINT, 1);
    const heightMm = trimmed(heightPt * MILLIMETRES_PER_POINT, 1);
    const widthIn = trimmed(widthPt / POINTS_PER_INCH, 2);
    const heightIn = trimmed(heightPt / POINTS_PER_INCH, 2);
    const name = paperSizeName(widthPt, heightPt);
    const size = `${widthMm} × ${heightMm} mm (${widthIn} × ${heightIn} in)`;

    return name == null ? size : `${size}, ${name}`;
}

// 210 rather than 210.0, 215.9 and 8.27: rounded to `digits` decimals with trailing zeros dropped.
function trimmed(value: number, digits: number): string {
    return String(Number(value.toFixed(digits)));
}
