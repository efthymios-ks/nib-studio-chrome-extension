import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDocFile, buildPropertySet, sprm, SUMMARY_FORMAT_ID, u32 } from '../../common/office/testing/docFixtures.js';
import {
    buildStandardEncryptedAsync,
    buildTinyDocxAsync,
    encryptDocFile,
    encryptedPackageFile,
    encryptionInfoStream,
} from '../../common/office/testing/encryptionFixtures.js';
import { BLIP, blip, picf, shape, TINY_PNG } from '../../common/office/testing/officeArtFixtures.js';
import { setClientSize } from '../testing/fakeAnimationClock.js';
import { FIND_CURRENT_HIGHLIGHT, FIND_HIGHLIGHT } from './documentFind.js';
import { markBoldHeaderRows, mountDocumentPreview } from './documentView.js';
import { matchSummary } from './findBox.js';
import { requestPreviewFind } from './previewFindRequests.js';
import type { PreviewHandle } from './previewHandle.js';

class FakeHighlight {
    readonly ranges: Range[];

    constructor(...ranges: Range[]) {
        this.ranges = ranges;
    }
}

let host: HTMLElement;
let handles: PreviewHandle[];
let highlights: Map<string, FakeHighlight>;

async function docxFileAsync(body: string, name = 'report.docx'): Promise<File> {
    const zip = new JSZip();
    zip.file('_rels/.rels', [
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>',
        '</Relationships>',
    ].join(''));
    zip.file('word/document.xml', [
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        body,
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr>',
        '</w:body></w:document>',
    ].join(''));
    zip.file('docProps/core.xml', '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:title>Quarterly</dc:title><dc:creator>Ana</dc:creator></cp:coreProperties>');
    zip.file('docProps/app.xml', '<Properties><Application>Word</Application><Words>42</Words></Properties>');

    return new File([await zip.generateAsync({ type: 'arraybuffer' })], name, { lastModified: Date.UTC(2026, 10, 18) });
}

function paragraphs(...texts: string[]): string {
    return texts.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('');
}

function docFile(): File {
    const bytes = buildDocFile({
        pieces: [{ text: 'Legacy body\rName\u0007Total\u0007\u0007Ada\u000742\u0007\u0007\r', compressed: true }],
        paragraphs: new Map([
            [1, { sprms: [sprm(0x2416, 1)] }],
            [2, { sprms: [sprm(0x2416, 1)] }],
            [3, { sprms: [sprm(0x2416, 1), sprm(0x2417, 1)] }],
            [4, { sprms: [sprm(0x2416, 1)] }],
            [5, { sprms: [sprm(0x2416, 1)] }],
            [6, { sprms: [sprm(0x2416, 1), sprm(0x2417, 1)] }],
        ]),
        characters: [{ start: 12, end: 22, sprms: [sprm(0x0835, 1)] }],
        summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Legacy title'], [4, 'string', 'Bob']]),
    });

    return new File([bytes], 'legacy.doc', { lastModified: Date.UTC(2026, 10, 18) });
}

function mount(file: File): PreviewHandle {
    const handle = mountDocumentPreview(host, { file, fileName: file.name, memoryKey: `documents/${file.name}`, prefersReducedMotion: () => true });
    setClientSize(host.querySelector('.preview-viewport') as HTMLElement, 1000, 700);
    handles.push(handle);

    return handle;
}

function frame(): HTMLElement {
    return host.querySelector('.preview-frame') as HTMLElement;
}

function page(): HTMLElement {
    return host.querySelector('.preview-layer .document-page') as HTMLElement;
}

function findInput(): HTMLInputElement {
    return host.querySelector('.document-find-input') as HTMLInputElement;
}

function count(): string {
    return host.querySelector('.document-find-count')?.textContent ?? '';
}

function find(text: string): void {
    findInput().value = text;
    findInput().dispatchEvent(new Event('input'));
}

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

