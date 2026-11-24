// Builds small, valid PDFs as bytes for tests: pages of a given size with a line of text, an Info dictionary,
// and optionally a MarkInfo dictionary, with a correct cross-reference table.

export interface TestPdfOptions {
    // Each page's size in points; one A4 page by default.
    readonly pages?: ReadonlyArray<readonly [width: number, height: number]>;
    // Info dictionary entries, written as PDF strings.
    readonly info?: Readonly<Record<string, string>>;
    readonly isTagged?: boolean;
    readonly version?: string;
    // Gives the trailer an Encrypt dictionary of the standard security handler, as a password-protected PDF has;
    // the page content stays as it is, so only a reader that checks for encryption tells.
    readonly isEncrypted?: boolean;
}

const A4: readonly [number, number] = [595.28, 841.89];

function pdfString(value: string): string {
    return `(${value.replace(/[()\\]/g, (character) => `\\${character}`)})`;
}

export function buildTestPdf(options: TestPdfOptions = {}): Uint8Array {
    const sizes = options.pages ?? [A4];
    const objects: string[] = [];
    const add = (body: string): number => {
        objects.push(body);

        return objects.length;
    };

    const catalog = add('');
    const pages = add('');
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = sizes.map(([width, height], index) => {
        const text = `BT /F1 12 Tf 72 ${height - 72} Td (Page ${index + 1}) Tj ET`;
        const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
        const mediaBox = `/MediaBox [0 0 ${width} ${height}]`;
        const resources = `/Resources << /Font << /F1 ${font} 0 R >> >>`;
        const parent = `/Parent ${pages} 0 R`;

        return add(`<< /Type /Page ${parent} ${mediaBox} ${resources} /Contents ${content} 0 R >>`);
    });
    const markInfo = options.isTagged == null ? '' : ` /MarkInfo << /Marked ${options.isTagged} >>`;
    const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R${markInfo} >>`;
    objects[pages - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;
    const infoEntries = Object.entries(options.info ?? {})
        .map(([key, value]) => `/${key} ${pdfString(value)}`);
    const info = infoEntries.length === 0 ? null : add(`<< ${infoEntries.join(' ')} >>`);
    const infoReference = info == null ? '' : ` /Info ${info} 0 R`;

    let body = `%PDF-${options.version ?? '1.7'}\n`;
    const offsets: number[] = [];

    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    const encryption = options.isEncrypted === true
        ? ` /Encrypt << /Filter /Standard /V 1 /R 2 /P -44 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> >> /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]`
        : '';
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${infoReference}${encryption} >>\n`;
    body += `startxref\n${xref}\n%%EOF\n`;

    return Uint8Array.from(body, (character) => character.charCodeAt(0) & 0xff);
}
