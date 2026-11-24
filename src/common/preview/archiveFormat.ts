import { matchFileSuffix } from '../fs/fileTypes.js';

// Keyed by the suffix the file types resolve by, so `.tar.gz` names a compressed tarball rather than a gzip file.
const ARCHIVE_LABELS: ReadonlyMap<string, string> = new Map([
    ['zip', 'ZIP archive'],
    ['7z', '7-Zip archive'],
    ['rar', 'RAR archive'],
    ['tar', 'Tar archive'],
    ['gz', 'Gzip archive'],
    ['tar.gz', 'Gzip-compressed tar archive'],
    ['tgz', 'Gzip-compressed tar archive'],
    ['bz2', 'Bzip2 archive'],
    ['tar.bz2', 'Bzip2-compressed tar archive'],
    ['tbz2', 'Bzip2-compressed tar archive'],
    ['xz', 'XZ archive'],
    ['tar.xz', 'XZ-compressed tar archive'],
    ['txz', 'XZ-compressed tar archive'],
    ['zst', 'Zstandard archive'],
    ['tar.zst', 'Zstandard-compressed tar archive'],
    ['cab', 'Cabinet archive'],
    ['iso', 'ISO disc image'],
]);

// "ZIP archive", "Gzip-compressed tar archive": the Type row of an archive's Info panel.
export function archiveTypeLabel(fileName: string): string {
    return ARCHIVE_LABELS.get(matchFileSuffix(fileName) ?? '') ?? 'Archive';
}
