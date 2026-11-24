import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { isZip, openZipPackage } from './zipPackage.js';

async function buildZipAsync(
    entries: Readonly<Record<string, string | Uint8Array>>,
    compression: 'DEFLATE' | 'STORE',
): Promise<Uint8Array> {
    const zip = new JSZip();

    for (const [name, text] of Object.entries(entries)) {
        zip.file(name, text);
    }

    return await zip.generateAsync({ type: 'uint8array', compression });
}

describe('openZipPackage', () => {
    it('inflates a deflated part by name, with or without a leading slash', async () => {
        const text = '<w:document>'.concat('Γειά σου κόσμε. '.repeat(200), '</w:document>');
        const bytes = await buildZipAsync({ 'word/document.xml': text, '[Content_Types].xml': '<Types/>' }, 'DEFLATE');
        const zip = openZipPackage(bytes);

        expect(isZip(bytes)).toBe(true);
        expect(zip?.entries.get('word/document.xml')?.method).toBe(8);
        expect(zip?.readText('word/document.xml')).toBe(text);
        expect(zip?.readText('/[Content_Types].xml')).toBe('<Types/>');
    });

    it('lists every entry of the central directory, folders included, and reads binary parts', async () => {
        const zip = openZipPackage(await buildZipAsync({ 'a.txt': 'a', 'folder/b.bin': Uint8Array.of(1, 2, 3) }, 'DEFLATE'));

        expect([...zip?.entries.keys() ?? []]).toEqual(['a.txt', 'folder/', 'folder/b.bin']);
        expect([...zip?.read('/folder/b.bin') ?? []]).toEqual([1, 2, 3]);
    });

    it('reads a stored part as it is', async () => {
        const bytes = await buildZipAsync({ 'a.txt': 'plain' }, 'STORE');

        expect(openZipPackage(bytes)?.readText('a.txt')).toBe('plain');
    });

    it('gives null for a missing part, for damaged DEFLATE data and for bytes that are no ZIP', async () => {
        const bytes = await buildZipAsync({ 'a.txt': 'x'.repeat(4000) }, 'DEFLATE');
        const zip = openZipPackage(bytes);
        const entry = zip?.entries.get('a.txt');
        const damaged = bytes.slice();
        const dataStart = (entry?.headerOffset ?? 0) + 30 + 'a.txt'.length;
        damaged.fill(0xff, dataStart, dataStart + (entry?.compressedSize ?? 0));

        expect(zip?.read('b.txt')).toBeNull();
        expect(openZipPackage(damaged)?.read('a.txt')).toBeNull();
        expect(openZipPackage(new TextEncoder().encode('not a zip'))).toBeNull();
        expect(openZipPackage(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3))).toBeNull();
        expect(openZipPackage(new Uint8Array(30))).toBeNull();
    });
});
