import { describe, expect, it } from 'vitest';
import { EXTENSION_MAP } from '../fs/fileTypes.js';
import { archiveTypeLabel } from './archiveFormat.js';

describe('archiveTypeLabel', () => {
    it('names archives by their format', () => {
        expect(archiveTypeLabel('photos.zip')).toBe('ZIP archive');
        expect(archiveTypeLabel('backup.7z')).toBe('7-Zip archive');
        expect(archiveTypeLabel('backup.RAR')).toBe('RAR archive');
        expect(archiveTypeLabel('setup.cab')).toBe('Cabinet archive');
        expect(archiveTypeLabel('ubuntu.iso')).toBe('ISO disc image');
    });

    it('takes the longest suffix, so a compressed tarball is named as one', () => {
        expect(archiveTypeLabel('site.tar')).toBe('Tar archive');
        expect(archiveTypeLabel('site.tar.gz')).toBe('Gzip-compressed tar archive');
        expect(archiveTypeLabel('site.TGZ')).toBe('Gzip-compressed tar archive');
        expect(archiveTypeLabel('access.log.gz')).toBe('Gzip archive');
        expect(archiveTypeLabel('site.tar.bz2')).toBe('Bzip2-compressed tar archive');
        expect(archiveTypeLabel('site.tbz2')).toBe('Bzip2-compressed tar archive');
        expect(archiveTypeLabel('dump.bz2')).toBe('Bzip2 archive');
        expect(archiveTypeLabel('site.tar.xz')).toBe('XZ-compressed tar archive');
        expect(archiveTypeLabel('site.txz')).toBe('XZ-compressed tar archive');
        expect(archiveTypeLabel('dump.xz')).toBe('XZ archive');
        expect(archiveTypeLabel('site.tar.zst')).toBe('Zstandard-compressed tar archive');
        expect(archiveTypeLabel('dump.zst')).toBe('Zstandard archive');
    });

    it('names every archive suffix the Explorer knows', () => {
        const unnamed = [...EXTENSION_MAP]
            .filter(([suffix, id]) => id === 'archive' && archiveTypeLabel(`sample.${suffix}`) === 'Archive')
            .map(([suffix]) => suffix);

        expect(unnamed).toEqual([]);
    });

    it('falls back to Archive for a name it doesn\'t know', () => {
        expect(archiveTypeLabel('bundle')).toBe('Archive');
        expect(archiveTypeLabel('notes.txt')).toBe('Archive');
    });
});
