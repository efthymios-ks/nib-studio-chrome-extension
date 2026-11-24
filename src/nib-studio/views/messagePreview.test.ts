import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINARY_PREVIEW_MESSAGE, mountMessagePreview, officePreviewMessage, type PreviewMessage } from './messagePreview.js';
import type { PreviewHandle } from './previewHandle.js';

let host: HTMLElement;
let handles: PreviewHandle[];

function fileOf(name: string, content = 'PK\u0003\u0004binary'): File {
    return new File([content], name, { lastModified: Date.UTC(2026, 0, 1) });
}

function mount(file: File, message: PreviewMessage): PreviewHandle {
    const handle = mountMessagePreview(host, { file, fileName: file.name, memoryKey: `docs/${file.name}`, message });
    handles.push(handle);

    return handle;
}

function rows(): Record<string, string> {
    return Object.fromEntries([...host.querySelectorAll('.preview-info-row')].map((row) => [
        `${row.closest('.preview-info-group')?.querySelector('.preview-info-title')?.textContent}/${row.querySelector('dt')?.textContent}`,
        row.querySelector('dd')?.textContent ?? '',
    ]));
}

function title(): string | null | undefined {
    return host.querySelector('.preview-status h2')?.textContent;
}

function badges(): Array<string | null> {
    return [...host.querySelectorAll('.preview-toolbar .badge')].map((badge) => badge.textContent);
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    handles = [];
    localStorage.clear();
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }

    host.remove();
    vi.restoreAllMocks();
});

describe('officePreviewMessage', () => {
    it('calls every PowerPoint file and OpenDocument presentation a presentation, with its kind as the Type', () => {
        for (const [name, typeLabel] of [
            ['deck.pptx', 'PowerPoint presentation'],
            ['deck.ppt', 'PowerPoint 97–2003 presentation'],
            ['show.PPSX', 'PowerPoint slide show'],
            ['show.pps', 'PowerPoint 97–2003 slide show'],
            ['brand.potx', 'PowerPoint template'],
            ['brand.pot', 'PowerPoint 97–2003 template'],
            ['talk.odp', 'OpenDocument presentation'],
        ]) {
            expect(officePreviewMessage(name ?? ''), name).toMatchObject({ badge: 'Presentation', title: 'This presentation has no preview', typeLabel });
        }
    });

    it('calls OpenDocument text a document and an OpenDocument drawing a drawing', () => {
        expect(officePreviewMessage('letter.odt')).toMatchObject({
            badge: 'Document',
            typeLabel: 'OpenDocument text document',
            title: 'This document has no preview',
        });
        expect(officePreviewMessage('plan.odg')).toMatchObject({
            badge: 'Drawing',
            typeLabel: 'OpenDocument drawing',
            title: 'This drawing has no preview',
        });
    });
});

describe('mountMessagePreview', () => {
    it('shows a presentation as a message under its badge, with only Info in the toolbar', () => {
        mount(fileOf('deck.pptx'), officePreviewMessage('deck.pptx'));

        expect(host.querySelector<HTMLElement>('.preview-frame')?.dataset['state']).toBe('message');
        expect(title()).toBe('This presentation has no preview');
        expect(host.querySelector('.preview-status p')?.textContent)
            .toBe('Its slides aren\'t shown here. Open it with a presentation app, such as PowerPoint or LibreOffice Impress.');
        expect(badges()).toEqual(['Presentation', 'View only']);
        expect([...host.querySelectorAll('.preview-toolbar button')].map((button) => button.textContent)).toEqual(['Info']);
        expect(host.querySelector('.preview-zoom')).toBeNull();
        expect(host.querySelector('.preview-viewport')?.getAttribute('aria-label')).toBe('Presentation preview of deck.pptx');
    });

    it('lists the File group in Info, with the kind of file as the Type', () => {
        mount(fileOf('letter.odt', 'x'.repeat(2048)), officePreviewMessage('letter.odt'));

        expect(rows()).toMatchObject({
            'File/Name': 'letter.odt',
            'File/Type': 'OpenDocument text document',
            'File/Size': '2 KB (2,048 bytes)',
        });
        expect(rows()['File/Modified']).toMatch(/^2026-01-01/);
        expect([...host.querySelectorAll('.preview-info-title')].map((group) => group.textContent)).toEqual(['File']);
    });

    it('says a file of an unknown type isn\'t text, as a binary file', () => {
        mount(fileOf('firmware.bin', '\u0000\u0001'), BINARY_PREVIEW_MESSAGE);

        expect(title()).toBe('This file isn\'t text');
        expect(host.querySelector('.preview-status p')?.textContent)
            .toBe('It holds binary data, which can\'t be shown or edited here.');
        expect(badges()).toEqual(['Binary', 'View only']);
        expect(rows()['File/Type']).toBe('Binary file');
    });

    it('keeps Ctrl+F, Ctrl with +, - or 0 and Ctrl+wheel from the browser page, though it has no Find and no zoom', () => {
        mount(fileOf('deck.pptx'), officePreviewMessage('deck.pptx'));
        const message = host.querySelector('.preview-status') as HTMLElement;

        for (const key of ['f', '=', '-', '0']) {
            const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
            message.dispatchEvent(event);

            expect(event.defaultPrevented, key).toBe(true);
        }

        const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
        Object.defineProperty(wheel, 'ctrlKey', { value: true });
        message.dispatchEvent(wheel);

        expect(wheel.defaultPrevented).toBe(true);
    });

    it('never reads the file, as text or as bytes', () => {
        const reads = [
            vi.spyOn(Blob.prototype, 'text'),
            vi.spyOn(Blob.prototype, 'arrayBuffer'),
            vi.spyOn(Blob.prototype, 'stream'),
            vi.spyOn(Blob.prototype, 'slice'),
        ];
        const handle = mount(fileOf('deck.ppt'), officePreviewMessage('deck.ppt'));
        handle.update(fileOf('deck.ppt', 'changed'));

        expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0, 0, 0]);
    });

    it('lists a new snapshot of the file, and ignores the same one or none', () => {
        const file = fileOf('plan.odg', 'abc');
        const handle = mount(file, officePreviewMessage('plan.odg'));
        handle.update(file);
        handle.update(null);

        expect(rows()['File/Size']).toBe('3 bytes');

        handle.update(fileOf('plan.odg', 'abcdef'));

        expect(rows()['File/Size']).toBe('6 bytes');
        expect(title()).toBe('This drawing has no preview');
    });

    it('takes itself out of the page once destroyed', () => {
        const handle = mount(fileOf('deck.pptx'), officePreviewMessage('deck.pptx'));
        handle.destroy();

        expect(host.querySelector('.preview-frame')).toBeNull();
    });
});
