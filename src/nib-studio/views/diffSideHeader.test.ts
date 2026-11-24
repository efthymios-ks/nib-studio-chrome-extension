import { describe, expect, it } from 'vitest';
import type { DiffSide } from '../app/store.js';
import {
    buildDiffSideHeader,
    buildDiffSidesBar,
    diffDocumentSide,
    diffDocumentSidesKey,
    diffSideDescription,
    diffSideDetail,
    diffSideName,
    formatPastedTime,
} from './diffSideHeader.js';

const WORKSPACE_FILE: DiffSide = { label: 'config.json', path: 'settings/config.json', source: 'file' };
const PASTED_AT = new Date(2026, 0, 5, 9, 7).getTime();

describe('diffDocumentSide', () => {
    it('names a file side with its source and path', () => {
        expect(diffDocumentSide(WORKSPACE_FILE)).toEqual({ name: 'config.json', source: 'file', path: 'settings/config.json' });
        expect(diffDocumentSide({ label: 'b.json', path: 'b.json', source: 'open-tab' })).toEqual({ name: 'b.json', source: 'open-tab', path: 'b.json' });
        expect(diffDocumentSide({ label: 'other.json', source: 'disk' })).toEqual({ name: 'other.json', source: 'disk', path: 'other.json' });
    });

    it('names text with no file by where it came from, and never records when it was pasted', () => {
        expect(diffDocumentSide({ label: 'Clipboard', source: 'clipboard', text: 'a' })).toEqual({ name: 'Clipboard', source: 'clipboard' });
        expect(diffDocumentSide({ label: 'Pasted text', source: 'paste', text: 'a', pastedAt: PASTED_AT })).toEqual({ name: 'Pasted text', source: 'pasted' });
        expect(diffDocumentSide({ label: 'Edited text', source: 'paste', text: 'a', pastedAt: PASTED_AT, edited: true }))
            .toEqual({ name: 'Edited text', source: 'edited' });
        expect(diffDocumentSide(null)).toEqual({ name: 'Not chosen', source: 'none' });
    });
});

describe('diffDocumentSidesKey', () => {
    it('changes when a side is renamed, and not when only its paste time does', () => {
        const pasted = (time: number): DiffSide => ({ label: 'Pasted text', source: 'paste', text: 'a', pastedAt: time });

        expect(diffDocumentSidesKey(WORKSPACE_FILE, pasted(1))).toBe(diffDocumentSidesKey(WORKSPACE_FILE, pasted(2)));
        expect(diffDocumentSidesKey(WORKSPACE_FILE, pasted(1))).not.toBe(diffDocumentSidesKey(pasted(1), WORKSPACE_FILE));
    });
});

function actionsOf(header: HTMLElement): string[] {
    return [...header.querySelectorAll<HTMLElement>('[data-side-action]')].map((button) => button.dataset['sideAction'] ?? '');
}

describe('diffSideName', () => {
    it('names each kind of side', () => {
        expect(diffSideName(null)).toBe('Not chosen');
        expect(diffSideName({ label: 'x', source: 'clipboard' })).toBe('Clipboard');
        expect(diffSideName({ label: 'x', source: 'paste' })).toBe('Pasted text');
        expect(diffSideName({ label: 'x', source: 'paste', edited: true })).toBe('Edited text');
        expect(diffSideName(WORKSPACE_FILE)).toBe('config.json');
        expect(diffSideName({ label: 'Dropped file', source: 'disk' })).toBe('Dropped file');
    });
});

describe('formatPastedTime', () => {
    it('pads hours and minutes to two digits', () => {
        expect(formatPastedTime(PASTED_AT)).toBe('09:07');
    });
});

describe('diffSideDetail', () => {
    it('describes where each side came from', () => {
        expect(diffSideDetail(null)).toBe('Drop, paste or pick the other side');
        expect(diffSideDetail({ label: 'x', source: 'clipboard' })).toBe('Text read from the clipboard');
        expect(diffSideDetail({ label: 'x', source: 'paste' })).toBe('Text pasted into Nib Studio');
        expect(diffSideDetail({ label: 'x', source: 'paste', pastedAt: PASTED_AT })).toBe('Pasted at 09:07');
        expect(diffSideDetail({ label: 'x', source: 'paste', pastedAt: PASTED_AT, edited: true })).toBe('Edited at 09:07');
        expect(diffSideDetail({ label: 'a.json', source: 'disk' })).toBe('a.json (from disk)');
        expect(diffSideDetail({ label: 'a', path: 'docs/a.json', source: 'open-tab' })).toBe('docs/a.json (open tab)');
        expect(diffSideDetail(WORKSPACE_FILE)).toBe('settings/config.json');
    });
});

describe('diffSideDescription', () => {
    it('prefixes the detail with the side badge', () => {
        expect(diffSideDescription('modified', WORKSPACE_FILE)).toBe('Modified: settings/config.json');
    });
});

describe('buildDiffSideHeader', () => {
    it('shows badge, name, detail and every action for a filled side', () => {
        const header = buildDiffSideHeader('original', WORKSPACE_FILE);

        expect(header.dataset['side']).toBe('original');
        expect(header.dataset['empty']).toBeUndefined();
        expect(header.title).toBe('Original: settings/config.json');
        expect(header.querySelector('.diff-side-badge')?.textContent).toBe('Original');
        expect(header.querySelector('.diff-side-name')?.textContent).toBe('config.json');
        expect(header.querySelector('.diff-side-path')?.textContent).toBe('settings/config.json');
        expect(actionsOf(header)).toEqual(['paste', 'edit', 'choose', 'clear']);
    });

    it('marks an empty side and leaves out Clear', () => {
        const header = buildDiffSideHeader('modified', null);

        expect(header.dataset['empty']).toBe('true');
        expect(header.querySelector('.diff-side-name')?.textContent).toBe('Not chosen');
        expect(actionsOf(header)).toEqual(['paste', 'edit', 'choose']);
    });

    it('makes every action a non-submitting button with a tooltip', () => {
        const header = buildDiffSideHeader('original', WORKSPACE_FILE);

        for (const button of header.querySelectorAll('button')) {
            expect(button.getAttribute('type')).toBe('button');
            expect(button.title).not.toBe('');
        }
    });
});

describe('buildDiffSidesBar', () => {
    it('puts both headers either side of a hidden arrow', () => {
        const bar = buildDiffSidesBar(WORKSPACE_FILE, null);
        const headers = [...bar.querySelectorAll<HTMLElement>('.diff-side-header')];

        expect(headers.map((header) => header.dataset['side'])).toEqual(['original', 'modified']);
        expect(bar.querySelector('.diff-sides-arrow')?.getAttribute('aria-hidden')).toBe('true');
    });
});
