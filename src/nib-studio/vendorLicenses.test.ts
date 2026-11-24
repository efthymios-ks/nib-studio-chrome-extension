import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { VENDOR_LICENSES, type VendorLicense } from './vendorLicenses.js';

function entry(name: string, version?: string): VendorLicense | undefined {
    return VENDOR_LICENSES.find((candidate) => candidate.name === name && (version == null || candidate.version === version));
}

describe('VENDOR_LICENSES', () => {
    it('lists every runtime dependency with non-empty license text', () => {
        const listed = new Map(VENDOR_LICENSES.map((license) => [license.name, license]));

        for (const name of Object.keys(packageJson.dependencies)) {
            const license = listed.get(name);

            expect(license, `${name} is missing from VENDOR_LICENSES`).toBeDefined();
            expect(license?.text.trim(), `${name} has no license text`).not.toBe('');
        }
    });

    it('lists the packages the bundle takes from dependencies of dependencies, such as mermaid\'s', () => {
        for (const name of ['d3-shape', 'cytoscape', 'katex', 'lodash-es', 'khroma', 'jszip', 'elkjs', '@lezer/common']) {
            expect(entry(name), name).toBeDefined();
        }

        expect(VENDOR_LICENSES.length).toBeGreaterThan(Object.keys(packageJson.dependencies).length * 3);
    });

    it('gives every package a version, a license and license text, sorted by name and then version', () => {
        for (const license of VENDOR_LICENSES) {
            expect(license.version, license.name).toMatch(/^\d+\.\d+\.\d+/);
            expect(license.license.trim(), license.name).not.toBe('');
            expect(license.license, license.name).not.toBe('unknown');
            expect(license.text.trim(), license.name).not.toBe('');
        }

        const keys = VENDOR_LICENSES.map((license) => `${license.name} ${license.version}`);

        expect(new Set(keys).size).toBe(keys.length);
        expect(VENDOR_LICENSES.map((license) => license.name)).toEqual([...VENDOR_LICENSES.map((license) => license.name)].sort());
    });

    it('lists both copies of DOMPurify, ours and mermaid\'s, under the Apache License they are elected under', () => {
        const copies = VENDOR_LICENSES.filter((license) => license.name === 'dompurify');

        expect(copies.length).toBe(2);
        expect(copies[0]!.version.localeCompare(copies[1]!.version, 'en', { numeric: true })).toBeLessThan(0);

        for (const copy of copies) {
            expect(copy.license).toBe('Apache-2.0');
            expect(copy.text).toContain('Apache License');
        }
    });

    it('records the licenses elected for jszip and elkjs, with where elkjs\'s source is', () => {
        const elkjs = entry('elkjs');

        expect(entry('jszip')?.license).toBe('MIT');
        expect(elkjs?.license).toBe('EPL-2.0');
        expect(elkjs?.text).toContain('Eclipse Public License');
        expect(elkjs?.text).toContain(`https://www.npmjs.com/package/elkjs/v/${elkjs?.version}`);
        expect(elkjs?.text).toContain('https://github.com/kieler/elkjs');
    });

    it('names khroma\'s license, which its package.json leaves out', () => {
        expect(entry('khroma')?.license).toBe('MIT');
    });

    it('lists the licences of the decoders, fonts and CMaps that pdf.js ships with its own', () => {
        const text = entry('pdfjs-dist')?.text ?? '';

        for (const part of ['Apache License', 'JBIG2 decoder (PDFium)', 'OpenJPEG decoder', 'Foxit standard fonts', 'Adobe CMaps']) {
            expect(text, part).toContain(part);
        }
    });

    it('lists utif2 and exifr, which read TIFF pictures and the EXIF of HEIC', () => {
        expect(entry('utif2')).toBeDefined();
        expect(entry('exifr')).toBeDefined();
    });
});