async function readyAsync(): Promise<void> {
    await vi.waitFor(() => expect(frame().dataset['state']).toMatch(/ready|message/), { timeout: 5000 });
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    handles = [];
    highlights = new Map();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights, escape: (value: string) => value });
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('mountDocumentPreview', () => {
    it('builds one toolbar row: the Word badge, zoom, Info and View only, with Find in the controls bar below', async () => {
        mount(await docxFileAsync(paragraphs('Hello')));
        await readyAsync();

        const toolbar = host.querySelector('.preview-toolbar') as HTMLElement;
        const controls = host.querySelector('.preview-controls') as HTMLElement;

        expect(host.querySelectorAll('.editor-toolbar')).toHaveLength(1);
        expect([...toolbar.querySelectorAll('.badge')].map((badge) => badge.textContent)).toEqual(['Word', 'View only']);
        expect([...toolbar.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['−', '+', 'Reset', 'Info']);
        expect([...controls.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['↑', '↓']);
        expect(controls.hidden).toBe(false);
        expect(findInput().placeholder).toBe('Find in document…');
    });

    it('shows a .doc\'s pictures from blob URLs, counts them in Info and revokes the URLs on destroy', async () => {
        const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:nib/picture-1');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const data = picf({ width: 1500, height: 750, records: [shape({ id: 1, blipIndex: 1, description: 'Chart' }), blip(BLIP.png, TINY_PNG)] });
        const bytes = buildDocFile({
            pieces: [{ text: 'Chart: \u0001\r', compressed: true }],
            characters: [{ start: 7, end: 8, sprms: [sprm(0x0855, 1), sprm(0x6a03, ...u32(0))] }],
            data,
        });
        const handle = mount(new File([bytes], 'chart.doc'));
        await readyAsync();
        const image = page().querySelector('img') as HTMLImageElement;

        expect([image.getAttribute('src'), image.alt, image.getAttribute('width'), image.getAttribute('height')]).toEqual(['blob:nib/picture-1', 'Chart', '100', '50']);
        expect(page().querySelector('.document-picture')).toBeNull();
        expect(create).toHaveBeenCalledTimes(1);
        expect(rows()['Statistics/Pictures']).toBe('1');

        handle.destroy();

        expect(revoke).toHaveBeenCalledWith('blob:nib/picture-1');
    });

    it('shows a loading message, then the DOCX on a page of the document\'s width and margins, with its details', async () => {
        mount(await docxFileAsync(paragraphs('Hello there', 'Second paragraph')));

        expect(frame().dataset['state']).toBe('loading');
        expect(host.querySelector('.preview-status')?.textContent).toBe('Opening the document…');

        await readyAsync();

        expect(frame().dataset['state']).toBe('ready');
        expect(page().dataset['source']).toBe('docx');
        expect([...page().querySelectorAll('p')].map((paragraph) => paragraph.textContent)).toEqual(['Hello there', 'Second paragraph']);
        expect(page().style.width).toBe('816px');
        expect(page().style.padding).toBe('96px 72px');
        expect(page().style.minHeight).toBe('1056px');
        expect(host.querySelector('.preview-zoom-level')?.textContent).toBe('100%');
        expect(rows()).toMatchObject({
            'File/Name': 'report.docx',
            'File/Type': 'Word document (DOCX)',
            'Document/Title': 'Quarterly',
            'Document/Author': 'Ana',
            'History/Application': 'Word',
            'Statistics/Words': '42',
        });
    });

    it('shows a .doc with its table, shading a bold first row, and its summary properties', async () => {
        mount(docFile());
        await readyAsync();

        expect(page().dataset['source']).toBe('doc');
        expect(page().querySelector('p')?.textContent).toBe('Legacy body');
        expect([...page().querySelectorAll('tr')].map((row) => [...row.cells].map((cell) => cell.textContent))).toEqual([['Name', 'Total'], ['Ada', '42']]);
        expect(page().querySelector('tr')?.dataset['header']).toBe('true');
        expect(rows()).toMatchObject({ 'File/Type': 'Word 97–2003 document (DOC)', 'Document/Title': 'Legacy title', 'Document/Author': 'Bob' });
    });

    it('finds every match ignoring case, steps through them both ways with wrap-around, and clears on Escape', async () => {
        const scrollTo = vi.fn();
        vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(scrollTo);
        mount(await docxFileAsync(paragraphs('Alpha beta alpha.', 'ALPHA end')));
        await readyAsync();

        find('alpha');

        expect(count()).toBe('1 of 3');
        expect(highlights.get(FIND_HIGHLIGHT)?.ranges.map((range) => range.toString())).toEqual(['Alpha', 'alpha', 'ALPHA']);
        expect(highlights.get(FIND_CURRENT_HIGHLIGHT)?.ranges[0]?.toString()).toBe('Alpha');
        expect(scrollTo).toHaveBeenCalled();

        press(findInput(), 'Enter');
        expect(count()).toBe('2 of 3');

        (host.querySelector('[data-action="find-next"]') as HTMLButtonElement).click();
        (host.querySelector('[data-action="find-next"]') as HTMLButtonElement).click();
        expect(count()).toBe('1 of 3');

        press(findInput(), 'Enter', { shiftKey: true });
        expect(count()).toBe('3 of 3');
        expect(highlights.get(FIND_CURRENT_HIGHLIGHT)?.ranges[0]?.toString()).toBe('ALPHA');

        press(findInput(), 'Escape');
        expect(findInput().value).toBe('');
        expect(count()).toBe('');
        expect(highlights.get(FIND_HIGHLIGHT)?.ranges).toEqual([]);
    });

    it('says when nothing matches and disables the arrows', async () => {
        mount(await docxFileAsync(paragraphs('Nothing here')));
        await readyAsync();

        find('zebra');

        expect(count()).toBe('No matches');
        expect(host.querySelector<HTMLElement>('.document-find')?.dataset['state']).toBe('none');
        expect((host.querySelector('[data-action="find-next"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('finds a phrase asked for from outside once the page shows, or at once when it shows already', async () => {
        vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
        requestPreviewFind('documents/report.docx', 'owned by Anna');
        mount(await docxFileAsync(paragraphs('The review is owned by Anna Smith.', 'Owned by anna again.')));
        await readyAsync();

        expect(findInput().value).toBe('owned by Anna');
        expect(count()).toBe('1 of 2');
        expect(highlights.get(FIND_CURRENT_HIGHLIGHT)?.ranges[0]?.toString()).toBe('owned by Anna');

        requestPreviewFind('documents/report.docx', 'again');

        expect(findInput().value).toBe('again');
        expect(count()).toBe('1 of 1');

        requestPreviewFind('documents/other.docx', 'review');

        expect(findInput().value).toBe('again');
    });

    it('sends Ctrl+F in the preview to its Find box', async () => {
        mount(await docxFileAsync(paragraphs('Text')));
        await readyAsync();

        press(host.querySelector('.preview-viewport') as HTMLElement, 'f', { ctrlKey: true });

        expect(document.activeElement).toBe(findInput());
    });

    it('reads each file snapshot once, keeps the page for the same snapshot and reloads for a new one', async () => {
        const read = vi.spyOn(File.prototype, 'arrayBuffer');
        const file = await docxFileAsync(paragraphs('First version'));
        const handle = mount(file);
        await readyAsync();
        const shown = page();

        handle.update(file);
        handle.update(null);

        expect(page()).toBe(shown);

        handle.update(await docxFileAsync(paragraphs('Second version')));
        await vi.waitFor(() => expect(page()?.textContent).toBe('Second version'));

        mount(file);
        await vi.waitFor(() => expect(host.querySelectorAll('.preview-frame[data-state="ready"]')).toHaveLength(2));

        expect(read).toHaveBeenCalledTimes(2);
    });

    it('explains a file it can\'t show and still lists the file in Info', async () => {
        const encrypted = buildDocFile({ pieces: [{ text: 'Secret\r', compressed: true }], flags: 0x0300 });
        mount(new File([encrypted], 'secret.doc'));
        await readyAsync();

        expect(frame().dataset['state']).toBe('message');
        // Its FIB says it is encrypted, but its table stream holds no encryption header the preview knows.
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This document\'s encryption isn\'t supported');
        expect(rows()['File/Name']).toBe('secret.doc');
        expect(rows()['Security/Encrypted']).toBe('Unknown encryption (version 0.0)');
        expect(findInput().disabled).toBe(true);
        expect(findInput().closest('[hidden]')).not.toBeNull();

        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        host.querySelector('.preview-status')?.dispatchEvent(event);

        // Chrome's own find bar stays shut, and the hidden Find box takes nothing.
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).not.toBe(findInput());

        press(host.querySelector('.preview-viewport') as HTMLElement, 'f', { ctrlKey: true });

        expect(document.activeElement).not.toBe(findInput());
    });

    it('shows a note above an RTF file with a Word name', async () => {
        mount(new File(['{\\rtf1\\ansi Plain \\b words\\b0\\par}'], 'letter.doc'));
        await readyAsync();

        expect(host.querySelector('.preview-note')?.textContent).toBe('This file is in Rich Text Format; its text shows without formatting.');
        expect(page().textContent).toBe('Plain words');
    });

    it('scrolls to the target of an in-document link', async () => {
        const scrollTo = vi.fn();
        vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(scrollTo);
        mount(await docxFileAsync([
            '<w:p><w:hyperlink w:anchor="Target"><w:r><w:t>Jump</w:t></w:r></w:hyperlink></w:p>',
            '<w:p><w:bookmarkStart w:id="0" w:name="Target"/><w:r><w:t>Here</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>',
        ].join('')));
        await readyAsync();
        const link = page().querySelector('a[href]') as HTMLAnchorElement;
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });

        link.dispatchEvent(click);

        expect(link.getAttribute('href')).toBe('#word-Target');
        expect(click.defaultPrevented).toBe(true);
        expect(scrollTo).toHaveBeenCalled();
    });

    it('keeps a middle click on a link from starting the browser\'s autoscroll, and leaves it elsewhere', async () => {
        mount(await docxFileAsync([
            '<w:p><w:hyperlink w:anchor="Target"><w:r><w:t>Jump</w:t></w:r></w:hyperlink></w:p>',
            '<w:p><w:bookmarkStart w:id="0" w:name="Target"/><w:r><w:t>Here</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>',
        ].join('')));
        await readyAsync();
        // A web link shows without an address, its address as the tooltip.
        const webLink = document.createElement('a');
        webLink.title = 'https://example.com/report';
        webLink.textContent = 'the report';
        page().append(webLink);
        const press = (target: Element, type: string): boolean => {
            const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 1 });
            target.dispatchEvent(event);

            return event.defaultPrevented;
        };

        expect(press(webLink, 'mousedown')).toBe(true);
        expect(press(webLink, 'auxclick')).toBe(true);
        expect(press(page().querySelector('a[href]')!, 'mousedown')).toBe(true);
        expect(press(page().querySelector('p')!, 'mousedown')).toBe(false);
    });

    it('lets go of its highlights and takes the frame out on destroy', async () => {
        const handle = mount(await docxFileAsync(paragraphs('alpha')));
        await readyAsync();
        find('alpha');

        handle.destroy();

        expect(host.querySelector('.preview-frame')).toBeNull();
        expect(highlights.size).toBe(0);
    });
});

