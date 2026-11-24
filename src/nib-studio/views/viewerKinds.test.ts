import { describe, expect, it } from 'vitest';
import { holdsNoText, isPreviewKind, pickViewer } from './viewerKinds.js';

describe('pickViewer', () => {
    it('routes images, audio, video, fonts and PDFs to their previews', () => {
        for (const name of ['a.png', 'a.APNG', 'a.jpg', 'a.jfif', 'a.pjp', 'a.gif', 'a.webp', 'a.avif', 'a.bmp', 'a.ico', 'a.cur', 'a.svg', 'a.heic', 'a.heif', 'a.hif', 'a.tif', 'a.tiff']) {
            expect(pickViewer(name), name).toBe('image');
        }

        for (const name of ['a.mp3', 'a.wav', 'a.ogg', 'a.oga', 'a.opus', 'a.flac', 'a.m4a', 'a.aac', 'a.weba']) {
            expect(pickViewer(name), name).toBe('audio');
        }

        for (const name of ['a.mp4', 'a.m4v', 'a.webm', 'a.ogv', 'a.mov', 'a.mkv']) {
            expect(pickViewer(name), name).toBe('video');
        }

        for (const name of ['a.ttf', 'a.OTF', 'a.woff', 'a.woff2', 'a.ttc', 'a.otc']) {
            expect(pickViewer(name), name).toBe('font');
        }

        for (const name of ['manual.pdf', 'SCAN.PDF', 'Συμβόλαιο.pdf']) {
            expect(pickViewer(name), name).toBe('pdf');
        }
    });

    it('keeps the other kinds', () => {
        expect(pickViewer('data.csv')).toBe('table');
        expect(pickViewer('book.xlsx')).toBe('table');
        expect(pickViewer('letter.docx')).toBe('document');
        expect(pickViewer('notes.txt')).toBe('editor');
        expect(pickViewer('config.json')).toBe('editor');
        expect(pickViewer('notes')).toBe('editor');
    });

    it('routes every Word extension to the document preview', () => {
        for (const name of ['a.docx', 'a.DOC', 'a.docm', 'a.dotx', 'a.dotm']) {
            expect(pickViewer(name), name).toBe('document');
            expect(holdsNoText(name), name).toBe(true);
        }
    });

    it('routes every archive to the archive preview, which holds no text', () => {
        const names = [
            'a.zip', 'a.gz', 'a.tar', 'a.tar.gz', 'a.tgz', 'a.7z', 'a.RAR',
            'a.bz2', 'a.tar.bz2', 'a.tbz2', 'a.xz', 'a.tar.xz', 'a.txz', 'a.zst', 'a.tar.zst', 'a.cab', 'a.iso',
        ];

        for (const name of names) {
            expect(pickViewer(name), name).toBe('archive');
            expect(holdsNoText(name), name).toBe(true);
        }
    });

    it('routes every spreadsheet to the table view, Excel workbooks, templates and OpenDocument spreadsheets alike', () => {
        for (const name of ['a.xlsx', 'a.xls', 'a.xlsm', 'a.xltx', 'a.XLTM', 'a.xlsb', 'a.ods']) {
            expect(pickViewer(name), name).toBe('table');
            expect(holdsNoText(name), name).toBe(false);
        }
    });

    it('routes presentations and OpenDocument text and drawings to the office preview, which holds no text', () => {
        for (const name of ['a.ppt', 'a.pptx', 'a.pps', 'a.PPSX', 'a.pot', 'a.potx', 'a.odp', 'a.odt', 'a.odg']) {
            expect(pickViewer(name), name).toBe('office');
            expect(holdsNoText(name), name).toBe(true);
        }
    });

    it('opens a .dot file in the editor, since it is far more often a Graphviz graph than a Word 97 template', () => {
        expect(pickViewer('graph.dot')).toBe('editor');
        expect(holdsNoText('graph.dot')).toBe(false);
    });
});

describe('isPreviewKind', () => {
    it('is true for the previews, Word documents and archives included, and false for tables and the editor', () => {
        expect(['image', 'audio', 'video', 'font', 'pdf'].every((kind) => isPreviewKind(kind as never))).toBe(true);
        expect(isPreviewKind('document')).toBe(true);
        expect(isPreviewKind('archive')).toBe(true);
        expect(isPreviewKind('office')).toBe(true);
        expect(isPreviewKind('binary')).toBe(true);
        expect(isPreviewKind('table')).toBe(false);
        expect(isPreviewKind('editor')).toBe(false);
    });
});

describe('holdsNoText', () => {
    it('is true for files shown from their File, never read as text', () => {
        expect(holdsNoText('photo.HEIC')).toBe(true);
        expect(holdsNoText('song.mp3')).toBe(true);
        expect(holdsNoText('clip.mkv')).toBe(true);
        expect(holdsNoText('KaTeX_Main-Regular.ttf')).toBe(true);
        expect(holdsNoText('manual.pdf')).toBe(true);
        expect(holdsNoText('backup.tar.gz')).toBe(true);
        expect(holdsNoText('notes.md')).toBe(false);
        expect(holdsNoText('data.csv')).toBe(false);
    });
});
