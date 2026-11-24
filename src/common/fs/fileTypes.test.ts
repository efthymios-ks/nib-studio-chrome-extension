import { describe, expect, it } from 'vitest';
import {
    EXTENSION_MAP,
    FILE_TYPES,
    fileTypeLabel,
    matchFileSuffix,
    resolveFileType,
} from './fileTypes.js';

describe('fileTypes', () => {
    describe('EXTENSION_MAP coverage', () => {
        for (const [suffix, expectedId] of EXTENSION_MAP) {
            it(`resolves .${suffix} to ${expectedId}`, () => {
                const type = resolveFileType(`sample.${suffix}`);

                expect(type.id).toBe(expectedId);
            });
        }
    });

    describe('resolveFileType', () => {
        it('is case-insensitive on the suffix', () => {
            expect(resolveFileType('README.MD').id).toBe('markdown');
            expect(resolveFileType('Notes.JsonC').id).toBe('json');
            expect(resolveFileType('IMG.PNG').id).toBe('image');
        });

        it('is case-insensitive on multi-segment suffixes', () => {
            expect(resolveFileType('bundle.TAR.GZ').id).toBe('archive');
        });

        it('picks the longest suffix first so .tar.gz beats .gz', () => {
            expect(resolveFileType('README.tar.gz').id).toBe('archive');
            expect(resolveFileType('archive.gz').id).toBe('archive');
        });

        it('resolves compressed tarballs, compressed files, cabinets and disc images to archive', () => {
            for (const name of ['a.tar.bz2', 'a.TBZ2', 'a.bz2', 'a.tar.xz', 'a.txz', 'a.xz', 'a.zst', 'a.tar.zst', 'setup.cab', 'disc.ISO']) {
                expect(resolveFileType(name).id, name).toBe('archive');
            }
        });

        it('resolves every Excel workbook and template, and OpenDocument spreadsheets, to excel', () => {
            for (const name of ['a.xlsx', 'a.xls', 'a.xlsm', 'a.XLTX', 'a.xltm', 'a.xlsb', 'a.ods']) {
                expect(resolveFileType(name).id, name).toBe('excel');
            }
        });

        it('resolves PowerPoint files and OpenDocument presentations to presentation, which is not text', () => {
            for (const name of ['a.ppt', 'a.PPTX', 'a.pptm', 'a.pps', 'a.ppsx', 'a.ppsm', 'a.pot', 'a.potx', 'a.potm', 'a.odp']) {
                expect(resolveFileType(name).id, name).toBe('presentation');
                expect(resolveFileType(name).isText, name).toBe(false);
            }
        });

        it('resolves OpenDocument text and drawings to opendocument, which is not text', () => {
            for (const name of ['letter.odt', 'plan.ODG']) {
                expect(resolveFileType(name).id, name).toBe('opendocument');
                expect(resolveFileType(name).isText, name).toBe(false);
            }
        });

        it('returns unknown when the name has no extension', () => {
            expect(resolveFileType('LICENSE').id).toBe('unknown');
            expect(resolveFileType('Makefile').id).toBe('unknown');
        });

        // Dotfiles like .gitignore have no stem before the dot,
        // so they fall through to the generic unknown type.
        it('returns unknown for dotfiles', () => {
            expect(resolveFileType('.gitignore').id).toBe('unknown');
            expect(resolveFileType('.env').id).toBe('unknown');
        });

        it('returns unknown for an empty string', () => {
            expect(resolveFileType('').id).toBe('unknown');
        });

        it('returns unknown for an unmapped extension', () => {
            expect(resolveFileType('binary.xyz').id).toBe('unknown');
        });
    });

    describe('matchFileSuffix', () => {
        it('returns the longest known suffix, lowercased', () => {
            expect(matchFileSuffix('Backup.TAR.XZ')).toBe('tar.xz');
            expect(matchFileSuffix('notes.xz')).toBe('xz');
            expect(matchFileSuffix('README.md')).toBe('md');
        });

        it('is null for a name without a known suffix', () => {
            expect(matchFileSuffix('LICENSE')).toBeNull();
            expect(matchFileSuffix('.gitignore')).toBeNull();
            expect(matchFileSuffix('binary.xyz')).toBeNull();
        });
    });

    describe('fileTypeLabel', () => {
        it('names each kind of workbook', () => {
            expect(fileTypeLabel('a.xlsx')).toBe('Excel workbook');
            expect(fileTypeLabel('a.XLS')).toBe('Excel 97–2003 workbook');
            expect(fileTypeLabel('a.xlsm')).toBe('Excel macro-enabled workbook');
            expect(fileTypeLabel('a.xltx')).toBe('Excel template');
            expect(fileTypeLabel('a.xltm')).toBe('Excel macro-enabled template');
            expect(fileTypeLabel('a.xlsb')).toBe('Excel binary workbook');
            expect(fileTypeLabel('a.ods')).toBe('OpenDocument spreadsheet');
        });

        it('names each kind of presentation and OpenDocument file', () => {
            expect(fileTypeLabel('a.pptx')).toBe('PowerPoint presentation');
            expect(fileTypeLabel('a.ppt')).toBe('PowerPoint 97–2003 presentation');
            expect(fileTypeLabel('a.ppsx')).toBe('PowerPoint slide show');
            expect(fileTypeLabel('a.pps')).toBe('PowerPoint 97–2003 slide show');
            expect(fileTypeLabel('a.potx')).toBe('PowerPoint template');
            expect(fileTypeLabel('a.pptm')).toBe('PowerPoint macro-enabled presentation');
            expect(fileTypeLabel('a.pot')).toBe('PowerPoint 97–2003 template');
            expect(fileTypeLabel('a.odp')).toBe('OpenDocument presentation');
            expect(fileTypeLabel('a.odt')).toBe('OpenDocument text document');
            expect(fileTypeLabel('a.odg')).toBe('OpenDocument drawing');
        });

        it('is null for the other types, which name themselves', () => {
            expect(fileTypeLabel('notes.md')).toBeNull();
            expect(fileTypeLabel('LICENSE')).toBeNull();
        });
    });

    describe('folder type', () => {
        it('has no arrow glyph, because the Explorer draws a folder icon', () => {
            const folder = FILE_TYPES.find((type) => type.id === 'folder');

            expect(folder?.glyph).toBe('');
        });
    });

    describe('FILE_TYPES registry', () => {
        it('declares a distinct glyph per type', () => {
            const glyphs = new Set(FILE_TYPES.map((type) => type.glyph));

            expect(glyphs.size).toBe(FILE_TYPES.length);
        });

        it('declares a distinct id per type', () => {
            const ids = new Set(FILE_TYPES.map((type) => type.id));

            expect(ids.size).toBe(FILE_TYPES.length);
        });
    });
});
