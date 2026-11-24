import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { destroyLiveEditors, markedText, mountLiveEditor } from '../testing/liveEditor.js';
import { flushAsync, ignoreSelectionChange, pressKey } from '../testing/testHelpers.js';
import { closeLinkPopover, linkTargetAt, setLinkUrl } from './linkPopover.js';

beforeEach(() => {
    document.addEventListener('selectionchange', ignoreSelectionChange, true);
});

afterEach(() => {
    closeLinkPopover();
    destroyLiveEditors();
    document.body.replaceChildren();
    document.removeEventListener('selectionchange', ignoreSelectionChange, true);
});

function popover(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.link-popover');
}

function field(): HTMLInputElement {
    return popover()!.querySelector<HTMLInputElement>('input')!;
}

async function openWithCtrlKAsync(view: EditorView): Promise<void> {
    pressKey(view.contentDOM, 'k', { ctrlKey: true });
    await flushAsync();
}

function answer(value: string, key: 'Enter' | 'Escape'): void {
    field().value = value;
    pressKey(field(), key);
}

describe('linkTargetAt', () => {
    it.each([
        ['an inline link', 'see [the d‸ocs](https://x.y "T") now', 'link', 'the docs', 'https://x.y'],
        ['a reference link', 'see [do‸cs][d]\n\n[d]: https://d.example', 'link', 'docs', 'https://d.example'],
        ['a collapsed reference link', 'see [Do‸cs][]\n\n[docs]: https://d.example', 'link', 'Docs', 'https://d.example'],
        ['a link whose text is an address', 'see [https://a‸.example](https://b.example)', 'link', 'https://a.example', 'https://b.example'],
        ['an angle-bracket link', 'go <https://a‸.b> now', 'autolink', 'https://a.b', 'https://a.b'],
        ['a bare address', 'go https://a‸.b now', 'url', 'https://a.b', 'https://a.b'],
        ['the word at the caret', 'make it lo‸ud', 'text', 'loud', ''],
        ['the selected text', 'make «it loud»', 'text', 'it loud', ''],
    ])('finds %s', (_name, text, kind, linkText, url) => {
        const target = linkTargetAt(mountLiveEditor(text).view.state);

        expect([target.kind, target.text, target.url]).toEqual([kind, linkText, url]);
    });
});

describe('setLinkUrl', () => {
    it.each([
        ['changes the address and keeps the title', 'see [the d‸ocs](https://x.y "T") now', 'https://new.example', 'see [the docs](https://new.example "T") now'],
        ['removes the link and keeps its text for an empty address', 'see [**the** d‸ocs](https://x.y) now', '', 'see **the** docs now'],
        ['turns a reference link into an inline link', 'see [do‸cs][d]\n\n[d]: https://d.example', 'https://e.example', 'see [docs](https://e.example)\n\n[d]: https://d.example'],
        ['links the selected text', 'make «it loud»', 'https://x.y', 'make [it loud](https://x.y)'],
        ['links an address with spaces in angle brackets', 'make «it»', 'file:///My Notes.md', 'make [it](<file:///My Notes.md>)'],
        ['inserts the address as a link where there is no word', 'see ‸ now', 'https://x.y', 'see [https://x.y](https://x.y) now'],
        ['changes an angle-bracket link', 'go <https://a‸.b> now', 'https://c.d', 'go <https://c.d> now'],
    ])('%s', (_name, text, url, expected) => {
        const state = mountLiveEditor(text).view.state;
        const spec = setLinkUrl(state, linkTargetAt(state), url);

        expect(state.update(spec!).state.doc.toString()).toBe(expected);
    });

    it('changes nothing for an empty address on plain text', () => {
        const state = mountLiveEditor('make it lo‸ud').view.state;

        expect(setLinkUrl(state, linkTargetAt(state), '  ')).toBeNull();
    });
});

describe('the link popover', () => {
    it('opens on Ctrl+K with the link address and applies a new one on Enter, as one undo step', async () => {
        const view = mountLiveEditor('see [the d‸ocs](https://x.y) now').view;

        await openWithCtrlKAsync(view);

        expect(popover()?.getAttribute('role')).toBe('dialog');
        expect(field().value).toBe('https://x.y');
        expect(document.activeElement).toBe(field());

        answer('https://new.example', 'Enter');

        expect(popover()).toBeNull();
        expect(markedText(view)).toBe('see [the docs](https://new.example)‸ now');

        undo(view);

        expect(view.state.doc.toString()).toBe('see [the docs](https://x.y) now');
    });

    it('cancels on Esc', async () => {
        const view = mountLiveEditor('see [the d‸ocs](https://x.y) now').view;

        await openWithCtrlKAsync(view);
        answer('https://other.example', 'Escape');

        expect(popover()).toBeNull();
        expect(view.state.doc.toString()).toBe('see [the docs](https://x.y) now');
    });

    it('removes the link for an empty address', async () => {
        const view = mountLiveEditor('see [the d‸ocs](https://x.y) now').view;

        await openWithCtrlKAsync(view);
        answer('', 'Enter');

        expect(view.state.doc.toString()).toBe('see the docs now');
    });

    it('creates a link from a selection with Ctrl+K, and nothing until Enter', async () => {
        const view = mountLiveEditor('make «it loud»').view;

        await openWithCtrlKAsync(view);

        expect(field().value).toBe('');
        expect(view.state.doc.toString()).toBe('make it loud');

        answer('https://x.y', 'Enter');

        expect(view.state.doc.toString()).toBe('make [it loud](https://x.y)');
    });

    it('closes on a click outside, without changes', async () => {
        const view = mountLiveEditor('see [the d‸ocs](https://x.y) now').view;

        await openWithCtrlKAsync(view);
        field().value = 'https://changed.example';
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

        expect(popover()).toBeNull();
        expect(view.state.doc.toString()).toBe('see [the docs](https://x.y) now');
    });

    it('opens from the editor bar Link button', async () => {
        const view = mountLiveEditor('see [the d‸ocs](https://x.y) now', { withBar: true }).view;
        const button = document.querySelector<HTMLButtonElement>('.editor-bar-button[data-command="link"]')!;

        button.click();
        await flushAsync();

        expect(field().value).toBe('https://x.y');
        expect(document.activeElement).toBe(field());
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(view.state.doc.toString()).toBe('see [the docs](https://x.y) now');
    });

    it('keeps the source edit of the Editor view', () => {
        const view = mountLiveEditor('make «it»', { livePreview: false }).view;

        pressKey(view.contentDOM, 'k', { ctrlKey: true });

        expect(popover()).toBeNull();
        expect(view.state.doc.toString()).toBe('make [it](url)');
    });
});
