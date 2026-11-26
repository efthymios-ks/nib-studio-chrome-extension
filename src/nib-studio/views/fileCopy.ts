import type { RichText } from '../../common/clipboard/clipboardHtml.js';
import { htmlPageRichTextAsync, markdownRichTextAsync } from '../../common/clipboard/documentCopy.js';
import { dataTextFormatName, formatDataText, type DataTextFormat } from '../../common/clipboard/formattedText.js';
import { planTableCopy, tableCopyMessage, tableToHtml, tableToTsv } from '../../common/clipboard/tableClipboard.js';
import { formatMegabytes } from '../../common/csv/csvLimits.js';
import { basename } from '../../common/fs/fileEntry.js';
import { resolveFileType, type FileTypeId } from '../../common/fs/fileTypes.js';
import type { LocalImageContext } from '../../common/markdown/localImages.js';
import { readTextBlobAsync } from '../../common/text/textEncoding.js';
import { copyRichTextAsync, copyTextAsync, copyTextLaterAsync } from '../app/clipboard.js';
import type { OpenFile } from '../app/store.js';
import type { ToastMessage } from '../app/toast.js';
import { detectMode, type EditorMode } from '../editor/editorHost.js';
import { buildCopyButtons, type CopyAction, type CopyButton } from './copyButtons.js';
import { renderMermaidImageAsync } from './diagramImage.js';
import { withDocumentImagesAsync } from './documentImages.js';
import { findShownTable } from './shownTable.js';
import { isPreviewKind, pickViewer } from './viewerKinds.js';

// A copy reads a file's text from disk up to this size, such as a CSV or TSV too large to load in its tab.
export const DISK_COPY_LIMIT_BYTES = 64 * 1024 * 1024;

export interface FileCopyInput {
    // The file as its tab holds it now, the editor's unsaved text included.
    readonly currentFile: () => OpenFile;
    // The workspace a document's pictures are read from; null when none is open.
    readonly root: FileSystemDirectoryHandle | null;
    // Where the file's view is drawn, to find the table it shows.
    readonly view: () => ParentNode | null;
}

interface FileKinds {
    readonly mode: EditorMode;
    readonly typeId: FileTypeId;
}

// What Copy formatted copies, for the files that render as more than their text.
interface FormattedCopy {
    readonly applies: (kinds: FileKinds) => boolean;
    readonly title: string;
    readonly copyAsync: (input: FileCopyInput) => Promise<ToastMessage>;
}

const FORMATTED_COPIES: ReadonlyArray<FormattedCopy> = [
    {
        applies: ({ typeId }) => typeId === 'csv' || typeId === 'excel',
        title: 'Copy the table as shown, with its sheet, sort, filters, search, query and columns, to paste as cells',
        copyAsync: async (input) => await copyShownTableAsync(input),
    },
    {
        applies: ({ mode }) => mode === 'markdown',
        title: 'Copy the rendered document, to paste with its headings, lists, tables, links and pictures',
        copyAsync: async (input) => await copyDocumentAsync(input, async (text, context) => (
            await markdownRichTextAsync(text, { ...context, drawDiagramAsync: renderMermaidImageAsync })
        )),
    },
    {
        applies: ({ typeId }) => typeId === 'html',
        title: 'Copy the page as written without its scripts, to paste with its headings, lists, tables, links and pictures',
        copyAsync: async (input) => await copyDocumentAsync(input, htmlPageRichTextAsync),
    },
    dataTextCopy('json', 'Copy the JSON with a 2-space indent'),
    dataTextCopy('yaml', 'Copy the YAML laid out as Format lays it out'),
    dataTextCopy('xml', 'Copy the XML indented'),
];

const TEXT_COPY_TITLES: Readonly<Record<Exclude<CopyAction, 'formatted'>, string>> = Object.freeze({
    raw: 'Copy the source text as it is, unsaved edits included',
    content: 'Copy the text, unsaved edits included',
});

const TEXT_COPY_MESSAGES: Readonly<Record<Exclude<CopyAction, 'formatted'>, string>> = Object.freeze({
    raw: 'Raw text copied.',
    content: 'Content copied.',
});

// The copy buttons a file shows, by its name. A file with a rendered view (Markdown, HTML, CSV and TSV, JSON, YAML
// and XML) copies its source and what it renders; a workbook or a Word document, which has no text of its own,
// only what it renders; any other text its content. Previews of PDFs, pictures, sound, video, fonts, archives
// and other binary files copy nothing from here, though a picture has Copy image.
export function copyActionsFor(fileName: string, isBinary = false): ReadonlyArray<CopyAction> {
    const viewer = isBinary ? 'binary' : pickViewer(fileName);

    if (viewer === 'document') {
        return ['formatted'];
    }

    if (isPreviewKind(viewer)) {
        return [];
    }

    const kinds = kindsOf(fileName);

    if (kinds.typeId === 'excel') {
        return ['formatted'];
    }

    return FORMATTED_COPIES.some((entry) => entry.applies(kinds)) ? ['raw', 'formatted'] : ['content'];
}

