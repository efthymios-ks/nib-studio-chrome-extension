import { describe, expect, it } from 'vitest';
import { createFakeEngine, createFakePdf } from '../testing/fakePdf.js';
import { readPdfTextAsync } from './lookupPdfText.js';

const LETTER: readonly [number, number] = [612, 792];
const FILE = new File(['%PDF-1.7'], 'invoice.pdf');

describe('readPdfTextAsync', () => {
    it('reads every page\'s text items in order, the end of a line as a space, and lets the document go', async () => {
        const pdf = createFakePdf({
            pages: [LETTER, LETTER],
            texts: { 0: [{ str: 'Invoice 1042', hasEOL: true }, 'Customer: ', 'Anna Smith'], 1: ['Total: 1,250.00'] },
        });
        const outcome = await readPdfTextAsync(FILE, null, async () => createFakeEngine(pdf).engine);

        expect(outcome).toEqual({ kind: 'text', text: 'Invoice 1042 Customer: Anna Smith Total: 1,250.00', isUnlocked: false });
        expect(pdf.destroy).toHaveBeenCalled();
    });

    it('opens a protected PDF only with the password its tab was unlocked with', async () => {
        const pdf = (): ReturnType<typeof createFakePdf> => createFakePdf({ pages: [LETTER], texts: { 0: ['Confidential'] } });

        expect(await readPdfTextAsync(FILE, null, async () => createFakeEngine(pdf(), '1234').engine)).toEqual({ kind: 'locked' });
        expect(await readPdfTextAsync(FILE, 'wrong', async () => createFakeEngine(pdf(), '1234').engine)).toEqual({ kind: 'locked' });
        expect(await readPdfTextAsync(FILE, '1234', async () => createFakeEngine(pdf(), '1234').engine))
            .toEqual({ kind: 'text', text: 'Confidential', isUnlocked: true });
    });

    it('keeps only the name of a scan with no text, or of a PDF pdf.js can\'t read', async () => {
        const scan = createFakeEngine(createFakePdf({ pages: [LETTER], texts: { 0: [' '] } }));
        const broken = createFakeEngine(createFakePdf({ pages: [LETTER] }));
        broken.openAsync.mockRejectedValueOnce(new Error('Invalid PDF structure.'));

        expect(await readPdfTextAsync(FILE, null, async () => scan.engine)).toEqual({ kind: 'name-only' });
        expect(await readPdfTextAsync(FILE, null, async () => broken.engine)).toEqual({ kind: 'name-only' });
    });
});