describe('mountDocumentPreview with a password', () => {
    const PASSWORD = 'tika';

    async function lockedDocxAsync(name = 'locked.docx'): Promise<File> {
        const plain = await buildTinyDocxAsync('Unlocked words');

        return new File([await buildStandardEncryptedAsync({ password: PASSWORD, plain })], name, { lastModified: Date.UTC(2026, 10, 18) });
    }

    function lockedDoc(): File {
        const plain = buildDocFile({
            pieces: [{ text: 'Binary secret\r', compressed: true }],
            tableReserved: 256,
            summary: buildPropertySet(SUMMARY_FORMAT_ID, [[2, 'string', 'Readable title']]),
        });

        return new File([encryptDocFile(plain, PASSWORD, 'rc4')], 'locked.doc');
    }

    function panel(): HTMLElement | null {
        return host.querySelector('.password-panel');
    }

    function passwordInput(): HTMLInputElement {
        return host.querySelector('.password-panel-input') as HTMLInputElement;
    }

    async function panelAsync(reason: string): Promise<void> {
        await vi.waitFor(() => expect(panel()?.dataset['reason']).toBe(reason), { timeout: 5000 });
    }

    function submit(password: string): void {
        passwordInput().value = password;
        panel()?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    async function pageAsync(): Promise<HTMLElement> {
        await vi.waitFor(() => expect(frame().dataset['state']).toBe('ready'), { timeout: 5000 });

        return page();
    }

    it('asks for the password with the zoom and Find hidden, and Info showing what reads without it', async () => {
        mount(lockedDoc());
        await panelAsync('needed');

        expect(frame().dataset['state']).toBe('panel');
        expect(host.querySelector('.password-panel-title')?.textContent).toBe('This document is protected with a password');
        expect(host.querySelector('.password-panel-file')?.textContent).toBe('locked.doc');
        expect((host.querySelector('.preview-zoom') as HTMLElement).hidden).toBe(true);
        expect(findInput().closest('[hidden]')).not.toBeNull();
        expect(rows()).toMatchObject({
            'File/Type': 'Word 97–2003 document (DOC)',
            'Security/Encrypted': 'RC4 encryption',
            'Document/Title': 'Readable title',
        });
        expect(document.activeElement).toBe(passwordInput());
    });

    it('says a wrong password is wrong, then opens the document with the right one', async () => {
        mount(await lockedDocxAsync());
        await panelAsync('needed');
        submit('wrong');
        await panelAsync('incorrect');

        expect(host.querySelector('.password-panel-message')?.textContent).toBe('That password is incorrect. Try again.');

        submit(PASSWORD);

        expect((await pageAsync()).textContent).toContain('Unlocked words');
        expect(rows()).toMatchObject({ 'File/Type': 'Word document (DOCX)', 'Security/Encrypted': 'Standard encryption, AES-128 with SHA-1' });
        expect(panel()).toBeNull();
        find('unlocked');
        expect(count()).toBe('1 of 1');
    });

    it('opens an RC4 .doc with its password', async () => {
        mount(lockedDoc());
        await panelAsync('needed');
        submit(PASSWORD);

        expect((await pageAsync()).textContent).toContain('Binary secret');
    });

    it('leaves a clear message on Cancel, with a way back to the password box', async () => {
        mount(await lockedDocxAsync());
        await panelAsync('needed');
        (host.querySelector('[data-action="password-cancel"]') as HTMLButtonElement).click();
        await panelAsync('cancelled');

        expect(panel()?.textContent).toContain('It stays closed until its password is entered.');

        (host.querySelector('[data-action="password-retry"]') as HTMLButtonElement).click();
        await panelAsync('needed');
    });

    it('doesn\'t ask again for the same snapshot, and asks again once the file changed on disk', async () => {
        const file = await lockedDocxAsync();
        const first = mount(file);
        await panelAsync('needed');
        submit(PASSWORD);
        await pageAsync();
        first.destroy();

        mount(file);

        expect((await pageAsync()).textContent).toContain('Unlocked words');
        expect(panel()).toBeNull();

        const reopened = mount(file);
        reopened.update(new File([await file.arrayBuffer()], file.name));
        await panelAsync('needed');
    });

    it('keeps the password nowhere: the box is emptied and the page never holds it', async () => {
        const secret = 'Unforgettable-7';
        const plain = await buildTinyDocxAsync('Private');
        mount(new File([await buildStandardEncryptedAsync({ password: secret, plain })], 'private.docx'));
        await panelAsync('needed');
        submit(secret);
        await pageAsync();

        expect(host.innerHTML).not.toContain(secret);
        expect([...host.querySelectorAll('input')].every((input) => input.value !== secret)).toBe(true);
    });

    it('says why encryption it can\'t open isn\'t supported, with Info', async () => {
        const info = encryptionInfoStream(4, 3, 0, new Uint8Array(16));
        mount(new File([encryptedPackageFile(info, Uint8Array.of(1, 2, 3))], 'vault.docx'));
        await readyAsync();

        expect(frame().dataset['state']).toBe('message');
        expect(host.querySelector('.preview-status h2')?.textContent).toBe('This document\'s encryption isn\'t supported');
        expect(host.querySelector('.preview-status p')?.textContent).toContain('third-party encryption provider');
        expect(rows()['Security/Encrypted']).toBe('Extensible encryption');
        expect(panel()).toBeNull();
    });
});

describe('matchSummary', () => {
    it('counts matches, says when there are none, and says nothing for an empty box', () => {
        expect(matchSummary('', 0, -1)).toEqual({ text: '', state: 'idle' });
        expect(matchSummary('  ', 3, 0)).toEqual({ text: '', state: 'idle' });
        expect(matchSummary('x', 0, -1)).toEqual({ text: 'No matches', state: 'none' });
        expect(matchSummary('x', 5, 1)).toEqual({ text: '2 of 5', state: 'found' });
    });

    it('writes counts with thousands separators', () => {
        expect(matchSummary('x', 3_310, 1_203).text).toBe('1,204 of 3,310');
    });
});

describe('markBoldHeaderRows', () => {
    it('shades a first row of bold cells in a table without header cells', () => {
        const page = document.createElement('div');
        page.innerHTML = [
            '<table><tr><td><strong>A</strong></td><td><b>B</b> </td></tr><tr><td>1</td><td>2</td></tr></table>',
            '<table><tr><td><strong>A</strong></td><td>B</td></tr></table>',
            '<table><thead><tr><th><strong>A</strong></th><th>B</th></tr></thead></table>',
            '<table><tr><td><strong>Only one cell</strong></td></tr></table>',
        ].join('');

        markBoldHeaderRows(page);

        expect([...page.querySelectorAll('table')].map((table) => table.rows[0]?.dataset['header'] ?? null)).toEqual(['true', null, null, null]);
    });
});
