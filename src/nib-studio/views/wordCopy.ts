import { capInlineImages, documentRichText, type RichText } from '../../common/clipboard/clipboardHtml.js';
import { COPY_IMAGE_LIMIT_BYTES } from '../../common/clipboard/documentCopy.js';
import { encodeBase64Bytes } from '../../common/encoding/base64.js';
import type { DocImage } from '../../common/office/docModel.js';
import type { WordContent } from '../../common/office/wordLoader.js';
import { copyRichTextAsync } from '../app/clipboard.js';
import type { ToastMessage } from '../app/toast.js';
import { renderDocBlocks } from './docBlocksView.js';

// A Word document that shows as a page.
export type WordPage = Exclude<WordContent, { readonly kind: 'message' }>;

// A Word document as its preview shows it, for the clipboard: headings, lists, tables and links,
// its pictures inside it as data: URLs, within the limit of a copy.
export function wordRichText(content: WordPage): RichText {
    const template = document.createElement('template');

    if (content.kind === 'html') {
        // The HTML was sanitised when the document was read, and its pictures are data: URLs already.
        template.innerHTML = content.html;
    }
    else {
        template.content.append(renderDocBlocks(content.blocks, pictureDataUrl));
    }

    capInlineImages(template.content, COPY_IMAGE_LIMIT_BYTES);

    return documentRichText(template.innerHTML);
}

// Copy formatted of a Word document's preview.
export async function copyWordPageAsync(content: WordPage): Promise<ToastMessage> {
    // The page is built inside the clipboard's wait, so the click still counts however long it takes.
    await copyRichTextAsync(Promise.resolve().then(() => wordRichText(content)));

    return { message: 'Formatted document copied.', tone: 'ok' };
}

function pictureDataUrl(image: DocImage): string {
    return `data:${image.mimeType};base64,${encodeBase64Bytes(image.bytes)}`;
}