// The copy buttons of a file tab's toolbar; null for a file that copies nothing from there.
export function buildFileCopyButtons(input: FileCopyInput): HTMLElement | null {
    const file = input.currentFile();
    const fileName = basename(file.path);
    const formatted = FORMATTED_COPIES.find((entry) => entry.applies(kindsOf(fileName)));
    const buttons = copyActionsFor(fileName, file.binary === true).flatMap((action): CopyButton[] => {
        if (action !== 'formatted') {
            return [{
                action,
                title: TEXT_COPY_TITLES[action],
                copyAsync: async () => await copyFileTextAsync(input, TEXT_COPY_MESSAGES[action]),
            }];
        }

        if (formatted == null) {
            return [];
        }

        return [{ action, title: formatted.title, copyAsync: async () => await formatted.copyAsync(input) }];
    });

    return buildCopyButtons(buttons);
}

function kindsOf(fileName: string): FileKinds {
    return { mode: detectMode(fileName), typeId: resolveFileType(fileName).id };
}

// The tab's text as it is now; a CSV or TSV too large to load is read from disk, where it is as shown,
// since its table is view only.
async function copyFileTextAsync(input: FileCopyInput, message: string): Promise<ToastMessage> {
    const file = input.currentFile();
    const onDisk = file.large === true ? file.file : null;

    if (onDisk == null) {
        await copyTextAsync(file.text);

        return { message, tone: 'ok' };
    }

    const refusal = diskCopyRefusal(onDisk.size);

    if (refusal != null) {
        return refusal;
    }

    await copyDiskTextAsync(onDisk);

    return { message, tone: 'ok' };
}

// Why a file of this size on disk is too large to copy as text; null when it isn't.
export function diskCopyRefusal(size: number): ToastMessage | null {
    if (size <= DISK_COPY_LIMIT_BYTES) {
        return null;
    }

    return {
        message: `This file is too large to copy as text: it is ${formatMegabytes(size)}, `
            + `and a copy takes up to ${formatMegabytes(DISK_COPY_LIMIT_BYTES)}.`,
        tone: 'fail',
    };
}

// Puts a file's text as saved on disk on the clipboard, read while the clipboard waits for it.
export async function copyDiskTextAsync(onDisk: Blob): Promise<void> {
    await copyTextLaterAsync(blobTextAsync(onDisk));
}

async function blobTextAsync(blob: Blob): Promise<string> {
    return (await readTextBlobAsync(blob)).text;
}

// A Markdown or HTML document rendered for the clipboard, its workspace pictures read from the workspace it is in.
async function copyDocumentAsync(
    input: FileCopyInput,
    renderAsync: (text: string, context: LocalImageContext) => Promise<RichText>,
): Promise<ToastMessage> {
    const file = input.currentFile();
    const content = withDocumentImagesAsync(file.path, input.root, async (context) => await renderAsync(file.text, context));
    await copyRichTextAsync(content);

    return { message: 'Formatted document copied.', tone: 'ok' };
}

// The table on screen as shown: a sheet's rows, or the query result in their place. Up to the rich limit it goes as
// an HTML table and tab-separated text; past it as text alone; and past the copy limit only its first rows go.
async function copyShownTableAsync(input: FileCopyInput): Promise<ToastMessage> {
    const table = findShownTable(input.view() ?? document);

    if (table == null) {
        return { message: 'There is no table on screen to copy yet.', tone: 'warn' };
    }

    const busy = table.busyReason();

    if (busy != null) {
        return { message: busy, tone: 'warn' };
    }

    const shownRows = table.rowCount();
    const plan = planTableCopy(shownRows);
    const rows = table.readRowsAsync(plan.rowCount);

    if (plan.rich) {
        await copyRichTextAsync(rows.then((copy) => ({ html: tableToHtml(copy), text: tableToTsv(copy) })));
    }
    else {
        await copyTextLaterAsync(rows.then(tableToTsv));
    }

    return tableCopyMessage(plan, shownRows);
}

// JSON, YAML or XML laid out for reading; a text that doesn't parse copies nothing, and the toast says why.
function dataTextCopy(format: DataTextFormat, title: string): FormattedCopy {
    return {
        applies: ({ mode }) => mode === format,
        title,
        copyAsync: async (input) => {
            const result = formatDataText(format, input.currentFile().text);

            if (!result.ok) {
                return { message: `${result.message} Nothing was copied.`, tone: 'fail' };
            }

            await copyTextAsync(result.text);

            return { message: `Formatted ${dataTextFormatName(format)} copied.`, tone: 'ok' };
        },
    };
}
